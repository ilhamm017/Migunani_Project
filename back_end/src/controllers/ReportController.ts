import { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { Op } from 'sequelize';
import { ReportService } from '../services/ReportService';
import { CustomerBalanceService } from '../services/CustomerBalanceService';
import { Invoice, InvoiceItem, Order, OrderItem, PosSale, PosSaleItem, Product, User, sequelize } from '../models';
import { asyncWrapper } from '../utils/asyncWrapper';
import { CustomError } from '../utils/CustomError';

const PDFDocument = require('pdfkit');

const formatLocalYmd = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const formatLocalYmdHm = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${formatLocalYmd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const getProfitAndLoss = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { startDate, endDate, limit } = req.query;
        if (!startDate || !endDate) {
            throw new CustomError('StartDate dan EndDate wajib diisi', 400);
        }
        const result = await ReportService.calculateProfitAndLoss(String(startDate), String(endDate));

        const rowLimit = Math.min(Math.max(Number(limit || 200), 1), 2000);
        const start = new Date(`${String(startDate)}T00:00:00`);
        const end = new Date(`${String(endDate)}T23:59:59.999`);

        const paidInvoices = await Invoice.findAll({
            where: {
                payment_status: 'paid',
                verified_at: { [Op.between]: [start, end] },
            },
            attributes: ['id', 'invoice_number', 'subtotal', 'verified_at'],
            include: [
                { model: InvoiceItem, as: 'Items', attributes: ['qty', 'unit_cost'] },
                {
                    model: Order,
                    attributes: ['id'],
                    include: [{ model: User, as: 'Customer', attributes: ['id', 'name'] }],
                },
            ],
            order: [['verified_at', 'DESC']],
            limit: rowLimit,
        });

        const invoices = paidInvoices.map((inv: any) => {
            const items = Array.isArray(inv?.Items) ? inv.Items : [];
            const modal = items.reduce((sum: number, it: any) => sum + (Number(it?.unit_cost || 0) * Number(it?.qty || 0)), 0);
            const subtotal = Number(inv?.subtotal || 0);
            const customerName = String(inv?.Order?.Customer?.name || '').trim() || '-';
            return {
                invoice_id: String(inv?.id),
                invoice_number: String(inv?.invoice_number || ''),
                customer_name: customerName,
                subtotal,
                modal,
                laba: subtotal - modal,
            };
        });

        res.json({ ...result, invoices });
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error calculating P&L', 500);
    }
});

export const getBalanceSheet = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { asOfDate } = req.query;
        const result = await ReportService.calculateBalanceSheet(asOfDate as string | undefined);
        res.json(result);
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error calculating Balance Sheet', 500);
    }
});

export const getCashFlow = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            throw new CustomError('StartDate dan EndDate wajib diisi', 400);
        }
        const result = await ReportService.calculateCashFlow(String(startDate), String(endDate));
        res.json(result);
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error calculating Cash Flow', 500);
    }
});

export const getInventoryValue = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const result = await ReportService.calculateInventoryValue();
        res.json(result);
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error calculating Inventory Value', 500);
    }
});

export const getAccountsPayableAging = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const result = await ReportService.calculateAccountsPayableAging();
        res.json(result);
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error calculating AP Aging', 500);
    }
});

export const getAccountsReceivableAging = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const result = await ReportService.calculateAccountsReceivableAging();
        res.json(result);
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error calculating AR Aging', 500);
    }
});

export const getCustomerBalanceReport = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const q = String(req.query?.q || '').trim();
        const onlyNegative = String(req.query?.only_negative || '').trim().toLowerCase() === 'true';
        const onlyPositive = String(req.query?.only_positive || '').trim().toLowerCase() === 'true';
        const minAbs = req.query?.min_abs !== undefined ? Number(req.query.min_abs) : undefined;
        const limit = req.query?.limit !== undefined ? Number(req.query.limit) : undefined;
        const offset = req.query?.offset !== undefined ? Number(req.query.offset) : undefined;

        const result = await CustomerBalanceService.getCustomerBalancesReport({
            q,
            only_negative: onlyNegative,
            only_positive: onlyPositive,
            min_abs: minAbs,
            limit,
            offset,
        });
        res.json(result);
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error calculating customer balance report', 500);
    }
});

export const getTaxSummary = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            throw new CustomError('StartDate dan EndDate wajib diisi', 400);
        }
        const result = await ReportService.calculateTaxSummary(String(startDate), String(endDate));
        res.json(result);
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error calculating tax summary', 500);
    }
});

export const getVatMonthlyReport = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { year } = req.query;
        const y = Number(year || new Date().getFullYear());
        if (!Number.isInteger(y) || y < 2000 || y > 3000) {
            throw new CustomError('Year tidak valid', 400);
        }
        const result = await ReportService.calculateVatMonthlyReport(y);
        res.json(result);
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error generating VAT monthly report', 500);
    }
});

export const getBackorderPreorderReport = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { startDate, endDate } = req.query;
        const startRaw = typeof startDate === 'string' && startDate.trim() ? startDate.trim() : undefined;
        const endRaw = typeof endDate === 'string' && endDate.trim() ? endDate.trim() : undefined;

        const startParsed = startRaw ? new Date(startRaw) : null;
        const endParsed = endRaw ? new Date(endRaw) : null;
        if (startParsed && !Number.isFinite(startParsed.getTime())) {
            throw new CustomError('StartDate tidak valid', 400);
        }
        if (endParsed && !Number.isFinite(endParsed.getTime())) {
            throw new CustomError('EndDate tidak valid', 400);
        }
        if (startParsed && endParsed && startParsed.getTime() > endParsed.getTime()) {
            throw new CustomError('StartDate tidak boleh lebih besar dari EndDate', 400);
        }

        const result = await ReportService.calculateBackorderPreorderReport(
            startRaw,
            endRaw
        );
        res.json(result);
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error calculating Backorder report', 500);
    }
});

