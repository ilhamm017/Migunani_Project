import { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { Product, Category, ProductCategory, StockMutation, PurchaseOrder, PurchaseOrderItem, Supplier, sequelize, SupplierInvoice, SupplierPayment, Account, Journal, JournalLine } from '../models';
import { JournalService } from '../services/JournalService';
import { Op, Transaction } from 'sequelize';

const ALLOWED_IMPORT_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);
const REQUIRED_IMPORT_HEADERS = [
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
const IMPORT_ERROR_RESPONSE_LIMIT = 200;

type ImportHeader = typeof REQUIRED_IMPORT_HEADERS[number];

interface ImportFileRow {
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

interface ImportErrorItem {
    row: number;
    sku: string;
    reason: string;
}

interface ImportSummary {
    total_rows: number;
    processed_rows: number;
    created_count: number;
    updated_count: number;
    error_count: number;
}

interface ImportResult {
    summary: ImportSummary;
    errors: ImportErrorItem[];
}

interface ImportPreviewRow {
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

interface ImportPreviewSummary {
    total_rows: number;
    valid_rows: number;
    invalid_rows: number;
    error_count: number;
}

interface ImportPreviewResult {
    summary: ImportPreviewSummary;
    rows: ImportPreviewRow[];
    errors: ImportErrorItem[];
}

interface ImportNormalizedRow {
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

const REQUIRED_PRODUCT_COLUMNS = ['description', 'image_url', 'keterangan', 'tipe_modal', 'varian_harga', 'grosir', 'total_modal'] as const;
const ALLOWED_PRODUCT_IMAGE_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
]);
const PRODUCT_IMAGE_MAX_SIZE_BYTES = 2 * 1024 * 1024;

const resolveProductImageExtension = (file: Express.Multer.File): string => {
    const extFromName = path.extname(file.originalname || '').toLowerCase();
    if (/^\.[a-z0-9]+$/.test(extFromName)) return extFromName;

    if (file.mimetype === 'image/jpeg') return '.jpg';
    if (file.mimetype === 'image/png') return '.png';
    if (file.mimetype === 'image/webp') return '.webp';
    if (file.mimetype === 'image/gif') return '.gif';
    return '.jpg';
};

const parseImportStatus = (rawStatus: string): 'active' | 'inactive' => {
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

const SKU_CODE_PATTERN = /\b([A-Z0-9]{2,}(?:-[A-Z0-9]{2,})+)\b/i;
const SKU_SIZE_BLACKLIST_PATTERNS = [
    /\b\d{2,3}\s*\/\s*\d{2,3}\s*-\s*\d{2,3}\b/i, // contoh: 100/80-14
    /\b\d{2,3}\s*-\s*\d{2,3}\b/i, // contoh: 80-14
    /\b\d{1,3}(?:\.\d+)?\s*(?:L|ML|MM|CM|INCH|\"|')\b/i // contoh: 0.8L, 14"
];

const extractSkuCandidate = (value: string): string | null => {
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

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const stripSkuFromText = (source: string, sku: string): string =>
    source
        .replace(new RegExp(escapeRegex(sku), 'ig'), ' ')
        .replace(/^[\s\-_|:;,/]+|[\s\-_|:;,/]+$/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

const resolveSkuAndNameFromLegacyRow = (namaBarangRaw: string, varianRaw: string): { sku: string; name: string } => {
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

const normalizeHeader = (value: string): string =>
    value.trim().replace(/\s+/g, ' ').toUpperCase();

const readCellText = (value: unknown): string => {
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

const isBlankValue = (value: unknown): boolean => readCellText(value) === '';

const parseFlexibleNumber = (value: unknown): number | null => {
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

const parseRequiredNumber = (value: unknown, fieldName: string): number => {
    const parsed = parseFlexibleNumber(value);
    if (parsed === null) {
        throw new Error(`${fieldName} harus berupa angka`);
    }
    return Math.max(0, parsed);
};

const parseStockQuantity = (value: unknown): number => {
    if (isBlankValue(value)) return 0;
    const parsed = parseFlexibleNumber(value);
    if (parsed === null) {
        throw new Error('STOK harus berupa angka');
    }

    const stock = Math.trunc(parsed);
    return Math.max(0, stock);
};

const parseOptionalNumber = (value: unknown, fieldName: string): number | null => {
    if (isBlankValue(value)) return null;
    const parsed = parseFlexibleNumber(value);
    if (parsed === null) {
        throw new Error(`${fieldName} harus berupa angka`);
    }
    return Math.max(0, parsed);
};

const parseOptionalJson = (value: unknown, _fieldName: string): unknown | null => {
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

const normalizeGrosirPayload = (value: unknown, fallbackPrice: number): Record<string, number> => {
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

const isSupportedImportFile = (fileName: string): boolean =>
    ALLOWED_IMPORT_EXTENSIONS.has(path.extname(fileName).toLowerCase());

const loadWorkbookFromBuffer = async (buffer: Buffer | Uint8Array, extension: string): Promise<ExcelJS.Workbook> => {
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

const loadWorkbookFromPath = async (filePath: string): Promise<ExcelJS.Workbook> => {
    const workbook = new ExcelJS.Workbook();
    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.csv') {
        await workbook.csv.readFile(filePath);
    } else {
        await workbook.xlsx.readFile(filePath);
    }
    return workbook;
};

const getImportWorksheet = (workbook: ExcelJS.Workbook): ExcelJS.Worksheet => {
    const worksheet = workbook.getWorksheet('Barang') ?? workbook.worksheets[0];
    if (!worksheet) {
        throw new Error('Worksheet tidak ditemukan pada file import');
    }
    return worksheet;
};

const resolveHeaderMap = (worksheet: ExcelJS.Worksheet): Record<ImportHeader, number> => {
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

const parseImportRows = (worksheet: ExcelJS.Worksheet, headerMap: Record<ImportHeader, number>): ImportFileRow[] => {
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

const splitCategoryNames = (rawCategoryName: string): string[] => {
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

const getOrCreateCategoryIds = async (rawCategoryName: string, transaction: Transaction): Promise<number[]> => {
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

const syncProductCategories = async (productId: string, categoryIds: number[], transaction: Transaction) => {
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

const ensureProductColumnsReady = async () => {
    const tableDefinition = await sequelize.getQueryInterface().describeTable('products');
    const missingProductColumns = REQUIRED_PRODUCT_COLUMNS.filter((column) => !(column in tableDefinition));
    if (missingProductColumns.length > 0) {
        throw new Error(
            `Kolom products belum lengkap (${missingProductColumns.join(', ')}). Jalankan migrasi SQL: back_end/sql/20260212_add_products_import_columns.sql`
        );
    }
};

const buildPreviewRow = (row: ImportFileRow): ImportPreviewRow => {
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

const buildPreviewFromWorkbook = (workbook: ExcelJS.Workbook): ImportPreviewResult => {
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

const runInventoryPreviewFromBuffer = async (buffer: Buffer | Uint8Array, originalName: string): Promise<ImportPreviewResult> => {
    const extension = path.extname(originalName).toLowerCase();
    if (!isSupportedImportFile(originalName)) {
        throw new Error('Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv');
    }

    const workbook = await loadWorkbookFromBuffer(buffer, extension);
    return buildPreviewFromWorkbook(workbook);
};

const runInventoryPreviewFromPath = async (filePath: string): Promise<ImportPreviewResult> => {
    if (!isSupportedImportFile(filePath)) {
        throw new Error('Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv');
    }

    const workbook = await loadWorkbookFromPath(filePath);
    return buildPreviewFromWorkbook(workbook);
};

const normalizeCommitRows = (rowsPayload: unknown[]): { rows: ImportNormalizedRow[]; errors: ImportErrorItem[] } => {
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

const commitNormalizedRows = async (
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

const runInventoryImportFromBuffer = async (buffer: Buffer | Uint8Array, originalName: string): Promise<ImportResult> => {
    const preview = await runInventoryPreviewFromBuffer(buffer, originalName);
    const { rows, errors } = normalizeCommitRows(preview.rows);
    return commitNormalizedRows(rows, preview.rows.length, errors);
};

const runInventoryImportFromPath = async (filePath: string): Promise<ImportResult> => {
    const preview = await runInventoryPreviewFromPath(filePath);
    const { rows, errors } = normalizeCommitRows(preview.rows);
    return commitNormalizedRows(rows, preview.rows.length, errors);
};

const runInventoryImportFromRowsPayload = async (rowsPayload: unknown[]): Promise<ImportResult> => {
    const { rows, errors } = normalizeCommitRows(rowsPayload);
    return commitNormalizedRows(rows, rowsPayload.length, errors);
};

const resolveImportErrorStatus = (message: string): number => {
    const normalized = message.toLowerCase();
    if (
        normalized.includes('header wajib') ||
        normalized.includes('worksheet') ||
        normalized.includes('format file') ||
        normalized.includes('file wajib') ||
        normalized.includes('invalid signature') ||
        normalized.includes('kolom products belum lengkap') ||
        normalized.includes('rows wajib diisi')
    ) {
        return 400;
    }
    return 500;
};

export const getProducts = async (req: Request, res: Response) => {
    try {
        await ensureProductColumnsReady();

        const { page = 1, limit = 10, search, category_id, status = 'all' } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const whereClause: any = {};
        const normalizedStatus = String(status).toLowerCase();
        if (normalizedStatus === 'active' || normalizedStatus === 'inactive') {
            whereClause.status = normalizedStatus;
        }

        if (search) {
            whereClause[Op.or] = [
                { name: { [Op.like]: `%${search}%` } },
                { sku: { [Op.like]: `%${search}%` } },
                { barcode: { [Op.like]: `%${search}%` } }
            ];
        }

        if (category_id) {
            const categoryId = Number(category_id);
            if (!Number.isInteger(categoryId) || categoryId <= 0) {
                return res.status(400).json({ message: 'category_id tidak valid' });
            }

            const mappings = await ProductCategory.findAll({
                attributes: ['product_id'],
                where: { category_id: categoryId },
                raw: true
            });
            const mappedProductIds = mappings.map((item: any) => item.product_id);

            const categoryMatcher: any = {
                [Op.or]: [
                    { category_id: categoryId },
                    ...(mappedProductIds.length > 0 ? [{ id: { [Op.in]: mappedProductIds } }] : [])
                ]
            };

            whereClause[Op.and] = [...(whereClause[Op.and] || []), categoryMatcher];
        }

        const { count, rows } = await Product.findAndCountAll({
            where: whereClause,
            include: [
                { model: Category, attributes: ['id', 'name'] },
                { model: Category, as: 'Categories', attributes: ['id', 'name'], through: { attributes: [] }, required: false }
            ],
            limit: Number(limit),
            offset: Number(offset),
            order: [['name', 'ASC']],
            distinct: true
        });

        res.json({
            total: count,
            totalPages: Math.ceil(count / Number(limit)),
            currentPage: Number(page),
            products: rows
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Error fetching products';
        console.error('Error fetching admin products:', error);
        if (message.includes('Kolom products belum lengkap')) {
            return res.status(400).json({ message });
        }
        res.status(500).json({ message: 'Error fetching products', error });
    }
};

export const getCategories = async (_req: Request, res: Response) => {
    try {
        const categories = await Category.findAll({
            attributes: ['id', 'name', 'description', 'icon'],
            order: [['name', 'ASC']]
        });
        res.json({ categories });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching categories', error });
    }
};

const normalizeCategoryIcon = (rawIcon: unknown): string | null => {
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

export const createCategory = async (req: Request, res: Response) => {
    try {
        const name = String(req.body?.name || '').trim();
        const description = String(req.body?.description || '').trim();
        let icon: string | null = null;

        if (!name) {
            return res.status(400).json({ message: 'Nama kategori wajib diisi' });
        }

        try {
            icon = normalizeCategoryIcon(req.body?.icon);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Nilai icon tidak valid';
            return res.status(400).json({ message });
        }

        const existingCategory = await Category.findOne({ where: { name } });
        if (existingCategory) {
            return res.status(400).json({ message: 'Nama kategori sudah digunakan' });
        }

        const category = await Category.create({
            name,
            description: description || null,
            icon
        });

        res.status(201).json(category);
    } catch (error) {
        res.status(500).json({ message: 'Error creating category', error });
    }
};

export const updateCategory = async (req: Request, res: Response) => {
    try {
        const categoryId = Number(req.params.id);
        if (!Number.isInteger(categoryId) || categoryId <= 0) {
            return res.status(400).json({ message: 'ID kategori tidak valid' });
        }

        const category = await Category.findByPk(categoryId);
        if (!category) {
            return res.status(404).json({ message: 'Kategori tidak ditemukan' });
        }

        const updates: { name?: string; description?: string | null; icon?: string | null } = {};

        if (req.body?.name !== undefined) {
            const nextName = String(req.body.name).trim();
            if (!nextName) {
                return res.status(400).json({ message: 'Nama kategori wajib diisi' });
            }

            const duplicate = await Category.findOne({
                where: {
                    name: nextName,
                    id: { [Op.ne]: categoryId }
                }
            });
            if (duplicate) {
                return res.status(400).json({ message: 'Nama kategori sudah digunakan' });
            }
            updates.name = nextName;
        }

        if (req.body?.description !== undefined) {
            const nextDescription = String(req.body.description || '').trim();
            updates.description = nextDescription || null;
        }

        if (req.body?.icon !== undefined) {
            try {
                updates.icon = normalizeCategoryIcon(req.body.icon);
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Nilai icon tidak valid';
                return res.status(400).json({ message });
            }
        }

        await category.update(updates);
        res.json(category);
    } catch (error) {
        res.status(500).json({ message: 'Error updating category', error });
    }
};

export const deleteCategory = async (req: Request, res: Response) => {
    const transaction = await sequelize.transaction();
    try {
        const categoryId = Number(req.params.id);
        if (!Number.isInteger(categoryId) || categoryId <= 0) {
            await transaction.rollback();
            return res.status(400).json({ message: 'ID kategori tidak valid' });
        }

        const category = await Category.findByPk(categoryId, { transaction });
        if (!category) {
            await transaction.rollback();
            return res.status(404).json({ message: 'Kategori tidak ditemukan' });
        }

        const replacementIdRaw = req.body?.replacement_category_id;
        const hasReplacement = replacementIdRaw !== undefined && replacementIdRaw !== null && String(replacementIdRaw).trim() !== '';

        if (hasReplacement) {
            const replacementCategoryId = Number(replacementIdRaw);
            if (!Number.isInteger(replacementCategoryId) || replacementCategoryId <= 0) {
                await transaction.rollback();
                return res.status(400).json({ message: 'replacement_category_id tidak valid' });
            }
            if (replacementCategoryId === categoryId) {
                await transaction.rollback();
                return res.status(400).json({ message: 'Kategori pengganti tidak boleh sama' });
            }

            const replacementCategory = await Category.findByPk(replacementCategoryId, { transaction });
            if (!replacementCategory) {
                await transaction.rollback();
                return res.status(404).json({ message: 'Kategori pengganti tidak ditemukan' });
            }

            const [movedCount] = await Product.update(
                { category_id: replacementCategoryId },
                { where: { category_id: categoryId }, transaction }
            );

            await category.destroy({ transaction });
            await transaction.commit();
            return res.json({
                message: 'Kategori berhasil dihapus dan produk dipindahkan',
                moved_products: movedCount
            });
        }

        const totalProducts = await Product.count({ where: { category_id: categoryId }, transaction });
        if (totalProducts > 0) {
            await transaction.rollback();
            return res.status(400).json({
                message: `Kategori masih dipakai ${totalProducts} produk. Pilih replacement_category_id untuk memindahkan produk sebelum hapus.`
            });
        }

        await category.destroy({ transaction });
        await transaction.commit();
        return res.json({ message: 'Kategori berhasil dihapus' });
    } catch (error) {
        await transaction.rollback();
        res.status(500).json({ message: 'Error deleting category', error });
    }
};

export const getSuppliers = async (_req: Request, res: Response) => {
    try {
        const suppliers = await Supplier.findAll({
            attributes: ['id', 'name', 'contact', 'address'],
            order: [['name', 'ASC']]
        });
        res.json({ suppliers });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching suppliers', error });
    }
};

export const createSupplier = async (req: Request, res: Response) => {
    try {
        const name = String(req.body?.name || '').trim();
        const contact = String(req.body?.contact || '').trim();
        const address = String(req.body?.address || '').trim();

        if (!name) {
            return res.status(400).json({ message: 'Nama supplier wajib diisi' });
        }

        const existingSupplier = await Supplier.findOne({ where: { name } });
        if (existingSupplier) {
            return res.status(400).json({ message: 'Nama supplier sudah digunakan' });
        }

        const supplier = await Supplier.create({
            name,
            contact: contact || null,
            address: address || null
        });

        res.status(201).json(supplier);
    } catch (error) {
        res.status(500).json({ message: 'Error creating supplier', error });
    }
};

export const updateSupplier = async (req: Request, res: Response) => {
    try {
        const supplierId = Number(req.params.id);
        if (!Number.isInteger(supplierId) || supplierId <= 0) {
            return res.status(400).json({ message: 'ID supplier tidak valid' });
        }

        const supplier = await Supplier.findByPk(supplierId);
        if (!supplier) {
            return res.status(404).json({ message: 'Supplier tidak ditemukan' });
        }

        const updates: { name?: string; contact?: string | null; address?: string | null } = {};

        if (req.body?.name !== undefined) {
            const nextName = String(req.body.name).trim();
            if (!nextName) {
                return res.status(400).json({ message: 'Nama supplier wajib diisi' });
            }

            const duplicate = await Supplier.findOne({
                where: {
                    name: nextName,
                    id: { [Op.ne]: supplierId }
                }
            });
            if (duplicate) {
                return res.status(400).json({ message: 'Nama supplier sudah digunakan' });
            }
            updates.name = nextName;
        }

        if (req.body?.contact !== undefined) {
            const nextContact = String(req.body.contact || '').trim();
            updates.contact = nextContact || null;
        }

        if (req.body?.address !== undefined) {
            const nextAddress = String(req.body.address || '').trim();
            updates.address = nextAddress || null;
        }

        await supplier.update(updates);
        res.json(supplier);
    } catch (error) {
        res.status(500).json({ message: 'Error updating supplier', error });
    }
};

export const deleteSupplier = async (req: Request, res: Response) => {
    const transaction = await sequelize.transaction();
    try {
        const supplierId = Number(req.params.id);
        if (!Number.isInteger(supplierId) || supplierId <= 0) {
            await transaction.rollback();
            return res.status(400).json({ message: 'ID supplier tidak valid' });
        }

        const supplier = await Supplier.findByPk(supplierId, { transaction });
        if (!supplier) {
            await transaction.rollback();
            return res.status(404).json({ message: 'Supplier tidak ditemukan' });
        }

        const replacementIdRaw = req.body?.replacement_supplier_id;
        const hasReplacement = replacementIdRaw !== undefined && replacementIdRaw !== null && String(replacementIdRaw).trim() !== '';

        if (hasReplacement) {
            const replacementSupplierId = Number(replacementIdRaw);
            if (!Number.isInteger(replacementSupplierId) || replacementSupplierId <= 0) {
                await transaction.rollback();
                return res.status(400).json({ message: 'replacement_supplier_id tidak valid' });
            }
            if (replacementSupplierId === supplierId) {
                await transaction.rollback();
                return res.status(400).json({ message: 'Supplier pengganti tidak boleh sama' });
            }

            const replacementSupplier = await Supplier.findByPk(replacementSupplierId, { transaction });
            if (!replacementSupplier) {
                await transaction.rollback();
                return res.status(404).json({ message: 'Supplier pengganti tidak ditemukan' });
            }

            const [movedCount] = await PurchaseOrder.update(
                { supplier_id: replacementSupplierId },
                { where: { supplier_id: supplierId }, transaction }
            );

            await supplier.destroy({ transaction });
            await transaction.commit();
            return res.json({
                message: 'Supplier berhasil dihapus dan data purchase order dipindahkan',
                moved_purchase_orders: movedCount
            });
        }

        const totalPurchaseOrders = await PurchaseOrder.count({ where: { supplier_id: supplierId }, transaction });
        if (totalPurchaseOrders > 0) {
            await transaction.rollback();
            return res.status(400).json({
                message: `Supplier masih dipakai ${totalPurchaseOrders} purchase order. Pilih replacement_supplier_id sebelum hapus.`
            });
        }

        await supplier.destroy({ transaction });
        await transaction.commit();
        return res.json({ message: 'Supplier berhasil dihapus' });
    } catch (error) {
        await transaction.rollback();
        res.status(500).json({ message: 'Error deleting supplier', error });
    }
};

export const getProductBySku = async (req: Request, res: Response) => {
    try {
        const queryCode = readCellText(req.query.code);
        const paramSku = readCellText(req.params.sku);
        const code = queryCode || paramSku;
        if (!code) {
            return res.status(400).json({ message: 'SKU/barcode wajib diisi' });
        }

        const product = await Product.findOne({
            where: {
                [Op.or]: [
                    { sku: code },
                    { barcode: code }
                ]
            },
            include: [
                { model: Category, attributes: ['id', 'name'] },
                { model: Category, as: 'Categories', attributes: ['id', 'name'], through: { attributes: [] }, required: false }
            ]
        });

        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        res.json(product);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching product', error });
    }
};

export const uploadProductImage = async (req: Request, res: Response) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ message: 'File gambar wajib diunggah' });
        }

        if (!ALLOWED_PRODUCT_IMAGE_MIME_TYPES.has(file.mimetype)) {
            return res.status(400).json({ message: 'Format gambar tidak didukung. Gunakan JPG, PNG, WEBP, atau GIF.' });
        }

        if (file.size > PRODUCT_IMAGE_MAX_SIZE_BYTES) {
            return res.status(400).json({ message: 'Ukuran gambar terlalu besar (maksimal 2MB).' });
        }

        const userId = (req as any).user?.id || 'anonymous';
        const uploadDir = path.resolve(process.cwd(), 'uploads', String(userId), 'products');
        await fs.mkdir(uploadDir, { recursive: true });

        const fileExt = resolveProductImageExtension(file);
        const fileName = `prd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${fileExt}`;
        const absolutePath = path.join(uploadDir, fileName);
        await fs.writeFile(absolutePath, file.buffer);

        const imagePath = `/uploads/${userId}/products/${fileName}`;
        const configuredPublicBase = String(process.env.BACKEND_PUBLIC_URL || '').trim().replace(/\/$/, '');
        const imagePublicUrl = configuredPublicBase ? `${configuredPublicBase}${imagePath}` : imagePath;

        return res.status(201).json({
            message: 'Gambar produk berhasil diunggah',
            image_url: imagePath,
            image_public_url: imagePublicUrl,
            file_name: fileName
        });
    } catch (error) {
        return res.status(500).json({ message: 'Error uploading product image', error });
    }
};

export const createProduct = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { sku, barcode, name, description, image_url, base_price, price, unit, min_stock, category_id, stock_quantity, bin_location, vehicle_compatibility } = req.body;

        const existingProduct = await Product.findOne({ where: { sku } });
        if (existingProduct) {
            await t.rollback();
            return res.status(400).json({ message: 'Product with this SKU already exists' });
        }

        const normalizedImageUrl = String(image_url ?? '').trim() || null;
        const normalizedDescription = String(description ?? '').trim() || null;
        const normalizedBinLocation = String(bin_location ?? '').trim() || null;
        let normalizedVehicleCompatibility = vehicle_compatibility;
        if (typeof vehicle_compatibility === 'object' && vehicle_compatibility !== null) {
            normalizedVehicleCompatibility = JSON.stringify(vehicle_compatibility);
        } else {
            normalizedVehicleCompatibility = String(vehicle_compatibility ?? '').trim() || null;
        }

        const product = await Product.create({
            sku,
            barcode,
            name,
            description: normalizedDescription,
            image_url: normalizedImageUrl,
            base_price,
            price,
            unit,
            min_stock,
            category_id,
            stock_quantity: 0,
            bin_location: normalizedBinLocation,
            vehicle_compatibility: normalizedVehicleCompatibility
        }, { transaction: t });
        await syncProductCategories(product.id, [Number(category_id)], t);

        // Handles initial stock via mutation if provided
        if (stock_quantity && stock_quantity > 0) {
            await StockMutation.create({
                product_id: product.id,
                type: 'initial',
                qty: stock_quantity,
                note: 'Initial Stock via Create Product',
                reference_id: 'INIT-' + sku
            }, { transaction: t });

            await product.update({ stock_quantity }, { transaction: t });
        }

        await t.commit();
        res.status(201).json(product);
    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: 'Error creating product', error });
    }
};

export const updateProduct = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params;
        const payload = req.body as Record<string, unknown>;
        const blockedPricingFields = ['price', 'varian_harga'];
        const attemptedPricingFields = blockedPricingFields.filter((field) => payload[field] !== undefined);
        if (attemptedPricingFields.length > 0) {
            await t.rollback();
            return res.status(403).json({
                message: 'Modifikasi harga tier tidak tersedia di modul gudang. Gunakan modul Admin Sales/Kasir.'
            });
        }

        const allowedFields = new Set([
            'sku',
            'barcode',
            'name',
            'description',
            'image_url',
            'base_price',
            'price',
            'unit',
            'min_stock',
            'category_id',
            'category_ids',
            'status',
            'keterangan',
            'tipe_modal',
            'varian_harga',
            'grosir',
            'grosir',
            'total_modal',
            'bin_location',
            'vehicle_compatibility'
        ]);

        const updates = Object.entries(payload).reduce<Record<string, unknown>>((acc, [key, value]) => {
            if (!allowedFields.has(key)) return acc;
            acc[key] = value;
            return acc;
        }, {});

        if (updates.image_url !== undefined) {
            updates.image_url = String(updates.image_url ?? '').trim() || null;
        }
        if (updates.description !== undefined) {
            updates.description = String(updates.description ?? '').trim() || null;
        }
        if (updates.barcode !== undefined) {
            updates.barcode = String(updates.barcode ?? '').trim() || null;
        }
        if (updates.keterangan !== undefined) {
            updates.keterangan = String(updates.keterangan ?? '').trim() || null;
        }
        if (updates.tipe_modal !== undefined) {
            updates.tipe_modal = String(updates.tipe_modal ?? '').trim() || null;
        }
        if (updates.bin_location !== undefined) {
            updates.bin_location = String(updates.bin_location ?? '').trim() || null;
        }
        if (updates.vehicle_compatibility !== undefined) {
            // vehicle_compatibility is TEXT, we might want to keep it as string or stringified JSON
            const rawVal = updates.vehicle_compatibility;
            if (typeof rawVal === 'object' && rawVal !== null) {
                updates.vehicle_compatibility = JSON.stringify(rawVal);
            } else {
                updates.vehicle_compatibility = String(rawVal ?? '').trim() || null;
            }
        }

        const [updated] = await Product.update(updates, { where: { id }, transaction: t });

        if (updated) {
            const updatedProduct = await Product.findByPk(String(id), { transaction: t });
            if (updatedProduct && Array.isArray(updates.category_ids)) {
                const normalizedIds = updates.category_ids
                    .map((value: unknown) => Number(value))
                    .filter((value: number) => Number.isInteger(value) && value > 0);

                if (normalizedIds.length > 0) {
                    await syncProductCategories(updatedProduct.id, normalizedIds, t);
                }
            } else if (updatedProduct && updates.category_id !== undefined) {
                const mappings = await ProductCategory.findAll({
                    attributes: ['category_id'],
                    where: { product_id: updatedProduct.id },
                    transaction: t,
                    raw: true
                });
                const mappedIds = mappings.map((item: any) => Number(item.category_id)).filter((value: number) => Number.isInteger(value) && value > 0);
                const mergedIds = [...new Set([...mappedIds, Number(updates.category_id)])].filter((value) => Number.isInteger(value) && value > 0);
                await syncProductCategories(updatedProduct.id, mergedIds, t);
            }
            await t.commit();
            return res.status(200).json(updatedProduct);
        }

        await t.rollback();
        return res.status(404).json({ message: 'Product not found' });
    } catch (error) {
        await t.rollback();
        const message = error instanceof Error ? error.message : 'Error updating product';
        if (message.toLowerCase().includes('data too long for column') && message.toLowerCase().includes('image_url')) {
            return res.status(400).json({ message: 'URL gambar terlalu panjang untuk disimpan. Gunakan URL yang lebih pendek atau jalankan migrasi kolom image_url.' });
        }
        if (message.toLowerCase().includes("unknown column 'image_url'")) {
            return res.status(400).json({ message: 'Kolom image_url belum ada di database. Jalankan migrasi SQL untuk kolom image_url.' });
        }
        res.status(500).json({ message: 'Error updating product', error });
    }
};

const toNonNegativeNumber = (value: unknown): number | null => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return parsed;
};

const toPercentageNumber = (value: unknown): number | null => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
    return parsed;
};

const roundPrice = (value: number): number => {
    return Math.round(Math.max(0, value) * 100) / 100;
};

const toObjectOrEmpty = (value: unknown): Record<string, unknown> => {
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

export const updateProductTierPricing = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params;
        const actorRole = String(req.user?.role || '');
        if (actorRole !== 'kasir' && actorRole !== 'super_admin') {
            await t.rollback();
            return res.status(403).json({ message: 'Hanya admin sales/kasir yang bisa memodifikasi harga tier.' });
        }

        const regularPrice = toNonNegativeNumber(req.body?.regular_price ?? req.body?.regular);
        const goldPrice = toNonNegativeNumber(req.body?.gold_price ?? req.body?.gold);
        const platinumPrice = toNonNegativeNumber(
            req.body?.premium_price ?? req.body?.premium ?? req.body?.platinum_price ?? req.body?.platinum
        );

        if (regularPrice === null || goldPrice === null || platinumPrice === null) {
            await t.rollback();
            return res.status(400).json({
                message: 'regular_price, gold_price, dan premium_price/platinum_price wajib berupa angka valid (>= 0).'
            });
        }

        const product = await Product.findByPk(String(id), { transaction: t, lock: t.LOCK.UPDATE });
        if (!product) {
            await t.rollback();
            return res.status(404).json({ message: 'Product not found' });
        }

        const previousVariant = toObjectOrEmpty(product.varian_harga);
        const previousPrices = toObjectOrEmpty(previousVariant.prices);
        const previousDiscounts = toObjectOrEmpty(previousVariant.discounts_pct);

        const discountFromRegular = (targetPrice: number): number => {
            if (regularPrice <= 0) return 0;
            const pct = ((regularPrice - targetPrice) / regularPrice) * 100;
            return Math.min(100, Math.max(0, Math.round(pct * 100) / 100));
        };

        const tierPrices = {
            regular: regularPrice,
            gold: goldPrice,
            platinum: platinumPrice,
            premium: platinumPrice
        };

        const nextVariantHarga = {
            ...previousVariant,
            regular: regularPrice,
            gold: goldPrice,
            platinum: platinumPrice,
            premium: platinumPrice,
            base_price: regularPrice,
            prices: {
                ...previousPrices,
                ...tierPrices
            },
            discounts_pct: {
                ...previousDiscounts,
                regular: discountFromRegular(regularPrice),
                gold: discountFromRegular(goldPrice),
                platinum: discountFromRegular(platinumPrice),
                premium: discountFromRegular(platinumPrice)
            }
        };

        await product.update({
            price: regularPrice,
            varian_harga: nextVariantHarga
        }, { transaction: t });

        await t.commit();
        return res.status(200).json({
            message: 'Harga tier produk berhasil diperbarui.',
            product,
            tier_pricing: tierPrices
        });
    } catch (error) {
        await t.rollback();
        return res.status(500).json({ message: 'Error updating product tier pricing', error });
    }
};

export const bulkUpdateTierDiscounts = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const actorRole = String(req.user?.role || '');
        if (actorRole !== 'kasir' && actorRole !== 'super_admin') {
            await t.rollback();
            return res.status(403).json({ message: 'Hanya admin sales/kasir yang bisa memodifikasi diskon tier.' });
        }

        const goldDiscount = toPercentageNumber(req.body?.gold_discount_pct ?? req.body?.gold_discount ?? req.body?.gold);
        const premiumDiscount = toPercentageNumber(
            req.body?.premium_discount_pct ??
            req.body?.premium_discount ??
            req.body?.premium ??
            req.body?.platinum_discount_pct ??
            req.body?.platinum_discount ??
            req.body?.platinum
        );

        if (goldDiscount === null || premiumDiscount === null) {
            await t.rollback();
            return res.status(400).json({
                message: 'gold_discount_pct dan premium_discount_pct/platinum_discount_pct wajib angka valid antara 0 sampai 100.'
            });
        }

        const statusRaw = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : 'active';
        const whereClause: Record<string, unknown> = {};
        if (statusRaw === 'active' || statusRaw === 'inactive') {
            whereClause.status = statusRaw;
        }

        const products = await Product.findAll({
            where: whereClause,
            attributes: ['id', 'price', 'varian_harga'],
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        let updatedCount = 0;

        for (const product of products) {
            const regularPrice = roundPrice(Number(product.price || 0));
            const goldPrice = roundPrice(regularPrice * (1 - (goldDiscount / 100)));
            const premiumPrice = roundPrice(regularPrice * (1 - (premiumDiscount / 100)));

            const previousVariant = toObjectOrEmpty(product.varian_harga);
            const previousPrices = toObjectOrEmpty(previousVariant.prices);
            const previousDiscounts = toObjectOrEmpty(previousVariant.discounts_pct);

            const nextVariantHarga = {
                ...previousVariant,
                regular: regularPrice,
                gold: goldPrice,
                platinum: premiumPrice,
                premium: premiumPrice,
                base_price: regularPrice,
                prices: {
                    ...previousPrices,
                    regular: regularPrice,
                    gold: goldPrice,
                    platinum: premiumPrice,
                    premium: premiumPrice
                },
                discounts_pct: {
                    ...previousDiscounts,
                    regular: 0,
                    gold: goldDiscount,
                    platinum: premiumDiscount,
                    premium: premiumDiscount
                }
            };

            await product.update({
                varian_harga: nextVariantHarga
            }, { transaction: t });
            updatedCount += 1;
        }

        await t.commit();
        return res.status(200).json({
            message: `Diskon tier berhasil diterapkan ke ${updatedCount} produk.`,
            updated_count: updatedCount,
            discounts_pct: {
                regular: 0,
                gold: goldDiscount,
                premium: premiumDiscount,
                platinum: premiumDiscount
            }
        });
    } catch (error) {
        await t.rollback();
        return res.status(500).json({ message: 'Error bulk updating tier discounts', error });
    }
};

export const createStockMutation = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { product_id, type, qty, note, reference_id } = req.body;
        // type: 'in' | 'out' | 'adjustment'

        const product = await Product.findByPk(product_id, { transaction: t });
        if (!product) {
            await t.rollback();
            return res.status(404).json({ message: 'Product not found' });
        }

        let newStock = product.stock_quantity;
        if (type === 'in' || (type === 'adjustment' && qty > 0)) {
            newStock += qty;
        } else if (type === 'out' || (type === 'adjustment' && qty < 0)) {
            newStock -= Math.abs(qty); // Ensure subtraction
        }

        if (newStock < 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Insufficient stock' });
        }

        await StockMutation.create({
            product_id,
            type,
            qty: type === 'out' ? -Math.abs(qty) : Math.abs(qty), // Store logic based on type, ensuring adjustments follow sign logic or explicit type
            note,
            reference_id
        }, { transaction: t });

        await product.update({ stock_quantity: newStock }, { transaction: t });

        await t.commit();
        res.json({ message: 'Stock mutation recorded', current_stock: newStock });
    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: 'Error creating mutation', error });
    }
};

export const createPurchaseOrder = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const supplierId = Number(req.body?.supplier_id);
        const totalCost = Number(req.body?.total_cost);

        if (!Number.isInteger(supplierId) || supplierId <= 0) {
            await t.rollback();
            return res.status(400).json({ message: 'supplier_id tidak valid' });
        }
        if (!Number.isFinite(totalCost) || totalCost < 0) {
            await t.rollback();
            return res.status(400).json({ message: 'total_cost tidak valid' });
        }

        const supplier = await Supplier.findByPk(supplierId, { transaction: t });
        if (!supplier) {
            await t.rollback();
            return res.status(404).json({ message: 'Supplier tidak ditemukan' });
        }

        const po = await PurchaseOrder.create({
            supplier_id: supplierId,
            status: 'pending',
            total_cost: totalCost,
            created_by: req.user!.id
        }, { transaction: t });

        const items = req.body?.items;
        if (Array.isArray(items) && items.length > 0) {
            for (const item of items) {
                const qty = Number(item.qty);
                const unitCost = Number(item.unit_cost);
                if (qty > 0 && unitCost >= 0) {
                    await PurchaseOrderItem.create({
                        purchase_order_id: po.id,
                        product_id: item.product_id,
                        qty: qty,
                        unit_cost: unitCost,
                        total_cost: qty * unitCost,
                        received_qty: 0
                    }, { transaction: t });
                }
            }
        }

        await t.commit();
        res.status(201).json(po);
    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: 'Error creating PO', error });
    }
};


export const createSupplierInvoice = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { purchase_order_id, invoice_number, total, due_date } = req.body;
        const userId = req.user!.id;

        const po = await PurchaseOrder.findByPk(purchase_order_id, { transaction: t });
        if (!po) {
            await t.rollback();
            return res.status(404).json({ message: 'Purchase Order not found' });
        }

        const supplierInvoice = await SupplierInvoice.create({
            supplier_id: po.supplier_id,
            purchase_order_id: po.id,
            invoice_number,
            total: Number(total),
            due_date: new Date(due_date),
            status: 'unpaid',
            created_by: userId
        }, { transaction: t });

        // --- Journal: Persediaan (D) vs Hutang Supplier (K) ---
        // Note: Assuming inventory value increases when invoice is received/acknowledged.
        const inventoryAcc = await Account.findOne({ where: { code: '1300' }, transaction: t });
        const apAcc = await Account.findOne({ where: { code: '2100' }, transaction: t }); // Hutang Supplier

        if (inventoryAcc && apAcc) {
            await JournalService.createEntry({
                description: `Tagihan Supplier #${supplierInvoice.invoice_number} (PO #${po.id})`,
                reference_type: 'supplier_invoice',
                reference_id: supplierInvoice.id.toString(),
                created_by: userId,
                lines: [
                    { account_id: inventoryAcc.id, debit: Number(total), credit: 0 },
                    { account_id: apAcc.id, debit: 0, credit: Number(total) }
                ]
            }, t);
        }

        await t.commit();
        res.status(201).json(supplierInvoice);
    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error creating supplier invoice', error });
    }
};

