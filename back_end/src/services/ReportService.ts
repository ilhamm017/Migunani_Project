import { Op, QueryTypes } from 'sequelize';
import { Account, Journal, JournalLine, Product, Invoice, User, Order, sequelize, Backorder, OrderItem, ProductCostState, OrderAllocation } from '../models';

type StockReductionEventType = 'allocation' | 'goods_out';

type StockReductionRow = {
    event_type: StockReductionEventType;
    product_id: string;
    sku: string;
    product_name: string;
    unit: string;
    qty_reduced: number;
    order_count: number;
    related_order_ids: string[];
    latest_order_id: string | null;
    latest_event_at: string | null;
    breakdown: {
        allocation: number;
        goods_out: number;
    };
};

type StockReductionResult = {
    period: { start: Date; end: Date };
    event_type: 'all' | StockReductionEventType;
    search: string;
    summary: {
        total_qty_reduced: number;
        total_products: number;
        total_orders: number;
    };
    rows: StockReductionRow[];
};

export class ReportService {
    private static normalizeStockReductionEventType(raw?: string): 'all' | StockReductionEventType {
        const value = String(raw || '').trim().toLowerCase();
        if (value === 'allocation') return 'allocation';
        if (value === 'goods_out') return 'goods_out';
        return 'all';
    }

