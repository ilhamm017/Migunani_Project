import { Request, Response } from 'express';
import { Op, QueryTypes } from 'sequelize';
import { Account, Journal, JournalLine, Product, SupplierInvoice, Invoice, User, Order, sequelize } from '../models';

// --- Helper Functions ---
const getJournalBalance = async (
    accountType: string | string[],
    dateFilter: any,
    invert: boolean = false,
    specificCode?: string
) => {
    let typeCondition: any = Array.isArray(accountType) ? { [Op.in]: accountType } : accountType;
    if (specificCode) {
        typeCondition = undefined; // If specific code is provided, ignore type or combine
    }

    const whereAccount: any = {};
    if (typeCondition) whereAccount.type = typeCondition;
    if (specificCode) whereAccount.code = specificCode;

    const lines = await JournalLine.findAll({
        include: [
            {
                model: Account,
                where: whereAccount,
                attributes: []
            },
            {
                model: Journal,
                where: { date: dateFilter },
                attributes: []
            }
        ],
        attributes: [
            [sequelize.fn('SUM', sequelize.col('debit')), 'total_debit'],
            [sequelize.fn('SUM', sequelize.col('credit')), 'total_credit']
        ],
        raw: true
    }) as unknown as { total_debit: number, total_credit: number }[];

    const debit = Number(lines[0]?.total_debit || 0);
    const credit = Number(lines[0]?.total_credit || 0);

    return invert ? (credit - debit) : (debit - credit);
};

// --- Reports ---

export const getProfitAndLoss = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'StartDate dan EndDate wajib diisi' });
        }

        const dateFilter = {
            [Op.between]: [new Date(startDate as string), new Date(endDate as string)]
        };

        // 1. Revenue (Type: revenue, Credit - Debit)
        const revenue = await getJournalBalance('revenue', dateFilter, true);

        // 2. COGS (Code: 5100, Debit - Credit)
        const cogs = await getJournalBalance('expense', dateFilter, false, '5100');

        // 3. Operational Expenses (Type: expense, Code != 5100, Debit - Credit)
        // Since we can't easily do "Code != 5100" in simple helper, we calculate All Expense then subtract COGS
        const totalExpense = await getJournalBalance('expense', dateFilter, false);
        const expenses = totalExpense - cogs;

        const grossProfit = revenue - cogs;
        const netProfit = grossProfit - expenses;

        res.json({
            period: { startDate, endDate },
            revenue,
            cogs,
            gross_profit: grossProfit,
            expenses,
            net_profit: netProfit
        });
    } catch (error) {
        res.status(500).json({ message: 'Error calculating P&L', error });
    }
};

export const getBalanceSheet = async (req: Request, res: Response) => {
    try {
        const { asOfDate } = req.query;
        const targetDate = asOfDate ? new Date(asOfDate as string) : new Date();

        // Balance Sheet includes ALL transactions up to targetDate
        const dateFilter = {
            [Op.lte]: targetDate
        };

        // 1. Assets (Debit - Credit)
        const assets = await getJournalBalance('asset', dateFilter, false);

        // 2. Liabilities (Credit - Debit)
        const liabilities = await getJournalBalance('liability', dateFilter, true);

        // 3. Equity (Credit - Debit)
        const equity = await getJournalBalance('equity', dateFilter, true);

        // 4. Current Earnings (Revenue - Expenses for ALL time)
        // Needed to balance the equation (Assets = Liab + Equity + Earnings)
        const totalRevenue = await getJournalBalance('revenue', dateFilter, true);
        const totalExpense = await getJournalBalance('expense', dateFilter, false);
        const currentEarnings = totalRevenue - totalExpense;

        const totalEquity = equity + currentEarnings;

        res.json({
            as_of: targetDate,
            assets,
            liabilities,
            equity: {
                initial: equity,
                current_earnings: currentEarnings,
                total: totalEquity
            },
            balance_check: assets - (liabilities + totalEquity)
        });
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

        const start = new Date(startDate as string);
        const end = new Date(endDate as string);

        // 1. Opening Balance (Cash Account 11xx up to StartDate)
        const accWhere = { code: { [Op.like]: '11%' }, type: 'asset' };

        const openingLines = await JournalLine.findAll({
            include: [
                { model: Account, where: accWhere, attributes: [] },
                { model: Journal, where: { date: { [Op.lt]: start } }, attributes: [] }
            ],
            attributes: [
                [sequelize.fn('SUM', sequelize.col('debit')), 'total_debit'],
                [sequelize.fn('SUM', sequelize.col('credit')), 'total_credit']
            ],
            raw: true
        }) as unknown as { total_debit: number, total_credit: number }[];

        const openingBalance = Number(openingLines[0]?.total_debit || 0) - Number(openingLines[0]?.total_credit || 0);

        // 2. Period Movements
        const periodLines = await JournalLine.findAll({
            include: [
                { model: Account, where: accWhere, attributes: [] },
                { model: Journal, where: { date: { [Op.between]: [start, end] } }, attributes: [] }
            ],
            attributes: [
                [sequelize.fn('SUM', sequelize.col('debit')), 'total_in'], // Money In
                [sequelize.fn('SUM', sequelize.col('credit')), 'total_out'] // Money Out
            ],
            raw: true
        }) as unknown as { total_in: number, total_out: number }[];

        const cashIn = Number(periodLines[0]?.total_in || 0);
        const cashOut = Number(periodLines[0]?.total_out || 0);
        const closingBalance = openingBalance + cashIn - cashOut;

        res.json({
            period: { startDate, endDate },
            opening_balance: openingBalance,
            cash_in: cashIn,
            cash_out: cashOut,
            net_change: cashIn - cashOut,
            closing_balance: closingBalance
        });
    } catch (error) {
        res.status(500).json({ message: 'Error calculating Cash Flow', error });
    }
};