export const paySupplierInvoice = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { invoice_id, amount, account_id, note } = req.body;
        const userId = req.user!.id;

        const invoice = await SupplierInvoice.findByPk(invoice_id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!invoice) {
            await t.rollback();
            return res.status(404).json({ message: 'Invoice not found' });
        }

        const paymentAmount = Number(amount);
        if (paymentAmount <= 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Jumlah pembayaran tidak valid' });
        }

        const payments = await SupplierPayment.findAll({ where: { supplier_invoice_id: invoice_id }, transaction: t });
        const paidTotal = payments.reduce((sum, p) => sum + Number(p.amount), 0);

        const payment = await SupplierPayment.create({
            supplier_invoice_id: invoice.id,
            amount: paymentAmount,
            account_id,
            paid_at: new Date(),
            note,
            created_by: userId
        }, { transaction: t });

        const newPaidTotal = paidTotal + paymentAmount;
        if (newPaidTotal >= Number(invoice.total)) {
            await invoice.update({ status: 'paid' }, { transaction: t });
        }

        // --- Journal: Hutang Supplier (D) vs Kas/Bank (K) ---
        const apAcc = await Account.findOne({ where: { code: '2100' }, transaction: t });
        const paymentAcc = await Account.findByPk(account_id, { transaction: t }); // 1101 or 1102

        if (apAcc && paymentAcc) {
            await JournalService.createEntry({
                description: `Pembayaran Tagihan Supplier #${invoice.invoice_number} (Payment #${payment.id})`,
                reference_type: 'supplier_payment',
                reference_id: payment.id.toString(),
                created_by: userId,
                lines: [
                    { account_id: apAcc.id, debit: paymentAmount, credit: 0 },
                    { account_id: paymentAcc.id, debit: 0, credit: paymentAmount }
                ]
            }, t);
        }

        await t.commit();
        res.json({ message: 'Pembayaran berhasil', payment });

    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error paying supplier invoice', error });
    }
};

