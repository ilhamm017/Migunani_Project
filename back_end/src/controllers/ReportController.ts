import { Request, Response } from 'express';
import { Op, QueryTypes } from 'sequelize';
import { Account, Journal, JournalLine, Product, SupplierInvoice, Invoice, User, Order, sequelize, Backorder, OrderItem, ProductCostState, OrderAllocation } from '../models';

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
                as: 'Account',
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
        const accWhere = { code: { [Op.in]: ['1101', '1102'] }, type: 'asset' };

        const openingLines = await JournalLine.findAll({
            include: [
                { model: Account, as: 'Account', where: accWhere, attributes: [] },
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
                { model: Account, as: 'Account', where: accWhere, attributes: [] },
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
        const products = await Product.findAll({
            attributes: [
                'id', 'sku', 'name', 'stock_quantity'
            ],
            where: {
                stock_quantity: { [Op.gt]: 0 }
            },
            include: [{
                model: ProductCostState,
                as: 'CostState',
                required: false,
                attributes: ['avg_cost', 'on_hand_qty']
            }],
            order: [['updatedAt', 'DESC']]
        });

        const breakdown = products.map((p: any) => {
            const qty = Number(p.stock_quantity || 0);
            const avgCost = Number(p.CostState?.avg_cost || 0);
            const value = qty * avgCost;
            return {
                id: p.id,
                sku: p.sku,
                name: p.name,
                stock_quantity: qty,
                avg_cost: avgCost,
                total_valuation: value
            };
        });
        const totalItems = breakdown.reduce((sum, p) => sum + Number(p.stock_quantity || 0), 0);
        const totalValue = breakdown.reduce((sum, p) => sum + Number(p.total_valuation || 0), 0);

        res.json({
            total_items: totalItems || 0,
            total_valuation: totalValue || 0,
            breakdown
        });
    } catch (error) {
        res.status(500).json({ message: 'Error calculating Inventory Value', error });
    }
};

export const getAccountsPayableAging = async (req: Request, res: Response) => {
    try {
        const now = new Date();
        const aging = {
            '0-30': 0,
            '31-60': 0,
            '61-90': 0,
            '>90': 0,
            total: 0
        };
        const rowsRaw = await sequelize.query(
            `SELECT 
                j.reference_type,
                j.reference_id,
                MIN(j.date) AS first_date,
                SUM(jl.credit - jl.debit) AS outstanding
             FROM journal_lines jl
             INNER JOIN journals j ON j.id = jl.journal_id
             INNER JOIN accounts a ON a.id = jl.account_id
             WHERE a.code = '2100'
             GROUP BY j.reference_type, j.reference_id
             HAVING SUM(jl.credit - jl.debit) > 0`,
            { type: QueryTypes.SELECT }
        ) as Array<{ reference_type: string; reference_id: string; first_date: string; outstanding: number }>;

        const rows = rowsRaw.map((r) => {
            const firstDate = new Date(r.first_date);
            const diffTime = Math.abs(now.getTime() - firstDate.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            const amount = Number(r.outstanding || 0);

            aging.total += amount;
            if (diffDays <= 30) aging['0-30'] += amount;
            else if (diffDays <= 60) aging['31-60'] += amount;
            else if (diffDays <= 90) aging['61-90'] += amount;
            else aging['>90'] += amount;

            return {
                reference_type: r.reference_type,
                reference_id: r.reference_id,
                created_at: firstDate,
                days_outstanding: diffDays,
                amount_due: amount
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
        const now = new Date();
        const aging = {
            '0-30': 0,
            '31-60': 0,
            '61-90': 0,
            '>90': 0,
            total: 0
        };
        const rowsRaw = await sequelize.query(
            `SELECT 
                j.reference_type,
                j.reference_id,
                MIN(j.date) AS first_date,
                SUM(jl.debit - jl.credit) AS outstanding
             FROM journal_lines jl
             INNER JOIN journals j ON j.id = jl.journal_id
             INNER JOIN accounts a ON a.id = jl.account_id
             WHERE a.code IN ('1103', '1104', '1105')
             GROUP BY j.reference_type, j.reference_id
             HAVING SUM(jl.debit - jl.credit) > 0`,
            { type: QueryTypes.SELECT }
        ) as Array<{ reference_type: string; reference_id: string; first_date: string; outstanding: number }>;

        const rows = rowsRaw.map((r) => {
            const firstDate = new Date(r.first_date);
            const diffTime = Math.abs(now.getTime() - firstDate.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            const amountDue = Number(r.outstanding || 0);
            aging.total += amountDue;
            if (diffDays <= 30) aging['0-30'] += amountDue;
            else if (diffDays <= 60) aging['31-60'] += amountDue;
            else if (diffDays <= 90) aging['61-90'] += amountDue;
            else aging['>90'] += amountDue;
            return {
                reference_type: r.reference_type,
                reference_id: r.reference_id,
                created_at: firstDate,
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

export const getTaxSummary = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'StartDate dan EndDate wajib diisi' });
        }
        const dateFilter = {
            [Op.between]: [new Date(String(startDate)), new Date(String(endDate))]
        };
        const ppnOutput = await getJournalBalance('liability', dateFilter, true, '2201');
        const ppnInput = await getJournalBalance('asset', dateFilter, false, '2202');
        const vatPayable = ppnOutput - ppnInput;

        const nonPkpInvoices = await Invoice.findAll({
            where: {
                tax_mode_snapshot: 'non_pkp',
                verified_at: dateFilter
            },
            attributes: ['id', 'invoice_number', 'subtotal', 'pph_final_amount', 'verified_at']
        });
        const omzetNonPkp = nonPkpInvoices.reduce((sum, inv) => sum + Number(inv.subtotal || 0), 0);
        const pphFinal = nonPkpInvoices.reduce((sum, inv) => sum + Number(inv.pph_final_amount || 0), 0);

        return res.json({
            period: { startDate, endDate },
            ppn: {
                output: ppnOutput,
                input: ppnInput,
                payable: vatPayable
            },
            pph_final_non_pkp: {
                omzet: omzetNonPkp,
                amount: pphFinal
            }
        });
    } catch (error) {
        return res.status(500).json({ message: 'Error calculating tax summary', error });
    }
};

export const getVatMonthlyReport = async (req: Request, res: Response) => {
    try {
        const { year } = req.query;
        const y = Number(year || new Date().getFullYear());
        if (!Number.isInteger(y) || y < 2000 || y > 3000) {
            return res.status(400).json({ message: 'Year tidak valid' });
        }

        const rows = await sequelize.query(
            `SELECT 
                MONTH(j.date) AS month_num,
                SUM(CASE WHEN a.code = '2201' THEN (jl.credit - jl.debit) ELSE 0 END) AS ppn_keluaran,
                SUM(CASE WHEN a.code = '2202' THEN (jl.debit - jl.credit) ELSE 0 END) AS ppn_masukan
             FROM journal_lines jl
             INNER JOIN journals j ON j.id = jl.journal_id
             INNER JOIN accounts a ON a.id = jl.account_id
             WHERE YEAR(j.date) = :yearParam
               AND a.code IN ('2201', '2202')
             GROUP BY MONTH(j.date)
             ORDER BY MONTH(j.date)`,
            {
                type: QueryTypes.SELECT,
                replacements: { yearParam: y }
            }
        ) as Array<{ month_num: number; ppn_keluaran: number; ppn_masukan: number }>;

        const monthly = Array.from({ length: 12 }).map((_, idx) => {
            const monthNum = idx + 1;
            const row = rows.find((r) => Number(r.month_num) === monthNum);
            const output = Number(row?.ppn_keluaran || 0);
            const input = Number(row?.ppn_masukan || 0);
            return {
                month: monthNum,
                ppn_keluaran: output,
                ppn_masukan: input,
                ppn_netto: output - input
            };
        });

        return res.json({ year: y, rows: monthly });
    } catch (error) {
        return res.status(500).json({ message: 'Error generating VAT monthly report', error });
    }
};

export const getBackorderPreorderReport = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate } = req.query;
        const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const end = endDate ? new Date(endDate as string) : new Date();

        const backorders = await Backorder.findAll({
            where: {
                qty_pending: { [Op.gt]: 0 },
                status: 'waiting_stock',
                createdAt: { [Op.between]: [start, end] }
            },
            include: [
                {
                    model: OrderItem,
                    include: [
                        { model: Product, attributes: ['id', 'sku', 'name', 'price', 'base_price'] },
                        {
                            model: Order,
                            include: [{ model: User, as: 'Customer', attributes: ['id', 'name', 'whatsapp_number'] }]
                        }
                    ]
                }
            ],
            order: [['createdAt', 'DESC']]
        });

        const orderIds = Array.from(new Set(backorders.map((bo: any) => String(bo?.OrderItem?.Order?.id || '')).filter(Boolean)));
        const allocationRows = orderIds.length > 0
            ? await OrderAllocation.findAll({
                where: { order_id: { [Op.in]: orderIds } },
                attributes: ['order_id', 'allocated_qty']
            })
            : [];
        const allocatedByOrder = new Map<string, number>();
        allocationRows.forEach((row: any) => {
            const key = String(row.order_id || '');
            const prev = Number(allocatedByOrder.get(key) || 0);
            allocatedByOrder.set(key, prev + Number(row.allocated_qty || 0));
        });

        const rows = backorders.map((bo: any) => {
            const item = bo.OrderItem;
            const product = item?.Product;
            const order = item?.Order;
            const customer = order?.Customer;

            // Preorder logic: if no allocation was made yet (allocated_total = 0 on order level)
            // But we can simplify: if bo records exist and are waiting, they are backorders/preorders.
            // In our system, 'preorder' is just a backorder with 0 allocation.
            const allocatedQty = Number(allocatedByOrder.get(String(order?.id || '')) || 0);
            const isPreorder = allocatedQty <= 0 && bo.qty_pending === item?.qty;

            return {
                id: bo.id,
                order_id: order?.id,
                customer_name: customer?.name || order?.customer_name || 'Generic Customer',
                product_name: product?.name || 'Unknown Product',
                sku: product?.sku || '-',
                qty: bo.qty_pending,
                price: Number(product?.price || 0),
                total_value: bo.qty_pending * Number(product?.price || 0),
                date: bo.createdAt,
                type: isPreorder ? 'preorder' : 'backorder'
            };
        });

        const summary = {
            total_items: rows.reduce((sum, r) => sum + r.qty, 0),
            total_value: rows.reduce((sum, r) => sum + r.total_value, 0),
            backorder_count: rows.filter(r => r.type === 'backorder').length,
            preorder_count: rows.filter(r => r.type === 'preorder').length,
        };

        // Top Products
        const productStats = new Map<string, any>();
        rows.forEach(r => {
            const existing = productStats.get(r.sku) || { sku: r.sku, name: r.product_name, qty: 0, value: 0 };
            existing.qty += r.qty;
            existing.value += r.total_value;
            productStats.set(r.sku, existing);
        });

        const topProducts = Array.from(productStats.values())
            .sort((a, b) => b.qty - a.qty)
            .slice(0, 10);

        // Top Customers
        const customerStats = new Map<string, any>();
        rows.forEach(r => {
            const existing = customerStats.get(r.customer_name) || { name: r.customer_name, qty: 0, value: 0 };
            existing.qty += r.qty;
            existing.value += r.total_value;
            customerStats.set(r.customer_name, existing);
        });

        const topCustomers = Array.from(customerStats.values())
            .sort((a, b) => b.value - a.value)
            .slice(0, 10);

        res.json({
            period: { start, end },
            summary,
            top_products: topProducts,
            top_customers: topCustomers,
            details: rows
        });
    } catch (error) {
        console.error('Error in getBackorderPreorderReport:', error);
        res.status(500).json({ message: 'Error calculating Backorder report', error });
    }
};