export const exportBackorderPreorderReportExcel = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { startDate, endDate, extract } = req.query;
        const startRaw = typeof startDate === 'string' && startDate.trim() ? startDate.trim() : undefined;
        const endRaw = typeof endDate === 'string' && endDate.trim() ? endDate.trim() : undefined;
        const extractModeRaw = typeof extract === 'string' ? extract.trim().toLowerCase() : '';
        const extractMode: 'full' | 'po' = extractModeRaw === 'po' ? 'po' : 'full';

        const startParsed = startRaw ? new Date(startRaw) : null;
        const endParsed = endRaw ? new Date(endRaw) : null;
        if (startParsed && !Number.isFinite(startParsed.getTime())) {
            throw new CustomError('StartDate tidak valid', 400);
        }
        if (endParsed && !Number.isFinite(endParsed.getTime())) {
            throw new CustomError('EndDate tidak valid', 400);
        }
        if (startParsed && endParsed && startParsed.getTime() > endParsed.getTime()) {
            throw new CustomError('StartDate tidak boleh lebih besar dari EndDate', 400);
        }

        const report = await ReportService.calculateBackorderPreorderReport(startRaw, endRaw);

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Migunani Admin';
        workbook.created = new Date();

        const periodStart = report.period.start.toISOString().slice(0, 10);
        const periodEnd = report.period.end.toISOString().slice(0, 10);
        const exportTime = new Date().toISOString().replace('T', ' ').slice(0, 19);

        const details = Array.isArray((report as any)?.details) ? ((report as any).details as any[]) : [];

        if (extractMode === 'po') {
            const sheet = workbook.addWorksheet('PO_Extract');

            sheet.getCell('A1').value = 'Ekstrak PO (Backorder / Preorder)';
            sheet.getCell('A2').value = `Waktu Export: ${exportTime}`;
            sheet.getCell('A3').value = `Periode: ${periodStart} s/d ${periodEnd}`;
            sheet.getCell('A4').value = `Total Item: ${Number(report.summary?.total_items || 0)}`;

            const aggregated = new Map<string, { sku: string; product_name: string; qty: number }>();
            details.forEach((row: any) => {
                const sku = String(row?.sku || '').trim();
                if (!sku || sku === '-') return;
                const productName = String(row?.product_name || '').trim() || '-';
                const qty = Number(row?.qty || 0);
                if (qty <= 0) return;
                const prev = aggregated.get(sku);
                if (prev) {
                    prev.qty += qty;
                    if (!prev.product_name || prev.product_name === '-' || prev.product_name === 'Unknown Product') {
                        prev.product_name = productName;
                    }
                } else {
                    aggregated.set(sku, { sku, product_name: productName, qty });
                }
            });

            const rows = Array.from(aggregated.values())
                .sort((a, b) => (b.qty - a.qty) || a.sku.localeCompare(b.sku));

            sheet.getCell('A5').value = `Total SKU: ${rows.length}`;

            const headerRowIndex = 7;
            sheet.getRow(headerRowIndex).values = ['No', 'SKU', 'Produk', 'Qty'];
            sheet.getRow(headerRowIndex).font = { bold: true };

            rows.forEach((row, idx) => {
                sheet.getRow(headerRowIndex + 1 + idx).values = [
                    idx + 1,
                    row.sku,
                    row.product_name,
                    Number(row.qty || 0),
                ];
            });

            sheet.columns = [
                { key: 'no', width: 6 },
                { key: 'sku', width: 18 },
                { key: 'product', width: 44 },
                { key: 'qty', width: 12 },
            ];
        } else {
            const sheet = workbook.addWorksheet('Backorder_Preorder');

            sheet.getCell('A1').value = 'Laporan Backorder / Preorder';
            sheet.getCell('A2').value = `Waktu Export: ${exportTime}`;
            sheet.getCell('A3').value = `Periode: ${periodStart} s/d ${periodEnd}`;
            sheet.getCell('A4').value = `Total Item: ${Number(report.summary?.total_items || 0)}`;
            sheet.getCell('A5').value = `Estimasi Nilai: ${Number(report.summary?.total_value || 0)}`;
            sheet.getCell('A6').value = `Backorder Count: ${Number(report.summary?.backorder_count || 0)}`;
            sheet.getCell('A7').value = `Preorder Count: ${Number(report.summary?.preorder_count || 0)}`;

            const headerRowIndex = 9;
            const headers = ['Tanggal', 'Order ID', 'Customer', 'SKU', 'Produk', 'Tipe', 'Qty', 'Harga', 'Total'];
            sheet.getRow(headerRowIndex).values = headers;
            sheet.getRow(headerRowIndex).font = { bold: true };

            details.forEach((row: any, idx: number) => {
                const excelRowIndex = headerRowIndex + 1 + idx;
                const date = row?.date ? new Date(row.date) : null;
                const dateStr = date && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '-';

                sheet.getRow(excelRowIndex).values = [
                    dateStr,
                    row?.order_id ? String(row.order_id) : '-',
                    row?.customer_name || '-',
                    row?.sku || '-',
                    row?.product_name || '-',
                    row?.type || '-',
                    Number(row?.qty || 0),
                    Number(row?.price || 0),
                    Number(row?.total_value || 0),
                ];
            });

            sheet.columns = [
                { key: 'date', width: 14 },
                { key: 'order_id', width: 18 },
                { key: 'customer', width: 26 },
                { key: 'sku', width: 18 },
                { key: 'product', width: 36 },
                { key: 'type', width: 12 },
                { key: 'qty', width: 10 },
                { key: 'price', width: 14 },
                { key: 'total', width: 16 },
            ];
        }

        const timestamp = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const fileSuffix = `${timestamp.getFullYear()}${pad(timestamp.getMonth() + 1)}${pad(timestamp.getDate())}-${pad(timestamp.getHours())}${pad(timestamp.getMinutes())}`;
        const fileName = extractMode === 'po'
            ? `ekstrak-po-backorder-preorder-${fileSuffix}.xlsx`
            : `laporan-backorder-preorder-${fileSuffix}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error exporting Backorder report', 500);
    }
});

export const printBackorderPreorderReportThermalPdf = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { startDate, endDate } = req.query;
        const startRaw = typeof startDate === 'string' && startDate.trim() ? startDate.trim() : undefined;
        const endRaw = typeof endDate === 'string' && endDate.trim() ? endDate.trim() : undefined;

        const startParsed = startRaw ? new Date(startRaw) : null;
        const endParsed = endRaw ? new Date(endRaw) : null;
        if (startParsed && !Number.isFinite(startParsed.getTime())) {
            throw new CustomError('StartDate tidak valid', 400);
        }
        if (endParsed && !Number.isFinite(endParsed.getTime())) {
            throw new CustomError('EndDate tidak valid', 400);
        }
        if (startParsed && endParsed && startParsed.getTime() > endParsed.getTime()) {
            throw new CustomError('StartDate tidak boleh lebih besar dari EndDate', 400);
        }

        const report = await ReportService.calculateBackorderPreorderReport(startRaw, endRaw);
        const details = Array.isArray((report as any)?.details) ? ((report as any).details as any[]) : [];

        type ThermalRow = {
            sku: string;
            name: string;
            qty_total: number;
            qty_backorder: number;
            qty_preorder: number;
        };

        const grouped = new Map<string, ThermalRow>();
        for (const row of details) {
            const sku = String(row?.sku || '').trim();
            if (!sku || sku === '-') continue;
            const productName = String(row?.product_name || '').trim() || '-';
            const qty = Number(row?.qty || 0);
            const type = String(row?.type || '').trim();

            const existing = grouped.get(sku) || {
                sku,
                name: productName,
                qty_total: 0,
                qty_backorder: 0,
                qty_preorder: 0,
            };
            existing.qty_total += qty;
            if (type === 'preorder') existing.qty_preorder += qty;
            else existing.qty_backorder += qty;
            if (!existing.name || existing.name === '-' || existing.name === 'Unknown Product') existing.name = productName;
            grouped.set(sku, existing);
        }

        const rows = Array.from(grouped.values())
            .sort((a, b) => (b.qty_total - a.qty_total) || a.sku.localeCompare(b.sku))
            .filter((r) => r.qty_total > 0);

        const totalQty = rows.reduce((sum, r) => sum + r.qty_total, 0);
        const totalBo = rows.reduce((sum, r) => sum + r.qty_backorder, 0);
        const totalPo = rows.reduce((sum, r) => sum + r.qty_preorder, 0);

        const periodStart = formatLocalYmd(report.period.start);
        const periodEnd = formatLocalYmd(report.period.end);
        const printedAt = formatLocalYmdHm(new Date());

        const paperWidthPt = 226.77; // 80mm thermal (approx)
        const marginPt = 10;
        const lineHeightPt = 12;
        const headerLines = 9;
        const footerLines = 2;
        const perRowLines = 4;
        const estHeight = (marginPt * 2) + (lineHeightPt * (headerLines + footerLines + (rows.length * perRowLines)));
        const pageHeightPt = Math.max(240, Math.min(14400, Math.ceil(estHeight)));

        const timestamp = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const fileSuffix = `${timestamp.getFullYear()}${pad(timestamp.getMonth() + 1)}${pad(timestamp.getDate())}-${pad(timestamp.getHours())}${pad(timestamp.getMinutes())}`;
        const fileName = `print-backorder-thermal-${fileSuffix}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);

        const doc = new PDFDocument({
            size: [paperWidthPt, pageHeightPt],
            margin: marginPt,
        });
        doc.pipe(res);

        const truncate = (s: string, maxLen: number) => {
            const str = String(s || '').replace(/\s+/g, ' ').trim();
            if (str.length <= maxLen) return str;
            return `${str.slice(0, Math.max(0, maxLen - 1))}…`;
        };

        const rule = () => doc.text('-'.repeat(32));

        const ensureSpace = (linesNeeded: number) => {
            const bottomY = doc.page.height - doc.page.margins.bottom;
            const needed = linesNeeded * lineHeightPt;
            if (doc.y + needed > bottomY) {
                doc.addPage({ size: [paperWidthPt, pageHeightPt], margin: marginPt });
            }
        };

        doc.font('Courier').fontSize(10).text('LAPORAN BACKORDER', { align: 'center' });
        doc.moveDown(0.2);
        doc.fontSize(8);
        doc.text(`Periode: ${periodStart} s/d ${periodEnd}`);
        doc.text(`Printed: ${printedAt}`);
        doc.text(`Total SKU: ${rows.length}`);
        doc.text(`Total Qty: ${totalQty} (BO:${totalBo} PO:${totalPo})`);
        rule();
        doc.fontSize(9);

        for (const r of rows) {
            ensureSpace(perRowLines + 1);
            doc.text(`${truncate(r.sku, 16)}  QTY:${r.qty_total}`);
            doc.text(`BO:${r.qty_backorder}  PO:${r.qty_preorder}`);
            doc.text(truncate(r.name, 32));
            rule();
        }

        doc.end();
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error printing Backorder report', 500);
    }
});

