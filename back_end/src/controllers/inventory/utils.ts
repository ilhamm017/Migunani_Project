import { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { Product, Category, ProductCategory, StockMutation, PurchaseOrder, PurchaseOrderItem, Supplier, sequelize, SupplierInvoice, SupplierPayment, Account, Journal, JournalLine } from '../../models';
import { JournalService } from '../../services/JournalService';
import { Op, Transaction } from 'sequelize';
import { InventoryCostService } from '../../services/InventoryCostService';
import { TaxConfigService } from '../../services/TaxConfigService';

export const ALLOWED_IMPORT_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);
export const REQUIRED_IMPORT_HEADERS = [
    'NAMA BARANG',
    'VARIAN',
    'KATEGORI BARANG',
    'HARGA BELI',
    'HARGA JUAL',
    'UNIT',
    'BARCODE',
    'KETERANGAN',
    'TIPE MODAL',
    'VARIAN HARGA',
    'GROSIR',
    'STATUS',
    'STOK',
    'TOTAL MODAL'
] as const;
export const IMPORT_ERROR_RESPONSE_LIMIT = 200;

export type ImportHeader = typeof REQUIRED_IMPORT_HEADERS[number];

export interface ImportFileRow {
    rowNumber: number;
    sku: string;
    skuKey: string;
    name: string;
    categoryName: string;
    unit: string;
    barcode: string;
    keterangan: string;
    tipeModal: string;
    statusRaw: string;
    basePriceRaw: unknown;
    priceRaw: unknown;
    stockRaw: unknown;
    totalModalRaw: unknown;
    varianHargaRaw: unknown;
    grosirRaw: unknown;
}

export interface ImportErrorItem {
    row: number;
    sku: string;
    reason: string;
}

export interface ImportSummary {
    total_rows: number;
    processed_rows: number;
    created_count: number;
    updated_count: number;
    error_count: number;
}

export interface ImportResult {
    summary: ImportSummary;
    errors: ImportErrorItem[];
}

export interface ImportPreviewRow {
    row: number;
    sku: string;
    name: string;
    category_name: string;
    unit: string;
    barcode: string;
    base_price: number | null;
    price: number | null;
    stock_quantity: number | null;
    status: 'active' | 'inactive';
    keterangan: string;
    tipe_modal: string;
    varian_harga_text: string;
    grosir_text: string;
    total_modal: number | null;
    is_valid: boolean;
    reasons: string[];
}

export interface ImportPreviewSummary {
    total_rows: number;
    valid_rows: number;
    invalid_rows: number;
    error_count: number;
}

export interface ImportPreviewResult {
    summary: ImportPreviewSummary;
    rows: ImportPreviewRow[];
    errors: ImportErrorItem[];
}

export interface ImportNormalizedRow {
    row: number;
    sku: string;
    skuKey: string;
    name: string;
    categoryName: string;
    unit: string;
    barcode: string | null;
    basePrice: number;
    price: number;
    stockQuantity: number;
    status: 'active' | 'inactive';
    keterangan: string | null;
    tipeModal: string | null;
    varianHarga: unknown | null;
    grosir: unknown | null;
    totalModal: number | null;
}

export const REQUIRED_PRODUCT_COLUMNS = ['description', 'image_url', 'keterangan', 'tipe_modal', 'varian_harga', 'grosir', 'total_modal'] as const;
export const ALLOWED_PRODUCT_IMAGE_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
]);
export const PRODUCT_IMAGE_MAX_SIZE_BYTES = 2 * 1024 * 1024;

export const resolveProductImageExtension = (file: Express.Multer.File): string => {
    const extFromName = path.extname(file.originalname || '').toLowerCase();
    if (/^\.[a-z0-9]+$/.test(extFromName)) return extFromName;

    if (file.mimetype === 'image/jpeg') return '.jpg';
    if (file.mimetype === 'image/png') return '.png';
    if (file.mimetype === 'image/webp') return '.webp';
    if (file.mimetype === 'image/gif') return '.gif';
    return '.jpg';
};

