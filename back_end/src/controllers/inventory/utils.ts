import { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { Product, Category, ProductCategory, StockMutation, PurchaseOrder, PurchaseOrderItem, Supplier, sequelize, SupplierInvoice, SupplierPayment, Account, Journal, JournalLine, Setting } from '../../models';
import { JournalService } from '../../services/JournalService';
import { Op, Transaction } from 'sequelize';
import { InventoryCostService } from '../../services/InventoryCostService';
import { TaxConfigService } from '../../services/TaxConfigService';
import { VEHICLE_TYPES_SETTING_KEY, buildCanonicalVehicleMap, canonicalizeVehicleList, dedupeCaseInsensitive, parseVehicleCompatibilityInput, toVehicleCompatibilityDbValue } from '../../utils/vehicleCompatibility';

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
// Supports importing from a DB export-like worksheet (e.g. "Products") with snake_case headers.
export const PRODUCT_EXPORT_IMPORT_HEADERS = [
    'sku',
    'barcode',
    'name',
    'description',
    'image_url',
    'base_price',
    'price',
    'unit',
    'stock_quantity',
    'allocated_quantity',
    'min_stock',
    'category_id',
    'category_ids',
    'status',
    'keterangan',
    'tipe_modal',
    'varian_harga',
    'grosir',
    'total_modal',
    'bin_location',
    'vehicle_compatibility'
] as const;
export const IMPORT_ERROR_RESPONSE_LIMIT = 200;

export type ImportHeader = typeof REQUIRED_IMPORT_HEADERS[number];
export type ProductExportImportHeader = typeof PRODUCT_EXPORT_IMPORT_HEADERS[number];

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
    added_vehicle_types?: string[];
}

export interface ImportPreviewRow {
    row: number;
    sku: string;
    name: string;
    category_name: string;
    category_id?: number | null;
    category_ids?: number[] | null;
    unit: string;
    barcode: string;
    base_price: number | null;
    price: number | null;
    stock_quantity: number | null;
    status: 'active' | 'inactive';
    description?: string | null;
    image_url?: string | null;
    allocated_quantity?: number | null;
    min_stock?: number | null;
    bin_location?: string | null;
    vehicle_compatibility?: string | null;
    keterangan: string;
    tipe_modal: string;
    varian_harga_text: string;
    grosir_text: string;
    total_modal: number | null;
    is_valid: boolean;
    reasons: string[];
    _import_meta?: {
        blank_fields?: Record<string, boolean>;
    };
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
    categoryId: number | null;
    categoryIds?: number[] | null;
    unit: string;
    barcode: string | null;
    basePrice: number;
    price: number;
    stockQuantity: number;
    status: 'active' | 'inactive';
    description?: string | null;
    imageUrl?: string | null;
    allocatedQuantity?: number | null;
    minStock?: number | null;
    binLocation?: string | null;
    vehicleCompatibility?: string | null;
    keterangan: string | null;
    tipeModal: string | null;
    varianHarga: unknown | null;
    grosir: unknown | null;
    totalModal: number | null;
    inputBlankFields?: Record<string, boolean>;
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

export const normalizeHeaderLoose = (value: string): string =>
    value.trim().replace(/\s+/g, ' ').toLowerCase();

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

export const parseCategoryIdsInput = (value: unknown): number[] => {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) {
        const parsed = value
            .map((item) => parseFlexibleNumber(item))
            .filter((num): num is number => typeof num === 'number' && Number.isFinite(num))
            .map((num) => Math.trunc(num))
            .filter((num) => num > 0);
        const uniqueOrdered: number[] = [];
        const seen = new Set<number>();
        for (const id of parsed) {
            if (seen.has(id)) continue;
            seen.add(id);
            uniqueOrdered.push(id);
        }
        return uniqueOrdered;
    }

    const text = readCellText(value);
    if (!text) return [];

    // Accept JSON array (e.g. "[1,2,3]") in addition to loose separators (e.g. "1,2,3" / "1|2|3").
    const trimmed = text.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return parseCategoryIdsInput(parsed);
        } catch {
            // fall back to loose parsing below
        }
    }

    const normalized = trimmed
        .replace(/\s+(dan|and)\s+/gi, ',')
        .replace(/[\r\n\t]+/g, ',')
        .replace(/[&;/+|]/g, ',');
    const tokens = normalized
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean);

    const parsedIds = tokens
        .map((token) => parseFlexibleNumber(token))
        .filter((num): num is number => typeof num === 'number' && Number.isFinite(num))
        .map((num) => Math.trunc(num))
        .filter((num) => num > 0);

    const uniqueOrdered: number[] = [];
    const seen = new Set<number>();
    for (const id of parsedIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        uniqueOrdered.push(id);
    }
    return uniqueOrdered;
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
    const worksheet = workbook.getWorksheet('Barang') ?? workbook.getWorksheet('Products') ?? workbook.worksheets[0];
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

export const resolveHeaderMapLoose = (worksheet: ExcelJS.Worksheet): Record<string, number> => {
    const headerRow = worksheet.getRow(1);
    const map = new Map<string, number>();

    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const headerName = normalizeHeaderLoose(readCellText(cell.value));
        if (headerName) map.set(headerName, colNumber);
    });

    return [...map.entries()].reduce((acc, [key, value]) => {
        acc[key] = value;
        return acc;
    }, {} as Record<string, number>);
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
            categoryName: readCellText(row.getCell(headerMap['KATEGORI BARANG']).value),
            unit: readCellText(row.getCell(headerMap['UNIT']).value),
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

export interface ImportFileRowExtras {
    categoryId?: number | null;
    categoryIds?: number[] | null;
    categoryIdInputRaw?: unknown;
    categoryIdsInputRaw?: unknown;
    descriptionRaw?: unknown;
    imageUrlRaw?: unknown;
    allocatedQuantityRaw?: unknown;
    minStockRaw?: unknown;
    binLocationRaw?: unknown;
    vehicleCompatibilityRaw?: unknown;
}

