import { Router } from 'express';
import * as FinanceController from '../controllers/FinanceController';
import * as ReportController from '../controllers/ReportController';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';

import fs from 'fs';
import path from 'path';
import multer from 'multer';

const router = Router();
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const userId = req.user?.id || 'anonymous';
            const dest = path.join('uploads', String(userId), 'expenses');
            if (!fs.existsSync(dest)) {
                fs.mkdirSync(dest, { recursive: true });
            }
            cb(null, dest);
        },
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, 'exp-' + uniqueSuffix + path.extname(file.originalname));
        }
    })
});

router.use(authenticateToken);

// Expenses (Admin Finance, Super Admin)
router.get('/expenses', authorizeRoles('super_admin', 'admin_finance'), FinanceController.getExpenses);
router.post('/expenses', authorizeRoles('super_admin', 'admin_finance'), upload.single('attachment'), FinanceController.createExpense);
router.post('/expenses/:id/approve', authorizeRoles('super_admin', 'admin_finance'), FinanceController.approveExpense);
router.post('/expenses/:id/pay', authorizeRoles('super_admin', 'admin_finance'), FinanceController.payExpense);
router.get('/expense-labels', authorizeRoles('super_admin', 'admin_finance'), FinanceController.getExpenseLabels);
router.post('/expense-labels', authorizeRoles('super_admin', 'admin_finance'), FinanceController.createExpenseLabel);
router.put('/expense-labels/:id', authorizeRoles('super_admin', 'admin_finance'), FinanceController.updateExpenseLabel);
router.delete('/expense-labels/:id', authorizeRoles('super_admin', 'admin_finance'), FinanceController.deleteExpenseLabel);

// Verification (Admin Finance)
router.post('/orders/:id/issue-invoice', authorizeRoles('super_admin', 'kasir'), FinanceController.issueInvoice);
router.post('/invoices/issue-batch', authorizeRoles('super_admin', 'kasir'), FinanceController.issueInvoiceBatch);
router.post('/invoices/issue-items', authorizeRoles('super_admin', 'kasir'), FinanceController.issueInvoiceByItems);
router.patch('/orders/:id/verify', authorizeRoles('super_admin', 'admin_finance'), FinanceController.verifyPayment);
router.post('/invoices/:id/void', authorizeRoles('super_admin', 'admin_finance'), FinanceController.voidPayment);
router.get('/settings/tax', authorizeRoles('super_admin', 'admin_finance'), FinanceController.getTaxSettings);
router.put('/settings/tax', authorizeRoles('super_admin', 'admin_finance'), FinanceController.updateTaxSettings);

// Reports (Super Admin, Owner - assuming Owner has super_admin/admin_finance role or separate)
// Reports
router.get('/reports/pnl', authorizeRoles('super_admin', 'admin_finance'), ReportController.getProfitAndLoss);
router.get('/reports/balance-sheet', authorizeRoles('super_admin', 'admin_finance'), ReportController.getBalanceSheet);
router.get('/reports/cash-flow', authorizeRoles('super_admin', 'admin_finance'), ReportController.getCashFlow);
router.get('/reports/inventory-value', authorizeRoles('super_admin', 'admin_finance'), ReportController.getInventoryValue);
router.get('/reports/aging-ap', authorizeRoles('super_admin', 'admin_finance'), ReportController.getAccountsPayableAging);
router.get('/reports/aging-ar', authorizeRoles('super_admin', 'admin_finance'), ReportController.getAccountsReceivableAging);
router.get('/reports/backorders', authorizeRoles('super_admin', 'kasir'), ReportController.getBackorderPreorderReport);
router.get('/reports/tax-summary', authorizeRoles('super_admin', 'admin_finance'), ReportController.getTaxSummary);
router.get('/reports/vat-monthly', authorizeRoles('super_admin', 'admin_finance'), ReportController.getVatMonthlyReport);

// Legacy/Operational AR
router.get('/ar', authorizeRoles('super_admin', 'admin_finance'), FinanceController.getAccountsReceivable);
router.get('/ar/:id', authorizeRoles('super_admin', 'admin_finance'), FinanceController.getAccountsReceivableDetail);
// router.get('/pnl', authorizeRoles('super_admin'), FinanceController.getProfitAndLoss); // Deprecated in favor of reports/pnl

// Driver COD Deposit
router.get('/driver-cod', authorizeRoles('super_admin', 'admin_finance'), FinanceController.getDriverCodList);
router.post('/driver-cod/verify', authorizeRoles('super_admin', 'admin_finance'), FinanceController.verifyDriverCod);

// Credit Notes
router.post('/credit-notes', authorizeRoles('super_admin', 'admin_finance'), FinanceController.createCreditNote);
router.post('/credit-notes/:id/post', authorizeRoles('super_admin', 'admin_finance'), FinanceController.postCreditNote);

// Journals
router.get('/journals', authorizeRoles('super_admin', 'admin_finance'), FinanceController.getJournals);

// Accounting Periods & Adjustments
router.get('/periods', authorizeRoles('super_admin', 'admin_finance'), FinanceController.getAccountingPeriods);
router.post('/periods/close', authorizeRoles('super_admin'), FinanceController.closeAccountingPeriod);
router.post('/journals/adjustment', authorizeRoles('super_admin', 'admin_finance'), FinanceController.createAdjustmentJournal);

export default router;