export const parseImportStatus = (rawStatus: string): 'active' | 'inactive' => {
    const normalized = rawStatus.trim().toUpperCase();
    if (!normalized) return 'active';

    const inactiveTokens = new Set([
        'INACTIVE',
        'NONACTIVE',
        'NON-ACTIVE',
        'NON AKTIF',
        'TIDAK AKTIF',
        'DISABLED',
        'OFF',
        '0',
        'FALSE'
    ]);

    if (inactiveTokens.has(normalized)) return 'inactive';
    return 'active';
};

export const SKU_CODE_PATTERN = /\b([A-Z0-9]{2,}(?:-[A-Z0-9]{2,})+)\b/i;
export const SKU_SIZE_BLACKLIST_PATTERNS = [
    /\b\d{2,3}\s*\/\s*\d{2,3}\s*-\s*\d{2,3}\b/i, // contoh: 100/80-14
    /\b\d{2,3}\s*-\s*\d{2,3}\b/i, // contoh: 80-14
    /\b\d{1,3}(?:\.\d+)?\s*(?:L|ML|MM|CM|INCH|\"|')\b/i // contoh: 0.8L, 14"
];

export const extractSkuCandidate = (value: string): string | null => {
    const source = value.trim();
    if (!source) return null;

    const match = source.match(SKU_CODE_PATTERN);
    if (!match?.[1]) return null;

    const candidate = match[1].toUpperCase();
    const hasBlacklistedSizePattern = SKU_SIZE_BLACKLIST_PATTERNS.some((pattern) => pattern.test(candidate));
    if (hasBlacklistedSizePattern) return null;
    // Guard: reduce false positives on plain text tokens.
    if (!/\d/.test(candidate)) return null;
    if (!/[A-Z]/.test(candidate)) return null;
    return candidate;
};

export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const stripSkuFromText = (source: string, sku: string): string =>
    source
        .replace(new RegExp(escapeRegex(sku), 'ig'), ' ')
        .replace(/^[\s\-_|:;,/]+|[\s\-_|:;,/]+$/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

export const resolveSkuAndNameFromLegacyRow = (namaBarangRaw: string, varianRaw: string): { sku: string; name: string } => {
    const namaBarang = namaBarangRaw.trim();
    const varian = varianRaw.trim();

    const skuFromNamaBarang = extractSkuCandidate(namaBarang);
    if (skuFromNamaBarang) {
        const namaDariNamaBarang = stripSkuFromText(namaBarang, skuFromNamaBarang);
        return {
            sku: skuFromNamaBarang,
            name: varian || namaDariNamaBarang
        };
    }

    const skuFromVarian = extractSkuCandidate(varian);
    if (skuFromVarian) {
        const namaDariVarian = stripSkuFromText(varian, skuFromVarian);
        return {
            sku: skuFromVarian,
            name: namaBarang || namaDariVarian
        };
    }

    return {
        sku: '',
        name: namaBarang || varian
    };
};

export const normalizeHeader = (value: string): string =>
    value.trim().replace(/\s+/g, ' ').toUpperCase();

export const readCellText = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value).trim();
    if (value instanceof Date) return value.toISOString();

    if (typeof value === 'object') {
        const richValue = value as { text?: string; result?: unknown; richText?: Array<{ text?: string }> };
        if (typeof richValue.text === 'string') return richValue.text.trim();
        if (Array.isArray(richValue.richText)) {
            return richValue.richText.map((item) => item.text ?? '').join('').trim();
        }
        if (richValue.result !== undefined) return readCellText(richValue.result);
    }

    return String(value).trim();
};

export const isBlankValue = (value: unknown): boolean => readCellText(value) === '';