export const scanProduct = async (req: Request, res: Response) => {
    // Same as getProductBySku logic basically but intended for scanner
    return getProductBySku(req, res);
};

export const importProductsFromUpload = async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'File wajib diunggah' });
        }

        if (!isSupportedImportFile(req.file.originalname)) {
            return res.status(400).json({ message: 'Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv' });
        }

        const result = await runInventoryImportFromBuffer(req.file.buffer, req.file.originalname);
        res.json({
            message: 'Import selesai',
            summary: result.summary,
            errors: result.errors
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Import gagal';
        res.status(resolveImportErrorStatus(message)).json({ message, error });
    }
};

export const previewProductsImportFromUpload = async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'File wajib diunggah' });
        }

        if (!isSupportedImportFile(req.file.originalname)) {
            return res.status(400).json({ message: 'Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv' });
        }

        const result = await runInventoryPreviewFromBuffer(req.file.buffer, req.file.originalname);
        res.json({
            message: 'Preview siap. Periksa dan edit data sebelum commit.',
            summary: result.summary,
            rows: result.rows,
            errors: result.errors
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Preview import gagal';
        res.status(resolveImportErrorStatus(message)).json({ message, error });
    }
};

export const commitProductsImport = async (req: Request, res: Response) => {
    try {
        const { rows } = req.body as { rows?: unknown[] };
        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ message: 'rows wajib diisi dan tidak boleh kosong' });
        }

        const result = await runInventoryImportFromRowsPayload(rows);
        res.json({
            message: 'Import selesai',
            summary: result.summary,
            errors: result.errors
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Commit import gagal';
        res.status(resolveImportErrorStatus(message)).json({ message, error });
    }
};

