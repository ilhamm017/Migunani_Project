import { Router } from 'express';
import * as FinanceController from '../controllers/FinanceController';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';

const router = Router();

router.use(authenticateToken);

// Expenses (Admin Finance, Super Admin)
router.get('/expenses', authorizeRoles('super_admin', 'admin_finance'), FinanceController.getExpenses);
router.post('/expenses', authorizeRoles('super_admin', 'admin_finance'), FinanceController.createExpense);
router.get('/expense-labels', authorizeRoles('super_admin', 'admin_finance'), FinanceController.getExpenseLabels);
router.post('/expense-labels', authorizeRoles('super_admin', 'admin_finance'), FinanceController.createExpenseLabel);
router.put('/expense-labels/:id', authorizeRoles('super_admin', 'admin_finance'), FinanceController.updateExpenseLabel);
router.delete('/expense-labels/:id', authorizeRoles('super_admin', 'admin_finance'), FinanceController.deleteExpenseLabel);

// Verification (Admin Finance)
router.patch('/orders/:id/verify', authorizeRoles('super_admin', 'admin_finance'), FinanceController.verifyPayment);

// Reports (Super Admin, Owner - assuming Owner has super_admin/admin_finance role or separate)
router.get('/ar', authorizeRoles('super_admin', 'admin_finance'), FinanceController.getAccountsReceivable);
router.get('/ar/:id', authorizeRoles('super_admin', 'admin_finance'), FinanceController.getAccountsReceivableDetail);
router.get('/pnl', authorizeRoles('super_admin'), FinanceController.getProfitAndLoss);

export default router;