export const parseFlexibleNumber = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    let normalized = readCellText(value)
        .replace(/\s+/g, '')
        .replace(/[^0-9,.-]/g, '');
    if (!normalized) return null;

    const hasComma = normalized.includes(',');
    const hasDot = normalized.includes('.');

    if (hasComma && hasDot) {
        if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
            normalized = normalized.replace(/\./g, '').replace(',', '.');
        } else {
            normalized = normalized.replace(/,/g, '');
        }
    } else if (hasComma) {
        if (/,\d{1,2}$/.test(normalized)) {
            normalized = normalized.replace(',', '.');
        } else {
            normalized = normalized.replace(/,/g, '');
        }
    } else if (hasDot) {
        if (!/\.\d{1,2}$/.test(normalized)) {
            normalized = normalized.replace(/\./g, '');
        }
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
};

export const parseRequiredNumber = (value: unknown, fieldName: string): number => {
    const parsed = parseFlexibleNumber(value);
    if (parsed === null) {
        throw new Error(`${fieldName} harus berupa angka`);
    }
    return Math.max(0, parsed);
};

export const parseStockQuantity = (value: unknown): number => {
    if (isBlankValue(value)) return 0;
    const parsed = parseFlexibleNumber(value);
    if (parsed === null) {
        throw new Error('STOK harus berupa angka');
    }

    const stock = Math.trunc(parsed);
    return Math.max(0, stock);
};

export const parseOptionalNumber = (value: unknown, fieldName: string): number | null => {
    if (isBlankValue(value)) return null;
    const parsed = parseFlexibleNumber(value);
    if (parsed === null) {
        throw new Error(`${fieldName} harus berupa angka`);
    }
    return Math.max(0, parsed);
};

export const parseOptionalJson = (value: unknown, _fieldName: string): unknown | null => {
    if (isBlankValue(value)) return null;
    if (typeof value === 'object') return value;
    const text = readCellText(value);
    try {
        return JSON.parse(text);
    } catch {
        // Legacy import compatibility: plain text is allowed and stored as JSON string.
        return text;
    }
};

export const normalizeGrosirPayload = (value: unknown, fallbackPrice: number): Record<string, number> => {
    let minQty: number | null = null;
    let price: number | null = null;

    const normalizedFallbackPrice = Math.max(0, fallbackPrice);

    if (Array.isArray(value) && value.length > 0 && value[0] && typeof value[0] === 'object') {
        const item = value[0] as Record<string, unknown>;
        minQty = parseFlexibleNumber(item.min_qty ?? item.qty ?? item.minQty);
        price = parseFlexibleNumber(item.price ?? item.harga);
    } else if (value && typeof value === 'object') {
        const item = value as Record<string, unknown>;
        minQty = parseFlexibleNumber(item.min_qty ?? item.qty ?? item.minQty);
        price = parseFlexibleNumber(item.price ?? item.harga);
    } else {
        price = parseFlexibleNumber(value);
    }

    const payload: Record<string, number> = {
        min_qty: minQty === null ? 10 : Math.max(0, Math.trunc(minQty))
    };

    payload.price = price === null ? normalizedFallbackPrice : Math.max(0, price);
    return payload;
};

export const isSupportedImportFile = (fileName: string): boolean =>
    ALLOWED_IMPORT_EXTENSIONS.has(path.extname(fileName).toLowerCase());

export const loadWorkbookFromBuffer = async (buffer: Buffer | Uint8Array, extension: string): Promise<ExcelJS.Workbook> => {
    const workbook = new ExcelJS.Workbook();
    if (extension === '.csv') {
        const stream = Readable.from(buffer);
        await workbook.csv.read(stream);
    } else {
        // Cast needed because exceljs uses older Buffer typing than current @types/node.
        await workbook.xlsx.load(buffer as any);
    }
    return workbook;
};

export const loadWorkbookFromPath = async (filePath: string): Promise<ExcelJS.Workbook> => {
    const workbook = new ExcelJS.Workbook();
    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.csv') {
        await workbook.csv.readFile(filePath);
    } else {
        await workbook.xlsx.readFile(filePath);
    }
    return workbook;
};

export const getImportWorksheet = (workbook: ExcelJS.Workbook): ExcelJS.Worksheet => {
    const worksheet = workbook.getWorksheet('Barang') ?? workbook.worksheets[0];
    if (!worksheet) {
        throw new Error('Worksheet tidak ditemukan pada file import');
    }
    return worksheet;
};