export const parseProductsExportRows = (
    worksheet: ExcelJS.Worksheet,
    headerMap: Record<string, number>
): Array<ImportFileRow & ImportFileRowExtras> => {
    const rows: Array<ImportFileRow & ImportFileRowExtras> = [];

    const getCellValueByHeader = (row: ExcelJS.Row, header: string): unknown => {
        const col = headerMap[header];
        if (!col) return null;
        return row.getCell(col).value;
    };

    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;

        const skuRaw = readCellText(getCellValueByHeader(row, 'sku'));
        const nameRaw = readCellText(getCellValueByHeader(row, 'name'));
        const priceValue = getCellValueByHeader(row, 'price');
        const stockValue = getCellValueByHeader(row, 'stock_quantity');

        const isCompletelyEmpty = [skuRaw, nameRaw, readCellText(priceValue), readCellText(stockValue)]
            .every((value) => value === '');
        if (isCompletelyEmpty) return;

        const sku = skuRaw.trim();
        const name = nameRaw.trim();
        const rawCategoryIds = getCellValueByHeader(row, 'category_ids');
        const parsedCategoryIds = parseCategoryIdsInput(rawCategoryIds);
        const rawCategoryId = getCellValueByHeader(row, 'category_id');
        // Backward compatibility: allow multi-ID input in "category_id" column (e.g. "4,5,8").
        const parsedFromCategoryId = parsedCategoryIds.length > 0 ? [] : parseCategoryIdsInput(rawCategoryId);
        const effectiveCategoryIds = parsedCategoryIds.length > 0 ? parsedCategoryIds : parsedFromCategoryId;

        const categoryIdFromList = effectiveCategoryIds.length > 0 ? effectiveCategoryIds[0] : null;
        const categoryIdParsed = categoryIdFromList === null
            ? parseFlexibleNumber(rawCategoryId)
            : categoryIdFromList;
        const categoryId = categoryIdParsed === null ? null : Math.max(0, Math.trunc(categoryIdParsed));

        rows.push({
            rowNumber,
            sku,
            skuKey: sku.toUpperCase(),
            name,
            categoryName: 'Uncategorized',
            unit: readCellText(getCellValueByHeader(row, 'unit')),
            barcode: readCellText(getCellValueByHeader(row, 'barcode')),
            keterangan: readCellText(getCellValueByHeader(row, 'keterangan')),
            tipeModal: readCellText(getCellValueByHeader(row, 'tipe_modal')),
            statusRaw: readCellText(getCellValueByHeader(row, 'status')),
            basePriceRaw: getCellValueByHeader(row, 'base_price'),
            priceRaw: priceValue,
            stockRaw: stockValue,
            totalModalRaw: getCellValueByHeader(row, 'total_modal'),
            varianHargaRaw: getCellValueByHeader(row, 'varian_harga'),
            grosirRaw: getCellValueByHeader(row, 'grosir'),
            categoryId,
            categoryIds: effectiveCategoryIds.length > 0 ? effectiveCategoryIds : undefined,
            categoryIdInputRaw: rawCategoryId,
            categoryIdsInputRaw: rawCategoryIds,
            descriptionRaw: getCellValueByHeader(row, 'description'),
            imageUrlRaw: getCellValueByHeader(row, 'image_url'),
            allocatedQuantityRaw: getCellValueByHeader(row, 'allocated_quantity'),
            minStockRaw: getCellValueByHeader(row, 'min_stock'),
            binLocationRaw: getCellValueByHeader(row, 'bin_location'),
            vehicleCompatibilityRaw: getCellValueByHeader(row, 'vehicle_compatibility')
        });
    });

    return rows;
};

const normalizeCategoryToken = (value: string): string => {
    return value
        .replace(/\u00A0/g, ' ')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/:\s*$/, '')
        .trim();
};

const splitCategoryTokensLoose = (rawValue: string): string[] => {
    const normalized = rawValue
        .replace(/\s+(dan|and)\s+/gi, ',')
        .replace(/[\r\n\t]+/g, ',')
        .replace(/[&;/+|]/g, ',');

    const tokens = normalized
        .split(',')
        .map((item) => normalizeCategoryToken(item))
        .filter(Boolean);

    if (tokens.length === 0) return [];

    const uniqueNames = new Map<string, string>();
    tokens.forEach((name) => {
        const key = name.toLowerCase();
        if (!uniqueNames.has(key)) {
            uniqueNames.set(key, name);
        }
    });
    return [...uniqueNames.values()];
};

