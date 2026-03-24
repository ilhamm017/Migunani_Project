import { Router } from 'express';
import * as FinanceController from '../controllers/finance';
import * as ReportController from '../controllers/ReportController';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';
import { createAttachmentUpload, createSingleUploadMiddleware } from '../utils/uploadPolicy';

const router = Router();
const expenseUpload = createAttachmentUpload({
    folderName: 'expenses',
    prefix: 'exp',
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.pdf'],
    fallbackExtension: '.pdf',
    maxSizeBytes: 5 * 1024 * 1024,
    unsupportedTypeMessage: 'File attachment expense harus berupa JPG, PNG, WEBP, atau PDF'
});
const uploadExpenseAttachment = createSingleUploadMiddleware(expenseUpload, {
    fieldName: 'attachment',
    sizeExceededMessage: 'Ukuran attachment expense terlalu besar (maksimal 5MB).',
    fallbackMessage: 'Upload attachment expense gagal diproses.'
});

router.use(authenticateToken);

// Expenses (Admin Finance, Super Admin)
router.get('/expenses', authorizeRoles('super_admin', 'admin_finance'), FinanceController.getExpenses);
router.post('/expenses', authorizeRoles('super_admin', 'admin_finance'), uploadExpenseAttachment, FinanceController.createExpense);
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
router.get('/reports/backorders/export', authorizeRoles('super_admin', 'kasir'), ReportController.exportBackorderPreorderReportExcel);
router.get('/reports/stock-reduction', authorizeRoles('super_admin', 'kasir'), ReportController.getStockReductionReport);
router.get('/reports/stock-reduction/export', authorizeRoles('super_admin', 'kasir'), ReportController.exportStockReductionReportExcel);
router.get('/reports/tax-summary', authorizeRoles('super_admin', 'admin_finance'), ReportController.getTaxSummary);
router.get('/reports/vat-monthly', authorizeRoles('super_admin', 'admin_finance'), ReportController.getVatMonthlyReport);
router.get('/reports/products-sold', authorizeRoles('super_admin', 'admin_finance', 'kasir'), ReportController.getProductsSoldReport);

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
router.get('/audit-logs', authorizeRoles('super_admin', 'admin_finance'), FinanceController.getAuditLogs);
router.get('/audit-logs/:id', authorizeRoles('super_admin', 'admin_finance'), FinanceController.getAuditLogDetail);

// Accounting Periods & Adjustments
router.get('/periods', authorizeRoles('super_admin', 'admin_finance'), FinanceController.getAccountingPeriods);
router.post('/periods/close', authorizeRoles('super_admin'), FinanceController.closeAccountingPeriod);
router.post('/journals/adjustment', authorizeRoles('super_admin', 'admin_finance'), FinanceController.createAdjustmentJournal);

export default router;