export const resolveHeaderMap = (worksheet: ExcelJS.Worksheet): Record<ImportHeader, number> => {
    const headerRow = worksheet.getRow(1);
    const map = new Map<string, number>();

    headerRow.eachCell((cell, colNumber) => {
        const headerName = normalizeHeader(readCellText(cell.value));
        if (headerName) map.set(headerName, colNumber);
    });

    const missing = REQUIRED_IMPORT_HEADERS.filter((header) => !map.has(header));
    if (missing.length > 0) {
        throw new Error(`Header wajib tidak lengkap: ${missing.join(', ')}`);
    }

    return REQUIRED_IMPORT_HEADERS.reduce((acc, header) => {
        const colNumber = map.get(header);
        if (!colNumber) {
            throw new Error(`Header "${header}" tidak ditemukan`);
        }
        acc[header] = colNumber;
        return acc;
    }, {} as Record<ImportHeader, number>);
};

export const parseImportRows = (worksheet: ExcelJS.Worksheet, headerMap: Record<ImportHeader, number>): ImportFileRow[] => {
    const rows: ImportFileRow[] = [];

    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;

        const rowValues = REQUIRED_IMPORT_HEADERS.map((header) => row.getCell(headerMap[header]).value);
        const isCompletelyEmpty = rowValues.every((value) => isBlankValue(value));
        if (isCompletelyEmpty) return;

        const namaBarangRaw = readCellText(row.getCell(headerMap['NAMA BARANG']).value);
        const varianRaw = readCellText(row.getCell(headerMap['VARIAN']).value);
        const { sku, name } = resolveSkuAndNameFromLegacyRow(namaBarangRaw, varianRaw);

        rows.push({
            rowNumber,
            sku,
            skuKey: sku.toUpperCase(),
            name,
            categoryName: readCellText(row.getCell(headerMap['KATEGORI BARANG']).value) || 'Uncategorized',
            unit: readCellText(row.getCell(headerMap['UNIT']).value) || 'Pcs',
            barcode: readCellText(row.getCell(headerMap['BARCODE']).value),
            keterangan: readCellText(row.getCell(headerMap['KETERANGAN']).value),
            tipeModal: readCellText(row.getCell(headerMap['TIPE MODAL']).value),
            statusRaw: readCellText(row.getCell(headerMap['STATUS']).value),
            basePriceRaw: row.getCell(headerMap['HARGA BELI']).value,
            priceRaw: row.getCell(headerMap['HARGA JUAL']).value,
            stockRaw: row.getCell(headerMap['STOK']).value,
            totalModalRaw: row.getCell(headerMap['TOTAL MODAL']).value,
            varianHargaRaw: row.getCell(headerMap['VARIAN HARGA']).value,
            grosirRaw: row.getCell(headerMap['GROSIR']).value
        });
    });

    return rows;
};

export const splitCategoryNames = (rawCategoryName: string): string[] => {
    const source = rawCategoryName.trim() || 'Uncategorized';
    const normalized = source
        .replace(/\s+(dan|and)\s+/gi, ',')
        .replace(/[&;/+|]/g, ',');

    const names = normalized
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

    if (names.length === 0) return ['Uncategorized'];

    const uniqueNames = new Map<string, string>();
    names.forEach((name) => {
        const key = name.toLowerCase();
        if (!uniqueNames.has(key)) {
            uniqueNames.set(key, name);
        }
    });
    return [...uniqueNames.values()];
};

export const getOrCreateCategoryIds = async (rawCategoryName: string, transaction: Transaction): Promise<number[]> => {
    const categoryNames = splitCategoryNames(rawCategoryName);
    const categoryIds: number[] = [];

    for (const categoryName of categoryNames) {
        let category = await Category.findOne({ where: { name: categoryName }, transaction });
        if (!category) {
            category = await Category.create({
                name: categoryName,
                description: null
            }, { transaction });
        }
        categoryIds.push(category.id);
    }

    return categoryIds;
};