export const getStockReductionReport = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { startDate, endDate, eventType, search } = req.query;
        const result = await ReportService.calculateStockReductionReport({
            startDate: startDate as string | undefined,
            endDate: endDate as string | undefined,
            eventType: eventType as string | undefined,
            search: search as string | undefined
        });
        res.json(result);
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error calculating stock reduction report', 500);
    }
});

export const exportStockReductionReportExcel = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { startDate, endDate, eventType, search } = req.query;
        const report = await ReportService.calculateStockReductionReport({
            startDate: startDate as string | undefined,
            endDate: endDate as string | undefined,
            eventType: eventType as string | undefined,
            search: search as string | undefined
        });

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Migunani Admin';
        workbook.created = new Date();
        const sheet = workbook.addWorksheet('IPO_Usulan');

        const periodStart = report.period.start.toISOString().slice(0, 10);
        const periodEnd = report.period.end.toISOString().slice(0, 10);
        const exportTime = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const activeEventType = String(report.event_type || 'all');

        sheet.getCell('A1').value = 'Template IPO Usulan Pengurangan Stok';
        sheet.getCell('A2').value = `Waktu Export: ${exportTime}`;
        sheet.getCell('A3').value = `Periode: ${periodStart} s/d ${periodEnd}`;
        sheet.getCell('A4').value = `Filter Event: ${activeEventType}`;
        sheet.getCell('A5').value = `Filter Search: ${report.search || '-'}`;

        const headerRowIndex = 7;
        const headers = ['SKU', 'Nama Produk', 'Qty Usulan IPO', 'Satuan', 'Referensi Order (sample)', 'Total Order Terkait', 'Periode', 'Catatan'];
        sheet.getRow(headerRowIndex).values = headers;
        sheet.getRow(headerRowIndex).font = { bold: true };

        report.rows.forEach((row, idx) => {
            const excelRowIndex = headerRowIndex + 1 + idx;
            sheet.getRow(excelRowIndex).values = [
                row.sku || '-',
                row.product_name || '-',
                Number(row.qty_reduced || 0),
                row.unit || '-',
                (Array.isArray(row.related_order_ids) ? row.related_order_ids : []).map((id) => `#${String(id).slice(-8).toUpperCase()}`).join(', '),
                Number(row.order_count || 0),
                `${periodStart} s/d ${periodEnd}`,
                ''
            ];
        });

        sheet.columns = [
            { key: 'sku', width: 18 },
            { key: 'name', width: 36 },
            { key: 'qty', width: 16 },
            { key: 'unit', width: 14 },
            { key: 'refs', width: 40 },
            { key: 'orderCount', width: 20 },
            { key: 'period', width: 24 },
            { key: 'note', width: 30 }
        ];

        const timestamp = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const fileSuffix = `${timestamp.getFullYear()}${pad(timestamp.getMonth() + 1)}${pad(timestamp.getDate())}-${pad(timestamp.getHours())}${pad(timestamp.getMinutes())}`;
        const fileName = `ipo-usulan-stock-reduction-${fileSuffix}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error exporting stock reduction report', 500);
    }
});

type ProductsSoldMergedRow = {
    product_id: string;
    sku: string | null;
    product_name: string | null;
    unit: string | null;
    qty_sold: number;
    revenue: number;
    cogs: number;
    qty_invoice: number;
    qty_pos: number;
    revenue_invoice: number;
    revenue_pos: number;
    cogs_invoice: number;
    cogs_pos: number;
    tx_invoice: number;
    tx_pos: number;
    order_count: number;
};

const computeProductsSoldMergedRows = async (params: { start: Date; end: Date; limitNum: number }): Promise<ProductsSoldMergedRow[]> => {
    const { start, end, limitNum } = params;

    const sourceLimit = Math.min(2000, Math.max(limitNum * 5, limitNum));
    const toNumberSafe = (value: unknown) => {
        const parsed = Number(value || 0);
        return Number.isFinite(parsed) ? parsed : 0;
    };

    type SourceRow = {
        product_id?: string;
        sku?: string | null;
        product_name?: string | null;
        unit?: string | null;
        qty_sold?: unknown;
        revenue?: unknown;
        cogs?: unknown;
        tx_count?: unknown;
    };

    const [invoiceRows, posRows] = await Promise.all([
        InvoiceItem.findAll({
            attributes: [
                [sequelize.col('OrderItem.product_id'), 'product_id'],
                [sequelize.col('OrderItem.Product.sku'), 'sku'],
                [sequelize.col('OrderItem.Product.name'), 'product_name'],
                [sequelize.col('OrderItem.Product.unit'), 'unit'],
                [sequelize.fn('SUM', sequelize.col('InvoiceItem.qty')), 'qty_sold'],
                [sequelize.fn('SUM', sequelize.col('InvoiceItem.line_total')), 'revenue'],
                [sequelize.fn('SUM', sequelize.literal(`InvoiceItem.qty * COALESCE((
                    SELECT ico.unit_cost_override
                    FROM invoice_cost_overrides ico
                    WHERE ico.invoice_id = InvoiceItem.invoice_id
                      AND ico.product_id = OrderItem.product_id
                    LIMIT 1
                ), InvoiceItem.unit_cost)`)), 'cogs'],
                [sequelize.fn('COUNT', sequelize.fn('DISTINCT', sequelize.col('InvoiceItem.invoice_id'))), 'tx_count'],
            ],
            include: [
                {
                    model: Invoice,
                    attributes: [],
                    where: {
                        payment_status: 'paid',
                        verified_at: { [Op.between]: [start, end] }
                    }
                },
                {
                    model: OrderItem,
                    attributes: [],
                    include: [
                        { model: Product, attributes: [] }
                    ]
                }
            ],
            group: [
                sequelize.col('OrderItem.product_id'),
                sequelize.col('OrderItem.Product.id'),
                sequelize.col('OrderItem.Product.sku'),
                sequelize.col('OrderItem.Product.name'),
                sequelize.col('OrderItem.Product.unit'),
            ],
            order: [[sequelize.literal('qty_sold'), 'DESC']],
            limit: sourceLimit,
            raw: true,
        }) as unknown as SourceRow[],
        PosSaleItem.findAll({
            attributes: [
                [sequelize.col('PosSaleItem.product_id'), 'product_id'],
                [sequelize.col('Product.sku'), 'sku'],
                [sequelize.col('Product.name'), 'product_name'],
                [sequelize.col('Product.unit'), 'unit'],
                [sequelize.fn('SUM', sequelize.col('PosSaleItem.qty')), 'qty_sold'],
                [sequelize.fn('SUM', sequelize.col('PosSaleItem.line_total')), 'revenue'],
                [sequelize.fn('SUM', sequelize.col('PosSaleItem.cogs_total')), 'cogs'],
                [sequelize.fn('COUNT', sequelize.fn('DISTINCT', sequelize.col('PosSaleItem.pos_sale_id'))), 'tx_count'],
            ],
            include: [
                {
                    model: PosSale,
                    as: 'Sale',
                    attributes: [],
                    where: {
                        status: 'paid',
                        paid_at: { [Op.between]: [start, end] }
                    }
                },
                {
                    model: Product,
                    as: 'Product',
                    attributes: [],
                }
            ],
            group: [
                sequelize.col('PosSaleItem.product_id'),
                sequelize.col('Product.id'),
                sequelize.col('Product.sku'),
                sequelize.col('Product.name'),
                sequelize.col('Product.unit'),
            ],
            order: [[sequelize.literal('qty_sold'), 'DESC']],
            limit: sourceLimit,
            raw: true,
        }) as unknown as SourceRow[],
    ]);

    type Bucket = {
        product_id: string;
        sku: string | null;
        product_name: string | null;
        unit: string | null;
        qty_invoice: number;
        qty_pos: number;
        revenue_invoice: number;
        revenue_pos: number;
        cogs_invoice: number;
        cogs_pos: number;
        tx_invoice: number;
        tx_pos: number;
    };

    const byProduct = new Map<string, Bucket>();
    const ensureBucket = (row: SourceRow) => {
        const productId = String(row.product_id || '').trim();
        if (!productId) return null;
        const existing = byProduct.get(productId);
        if (existing) return existing;
        const next: Bucket = {
            product_id: productId,
            sku: row.sku ?? null,
            product_name: row.product_name ?? null,
            unit: row.unit ?? null,
            qty_invoice: 0,
            qty_pos: 0,
            revenue_invoice: 0,
            revenue_pos: 0,
            cogs_invoice: 0,
            cogs_pos: 0,
            tx_invoice: 0,
            tx_pos: 0,
        };
        byProduct.set(productId, next);
        return next;
    };

    for (const row of invoiceRows) {
        const bucket = ensureBucket(row);
        if (!bucket) continue;
        bucket.sku = bucket.sku ?? row.sku ?? null;
        bucket.product_name = bucket.product_name ?? row.product_name ?? null;
        bucket.unit = bucket.unit ?? row.unit ?? null;
        bucket.qty_invoice += Math.max(0, toNumberSafe(row.qty_sold));
        bucket.revenue_invoice += Math.max(0, toNumberSafe(row.revenue));
        bucket.cogs_invoice += Math.max(0, toNumberSafe(row.cogs));
        bucket.tx_invoice += Math.max(0, Math.trunc(toNumberSafe(row.tx_count)));
    }

    for (const row of posRows) {
        const bucket = ensureBucket(row);
        if (!bucket) continue;
        bucket.sku = bucket.sku ?? row.sku ?? null;
        bucket.product_name = bucket.product_name ?? row.product_name ?? null;
        bucket.unit = bucket.unit ?? row.unit ?? null;
        bucket.qty_pos += Math.max(0, toNumberSafe(row.qty_sold));
        bucket.revenue_pos += Math.max(0, toNumberSafe(row.revenue));
        bucket.cogs_pos += Math.max(0, toNumberSafe(row.cogs));
        bucket.tx_pos += Math.max(0, Math.trunc(toNumberSafe(row.tx_count)));
    }

    return Array.from(byProduct.values())
        .map((bucket): ProductsSoldMergedRow => ({
            product_id: bucket.product_id,
            sku: bucket.sku,
            product_name: bucket.product_name,
            unit: bucket.unit,
            qty_sold: bucket.qty_invoice + bucket.qty_pos,
            revenue: bucket.revenue_invoice + bucket.revenue_pos,
            cogs: bucket.cogs_invoice + bucket.cogs_pos,
            qty_invoice: bucket.qty_invoice,
            qty_pos: bucket.qty_pos,
            revenue_invoice: bucket.revenue_invoice,
            revenue_pos: bucket.revenue_pos,
            cogs_invoice: bucket.cogs_invoice,
            cogs_pos: bucket.cogs_pos,
            tx_invoice: bucket.tx_invoice,
            tx_pos: bucket.tx_pos,
            order_count: bucket.tx_invoice + bucket.tx_pos,
        }))
        .sort((a, b) => toNumberSafe(b.qty_sold) - toNumberSafe(a.qty_sold))
        .slice(0, limitNum);
};

export const getProductsSoldReport = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { startDate, endDate, limit } = req.query;
        if (!startDate || !endDate) {
            throw new CustomError('StartDate dan EndDate wajib diisi', 400);
        }

        const start = new Date(String(startDate));
        const end = new Date(String(endDate));
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
            throw new CustomError('StartDate/EndDate tidak valid', 400);
        }

        const limitNum = Math.min(200, Math.max(1, Number(limit) || 50));
        const rows = await computeProductsSoldMergedRows({ start, end, limitNum });

        res.json({
            period: { startDate: String(startDate), endDate: String(endDate) },
            rows,
        });
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error generating products sold report', 500);
    }
});

export const exportProductsSoldReportExcel = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { startDate, endDate, limit } = req.query;
        if (!startDate || !endDate) {
            throw new CustomError('StartDate dan EndDate wajib diisi', 400);
        }

        const start = new Date(String(startDate));
        const end = new Date(String(endDate));
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
            throw new CustomError('StartDate/EndDate tidak valid', 400);
        }

        const limitNum = Math.min(500, Math.max(1, Number(limit) || 50));
        const rows = await computeProductsSoldMergedRows({ start, end, limitNum });

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Migunani Admin';
        workbook.created = new Date();
        const sheet = workbook.addWorksheet('Produk_Terjual');

        const periodStart = String(startDate);
        const periodEnd = String(endDate);
        const exportTime = new Date().toISOString().replace('T', ' ').slice(0, 19);

        sheet.getCell('A1').value = 'Laporan Produk Terjual (Invoice paid + POS paid)';
        sheet.getCell('A2').value = `Waktu Export: ${exportTime}`;
        sheet.getCell('A3').value = `Periode: ${periodStart} s/d ${periodEnd}`;
        sheet.getCell('A4').value = `Limit: ${limitNum}`;

        const headerRowIndex = 6;
        const headers = [
            'SKU',
            'Nama Produk',
            'Qty Terjual',
            'Satuan',
            'Revenue',
            'COGS',
            'Gross Profit',
            'Transaksi',
            'Qty Invoice',
            'Qty POS',
        ];
        sheet.getRow(headerRowIndex).values = headers;
        sheet.getRow(headerRowIndex).font = { bold: true };

        rows.forEach((row, idx) => {
            const excelRowIndex = headerRowIndex + 1 + idx;
            const revenue = Number(row.revenue || 0);
            const cogs = Number(row.cogs || 0);
            sheet.getRow(excelRowIndex).values = [
                row.sku || '-',
                row.product_name || '-',
                Number(row.qty_sold || 0),
                row.unit || '-',
                revenue,
                cogs,
                revenue - cogs,
                Number(row.order_count || 0),
                Number(row.qty_invoice || 0),
                Number(row.qty_pos || 0),
            ];
        });

        sheet.columns = [
            { key: 'sku', width: 18 },
            { key: 'name', width: 38 },
            { key: 'qty', width: 14 },
            { key: 'unit', width: 12 },
            { key: 'revenue', width: 16 },
            { key: 'cogs', width: 16 },
            { key: 'gp', width: 16 },
            { key: 'tx', width: 12 },
            { key: 'qtyInvoice', width: 14 },
            { key: 'qtyPos', width: 14 },
        ];

        const timestamp = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const fileSuffix = `${timestamp.getFullYear()}${pad(timestamp.getMonth() + 1)}${pad(timestamp.getDate())}-${pad(timestamp.getHours())}${pad(timestamp.getMinutes())}`;
        const fileName = `laporan-produk-terjual-${fileSuffix}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error exporting products sold report', 500);
    }
});