export const getInventoryValue = async (req: Request, res: Response) => {
    try {
        // Detailed list breakdown
        const products = await Product.findAll({
            attributes: [
                'id', 'sku', 'name', 'stock_quantity', 'base_price',
                [sequelize.literal('stock_quantity * base_price'), 'total_valuation']
            ],
            where: {
                stock_quantity: { [Op.gt]: 0 }
            },
            order: [[sequelize.literal('total_valuation'), 'DESC']]
        });

        const totalItems = products.reduce((sum, p) => sum + Number(p.stock_quantity || 0), 0);
        const totalValue = products.reduce((sum, p) => sum + (Number(p.getDataValue('total_valuation' as any)) || 0), 0);

        res.json({
            total_items: totalItems || 0,
            total_valuation: totalValue || 0,
            breakdown: products
        });
    } catch (error) {
        res.status(500).json({ message: 'Error calculating Inventory Value', error });
    }
};

export const getAccountsPayableAging = async (req: Request, res: Response) => {
    try {
        const unpaidInvoices = await SupplierInvoice.findAll({
            where: { status: 'unpaid' },
            order: [['due_date', 'ASC']]
        });

        const now = new Date();
        const aging = {
            '0-30': 0,
            '31-60': 0,
            '61-90': 0,
            '>90': 0,
            total: 0
        };

        const rows = unpaidInvoices.map(inv => {
            const dueDate = new Date(inv.due_date);
            const diffTime = Math.abs(now.getTime() - dueDate.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            // If not overdue yet (future due date), treat as 0 aging or separate bucket?
            // "Aging Hutang" usually looks at how OLD the invoice is, or how OVERDUE it is.
            // Let's assume Aging from Due Date (Overdue Days).
            const isOverdue = now > dueDate;
            const daysOverdue = isOverdue ? diffDays : 0;

            const amount = Number(inv.total);
            aging.total += amount;

            if (daysOverdue <= 30) aging['0-30'] += amount;
            else if (daysOverdue <= 60) aging['31-60'] += amount;
            else if (daysOverdue <= 90) aging['61-90'] += amount;
            else aging['>90'] += amount;

            return {
                ...inv.get({ plain: true }),
                days_overdue: daysOverdue
            };
        });

        res.json({
            summary: aging,
            details: rows
        });
    } catch (error) {
        res.status(500).json({ message: 'Error calculating AP Aging', error });
    }
};

export const getAccountsReceivableAging = async (req: Request, res: Response) => {
    try {
        const unpaidInvoices = await Invoice.findAll({
            where: { payment_status: { [Op.ne]: 'paid' } },
            include: [{ model: Order, attributes: ['total_amount', 'createdAt', 'customer_name'] }],
            order: [['createdAt', 'ASC']]
        });

        const now = new Date();
        const aging = {
            '0-30': 0,
            '31-60': 0,
            '61-90': 0,
            '>90': 0,
            total: 0
        };

        const rows = unpaidInvoices.map(inv => {
            const order = (inv as any).Order;
            const createdAt = new Date(order?.createdAt || inv.createdAt);
            const amountDue = Number(order?.total_amount || 0) - Number(inv.amount_paid || 0);

            const diffTime = Math.abs(now.getTime() - createdAt.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (amountDue > 0) {
                aging.total += amountDue;
                if (diffDays <= 30) aging['0-30'] += amountDue;
                else if (diffDays <= 60) aging['31-60'] += amountDue;
                else if (diffDays <= 90) aging['61-90'] += amountDue;
                else aging['>90'] += amountDue;
            }

            return {
                id: inv.id,
                invoice_number: inv.invoice_number,
                customer: order?.customer_name,
                created_at: createdAt,
                days_outstanding: diffDays,
                amount_due: amountDue
            };
        });

        res.json({
            summary: aging,
            details: rows
        });
    } catch (error) {
        res.status(500).json({ message: 'Error calculating AR Aging', error });
    }
};
