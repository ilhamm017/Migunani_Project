import ExcelJS from 'exceljs';
import {
    cellToString,
    parseDmyDate,
    parseIntNonNegative,
    parseNumberId,
} from './salesReportDiskonParser';

export type SalesReportBackorderLineItem = {
    product_name: string;
    cost_per_unit: number;
    price_per_unit: number;
    qty_requested: number;
    qty_display: number;
    backorder_qty: number;
    discount_amount: number;
    subtotal: number;
    note: string | null;
    discount_pct: number;
};

export type SalesReportBackorderInvoice = {
    invoice_no: string;
    date: Date;
    customer_name: string;
    bruto: number;
    diskon: number;
    netto: number;
    items: SalesReportBackorderLineItem[];
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

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

export const parseSalesReportBackorderXlsx = async (filePath: string): Promise<SalesReportBackorderInvoice[]> => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const ws = workbook.worksheets[0];
    if (!ws) return [];

    const headerRowNumber = findHeaderRow(ws);
    if (!headerRowNumber) {
        throw new Error('Header row not found (expected columns: INVOICE, TANGGAL, PELANGGAN).');
    }

    const invoices: SalesReportBackorderInvoice[] = [];
    let current: SalesReportBackorderInvoice | null = null;

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
        const qtyRequested = parseIntNonNegative(row.getCell(52).value) || parseIntNonNegative(row.getCell(22).value);
        const qtyDisplay = parseIntNonNegative(row.getCell(27).value);
        const backorderQty = parseIntNonNegative(row.getCell(28).value);
        const discountAmount = parseNumberId(row.getCell(23).value);
        const subtotal = parseNumberId(row.getCell(24).value);
        const noteRaw = cellToString(row.getCell(25).value);
        const note = noteRaw ? noteRaw.trim() : null;

        const denom = Math.max(0, pricePerUnit * Math.max(1, qtyRequested));
        const discountPct = denom > 0 && discountAmount > 0
            ? round2(Math.min(100, Math.max(0, (discountAmount / denom) * 100)))
            : 0;

        current.items.push({
            product_name: productName.trim(),
            cost_per_unit: round2(Math.max(0, costPerUnit)),
            price_per_unit: round2(Math.max(0, pricePerUnit)),
            qty_requested: qtyRequested,
            qty_display: qtyDisplay,
            backorder_qty: backorderQty,
            discount_amount: round2(Math.max(0, discountAmount)),
            subtotal: round2(Math.max(0, subtotal)),
            note,
            discount_pct: discountPct
        });
    }

    return invoices.filter((inv) => inv.items.length > 0);
};