export const importProductsFromPath = async (req: Request, res: Response) => {
    try {
        if (process.env.IMPORT_LOCAL_PATH_ENABLED !== 'true') {
            return res.status(403).json({ message: 'Import local path tidak diaktifkan' });
        }

        const { file_path } = req.body as { file_path?: string };
        if (!file_path || typeof file_path !== 'string') {
            return res.status(400).json({ message: 'file_path wajib diisi' });
        }

        const resolvedPath = path.resolve(file_path);
        if (!isSupportedImportFile(resolvedPath)) {
            return res.status(400).json({ message: 'Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv' });
        }

        try {
            const stat = await fs.stat(resolvedPath);
            if (!stat.isFile()) {
                return res.status(400).json({ message: 'file_path harus mengarah ke file' });
            }
        } catch {
            return res.status(400).json({ message: 'File pada file_path tidak ditemukan' });
        }

        const allowedRoots = (process.env.IMPORT_LOCAL_PATH_ALLOWLIST || '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
            .map((value) => path.resolve(value));

        if (allowedRoots.length > 0) {
            const isAllowedPath = allowedRoots.some((rootPath) =>
                resolvedPath === rootPath || resolvedPath.startsWith(`${rootPath}${path.sep}`)
            );
            if (!isAllowedPath) {
                return res.status(403).json({ message: 'Akses path ditolak oleh allowlist import' });
            }
        }

        const result = await runInventoryImportFromPath(resolvedPath);
        res.json({
            message: 'Import selesai',
            summary: result.summary,
            errors: result.errors
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Import gagal';
        res.status(resolveImportErrorStatus(message)).json({ message, error });
    }
};

export const getProductMutations = async (req: Request, res: Response) => {
    try {
        const { product_id } = req.params;
        const mutations = await StockMutation.findAll({
            where: { product_id },
            order: [['createdAt', 'DESC']],
            limit: 50
        });
        res.json(mutations);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching mutations', error });
    }
};

export const getPurchaseOrders = async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 10, status, supplier_id } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const where: any = {};
        if (status) where.status = status;
        if (supplier_id) where.supplier_id = supplier_id;

        const { count, rows } = await PurchaseOrder.findAndCountAll({
            where,
            include: [{ model: Supplier, attributes: ['id', 'name'] }],
            limit: Number(limit),
            offset: Number(offset),
            order: [['createdAt', 'DESC']]
        });

        res.json({
            total: count,
            totalPages: Math.ceil(count / Number(limit)),
            currentPage: Number(page),
            purchaseOrders: rows
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching POs', error });
    }
};

export const getPurchaseOrderById = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const po = await PurchaseOrder.findByPk(id, {
            include: [
                { model: Supplier, attributes: ['id', 'name'] },
                {
                    model: PurchaseOrderItem,
                    as: 'Items',
                    include: [{ model: Product, attributes: ['id', 'sku', 'name', 'stock_quantity'] }]
                }
            ]
        });

        if (!po) {
            return res.status(404).json({ message: 'Purchase Order not found' });
        }

        res.json(po);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching PO detail', error });
    }
};

