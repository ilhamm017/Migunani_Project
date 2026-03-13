import { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { ReportService } from '../services/ReportService';
import { asyncWrapper } from '../utils/asyncWrapper';
import { CustomError } from '../utils/CustomError';

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
        const result = await ReportService.calculateBackorderPreorderReport(
            startDate as string | undefined,
            endDate as string | undefined
        );
        res.json(result);
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error calculating Backorder report', 500);
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