export const splitCategoryNames = (rawCategoryName: string): string[] => {
    const source = normalizeCategoryToken(rawCategoryName);
    if (!source) return ['Uncategorized'];

    // Support hierarchical-like inputs such as:
    // - "BAN LUAR: IRC"
    // - "BAN LUAR:\nIRC"
    // - "BAN LUAR: IRC, ASPIRA"
    // We treat the left side as primary category, and the right side as additional tags.
    const hierarchicalMatch = source.match(/^(.+?)\s*:\s*(.+)$/s);
    if (hierarchicalMatch) {
        const primary = normalizeCategoryToken(hierarchicalMatch[1]);
        const rest = normalizeCategoryToken(hierarchicalMatch[2]);
        const secondary = splitCategoryTokensLoose(rest);
        const combined = [primary, ...secondary].map((name) => normalizeCategoryToken(name)).filter(Boolean);
        if (combined.length === 0) return ['Uncategorized'];

        const uniqueNames = new Map<string, string>();
        combined.forEach((name) => {
            const key = name.toLowerCase();
            if (!uniqueNames.has(key)) uniqueNames.set(key, name);
        });
        return [...uniqueNames.values()];
    }

    const tokens = splitCategoryTokensLoose(source);
    return tokens.length > 0 ? tokens : ['Uncategorized'];
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

    let totalModal: number | null = null;
    if (!isBlankValue(row.totalModalRaw)) {
        totalModal = parseFlexibleNumber(row.totalModalRaw);
        if (totalModal === null) reasons.push('TOTAL MODAL harus berupa angka');
        else totalModal = Math.max(0, totalModal);
    }

    let basePrice = parseFlexibleNumber(row.basePriceRaw);
    if (basePrice === null) {
        // Compatibility: some exports store purchase cost in TOTAL MODAL (or base_price is empty).
        if (totalModal !== null) {
            basePrice = totalModal;
        } else {
            reasons.push('HARGA BELI harus berupa angka');
        }
    }

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

    const varianHargaText = readCellText(row.varianHargaRaw);
    const grosirText = readCellText(row.grosirRaw);

    const extras = row as ImportFileRow & ImportFileRowExtras;
    const allocatedQuantityNumber = extras.allocatedQuantityRaw !== undefined
        ? parseFlexibleNumber(extras.allocatedQuantityRaw)
        : null;
    const minStockNumber = extras.minStockRaw !== undefined
        ? parseFlexibleNumber(extras.minStockRaw)
        : null;

    const blankFields: Record<string, boolean> = {
        sku: rawSku === '',
        name: rawName === '',
        category_name: row.categoryName.trim() === '',
        unit: row.unit.trim() === '',
        barcode: row.barcode.trim() === '',
        status: row.statusRaw.trim() === '',
        base_price: isBlankValue(row.basePriceRaw),
        price: isBlankValue(row.priceRaw),
        stock_quantity: isBlankValue(row.stockRaw),
        total_modal: isBlankValue(row.totalModalRaw),
        varian_harga_text: isBlankValue(row.varianHargaRaw),
        grosir_text: isBlankValue(row.grosirRaw),
        keterangan: row.keterangan.trim() === '',
        tipe_modal: row.tipeModal.trim() === '',
    };
    if (extras.categoryIdInputRaw !== undefined || extras.categoryIdsInputRaw !== undefined) {
        blankFields.category_id = isBlankValue(extras.categoryIdInputRaw);
        blankFields.category_ids = isBlankValue(extras.categoryIdsInputRaw);
        if (blankFields.category_id && blankFields.category_ids) {
            // Treat derived category_name ("Uncategorized") as not provided by input.
            blankFields.category_name = true;
        }
    }
    if (extras.descriptionRaw !== undefined) blankFields.description = isBlankValue(extras.descriptionRaw);
    if (extras.imageUrlRaw !== undefined) blankFields.image_url = isBlankValue(extras.imageUrlRaw);
    if (extras.allocatedQuantityRaw !== undefined) blankFields.allocated_quantity = isBlankValue(extras.allocatedQuantityRaw);
    if (extras.minStockRaw !== undefined) blankFields.min_stock = isBlankValue(extras.minStockRaw);
    if (extras.binLocationRaw !== undefined) blankFields.bin_location = isBlankValue(extras.binLocationRaw);
    if (extras.vehicleCompatibilityRaw !== undefined) blankFields.vehicle_compatibility = isBlankValue(extras.vehicleCompatibilityRaw);

    const preview: ImportPreviewRow = {
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

    if (extras.categoryId !== undefined) preview.category_id = extras.categoryId;
    if (extras.categoryIds !== undefined) preview.category_ids = extras.categoryIds;
    if (extras.descriptionRaw !== undefined) preview.description = readCellText(extras.descriptionRaw) || null;
    if (extras.imageUrlRaw !== undefined) preview.image_url = readCellText(extras.imageUrlRaw) || null;
    if (extras.allocatedQuantityRaw !== undefined) {
        preview.allocated_quantity = allocatedQuantityNumber === null ? null : Math.max(0, Math.trunc(allocatedQuantityNumber));
    }
    if (extras.minStockRaw !== undefined) {
        preview.min_stock = minStockNumber === null ? null : Math.max(0, Math.trunc(minStockNumber));
    }
    if (extras.binLocationRaw !== undefined) preview.bin_location = readCellText(extras.binLocationRaw) || null;
    if (extras.vehicleCompatibilityRaw !== undefined) preview.vehicle_compatibility = readCellText(extras.vehicleCompatibilityRaw) || null;

    preview._import_meta = { blank_fields: blankFields };
    return preview;
};

export const buildPreviewFromWorkbook = async (workbook: ExcelJS.Workbook): Promise<ImportPreviewResult> => {
    const worksheet = getImportWorksheet(workbook);
    const legacyHeadersPresent = (() => {
        const headerRow = worksheet.getRow(1);
        const headerSet = new Set<string>();
        headerRow.eachCell({ includeEmpty: false }, (cell) => {
            const headerName = normalizeHeader(readCellText(cell.value));
            if (headerName) headerSet.add(headerName);
        });
        return REQUIRED_IMPORT_HEADERS.every((header) => headerSet.has(header));
    })();

    let rows: ImportPreviewRow[] = [];
    if (legacyHeadersPresent) {
        const headerMap = resolveHeaderMap(worksheet);
        const fileRows = parseImportRows(worksheet, headerMap);
        rows = fileRows.map((row) => buildPreviewRow(row));
    } else {
        const headerMapLoose = resolveHeaderMapLoose(worksheet);
        const hasSku = Boolean(headerMapLoose.sku);
        const hasName = Boolean(headerMapLoose.name);
        const hasPrice = Boolean(headerMapLoose.price);
        const hasStock = Boolean(headerMapLoose.stock_quantity);

        if (!hasSku || !hasName || !hasPrice || !hasStock) {
            throw new Error(
                'Header file import tidak dikenali. Gunakan template import (sheet "Barang") atau export produk (sheet "Products" dengan header sku, name, price, stock_quantity).'
            );
        }

        const fileRows = parseProductsExportRows(worksheet, headerMapLoose);

        // Resolve category_name from category_id/category_ids (best-effort, using first ID).
        const categoryIds = [...new Set(
            fileRows
                .map((row) => (Array.isArray(row.categoryIds) && row.categoryIds.length > 0 ? row.categoryIds[0] : row.categoryId))
                .filter((id): id is number => typeof id === 'number' && id > 0)
        )];
        const categoryNameById = new Map<number, string>();
        if (categoryIds.length > 0) {
            const categories = await Category.findAll({ where: { id: categoryIds } });
            categories.forEach((category) => {
                categoryNameById.set(category.id, category.name);
            });
        }

        rows = fileRows.map((row) => {
            const primaryCategoryId = Array.isArray(row.categoryIds) && row.categoryIds.length > 0 ? row.categoryIds[0] : row.categoryId;
            const resolvedCategoryName = primaryCategoryId ? (categoryNameById.get(primaryCategoryId) ?? 'Uncategorized') : 'Uncategorized';
            const hydratedRow = { ...row, categoryName: resolvedCategoryName };
            return buildPreviewRow(hydratedRow);
        });
    }

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

        const inputBlankFields = (() => {
            const meta = (data as any)?._import_meta;
            if (!meta || typeof meta !== 'object') return undefined;
            const blanks = (meta as any).blank_fields;
            if (!blanks || typeof blanks !== 'object' || Array.isArray(blanks)) return undefined;
            const result: Record<string, boolean> = {};
            Object.entries(blanks as Record<string, unknown>).forEach(([key, value]) => {
                if (typeof value === 'boolean') result[key] = value;
            });
            return Object.keys(result).length > 0 ? result : undefined;
        })();

        const rawName = readCellText(data.name);
        const sku = rawSku || rawName;
        const name = rawName || rawSku;
        const categoryName = readCellText(data.category_name) || 'Uncategorized';

        const categoryIdsFromPayload = (() => {
            if (Object.prototype.hasOwnProperty.call(data, 'category_ids')) {
                return parseCategoryIdsInput((data as any).category_ids);
            }
            // Backward compatibility: allow "category_id" to contain a multi-ID string like "4,5,8".
            const rawCategoryIdText = readCellText((data as any).category_id);
            if (!rawCategoryIdText) return [];
            if (!/[,&;+/|]/.test(rawCategoryIdText) && !/\s+(dan|and)\s+/i.test(rawCategoryIdText)) return [];
            const parsed = parseCategoryIdsInput(rawCategoryIdText);
            return parsed.length > 1 ? parsed : [];
        })();

        const categoryIdParsed = categoryIdsFromPayload.length > 0
            ? categoryIdsFromPayload[0]
            : parseFlexibleNumber((data as any).category_id);
        const categoryId = categoryIdParsed === null ? null : Math.max(0, Math.trunc(categoryIdParsed));
        const unit = readCellText(data.unit) || 'Pcs';
        const barcodeText = readCellText(data.barcode);
        const hasDescription = Object.prototype.hasOwnProperty.call(data, 'description');
        const hasImageUrl = Object.prototype.hasOwnProperty.call(data, 'image_url');
        const hasAllocatedQty = Object.prototype.hasOwnProperty.call(data, 'allocated_quantity');
        const hasMinStock = Object.prototype.hasOwnProperty.call(data, 'min_stock');
        const hasBinLocation = Object.prototype.hasOwnProperty.call(data, 'bin_location');
        const hasVehicleCompatibility = Object.prototype.hasOwnProperty.call(data, 'vehicle_compatibility');

        const descriptionText = hasDescription ? readCellText((data as any).description) : '';
        const imageUrlText = hasImageUrl ? readCellText((data as any).image_url) : '';
        const allocatedQuantityParsed = hasAllocatedQty ? parseFlexibleNumber((data as any).allocated_quantity) : null;
        const minStockParsed = hasMinStock ? parseFlexibleNumber((data as any).min_stock) : null;
        const binLocationText = hasBinLocation ? readCellText((data as any).bin_location) : '';
        const vehicleCompatibilityText = hasVehicleCompatibility ? readCellText((data as any).vehicle_compatibility) : '';
        const keteranganText = readCellText(data.keterangan);
        const tipeModalText = readCellText(data.tipe_modal);
        const varianHargaText = readCellText(data.varian_harga_text);
        const grosirText = readCellText(data.grosir_text);

        if (!sku && !name) reasons.push('SKU atau Nama produk minimal salah satu wajib diisi');

        let basePrice: number | null = null;
        try {
            basePrice = parseRequiredNumber(data.base_price, 'HARGA BELI');
        } catch (error) {
            // Compatibility: allow base_price to be derived from total_modal when present.
            try {
                if (!isBlankValue(data.total_modal)) {
                    basePrice = parseRequiredNumber(data.total_modal, 'HARGA BELI');
                } else {
                    throw error;
                }
            } catch (fallbackError) {
                reasons.push(fallbackError instanceof Error ? fallbackError.message : 'HARGA BELI tidak valid');
            }
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
            categoryId,
            categoryIds: categoryIdsFromPayload.length > 0 ? categoryIdsFromPayload : undefined,
            unit,
            barcode: barcodeText || null,
            basePrice,
            price,
            stockQuantity,
            status: parseImportStatus(readCellText(data.status)),
            description: hasDescription ? (descriptionText || null) : undefined,
            imageUrl: hasImageUrl ? (imageUrlText || null) : undefined,
            allocatedQuantity: hasAllocatedQty ? (allocatedQuantityParsed === null ? null : Math.max(0, Math.trunc(allocatedQuantityParsed))) : undefined,
            minStock: hasMinStock ? (minStockParsed === null ? null : Math.max(0, Math.trunc(minStockParsed))) : undefined,
            binLocation: hasBinLocation ? (binLocationText || null) : undefined,
            vehicleCompatibility: hasVehicleCompatibility ? (vehicleCompatibilityText || null) : undefined,
            keterangan: keteranganText || null,
            tipeModal: tipeModalText || null,
            varianHarga,
            grosir,
            totalModal,
            inputBlankFields
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

        // When duplicate SKU exists in a single import file:
        // - keep the most complete row as the "base"
        // - accumulate stockQuantity as a delta (to match additive stock import semantics)
        // - merge non-blank fields so blank cells don't erase data
        const existingScore = getCompletenessScore(existing) - (existing.stockQuantity > 0 ? 1 : 0);
        const currentScore = getCompletenessScore(row) - (row.stockQuantity > 0 ? 1 : 0);
        const existingTextWeight = existing.name.length + (existing.keterangan?.length ?? 0) + (existing.barcode?.length ?? 0);
        const currentTextWeight = row.name.length + (row.keterangan?.length ?? 0) + (row.barcode?.length ?? 0);

        const chooseCurrent = currentScore > existingScore
            || (currentScore === existingScore && currentTextWeight > existingTextWeight)
            || (currentScore === existingScore && currentTextWeight === existingTextWeight && row.row < existing.row);

        const preferred = chooseCurrent ? row : existing;
        const other = chooseCurrent ? existing : row;

        const mergeBlankFields = (
            a?: Record<string, boolean>,
            b?: Record<string, boolean>
        ): Record<string, boolean> | undefined => {
            if (!a && !b) return undefined;
            const keys = new Set<string>([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
            const merged: Record<string, boolean> = {};
            keys.forEach((key) => {
                merged[key] = Boolean(a?.[key] ?? false) && Boolean(b?.[key] ?? false);
            });
            return Object.keys(merged).length > 0 ? merged : undefined;
        };
        const isBlankInput = (r: ImportNormalizedRow, key: string): boolean => Boolean(r.inputBlankFields?.[key]);

        const merged: ImportNormalizedRow = {
            ...preferred,
            row: Math.min(existing.row, row.row),
            stockQuantity: Math.max(0, Math.trunc(Number(existing.stockQuantity || 0))) + Math.max(0, Math.trunc(Number(row.stockQuantity || 0))),
            inputBlankFields: mergeBlankFields(existing.inputBlankFields, row.inputBlankFields)
        };

        const mergeText = (key: string, field: keyof ImportNormalizedRow) => {
            const preferredBlank = isBlankInput(preferred, key);
            const otherBlank = isBlankInput(other, key);
            const preferredVal = merged[field];
            const otherVal = other[field];
            const preferredText = typeof preferredVal === 'string' ? preferredVal.trim() : '';
            const otherText = typeof otherVal === 'string' ? otherVal.trim() : '';
            if ((preferredBlank || !preferredText) && !otherBlank && otherText) {
                (merged as any)[field] = otherVal;
            }
        };
        const mergeNullable = (key: string, field: keyof ImportNormalizedRow) => {
            const preferredBlank = isBlankInput(preferred, key);
            const otherBlank = isBlankInput(other, key);
            const preferredVal = merged[field];
            const otherVal = other[field];
            if ((preferredBlank || preferredVal === null || preferredVal === undefined) && !otherBlank && otherVal !== null && otherVal !== undefined) {
                (merged as any)[field] = otherVal;
            }
        };

        mergeText('name', 'name');
        mergeText('category_name', 'categoryName');
        mergeNullable('category_id', 'categoryId');
        mergeNullable('category_ids', 'categoryIds');
        mergeText('unit', 'unit');
        mergeNullable('barcode', 'barcode');
        mergeNullable('description', 'description');
        mergeNullable('image_url', 'imageUrl');
        mergeNullable('allocated_quantity', 'allocatedQuantity');
        mergeNullable('min_stock', 'minStock');
        mergeNullable('bin_location', 'binLocation');
        mergeNullable('vehicle_compatibility', 'vehicleCompatibility');
        mergeText('keterangan', 'keterangan');
        mergeText('tipe_modal', 'tipeModal');
        mergeNullable('varian_harga_text', 'varianHarga');
        mergeNullable('grosir_text', 'grosir');
        mergeNullable('total_modal', 'totalModal');
        if (isBlankInput(preferred, 'status') && !isBlankInput(other, 'status')) merged.status = other.status;

        deduplicatedBySku.set(row.skuKey, merged);
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

    // Auto-add any new vehicle compatibility tokens into master list, then normalize rows into canonical JSON array format.
    let addedVehicleTypes: string[] = [];
    const allVehicleTokens: string[] = [];
    const perRowTokens = new Map<number, string[]>();
    for (const row of rows) {
        if (row.vehicleCompatibility === undefined) continue;
        const tokens = parseVehicleCompatibilityInput(row.vehicleCompatibility);
        perRowTokens.set(row.row, tokens);
        allVehicleTokens.push(...tokens);
    }

    const uniqueTokens = dedupeCaseInsensitive(allVehicleTokens);
    let canonicalVehicleMap = new Map<string, string>();
    if (uniqueTokens.length > 0) {
        const t = await sequelize.transaction();
        try {
            const existingSetting = await Setting.findByPk(VEHICLE_TYPES_SETTING_KEY, { transaction: t, lock: t.LOCK.UPDATE });
            const existingOptionsRaw = Array.isArray(existingSetting?.value) ? existingSetting?.value : [];
            const existingOptions = dedupeCaseInsensitive(existingOptionsRaw.map((v: any) => String(v ?? '')));
            const existingMap = buildCanonicalVehicleMap(existingOptions);

            const nextOptions = dedupeCaseInsensitive([...existingOptions, ...uniqueTokens]);
            const nextMap = buildCanonicalVehicleMap(nextOptions);

            addedVehicleTypes = nextOptions.filter((opt) => !existingMap.has(opt.toLowerCase()));

            await Setting.upsert(
                {
                    key: VEHICLE_TYPES_SETTING_KEY,
                    value: nextOptions,
                    description: 'Master list aplikasi/jenis kendaraan untuk field products.vehicle_compatibility'
                },
                { transaction: t }
            );
            await t.commit();

            canonicalVehicleMap = nextMap;
        } catch (error) {
            try { await t.rollback(); } catch { }
            throw error;
        }

        // Apply canonical normalization into row.vehicleCompatibility as JSON string (or null).
        for (const row of rows) {
            if (row.vehicleCompatibility === undefined) continue;
            const tokens = perRowTokens.get(row.row) ?? parseVehicleCompatibilityInput(row.vehicleCompatibility);
            if (tokens.length === 0) {
                row.vehicleCompatibility = null;
                continue;
            }
            const { canonical } = canonicalizeVehicleList(tokens, canonicalVehicleMap);
            row.vehicleCompatibility = toVehicleCompatibilityDbValue(canonical);
        }
    } else {
        // If no input tokens exist, still normalize any provided values to null/JSON array shape.
        for (const row of rows) {
            if (row.vehicleCompatibility === undefined) continue;
            const tokens = perRowTokens.get(row.row) ?? parseVehicleCompatibilityInput(row.vehicleCompatibility);
            row.vehicleCompatibility = tokens.length === 0 ? null : toVehicleCompatibilityDbValue(dedupeCaseInsensitive(tokens));
        }
    }

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
            const existingProduct = await Product.findOne({
                where: { sku: row.sku },
                transaction,
                lock: transaction.LOCK.UPDATE
            });

            if (!existingProduct) {
                let categoryIds: number[] = [];
                if (Array.isArray(row.categoryIds) && row.categoryIds.length > 0) {
                    const normalizedIds = row.categoryIds
                        .map((value) => Number(value))
                        .filter((value) => Number.isInteger(value) && value > 0);

                    if (normalizedIds.length === 0) {
                        throw new Error('category_ids harus berisi daftar ID kategori yang valid');
                    }

                    const categories = await Category.findAll({
                        attributes: ['id'],
                        where: { id: { [Op.in]: normalizedIds } },
                        transaction
                    });
                    const existingIds = new Set(categories.map((cat) => Number(cat.id)));
                    const missing = normalizedIds.filter((id) => !existingIds.has(id));
                    if (missing.length > 0) {
                        throw new Error(`Kategori ID tidak ditemukan: ${missing.join(', ')}`);
                    }
                    // Preserve input order while removing duplicates.
                    const uniqueOrdered: number[] = [];
                    const seen = new Set<number>();
                    for (const id of normalizedIds) {
                        if (seen.has(id)) continue;
                        seen.add(id);
                        uniqueOrdered.push(id);
                    }
                    categoryIds = uniqueOrdered;
                } else if (row.categoryId) {
                    const existingCategory = await Category.findByPk(row.categoryId, { transaction });
                    if (existingCategory) categoryIds = [existingCategory.id];
                }
                if (categoryIds.length === 0) {
                    categoryIds = await getOrCreateCategoryIds(row.categoryName, transaction);
                }
                const primaryCategoryId = categoryIds[0];

                const importPayload = {
                    sku: row.sku,
                    name: row.name,
                    category_id: primaryCategoryId,
                    unit: row.unit,
                    barcode: row.barcode,
                    base_price: row.basePrice,
                    price: row.price,
                    status: row.status,
                    keterangan: row.keterangan,
                    tipe_modal: row.tipeModal,
                    varian_harga: row.varianHarga,
                    grosir: row.grosir,
                    total_modal: row.totalModal
                } as any;
                if (row.description !== undefined) importPayload.description = row.description;
                if (row.imageUrl !== undefined) importPayload.image_url = row.imageUrl;
                if (row.allocatedQuantity !== undefined) importPayload.allocated_quantity = row.allocatedQuantity;
                if (row.minStock !== undefined) importPayload.min_stock = row.minStock;
                if (row.binLocation !== undefined) importPayload.bin_location = row.binLocation;
                if (row.vehicleCompatibility !== undefined) importPayload.vehicle_compatibility = row.vehicleCompatibility;

                if (row.stockQuantity > 0 && row.basePrice <= 0) {
                    throw new Error('HARGA BELI wajib > 0 jika STOK > 0 (untuk pencatatan HPP/profit).');
                }
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
                        reference_type: 'inventory_import',
                        note: 'Initial stock from inventory import',
                        reference_id: batchReference
                    }, { transaction });

                    await InventoryCostService.recordInbound({
                        product_id: String(createdProduct.id),
                        qty: row.stockQuantity,
                        unit_cost: row.basePrice,
                        reference_type: 'inventory_import',
                        reference_id: batchReference,
                        note: 'Initial stock from inventory import',
                        transaction
                    });
                }

                summary.created_count += 1;
                summary.processed_rows += 1;
                await transaction.commit();
                continue;
            }

            const isBlankInput = (key: string): boolean => Boolean(row.inputBlankFields?.[key]);

            const categoryUpdateRequested = (() => {
                const categoryNameProvided = !isBlankInput('category_name') && row.categoryName.trim() !== '';
                const categoryIdProvided = !isBlankInput('category_id') && typeof row.categoryId === 'number' && row.categoryId > 0;
                const categoryIdsProvided = !isBlankInput('category_ids') && Array.isArray(row.categoryIds) && row.categoryIds.length > 0;
                return categoryNameProvided || categoryIdProvided || categoryIdsProvided;
            })();

            let categoryIds: number[] | null = null;
            let primaryCategoryId: number | null = null;
            if (categoryUpdateRequested) {
                categoryIds = [];
                if (Array.isArray(row.categoryIds) && row.categoryIds.length > 0) {
                    const normalizedIds = row.categoryIds
                        .map((value) => Number(value))
                        .filter((value) => Number.isInteger(value) && value > 0);

                    if (normalizedIds.length === 0) {
                        throw new Error('category_ids harus berisi daftar ID kategori yang valid');
                    }

                    const categories = await Category.findAll({
                        attributes: ['id'],
                        where: { id: { [Op.in]: normalizedIds } },
                        transaction
                    });
                    const existingIds = new Set(categories.map((cat) => Number(cat.id)));
                    const missing = normalizedIds.filter((id) => !existingIds.has(id));
                    if (missing.length > 0) {
                        throw new Error(`Kategori ID tidak ditemukan: ${missing.join(', ')}`);
                    }
                    // Preserve input order while removing duplicates.
                    const uniqueOrdered: number[] = [];
                    const seen = new Set<number>();
                    for (const id of normalizedIds) {
                        if (seen.has(id)) continue;
                        seen.add(id);
                        uniqueOrdered.push(id);
                    }
                    categoryIds = uniqueOrdered;
                } else if (row.categoryId) {
                    const existingCategory = await Category.findByPk(row.categoryId, { transaction });
                    if (existingCategory) categoryIds = [existingCategory.id];
                }
                if (categoryIds.length === 0) {
                    categoryIds = await getOrCreateCategoryIds(row.categoryName, transaction);
                }
                primaryCategoryId = categoryIds[0] ?? null;
            }

            const updatePayload: any = {
                base_price: row.basePrice,
                price: row.price,
            };

            // Skip updates when corresponding import cell was blank.
            if (!isBlankInput('name') && row.name.trim()) updatePayload.name = row.name;
            if (!isBlankInput('unit') && row.unit.trim()) updatePayload.unit = row.unit;
            if (!isBlankInput('status')) updatePayload.status = row.status;
            if (!isBlankInput('barcode') && row.barcode && row.barcode.trim()) updatePayload.barcode = row.barcode;
            if (!isBlankInput('keterangan') && row.keterangan && row.keterangan.trim()) updatePayload.keterangan = row.keterangan;
            if (!isBlankInput('tipe_modal') && row.tipeModal && row.tipeModal.trim()) updatePayload.tipe_modal = row.tipeModal;

            if (categoryUpdateRequested && primaryCategoryId) updatePayload.category_id = primaryCategoryId;

            if (row.description !== undefined && !isBlankInput('description') && row.description && row.description.trim()) {
                updatePayload.description = row.description;
            }
            if (row.imageUrl !== undefined && !isBlankInput('image_url') && row.imageUrl && row.imageUrl.trim()) {
                updatePayload.image_url = row.imageUrl;
            }
            if (row.allocatedQuantity !== undefined && !isBlankInput('allocated_quantity') && row.allocatedQuantity !== null) {
                updatePayload.allocated_quantity = row.allocatedQuantity;
            }
            if (row.minStock !== undefined && !isBlankInput('min_stock') && row.minStock !== null) {
                updatePayload.min_stock = row.minStock;
            }
            if (row.binLocation !== undefined && !isBlankInput('bin_location') && row.binLocation && row.binLocation.trim()) {
                updatePayload.bin_location = row.binLocation;
            }
            if (row.vehicleCompatibility !== undefined && !isBlankInput('vehicle_compatibility') && row.vehicleCompatibility && row.vehicleCompatibility.trim()) {
                updatePayload.vehicle_compatibility = row.vehicleCompatibility;
            }
            if (!isBlankInput('varian_harga_text') && row.varianHarga !== null) updatePayload.varian_harga = row.varianHarga;
            if (!isBlankInput('grosir_text') && row.grosir !== null) updatePayload.grosir = row.grosir;
            if (!isBlankInput('total_modal') && row.totalModal !== null) updatePayload.total_modal = row.totalModal;

            const previousStock = Number(existingProduct.stock_quantity);
            const importedQty = isBlankInput('stock_quantity') ? 0 : Math.max(0, Math.trunc(Number(row.stockQuantity || 0)));
            const nextStock = previousStock + importedQty;
            const stockDelta = importedQty;

            if (stockDelta > 0 && row.basePrice <= 0) {
                throw new Error('HARGA BELI wajib > 0 jika STOK bertambah (untuk pencatatan HPP/profit).');
            }

            // Guardrail: if an import updates `products.price` but doesn't include varian_harga,
            // keep `varian_harga` consistent so placeholder tier prices don't become unintended overrides.
            const prevSellingPrice = Number((existingProduct as any)?.price ?? 0);
            const nextSellingPrice = Number(row.price ?? 0);
            const priceChanged = Number.isFinite(prevSellingPrice) && Number.isFinite(nextSellingPrice)
                ? Math.abs(prevSellingPrice - nextSellingPrice) > 0.0001
                : false;
            const importProvidesVariantHarga = Object.prototype.hasOwnProperty.call(updatePayload, 'varian_harga');
            if (priceChanged && !importProvidesVariantHarga) {
                const existingVariantRaw = (existingProduct as any)?.varian_harga;
                const guardedVariant = buildGuardedVariantHargaForPriceUpdate(existingVariantRaw, prevSellingPrice, nextSellingPrice);
                if (guardedVariant) {
                    updatePayload.varian_harga = guardedVariant;
                }
            }

            await existingProduct.update({
                ...updatePayload,
                stock_quantity: nextStock
            }, { transaction });

            if (categoryUpdateRequested && categoryIds) {
                await syncProductCategories(existingProduct.id, categoryIds, transaction);
            }

            if (stockDelta !== 0) {
                await StockMutation.create({
                    product_id: existingProduct.id,
                    type: 'adjustment',
                    qty: stockDelta,
                    reference_type: 'inventory_import',
                    note: `Stock adjusted by import (${previousStock} -> ${nextStock})`,
                    reference_id: batchReference
                }, { transaction });

                if (stockDelta > 0) {
                    // IMPORTANT: stock increases from import should create an inbound cost layer (batch) using the
                    // imported unit cost, so a SKU can have multiple purchase prices over time.
                    await InventoryCostService.recordInbound({
                        product_id: String(existingProduct.id),
                        qty: stockDelta,
                        unit_cost: row.basePrice,
                        reference_type: 'inventory_import',
                        reference_id: batchReference,
                        note: `Stock inbound by import (${previousStock} -> ${nextStock})`,
                        merge_same_unit_cost: true,
                        transaction
                    });
                } else {
                    await InventoryCostService.recordAdjustment({
                        product_id: String(existingProduct.id),
                        qty_diff: stockDelta,
                        reference_type: 'inventory_import',
                        reference_id: batchReference,
                        note: `Stock adjusted by import (${previousStock} -> ${nextStock})`,
                        transaction
                    });
                }
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

    return { summary, errors, added_vehicle_types: addedVehicleTypes };
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

const PRICE_GUARDRAIL_EPS = 0.0001;

const approxEqual = (a: number, b: number): boolean => Math.abs(a - b) <= PRICE_GUARDRAIL_EPS;

const toFinitePositiveNumber = (value: unknown): number | null => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    if (parsed <= 0) return null;
    return parsed;
};

const resolveVariantRegularPrice = (variant: Record<string, unknown>, productPriceFallback: number): number => {
    const prices = toObjectOrEmpty((variant as any)?.prices);
    const candidates: unknown[] = [
        (prices as any).regular,
        (variant as any).regular,
        (prices as any).base_price,
        (variant as any).base_price,
        (prices as any).price,
        (variant as any).price,
        productPriceFallback
    ];

    for (const candidate of candidates) {
        const parsed = toFinitePositiveNumber(candidate);
        if (parsed !== null) return parsed;
    }

    const fallback = Number(productPriceFallback || 0);
    return Number.isFinite(fallback) ? Math.max(0, fallback) : 0;
};

const resolveTierDiscountPct = (variantRaw: unknown, tier: string, aliases: string[] = []): number | null => {
    const source = toObjectOrEmpty(variantRaw);
    const discounts = toObjectOrEmpty((source as any)?.discounts_pct);

    const candidates: unknown[] = [
        (discounts as any)[tier],
        toObjectOrEmpty((source as any)[tier]).discount_pct,
        (source as any)[`${tier}_discount_pct`]
    ];
    for (const alias of aliases) {
        candidates.push(
            (discounts as any)[alias],
            toObjectOrEmpty((source as any)[alias]).discount_pct,
            (source as any)[`${alias}_discount_pct`]
        );
    }

    for (const candidate of candidates) {
        const parsed = toPercentageNumber(candidate);
        if (parsed === null) continue;
        if (parsed <= 0) continue;
        return parsed;
    }

    return null;
};

const setTierPriceKeepingShape = (variant: Record<string, unknown>, tierKey: string, tierPrice: number): boolean => {
    let changed = false;
    const v = variant as any;

    const currentPrices = toObjectOrEmpty(v.prices);
    const nextPrices = { ...currentPrices } as Record<string, unknown>;
    if (!v.prices || typeof v.prices !== 'object' || Array.isArray(v.prices)) {
        v.prices = nextPrices;
        changed = true;
    } else {
        v.prices = nextPrices;
    }

    const prevPrice = toFinitePositiveNumber((nextPrices as any)[tierKey]);
    if (prevPrice === null || !approxEqual(prevPrice, tierPrice)) {
        (nextPrices as any)[tierKey] = tierPrice;
        changed = true;
    }

    if (Object.prototype.hasOwnProperty.call(v, tierKey)) {
        const topVal = v[tierKey];
        if (topVal && typeof topVal === 'object' && !Array.isArray(topVal)) {
            const prevTopPrice = toFinitePositiveNumber((topVal as any).price);
            if (prevTopPrice === null || !approxEqual(prevTopPrice, tierPrice)) {
                (topVal as any).price = tierPrice;
                changed = true;
            }
        } else {
            const prevTop = toFinitePositiveNumber(topVal);
            if (prevTop === null || !approxEqual(prevTop, tierPrice)) {
                v[tierKey] = tierPrice;
                changed = true;
            }
        }
    }

    return changed;
};

const cleanupPlaceholderTierPrice = (variant: Record<string, unknown>, tierKey: string, placeholder: number): boolean => {
    if (!Number.isFinite(placeholder) || placeholder <= 0) return false;
    let changed = false;
    const v = variant as any;

    const prices = toObjectOrEmpty(v.prices);
    if (prices && typeof prices === 'object' && !Array.isArray(prices) && Object.prototype.hasOwnProperty.call(prices, tierKey)) {
        const parsed = toFinitePositiveNumber((prices as any)[tierKey]);
        if (parsed !== null && approxEqual(parsed, placeholder)) {
            const next = { ...prices } as any;
            delete next[tierKey];
            v.prices = next;
            changed = true;
        }
    }

    if (Object.prototype.hasOwnProperty.call(v, tierKey)) {
        const topVal = v[tierKey];
        if (topVal && typeof topVal === 'object' && !Array.isArray(topVal)) {
            if (Object.prototype.hasOwnProperty.call(topVal as any, 'price')) {
                const parsed = toFinitePositiveNumber((topVal as any).price);
                if (parsed !== null && approxEqual(parsed, placeholder)) {
                    delete (topVal as any).price;
                    changed = true;
                }
            }
        } else {
            const parsed = toFinitePositiveNumber(topVal);
            if (parsed !== null && approxEqual(parsed, placeholder)) {
                delete v[tierKey];
                changed = true;
            }
        }
    }

    return changed;
};

const buildGuardedVariantHargaForPriceUpdate = (
    variantRaw: unknown,
    prevProductPrice: number,
    nextRegularPrice: number
): Record<string, unknown> | null => {
    const prevVariant = toObjectOrEmpty(variantRaw);
    if (Object.keys(prevVariant).length === 0) return null;

    const prevPrices = toObjectOrEmpty((prevVariant as any).prices);
    const prevRegularVariantPrice = resolveVariantRegularPrice(prevVariant, prevProductPrice);

    const nextVariant = { ...prevVariant } as Record<string, unknown>;
    let changed = false;

    const nextPrices = { ...prevPrices } as Record<string, unknown>;
    (nextVariant as any).prices = nextPrices;

    const nextRegularRounded = roundPrice(Number(nextRegularPrice || 0));
    if (!approxEqual(toFinitePositiveNumber((nextPrices as any).regular) ?? 0, nextRegularRounded)) {
        (nextPrices as any).regular = nextRegularRounded;
        changed = true;
    }

    if (Object.prototype.hasOwnProperty.call(prevVariant as any, 'regular')) {
        const prevTop = toFinitePositiveNumber((prevVariant as any).regular);
        if (prevTop === null || !approxEqual(prevTop, nextRegularRounded)) {
            (nextVariant as any).regular = nextRegularRounded;
            changed = true;
        }
    }

    const tiers: Array<{ key: 'gold' | 'platinum'; aliases: string[] }> = [
        { key: 'gold', aliases: [] },
        { key: 'platinum', aliases: ['premium'] }
    ];

    for (const { key, aliases } of tiers) {
        const discountPct = resolveTierDiscountPct(nextVariant, key, aliases);
        if (discountPct !== null) {
            const tierPrice = roundPrice(nextRegularRounded * (1 - discountPct / 100));
            changed = setTierPriceKeepingShape(nextVariant, key, tierPrice) || changed;

            // Some datasets use `premium` as an alias for `platinum`.
            if (key === 'platinum') {
                const hasPremium =
                    Object.prototype.hasOwnProperty.call(prevVariant as any, 'premium') ||
                    Object.prototype.hasOwnProperty.call(prevPrices as any, 'premium');
                if (hasPremium) {
                    changed = setTierPriceKeepingShape(nextVariant, 'premium', tierPrice) || changed;
                }
            }

            continue;
        }

        changed = cleanupPlaceholderTierPrice(nextVariant, key, prevRegularVariantPrice) || changed;
        if (key === 'platinum') {
            changed = cleanupPlaceholderTierPrice(nextVariant, 'premium', prevRegularVariantPrice) || changed;
        }
    }

    return changed ? nextVariant : null;
};