type TopCustomersMergedRow = {
    customer_id: string;
    customer_name: string | null;
    whatsapp_number: string | null;
    revenue: number;
    revenue_invoice: number;
    revenue_pos: number;
    qty_total: number;
    qty_invoice: number;
    qty_pos: number;
    tx_invoice: number;
    tx_pos: number;
    order_count: number;
    first_bought_at: Date | null;
    last_bought_at: Date | null;
};

const computeTopCustomersMergedRows = async (params: { start: Date; end: Date; limitNum: number }): Promise<TopCustomersMergedRow[]> => {
    const { start, end, limitNum } = params;

    const sourceLimit = Math.min(5000, Math.max(limitNum * 10, limitNum));
    const toNumberSafe = (value: unknown) => {
        const parsed = Number(value || 0);
        return Number.isFinite(parsed) ? parsed : 0;
    };

    const toDateSafe = (value: unknown): Date | null => {
        if (!value) return null;
        const d = value instanceof Date ? value : new Date(String(value));
        return Number.isFinite(d.getTime()) ? d : null;
    };

    type AggRow = {
        customer_id?: string | null;
        revenue?: unknown;
        tx_count?: unknown;
        first_at?: unknown;
        last_at?: unknown;
    };

    type QtyRow = {
        customer_id?: string | null;
        qty_total?: unknown;
    };

    const [invoiceAgg, invoiceQty, posAgg, posQty] = await Promise.all([
        Invoice.findAll({
            attributes: [
                'customer_id',
                [sequelize.fn('SUM', sequelize.col('Invoice.total')), 'revenue'],
                [sequelize.fn('COUNT', sequelize.fn('DISTINCT', sequelize.col('Invoice.id'))), 'tx_count'],
                [sequelize.fn('MIN', sequelize.col('Invoice.verified_at')), 'first_at'],
                [sequelize.fn('MAX', sequelize.col('Invoice.verified_at')), 'last_at'],
            ],
            where: {
                payment_status: 'paid',
                verified_at: { [Op.between]: [start, end] },
                customer_id: { [Op.ne]: null },
                sales_channel: 'app',
            },
            group: [sequelize.col('Invoice.customer_id')],
            order: [[sequelize.literal('tx_count'), 'DESC']],
            limit: sourceLimit,
            raw: true,
        }) as unknown as AggRow[],
        InvoiceItem.findAll({
            attributes: [
                [sequelize.col('Invoice.customer_id'), 'customer_id'],
                [sequelize.fn('SUM', sequelize.col('InvoiceItem.qty')), 'qty_total'],
            ],
            include: [
                {
                    model: Invoice,
                    attributes: [],
                    where: {
                        payment_status: 'paid',
                        verified_at: { [Op.between]: [start, end] },
                        customer_id: { [Op.ne]: null },
                        sales_channel: 'app',
                    }
                }
            ],
            group: [sequelize.col('Invoice.customer_id')],
            limit: sourceLimit,
            raw: true,
        }) as unknown as QtyRow[],
        PosSale.findAll({
            attributes: [
                'customer_id',
                [sequelize.fn('SUM', sequelize.col('PosSale.total')), 'revenue'],
                [sequelize.fn('COUNT', sequelize.fn('DISTINCT', sequelize.col('PosSale.id'))), 'tx_count'],
                [sequelize.fn('MIN', sequelize.col('PosSale.paid_at')), 'first_at'],
                [sequelize.fn('MAX', sequelize.col('PosSale.paid_at')), 'last_at'],
            ],
            where: {
                status: 'paid',
                paid_at: { [Op.between]: [start, end] },
                customer_id: { [Op.ne]: null },
            },
            group: [sequelize.col('PosSale.customer_id')],
            order: [[sequelize.literal('tx_count'), 'DESC']],
            limit: sourceLimit,
            raw: true,
        }) as unknown as AggRow[],
        PosSaleItem.findAll({
            attributes: [
                [sequelize.col('Sale.customer_id'), 'customer_id'],
                [sequelize.fn('SUM', sequelize.col('PosSaleItem.qty')), 'qty_total'],
            ],
            include: [
                {
                    model: PosSale,
                    as: 'Sale',
                    attributes: [],
                    where: {
                        status: 'paid',
                        paid_at: { [Op.between]: [start, end] },
                        customer_id: { [Op.ne]: null },
                    }
                }
            ],
            group: [sequelize.col('Sale.customer_id')],
            limit: sourceLimit,
            raw: true,
        }) as unknown as QtyRow[],
    ]);

    type Bucket = {
        customer_id: string;
        revenue_invoice: number;
        revenue_pos: number;
        qty_invoice: number;
        qty_pos: number;
        tx_invoice: number;
        tx_pos: number;
        first_invoice_at: Date | null;
        last_invoice_at: Date | null;
        first_pos_at: Date | null;
        last_pos_at: Date | null;
    };

    const byCustomer = new Map<string, Bucket>();
    const ensureBucket = (customerId: string) => {
        const id = String(customerId || '').trim();
        if (!id) return null;
        const existing = byCustomer.get(id);
        if (existing) return existing;
        const next: Bucket = {
            customer_id: id,
            revenue_invoice: 0,
            revenue_pos: 0,
            qty_invoice: 0,
            qty_pos: 0,
            tx_invoice: 0,
            tx_pos: 0,
            first_invoice_at: null,
            last_invoice_at: null,
            first_pos_at: null,
            last_pos_at: null,
        };
        byCustomer.set(id, next);
        return next;
    };

    const minDate = (a: Date | null, b: Date | null) => {
        if (!a) return b;
        if (!b) return a;
        return a.getTime() <= b.getTime() ? a : b;
    };
    const maxDate = (a: Date | null, b: Date | null) => {
        if (!a) return b;
        if (!b) return a;
        return a.getTime() >= b.getTime() ? a : b;
    };

    for (const row of invoiceAgg) {
        const customerId = String(row.customer_id || '').trim();
        if (!customerId) continue;
        const bucket = ensureBucket(customerId);
        if (!bucket) continue;
        bucket.revenue_invoice += Math.max(0, toNumberSafe(row.revenue));
        bucket.tx_invoice += Math.max(0, Math.trunc(toNumberSafe(row.tx_count)));
        bucket.first_invoice_at = minDate(bucket.first_invoice_at, toDateSafe(row.first_at));
        bucket.last_invoice_at = maxDate(bucket.last_invoice_at, toDateSafe(row.last_at));
    }

    for (const row of invoiceQty) {
        const customerId = String(row.customer_id || '').trim();
        if (!customerId) continue;
        const bucket = ensureBucket(customerId);
        if (!bucket) continue;
        bucket.qty_invoice += Math.max(0, toNumberSafe(row.qty_total));
    }

    for (const row of posAgg) {
        const customerId = String(row.customer_id || '').trim();
        if (!customerId) continue;
        const bucket = ensureBucket(customerId);
        if (!bucket) continue;
        bucket.revenue_pos += Math.max(0, toNumberSafe(row.revenue));
        bucket.tx_pos += Math.max(0, Math.trunc(toNumberSafe(row.tx_count)));
        bucket.first_pos_at = minDate(bucket.first_pos_at, toDateSafe(row.first_at));
        bucket.last_pos_at = maxDate(bucket.last_pos_at, toDateSafe(row.last_at));
    }

    for (const row of posQty) {
        const customerId = String(row.customer_id || '').trim();
        if (!customerId) continue;
        const bucket = ensureBucket(customerId);
        if (!bucket) continue;
        bucket.qty_pos += Math.max(0, toNumberSafe(row.qty_total));
    }

    const merged = Array.from(byCustomer.values()).map((bucket) => {
        const first_bought_at = minDate(bucket.first_invoice_at, bucket.first_pos_at);
        const last_bought_at = maxDate(bucket.last_invoice_at, bucket.last_pos_at);
        const revenue = bucket.revenue_invoice + bucket.revenue_pos;
        const qty_total = bucket.qty_invoice + bucket.qty_pos;
        const order_count = bucket.tx_invoice + bucket.tx_pos;
        return {
            customer_id: bucket.customer_id,
            revenue,
            revenue_invoice: bucket.revenue_invoice,
            revenue_pos: bucket.revenue_pos,
            qty_total,
            qty_invoice: bucket.qty_invoice,
            qty_pos: bucket.qty_pos,
            tx_invoice: bucket.tx_invoice,
            tx_pos: bucket.tx_pos,
            order_count,
            first_bought_at,
            last_bought_at,
        };
    });

    merged.sort((a, b) => {
        if (b.order_count !== a.order_count) return b.order_count - a.order_count;
        if (b.revenue !== a.revenue) return b.revenue - a.revenue;
        const aLast = a.last_bought_at ? a.last_bought_at.getTime() : 0;
        const bLast = b.last_bought_at ? b.last_bought_at.getTime() : 0;
        return bLast - aLast;
    });

    const top = merged.slice(0, limitNum);
    const topIds = top.map((r) => r.customer_id);

    const users = await User.findAll({
        where: { id: { [Op.in]: topIds } },
        attributes: ['id', 'name', 'whatsapp_number'],
        raw: true,
    }) as unknown as Array<{ id: string; name: string; whatsapp_number: string | null }>;

    const byUserId = new Map(users.map((u) => [String(u.id), u]));

    return top.map((r) => {
        const u = byUserId.get(r.customer_id);
        return {
            customer_id: r.customer_id,
            customer_name: u?.name ?? null,
            whatsapp_number: u?.whatsapp_number ?? null,
            revenue: r.revenue,
            revenue_invoice: r.revenue_invoice,
            revenue_pos: r.revenue_pos,
            qty_total: r.qty_total,
            qty_invoice: r.qty_invoice,
            qty_pos: r.qty_pos,
            tx_invoice: r.tx_invoice,
            tx_pos: r.tx_pos,
            order_count: r.order_count,
            first_bought_at: r.first_bought_at,
            last_bought_at: r.last_bought_at,
        };
    });
};