export const receivePurchaseOrder = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const id = req.params.id as string;
        const { items } = req.body; // Array of { product_id, received_qty, note }

        const po = await PurchaseOrder.findByPk(id, {
            include: [{ model: PurchaseOrderItem, as: 'Items' }],
            transaction: t
        });

        if (!po) {
            await t.rollback();
            return res.status(404).json({ message: 'Purchase Order not found' });
        }

        if (po.status === 'received' || po.status === 'canceled') {
            await t.rollback();
            return res.status(400).json({ message: `Cannot receive PO with status ${po.status}` });
        }

        if (Array.isArray(items)) {
            for (const item of items) {
                const poItem = (po as any).Items.find((pi: any) => pi.product_id === item.product_id);
                if (!poItem) continue;

                const receivedQty = Number(item.received_qty);
                if (receivedQty <= 0) continue;

                // Update PO Item
                await poItem.update({
                    received_qty: Number(poItem.received_qty || 0) + receivedQty
                }, { transaction: t });

                // Update Product Stock
                const product = await Product.findByPk(item.product_id, { transaction: t });
                if (product) {
                    await product.update({
                        stock_quantity: Number(product.stock_quantity || 0) + receivedQty
                    }, { transaction: t });
                }

                // Create Stock Mutation
                await StockMutation.create({
                    product_id: item.product_id,
                    type: 'in',
                    qty: receivedQty,
                    reference_id: `PO-${po.id}`,
                    note: item.note || `Received from PO #${po.id}`
                }, { transaction: t });
            }
        }

        // Update PO status
        const updatedPoItems = await PurchaseOrderItem.findAll({
            where: { purchase_order_id: po.id },
            transaction: t
        });

        const allReceived = updatedPoItems.every(item => Number(item.received_qty) >= Number(item.qty));
        const anyReceived = updatedPoItems.some(item => Number(item.received_qty) > 0);

        let newStatus: any = po.status;
        if (allReceived) {
            newStatus = 'received';
        } else if (anyReceived) {
            newStatus = 'partially_received';
        }

        await po.update({ status: newStatus }, { transaction: t });

        /**
         * KEBIJAKAN ALOKASI MANUAL:
         * Kedatangan stok (inbound PO) secara sengaja TIDAK memicu alokasi otomatis backorder/preorder.
         * Semua penyelesaian kekurangan stok (shortage) wajib melalui proses alokasi manual oleh admin 
         * di dashboard Order Allocation untuk menjaga kontrol penuh administrator.
         */
        await t.commit();
        res.json({ message: 'PO received successfully', status: newStatus });
    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: 'Error receiving PO', error });
    }
};