export const syncProductCategories = async (productId: string, categoryIds: number[], transaction: Transaction) => {
    const uniqueCategoryIds = [...new Set(categoryIds)];
    await ProductCategory.destroy({ where: { product_id: productId }, transaction });

    if (uniqueCategoryIds.length === 0) return;

    await ProductCategory.bulkCreate(
        uniqueCategoryIds.map((categoryId) => ({
            product_id: productId,
            category_id: categoryId
        })),
        { transaction }
    );
};

export const ensureProductColumnsReady = async () => {
    const tableDefinition = await sequelize.getQueryInterface().describeTable('products');
    const missingProductColumns = REQUIRED_PRODUCT_COLUMNS.filter((column) => !(column in tableDefinition));
    if (missingProductColumns.length > 0) {
        throw new Error(
            `Kolom products belum lengkap (${missingProductColumns.join(', ')}). Jalankan migrasi SQL: back_end/sql/20260212_add_products_import_columns.sql`
        );
    }
};

export const buildPreviewRow = (row: ImportFileRow): ImportPreviewRow => {
    const reasons: string[] = [];
    const rawSku = row.sku.trim();
    const rawName = row.name.trim();
    const sku = rawSku || rawName;
    const name = rawName || rawSku;

    if (!sku && !name) reasons.push('SKU atau Nama produk minimal salah satu wajib diisi');

    const basePrice = parseFlexibleNumber(row.basePriceRaw);
    if (basePrice === null) reasons.push('HARGA BELI harus berupa angka');

    const price = parseFlexibleNumber(row.priceRaw);
    if (price === null) reasons.push('HARGA JUAL harus berupa angka');

    let stockQuantity: number | null = null;
    if (isBlankValue(row.stockRaw)) {
        stockQuantity = 0;
    } else {
        const stockNumber = parseFlexibleNumber(row.stockRaw);
        if (stockNumber === null) {
            reasons.push('STOK harus berupa angka');
        } else {
            stockQuantity = Math.max(0, Math.trunc(stockNumber));
        }
    }

    let totalModal: number | null = null;
    if (!isBlankValue(row.totalModalRaw)) {
        totalModal = parseFlexibleNumber(row.totalModalRaw);
        if (totalModal === null) reasons.push('TOTAL MODAL harus berupa angka');
        else totalModal = Math.max(0, totalModal);
    }
    const varianHargaText = readCellText(row.varianHargaRaw);
    const grosirText = readCellText(row.grosirRaw);

    return {
        row: row.rowNumber,
        sku,
        name,
        category_name: row.categoryName.trim() || 'Uncategorized',
        unit: row.unit.trim() || 'Pcs',
        barcode: row.barcode.trim(),
        base_price: basePrice === null ? null : Math.max(0, basePrice),
        price: price === null ? null : Math.max(0, price),
        stock_quantity: stockQuantity,
        status: parseImportStatus(row.statusRaw),
        keterangan: row.keterangan.trim(),
        tipe_modal: row.tipeModal.trim(),
        varian_harga_text: varianHargaText,
        grosir_text: grosirText,
        total_modal: totalModal,
        is_valid: reasons.length === 0,
        reasons
    };
};

export const buildPreviewFromWorkbook = (workbook: ExcelJS.Workbook): ImportPreviewResult => {
    const worksheet = getImportWorksheet(workbook);
    const headerMap = resolveHeaderMap(worksheet);
    const fileRows = parseImportRows(worksheet, headerMap);
    const rows = fileRows.map((row) => buildPreviewRow(row));

    const errors: ImportErrorItem[] = [];
    rows.forEach((row) => {
        if (!row.is_valid && errors.length < IMPORT_ERROR_RESPONSE_LIMIT) {
            errors.push({
                row: row.row,
                sku: row.sku || '-',
                reason: row.reasons.join('; ')
            });
        }
    });

    const invalidRows = rows.filter((row) => !row.is_valid).length;
    return {
        summary: {
            total_rows: rows.length,
            valid_rows: rows.length - invalidRows,
            invalid_rows: invalidRows,
            error_count: invalidRows
        },
        rows,
        errors
    };
};