export const getTopCustomersReport = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { startDate, endDate, limit } = req.query;
        if (!startDate || !endDate) {
            throw new CustomError('StartDate dan EndDate wajib diisi', 400);
        }

        const start = new Date(String(startDate));
        const end = new Date(String(endDate));
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
            throw new CustomError('StartDate/EndDate tidak valid', 400);
        }

        const limitNum = Math.min(200, Math.max(1, Number(limit) || 50));
        const rows = await computeTopCustomersMergedRows({ start, end, limitNum });

        res.json({
            period: { startDate: String(startDate), endDate: String(endDate) },
            rows,
        });
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error generating top customers report', 500);
    }
});

export const exportTopCustomersReportExcel = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { startDate, endDate, limit } = req.query;
        if (!startDate || !endDate) {
            throw new CustomError('StartDate dan EndDate wajib diisi', 400);
        }

        const start = new Date(String(startDate));
        const end = new Date(String(endDate));
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
            throw new CustomError('StartDate/EndDate tidak valid', 400);
        }

        const limitNum = Math.min(500, Math.max(1, Number(limit) || 50));
        const rows = await computeTopCustomersMergedRows({ start, end, limitNum });

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Migunani Admin';
        workbook.created = new Date();
        const sheet = workbook.addWorksheet('Customer_Loyal');

        const periodStart = String(startDate);
        const periodEnd = String(endDate);
        const exportTime = new Date().toISOString().replace('T', ' ').slice(0, 19);

        sheet.getCell('A1').value = 'Laporan Customer Loyal (Invoice paid + POS paid)';
        sheet.getCell('A2').value = `Waktu Export: ${exportTime}`;
        sheet.getCell('A3').value = `Periode: ${periodStart} s/d ${periodEnd}`;
        sheet.getCell('A4').value = `Limit: ${limitNum}`;

        const headerRowIndex = 6;
        const headers = [
            'Customer',
            'WhatsApp',
            'Transaksi',
            'Qty Total',
            'Omzet',
            'Last Beli',
            'First Beli',
            'Tx Invoice',
            'Tx POS',
            'Omzet Invoice',
            'Omzet POS',
            'Qty Invoice',
            'Qty POS',
        ];
        sheet.getRow(headerRowIndex).values = headers;
        sheet.getRow(headerRowIndex).font = { bold: true };

        rows.forEach((row, idx) => {
            const excelRowIndex = headerRowIndex + 1 + idx;
            sheet.getRow(excelRowIndex).values = [
                row.customer_name || row.customer_id,
                row.whatsapp_number || '-',
                Number(row.order_count || 0),
                Number(row.qty_total || 0),
                Number(row.revenue || 0),
                row.last_bought_at ? formatLocalYmdHm(new Date(row.last_bought_at)) : '-',
                row.first_bought_at ? formatLocalYmdHm(new Date(row.first_bought_at)) : '-',
                Number(row.tx_invoice || 0),
                Number(row.tx_pos || 0),
                Number(row.revenue_invoice || 0),
                Number(row.revenue_pos || 0),
                Number(row.qty_invoice || 0),
                Number(row.qty_pos || 0),
            ];
        });

        sheet.columns = [
            { key: 'customer', width: 28 },
            { key: 'wa', width: 18 },
            { key: 'tx', width: 12 },
            { key: 'qty', width: 12 },
            { key: 'omzet', width: 16 },
            { key: 'last', width: 18 },
            { key: 'first', width: 18 },
            { key: 'txInv', width: 12 },
            { key: 'txPos', width: 12 },
            { key: 'omzetInv', width: 16 },
            { key: 'omzetPos', width: 16 },
            { key: 'qtyInv', width: 12 },
            { key: 'qtyPos', width: 12 },
        ];

        const timestamp = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const fileSuffix = `${timestamp.getFullYear()}${pad(timestamp.getMonth() + 1)}${pad(timestamp.getDate())}-${pad(timestamp.getHours())}${pad(timestamp.getMinutes())}`;
        const fileName = `laporan-customer-loyal-${fileSuffix}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error exporting top customers report', 500);
    }
});
