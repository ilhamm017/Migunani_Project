import { Request, Response } from 'express';
import { ReportService } from '../services/ReportService';

export const getProfitAndLoss = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'StartDate dan EndDate wajib diisi' });
        }
        const result = await ReportService.calculateProfitAndLoss(String(startDate), String(endDate));
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: 'Error calculating P&L', error });
    }
};

export const getBalanceSheet = async (req: Request, res: Response) => {
    try {
        const { asOfDate } = req.query;
        const result = await ReportService.calculateBalanceSheet(asOfDate as string | undefined);
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: 'Error calculating Balance Sheet', error });
    }
};

export const getCashFlow = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'StartDate dan EndDate wajib diisi' });
        }
        const result = await ReportService.calculateCashFlow(String(startDate), String(endDate));
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: 'Error calculating Cash Flow', error });
    }
};

export const getInventoryValue = async (req: Request, res: Response) => {
    try {
        const result = await ReportService.calculateInventoryValue();
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: 'Error calculating Inventory Value', error });
    }
};

export const getAccountsPayableAging = async (req: Request, res: Response) => {
    try {
        const result = await ReportService.calculateAccountsPayableAging();
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: 'Error calculating AP Aging', error });
    }
};

export const getAccountsReceivableAging = async (req: Request, res: Response) => {
    try {
        const result = await ReportService.calculateAccountsReceivableAging();
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: 'Error calculating AR Aging', error });
    }
};

export const getTaxSummary = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'StartDate dan EndDate wajib diisi' });
        }
        const result = await ReportService.calculateTaxSummary(String(startDate), String(endDate));
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: 'Error calculating tax summary', error });
    }
};

export const getVatMonthlyReport = async (req: Request, res: Response) => {
    try {
        const { year } = req.query;
        const y = Number(year || new Date().getFullYear());
        if (!Number.isInteger(y) || y < 2000 || y > 3000) {
            return res.status(400).json({ message: 'Year tidak valid' });
        }
        const result = await ReportService.calculateVatMonthlyReport(y);
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: 'Error generating VAT monthly report', error });
    }
};

export const getBackorderPreorderReport = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate } = req.query;
        const result = await ReportService.calculateBackorderPreorderReport(
            startDate as string | undefined,
            endDate as string | undefined
        );
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: 'Error calculating Backorder report', error });
    }
};