export const runInventoryPreviewFromBuffer = async (buffer: Buffer | Uint8Array, originalName: string): Promise<ImportPreviewResult> => {
    const extension = path.extname(originalName).toLowerCase();
    if (!isSupportedImportFile(originalName)) {
        throw new Error('Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv');
    }

    const workbook = await loadWorkbookFromBuffer(buffer, extension);
    return buildPreviewFromWorkbook(workbook);
};

export const runInventoryPreviewFromPath = async (filePath: string): Promise<ImportPreviewResult> => {
    if (!isSupportedImportFile(filePath)) {
        throw new Error('Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv');
    }

    const workbook = await loadWorkbookFromPath(filePath);
    return buildPreviewFromWorkbook(workbook);
};

export const normalizeCommitRows = (rowsPayload: unknown[]): { rows: ImportNormalizedRow[]; errors: ImportErrorItem[] } => {
    const rows: ImportNormalizedRow[] = [];
    const errors: ImportErrorItem[] = [];

    rowsPayload.forEach((rawRow, idx) => {
        const data = (rawRow ?? {}) as Record<string, unknown>;
        const rowNumber = Number(data.row) || idx + 2;
        const rawSku = readCellText(data.sku);
        const reasons: string[] = [];

        const rawName = readCellText(data.name);
        const sku = rawSku || rawName;
        const name = rawName || rawSku;
        const categoryName = readCellText(data.category_name) || 'Uncategorized';
        const unit = readCellText(data.unit) || 'Pcs';
        const barcodeText = readCellText(data.barcode);
        const keteranganText = readCellText(data.keterangan);
        const tipeModalText = readCellText(data.tipe_modal);
        const varianHargaText = readCellText(data.varian_harga_text);
        const grosirText = readCellText(data.grosir_text);

        if (!sku && !name) reasons.push('SKU atau Nama produk minimal salah satu wajib diisi');

        let basePrice: number | null = null;
        try {
            basePrice = parseRequiredNumber(data.base_price, 'HARGA BELI');
        } catch (error) {
            reasons.push(error instanceof Error ? error.message : 'HARGA BELI tidak valid');
        }

        let price: number | null = null;
        try {
            price = parseRequiredNumber(data.price, 'HARGA JUAL');
        } catch (error) {
            reasons.push(error instanceof Error ? error.message : 'HARGA JUAL tidak valid');
        }

        let stockQuantity: number | null = null;
        try {
            stockQuantity = parseStockQuantity(data.stock_quantity);
        } catch (error) {
            reasons.push(error instanceof Error ? error.message : 'STOK tidak valid');
        }

        let totalModal: number | null = null;
        try {
            totalModal = parseOptionalNumber(data.total_modal, 'TOTAL MODAL');
        } catch (error) {
            reasons.push(error instanceof Error ? error.message : 'TOTAL MODAL tidak valid');
        }

        let varianHarga: unknown | null = null;
        try {
            varianHarga = parseOptionalJson(varianHargaText, 'VARIAN HARGA');
        } catch (error) {
            reasons.push(error instanceof Error ? error.message : 'VARIAN HARGA tidak valid');
        }

        let grosir: unknown | null = null;
        try {
            grosir = parseOptionalJson(grosirText, 'GROSIR');
        } catch (error) {
            reasons.push(error instanceof Error ? error.message : 'GROSIR tidak valid');
        }
        grosir = normalizeGrosirPayload(grosir, price ?? 0);

        if (reasons.length > 0 || basePrice === null || price === null || stockQuantity === null) {
            errors.push({
                row: rowNumber,
                sku: sku || name || '-',
                reason: reasons.join('; ') || 'Data tidak valid'
            });
            return;
        }

        rows.push({
            row: rowNumber,
            sku,
            skuKey: sku.toUpperCase(),
            name,
            categoryName,
            unit,
            barcode: barcodeText || null,
            basePrice,
            price,
            stockQuantity,
            status: parseImportStatus(readCellText(data.status)),
            keterangan: keteranganText || null,
            tipeModal: tipeModalText || null,
            varianHarga,
            grosir,
            totalModal
        });
    });

    const getCompletenessScore = (row: ImportNormalizedRow): number => {
        let score = 0;
        if (row.name.trim()) score += 1;
        if (row.categoryName.trim() && row.categoryName.trim().toLowerCase() !== 'uncategorized') score += 1;
        if (row.unit.trim() && row.unit.trim().toLowerCase() !== 'pcs') score += 1;
        if (row.barcode) score += 1;
        if (row.keterangan) score += 1;
        if (row.tipeModal) score += 1;
        if (row.varianHarga !== null) score += 1;
        if (row.grosir !== null) score += 1;
        if (row.totalModal !== null) score += 1;
        if (row.stockQuantity > 0) score += 1;
        if (row.basePrice > 0) score += 1;
        if (row.price > 0) score += 1;
        return score;
    };

    const deduplicatedBySku = new Map<string, ImportNormalizedRow>();
    rows.forEach((row) => {
        const existing = deduplicatedBySku.get(row.skuKey);
        if (!existing) {
            deduplicatedBySku.set(row.skuKey, row);
            return;
        }

        const existingScore = getCompletenessScore(existing);
        const currentScore = getCompletenessScore(row);
        if (currentScore > existingScore) {
            deduplicatedBySku.set(row.skuKey, row);
            return;
        }

        if (currentScore === existingScore) {
            const existingTextWeight = existing.name.length + (existing.keterangan?.length ?? 0) + (existing.barcode?.length ?? 0);
            const currentTextWeight = row.name.length + (row.keterangan?.length ?? 0) + (row.barcode?.length ?? 0);
            if (currentTextWeight > existingTextWeight) {
                deduplicatedBySku.set(row.skuKey, row);
                return;
            }

            if (currentTextWeight === existingTextWeight && row.row < existing.row) {
                deduplicatedBySku.set(row.skuKey, row);
            }
        }
    });

    const deduplicatedRows = [...deduplicatedBySku.values()].sort((a, b) => a.row - b.row);
    return { rows: deduplicatedRows, errors };
};

