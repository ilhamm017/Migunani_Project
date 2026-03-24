import ExcelJS from 'exceljs';

export type SalesReportLineItem = {
    product_name: string;
    cost_per_unit: number;
    price_per_unit: number;
    qty: number;
    discount_amount: number;
    subtotal: number;
    note: string | null;
    discount_pct: number;
};

export type SalesReportInvoice = {
    invoice_no: string;
    date: Date;
    customer_name: string;
    bruto: number;
    diskon: number;
    netto: number;
    items: SalesReportLineItem[];
};

const toRichTextString = (value: any): string | null => {
    if (!value || typeof value !== 'object') return null;
    if (typeof value.text === 'string') return value.text;
    if (Array.isArray(value.richText)) {
        return value.richText.map((chunk: any) => String(chunk?.text || '')).join('');
    }
    if (value.formula && value.result !== undefined) {
        return String(value.result ?? '');
    }
    return null;
};

export const cellToString = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') return String(value);
    if (value instanceof Date) return value.toISOString();
    const rich = toRichTextString(value as any);
    if (rich !== null) return String(rich).trim();
    return String(value).trim();
};

export const parseNumberId = (value: unknown): number => {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const raw = cellToString(value);
    if (!raw) return 0;

    const normalized = raw
        .replace(/\s+/g, '')
        .replace(/[^0-9,.-]/g, '')
        .replace(/\.(?=\d{3}(\D|$))/g, '')
        .replace(',', '.');

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
};

export const parseIntNonNegative = (value: unknown): number => {
    const n = parseNumberId(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.floor(n));
};

export const parseDmyDate = (value: unknown): Date | null => {
    if (value instanceof Date && Number.isFinite(value.getTime())) return value;
    const raw = cellToString(value);
    if (!raw) return null;

    const match = raw.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
    if (!match) {
        const fallback = new Date(raw);
        return Number.isFinite(fallback.getTime()) ? fallback : null;
    }

    const day = Number(match[1]);
    const month = Number(match[2]);
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
    return new Date(year, month - 1, day, 0, 0, 0, 0);
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

const parseDiscountPctFromNote = (note: string): number | null => {
    const match = note.match(/diskon\s*([0-9]+(?:[.,][0-9]+)?)\s*%/i);
    if (!match) return null;
    const pct = parseNumberId(match[1]);
    if (!Number.isFinite(pct)) return null;
    if (pct < 0 || pct > 100) return null;
    return round2(pct);
};

const findHeaderRow = (ws: ExcelJS.Worksheet): number | null => {
    for (let rowNumber = 1; rowNumber <= Math.min(50, ws.rowCount); rowNumber += 1) {
        const row = ws.getRow(rowNumber);
        const c1 = cellToString(row.getCell(1).value).toUpperCase();
        const c2 = cellToString(row.getCell(2).value).toUpperCase();
        const c3 = cellToString(row.getCell(3).value).toUpperCase();
        if (c1 === 'INVOICE' && c2 === 'TANGGAL' && c3 === 'PELANGGAN') return rowNumber;
    }
    return null;
};

export const parseSalesReportDiskonXlsx = async (filePath: string): Promise<SalesReportInvoice[]> => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const ws = workbook.worksheets[0];
    if (!ws) return [];

    const headerRowNumber = findHeaderRow(ws);
    if (!headerRowNumber) {
        throw new Error('Header row not found (expected columns: INVOICE, TANGGAL, PELANGGAN).');
    }

    const invoices: SalesReportInvoice[] = [];
    let current: SalesReportInvoice | null = null;

    for (let rowNumber = headerRowNumber + 1; rowNumber <= ws.rowCount; rowNumber += 1) {
        const row = ws.getRow(rowNumber);
        const invoiceCell = cellToString(row.getCell(1).value);
        const productName = cellToString(row.getCell(19).value);

        const isInvoiceRow = !!invoiceCell && /^INV[-/]/i.test(invoiceCell);
        if (isInvoiceRow) {
            const date = parseDmyDate(row.getCell(2).value) || new Date();
            const customerName = cellToString(row.getCell(3).value) || 'Customer';
            const bruto = parseNumberId(row.getCell(10).value);
            const diskon = parseNumberId(row.getCell(11).value);
            const netto = parseNumberId(row.getCell(15).value);
            current = {
                invoice_no: invoiceCell.trim(),
                date,
                customer_name: customerName.trim(),
                bruto,
                diskon,
                netto,
                items: []
            };
            invoices.push(current);
            continue;
        }

        if (!current) continue;
        if (!productName) continue;

        const costPerUnit = parseNumberId(row.getCell(20).value);
        const pricePerUnit = parseNumberId(row.getCell(21).value);
        const qty = parseIntNonNegative(row.getCell(22).value);
        const discountAmount = parseNumberId(row.getCell(23).value);
        const subtotal = parseNumberId(row.getCell(24).value);
        const noteRaw = cellToString(row.getCell(25).value);
        const note = noteRaw ? noteRaw.trim() : null;

        let discountPct = 0;
        const denom = Math.max(0, pricePerUnit * Math.max(1, qty));
        if (denom > 0 && discountAmount > 0) {
            discountPct = round2(Math.min(100, Math.max(0, (discountAmount / denom) * 100)));
        } else if (note) {
            const pctFromNote = parseDiscountPctFromNote(note);
            if (pctFromNote !== null) discountPct = pctFromNote;
        }

        current.items.push({
            product_name: productName.trim(),
            cost_per_unit: round2(Math.max(0, costPerUnit)),
            price_per_unit: round2(Math.max(0, pricePerUnit)),
            qty,
            discount_amount: round2(Math.max(0, discountAmount)),
            subtotal: round2(Math.max(0, subtotal)),
            note,
            discount_pct: discountPct
        });
    }

    return invoices.filter((inv) => inv.items.length > 0);
};

