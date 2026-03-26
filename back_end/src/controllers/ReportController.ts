import { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { Op } from 'sequelize';
import { ReportService } from '../services/ReportService';
import { CustomerBalanceService } from '../services/CustomerBalanceService';
import { Invoice, InvoiceItem, OrderItem, Product, sequelize } from '../models';
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
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            throw new CustomError('StartDate dan EndDate wajib diisi', 400);
        }
        const result = await ReportService.calculateProfitAndLoss(String(startDate), String(endDate));
        res.json(result);
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

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Migunani Admin';
        workbook.created = new Date();
        const sheet = workbook.addWorksheet('Backorder_Preorder');

        const periodStart = report.period.start.toISOString().slice(0, 10);
        const periodEnd = report.period.end.toISOString().slice(0, 10);
        const exportTime = new Date().toISOString().replace('T', ' ').slice(0, 19);

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

        const details = Array.isArray((report as any)?.details) ? ((report as any).details as any[]) : [];
        details.forEach((row, idx) => {
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

        const timestamp = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const fileSuffix = `${timestamp.getFullYear()}${pad(timestamp.getMonth() + 1)}${pad(timestamp.getDate())}-${pad(timestamp.getHours())}${pad(timestamp.getMinutes())}`;
        const fileName = `laporan-backorder-preorder-${fileSuffix}.xlsx`;

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

        const rows = await InvoiceItem.findAll({
            attributes: [
                [sequelize.col('OrderItem.product_id'), 'product_id'],
                [sequelize.col('OrderItem.Product.sku'), 'sku'],
                [sequelize.col('OrderItem.Product.name'), 'product_name'],
                [sequelize.col('OrderItem.Product.unit'), 'unit'],
                [sequelize.fn('SUM', sequelize.col('InvoiceItem.qty')), 'qty_sold'],
                [sequelize.fn('SUM', sequelize.col('InvoiceItem.line_total')), 'revenue'],
                [sequelize.fn('SUM', sequelize.literal('InvoiceItem.qty * InvoiceItem.unit_cost')), 'cogs'],
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
            limit: limitNum,
            raw: true,
        });

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