export const commitNormalizedRows = async (
    rows: ImportNormalizedRow[],
    totalRows: number,
    initialErrors: ImportErrorItem[] = []
): Promise<ImportResult> => {
    await ensureProductColumnsReady();
    const batchReference = `IMPORT-${Date.now()}`;
    const summary: ImportSummary = {
        total_rows: totalRows,
        processed_rows: 0,
        created_count: 0,
        updated_count: 0,
        error_count: 0
    };
    const errors: ImportErrorItem[] = [];

    const pushError = (item: ImportErrorItem) => {
        summary.error_count += 1;
        if (errors.length < IMPORT_ERROR_RESPONSE_LIMIT) errors.push(item);
    };
    initialErrors.forEach(pushError);

    for (const row of rows) {
        const transaction = await sequelize.transaction();
        try {
            const categoryIds = await getOrCreateCategoryIds(row.categoryName, transaction);
            const primaryCategoryId = categoryIds[0];
            const importPayload = {
                sku: row.sku,
                name: row.name,
                category_id: primaryCategoryId,
                unit: row.unit,
                barcode: row.barcode,
                description: null,
                image_url: null,
                base_price: row.basePrice,
                price: row.price,
                status: row.status,
                keterangan: row.keterangan,
                tipe_modal: row.tipeModal,
                varian_harga: row.varianHarga,
                grosir: row.grosir,
                total_modal: row.totalModal
            };

            const existingProduct = await Product.findOne({
                where: { sku: row.sku },
                transaction,
                lock: transaction.LOCK.UPDATE
            });

            if (!existingProduct) {
                const createdProduct = await Product.create({
                    ...importPayload,
                    stock_quantity: row.stockQuantity
                }, { transaction });
                await syncProductCategories(createdProduct.id, categoryIds, transaction);

                if (row.stockQuantity > 0) {
                    await StockMutation.create({
                        product_id: createdProduct.id,
                        type: 'initial',
                        qty: row.stockQuantity,
                        note: 'Initial stock from inventory import',
                        reference_id: batchReference
                    }, { transaction });
                }

                summary.created_count += 1;
                summary.processed_rows += 1;
                await transaction.commit();
                continue;
            }

            const previousStock = Number(existingProduct.stock_quantity);
            const stockDelta = row.stockQuantity - previousStock;

            await existingProduct.update({
                ...importPayload,
                stock_quantity: row.stockQuantity
            }, { transaction });
            await syncProductCategories(existingProduct.id, categoryIds, transaction);

            if (stockDelta !== 0) {
                await StockMutation.create({
                    product_id: existingProduct.id,
                    type: 'adjustment',
                    qty: stockDelta,
                    note: `Stock adjusted by import (${previousStock} -> ${row.stockQuantity})`,
                    reference_id: batchReference
                }, { transaction });
            }

            summary.updated_count += 1;
            summary.processed_rows += 1;
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            pushError({
                row: row.row,
                sku: row.sku,
                reason: error instanceof Error ? error.message : 'Unknown import error'
            });
        }
    }

    return { summary, errors };
};