    private static resolveStockReductionPeriod(startDate?: string, endDate?: string) {
        const end = endDate ? new Date(endDate) : new Date();
        const start = startDate ? new Date(startDate) : new Date(end.getTime() - (30 * 24 * 60 * 60 * 1000));
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
            throw new Error('Tanggal tidak valid');
        }
        // Treat date filters as full-day windows to avoid excluding same-day records.
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        if (start > end) {
            throw new Error('Rentang tanggal tidak valid');
        }
        return { start, end };
    }

    static async calculateStockReductionReport(params: {
        startDate?: string;
        endDate?: string;
        eventType?: string;
        search?: string;
    }): Promise<StockReductionResult> {
        const { startDate, endDate, eventType, search } = params;
        const period = this.resolveStockReductionPeriod(startDate, endDate);
        const normalizedEventType = this.normalizeStockReductionEventType(eventType);
        const searchText = String(search || '').trim().toLowerCase();

        const allocations = normalizedEventType === 'goods_out'
            ? []
            : await OrderAllocation.findAll({
                where: {
                    allocated_qty: { [Op.gt]: 0 },
                    createdAt: { [Op.between]: [period.start, period.end] }
                } as any,
                include: [{ model: Product, as: 'Product', attributes: ['id', 'sku', 'name', 'unit'] }],
                attributes: ['order_id', 'product_id', 'allocated_qty', 'createdAt'],
                order: [['createdAt', 'DESC']],
                raw: false
            });

        const goodsOutRows = normalizedEventType === 'allocation'
            ? []
            : await sequelize.query(
                `SELECT 
                    l.product_id,
                    p.sku,
                    p.name,
                    p.unit,
                    l.reference_id AS order_id,
                    l.qty,
                    l.createdAt
                 FROM inventory_cost_ledger l
                 INNER JOIN products p ON p.id = l.product_id
                 WHERE l.movement_type = 'out'
                   AND l.reference_type IN ('order', 'pos_sale')
                   AND l.qty > 0
                   AND l.createdAt BETWEEN :startDate AND :endDate
                 ORDER BY l.createdAt DESC`,
                {
                    type: QueryTypes.SELECT,
                    replacements: { startDate: period.start, endDate: period.end }
                }
            ) as Array<{
                product_id: string;
                sku: string;
                name: string;
                unit: string | null;
                order_id: string | null;
                qty: number;
                createdAt: string | Date;
            }>;

        type RowBucket = {
            product_id: string;
            sku: string;
            product_name: string;
            unit: string;
            qty_reduced: number;
            orderIds: Set<string>;
            sampleOrderIds: string[];
            latest_event_at: Date | null;
            latest_order_id: string | null;
            breakdown: {
                allocation: number;
                goods_out: number;
            };
        };

        const byProduct = new Map<string, RowBucket>();
        const globalOrderIds = new Set<string>();

        const ensureBucket = (productId: string, sku: string, productName: string, unit?: string | null) => {
            const existing = byProduct.get(productId);
            if (existing) return existing;
            const next: RowBucket = {
                product_id: productId,
                sku: sku || '-',
                product_name: productName || 'Produk',
                unit: String(unit || '-'),
                qty_reduced: 0,
                orderIds: new Set<string>(),
                sampleOrderIds: [],
                latest_event_at: null,
                latest_order_id: null,
                breakdown: {
                    allocation: 0,
                    goods_out: 0
                }
            };
            byProduct.set(productId, next);
            return next;
        };

        for (const row of allocations as any[]) {
            const product = row?.Product || {};
            const productId = String(row?.product_id || product?.id || '').trim();
            if (!productId) continue;
            const sku = String(product?.sku || '').trim();
            const productName = String(product?.name || '').trim();
            if (searchText) {
                const haystack = `${sku} ${productName}`.toLowerCase();
                if (!haystack.includes(searchText)) continue;
            }
            const qty = Number(row?.allocated_qty || 0);
            if (qty <= 0) continue;
            const orderId = String(row?.order_id || '').trim();
            const createdAt = new Date(row?.createdAt);
            const bucket = ensureBucket(productId, sku, productName, product?.unit);
            bucket.qty_reduced += qty;
            bucket.breakdown.allocation += qty;
            if (orderId) {
                bucket.orderIds.add(orderId);
                globalOrderIds.add(orderId);
                if (bucket.sampleOrderIds.length < 5 && !bucket.sampleOrderIds.includes(orderId)) {
                    bucket.sampleOrderIds.push(orderId);
                }
            }
            if (!bucket.latest_event_at || createdAt > bucket.latest_event_at) {
                bucket.latest_event_at = createdAt;
                bucket.latest_order_id = orderId || null;
            }
        }

        for (const row of goodsOutRows) {
            const productId = String(row?.product_id || '').trim();
            if (!productId) continue;
            const sku = String(row?.sku || '').trim();
            const productName = String(row?.name || '').trim();
            if (searchText) {
                const haystack = `${sku} ${productName}`.toLowerCase();
                if (!haystack.includes(searchText)) continue;
            }
            const qty = Number(row?.qty || 0);
            if (qty <= 0) continue;
            const orderId = String(row?.order_id || '').trim();
            const createdAt = new Date(row?.createdAt);
            const bucket = ensureBucket(productId, sku, productName, row?.unit || null);
            bucket.qty_reduced += qty;
            bucket.breakdown.goods_out += qty;
            if (orderId) {
                bucket.orderIds.add(orderId);
                globalOrderIds.add(orderId);
                if (bucket.sampleOrderIds.length < 5 && !bucket.sampleOrderIds.includes(orderId)) {
                    bucket.sampleOrderIds.push(orderId);
                }
            }
            if (!bucket.latest_event_at || createdAt > bucket.latest_event_at) {
                bucket.latest_event_at = createdAt;
                bucket.latest_order_id = orderId || null;
            }
        }

        const rows = Array.from(byProduct.values())
            .map((bucket): StockReductionRow => ({
                event_type: normalizedEventType === 'all'
                    ? (bucket.breakdown.goods_out > bucket.breakdown.allocation ? 'goods_out' : 'allocation')
                    : normalizedEventType,
                product_id: bucket.product_id,
                sku: bucket.sku,
                product_name: bucket.product_name,
                unit: bucket.unit,
                qty_reduced: Number(bucket.qty_reduced || 0),
                order_count: bucket.orderIds.size,
                related_order_ids: bucket.sampleOrderIds,
                latest_order_id: bucket.latest_order_id,
                latest_event_at: bucket.latest_event_at ? bucket.latest_event_at.toISOString() : null,
                breakdown: {
                    allocation: Number(bucket.breakdown.allocation || 0),
                    goods_out: Number(bucket.breakdown.goods_out || 0)
                }
            }))
            .sort((a, b) => {
                const qtyDiff = Number(b.qty_reduced || 0) - Number(a.qty_reduced || 0);
                if (qtyDiff !== 0) return qtyDiff;
                const bTs = Date.parse(String(b.latest_event_at || ''));
                const aTs = Date.parse(String(a.latest_event_at || ''));
                const bVal = Number.isFinite(bTs) ? bTs : 0;
                const aVal = Number.isFinite(aTs) ? aTs : 0;
                return bVal - aVal;
            });

        return {
            period,
            event_type: normalizedEventType,
            search: String(search || '').trim(),
            summary: {
                total_qty_reduced: rows.reduce((sum, row) => sum + Number(row.qty_reduced || 0), 0),
                total_products: rows.length,
                total_orders: globalOrderIds.size
            },
            rows
        };
    }

    static async getJournalBalance(
        accountType: string | string[],
        dateFilter: any,
        invert: boolean = false,
        specificCode?: string
    ) {
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
    }

    static async calculateProfitAndLoss(startDate: string, endDate: string) {
        const dateFilter = {
            [Op.between]: [new Date(startDate), new Date(endDate)]
        };

        const revenue = await this.getJournalBalance('revenue', dateFilter, true);
        const cogs = await this.getJournalBalance('expense', dateFilter, false, '5100');
        const totalExpense = await this.getJournalBalance('expense', dateFilter, false);
        const expenses = totalExpense - cogs;

        const grossProfit = revenue - cogs;
        const netProfit = grossProfit - expenses;

        return {
            period: { startDate, endDate },
            revenue,
            cogs,
            gross_profit: grossProfit,
            expenses,
            net_profit: netProfit
        };
    }

    static async calculateBalanceSheet(asOfDate?: string) {
        const targetDate = asOfDate ? new Date(asOfDate) : new Date();

        const dateFilter = {
            [Op.lte]: targetDate
        };

        const assets = await this.getJournalBalance('asset', dateFilter, false);
        const liabilities = await this.getJournalBalance('liability', dateFilter, true);
        const equity = await this.getJournalBalance('equity', dateFilter, true);

        const totalRevenue = await this.getJournalBalance('revenue', dateFilter, true);
        const totalExpense = await this.getJournalBalance('expense', dateFilter, false);
        const currentEarnings = totalRevenue - totalExpense;

        const totalEquity = equity + currentEarnings;

        return {
            as_of: targetDate,
            assets,
            liabilities,
            equity: {
                initial: equity,
                current_earnings: currentEarnings,
                total: totalEquity
            },
            balance_check: assets - (liabilities + totalEquity)
        };
    }

    static async calculateCashFlow(startDate: string, endDate: string) {
        const start = new Date(startDate);
        const end = new Date(endDate);

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

        const periodLines = await JournalLine.findAll({
            include: [
                { model: Account, as: 'Account', where: accWhere, attributes: [] },
                { model: Journal, where: { date: { [Op.between]: [start, end] } }, attributes: [] }
            ],
            attributes: [
                [sequelize.fn('SUM', sequelize.col('debit')), 'total_in'],
                [sequelize.fn('SUM', sequelize.col('credit')), 'total_out']
            ],
            raw: true
        }) as unknown as { total_in: number, total_out: number }[];

        const cashIn = Number(periodLines[0]?.total_in || 0);
        const cashOut = Number(periodLines[0]?.total_out || 0);
        const closingBalance = openingBalance + cashIn - cashOut;

        return {
            period: { startDate, endDate },
            opening_balance: openingBalance,
            cash_in: cashIn,
            cash_out: cashOut,
            net_change: cashIn - cashOut,
            closing_balance: closingBalance
        };
    }

    static async calculateInventoryValue() {
        const products = await Product.findAll({
            attributes: ['id', 'sku', 'name', 'stock_quantity'],
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

        return {
            total_items: totalItems || 0,
            total_valuation: totalValue || 0,
            breakdown
        };
    }

    static async calculateAccountsPayableAging() {
        const now = new Date();
        const aging = {
            '0-30': 0, '31-60': 0, '61-90': 0, '>90': 0, total: 0
        };
        const rowsRaw = await sequelize.query(
            `SELECT 
                j.reference_type, j.reference_id, MIN(j.date) AS first_date, SUM(jl.credit - jl.debit) AS outstanding
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

        return { summary: aging, details: rows };
    }

    static async calculateAccountsReceivableAging() {
        const now = new Date();
        const aging = {
            '0-30': 0, '31-60': 0, '61-90': 0, '>90': 0, total: 0
        };
        const rowsRaw = await sequelize.query(
            `SELECT 
                j.reference_type, j.reference_id, MIN(j.date) AS first_date, SUM(jl.debit - jl.credit) AS outstanding
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

        return { summary: aging, details: rows };
    }

    static async calculateTaxSummary(startDate: string, endDate: string) {
        const dateFilter = {
            [Op.between]: [new Date(startDate), new Date(endDate)]
        };
        const ppnOutput = await this.getJournalBalance('liability', dateFilter, true, '2201');
        const ppnInput = await this.getJournalBalance('asset', dateFilter, false, '2202');
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

        return {
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
        };
    }

    static async calculateVatMonthlyReport(year: number) {
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
                replacements: { yearParam: year }
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

        return { year, rows: monthly };
    }

    static async calculateBackorderPreorderReport(startDate?: string, endDate?: string) {
        const parseBound = (raw: string, bound: 'start' | 'end') => {
            const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (m) {
                const year = Number(m[1]);
                const month = Number(m[2]);
                const day = Number(m[3]);
                if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
                    throw new Error(`Invalid date: ${raw}`);
                }
                if (bound === 'start') return new Date(year, month - 1, day, 0, 0, 0, 0);
                return new Date(year, month - 1, day, 23, 59, 59, 999);
            }
            const dt = new Date(raw);
            if (!Number.isFinite(dt.getTime())) throw new Error(`Invalid date: ${raw}`);
            return dt;
        };

        const now = new Date();
        const start = startDate
            ? parseBound(startDate, 'start')
            : (() => {
                const d = new Date(now);
                d.setDate(d.getDate() - 7);
                d.setHours(0, 0, 0, 0);
                return d;
            })();
        const end = endDate
            ? parseBound(endDate, 'end')
            : (() => {
                const d = new Date(now);
                d.setHours(23, 59, 59, 999);
                return d;
            })();

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

        return {
            period: { start, end },
            summary,
            top_products: topProducts,
            top_customers: topCustomers,
            details: rows
        };
    }
}