export const runInventoryImportFromBuffer = async (buffer: Buffer | Uint8Array, originalName: string): Promise<ImportResult> => {
    const preview = await runInventoryPreviewFromBuffer(buffer, originalName);
    const { rows, errors } = normalizeCommitRows(preview.rows);
    return commitNormalizedRows(rows, preview.rows.length, errors);
};

export const runInventoryImportFromPath = async (filePath: string): Promise<ImportResult> => {
    const preview = await runInventoryPreviewFromPath(filePath);
    const { rows, errors } = normalizeCommitRows(preview.rows);
    return commitNormalizedRows(rows, preview.rows.length, errors);
};

export const runInventoryImportFromRowsPayload = async (rowsPayload: unknown[]): Promise<ImportResult> => {
    const { rows, errors } = normalizeCommitRows(rowsPayload);
    return commitNormalizedRows(rows, rowsPayload.length, errors);
};

export const resolveImportErrorStatus = (message: string): number => {
    const normalized = message.toLowerCase();
    if (
        normalized.includes('header wajib') ||
        normalized.includes('worksheet') ||
        normalized.includes('format file') ||
        normalized.includes('file wajib') ||
        normalized.includes('file_path wajib') ||
        normalized.includes('invalid signature') ||
        normalized.includes('kolom products belum lengkap') ||
        normalized.includes('rows wajib diisi')
    ) {
        return 400;
    }
    if (
        normalized.includes('import local path tidak diaktifkan') ||
        normalized.includes('akses path ditolak oleh allowlist import')
    ) {
        return 403;
    }
    return 500;
};



export const normalizeCategoryIcon = (rawIcon: unknown): string | null => {
    const icon = String(rawIcon ?? '').trim().toLowerCase();
    if (!icon) return null;
    if (!/^[a-z0-9_-]+$/.test(icon)) {
        throw new Error('Format icon tidak valid. Gunakan huruf kecil, angka, dash, atau underscore.');
    }
    if (icon.length > 50) {
        throw new Error('Nilai icon terlalu panjang (maksimal 50 karakter).');
    }
    return icon;
};

export const toNullablePercentage = (value: unknown): number | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return undefined;
    return Math.round(parsed * 100) / 100;
};

export const parseCategoryDiscountField = (value: unknown, fieldName: string): number | null => {
    const parsed = toNullablePercentage(value);
    if (parsed === undefined) {
        throw new Error(`${fieldName} harus angka antara 0 sampai 100 atau null.`);
    }
    return parsed;
};













export const toNonNegativeNumber = (value: unknown): number | null => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return parsed;
};

export const toPercentageNumber = (value: unknown): number | null => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
    return parsed;
};

export const roundPrice = (value: number): number => {
    return Math.round(Math.max(0, value) * 100) / 100;
};

export const toObjectOrEmpty = (value: unknown): Record<string, unknown> => {
    if (!value) return {};
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return {};
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
            return {};
        } catch {
            return {};
        }
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {};
};















