import { Request, Response } from 'express';
import { Expense, ExpenseLabel, Invoice, Order, OrderItem, Product, User, sequelize, Account, Journal, JournalLine, CodCollection, CodSettlement, OrderAllocation, AccountingPeriod } from '../models';
import { Op } from 'sequelize';
import { JournalService } from '../services/JournalService';
import { io } from '../server';


type ExpenseDetail = {
    key: string;
    value: string;
};

type ParsedExpenseNote = {
    text: string;
    details: ExpenseDetail[];
};

const DEFAULT_EXPENSE_LABELS = [
    { name: 'Listrik', description: 'Tagihan listrik dan utilitas' },
    { name: 'Gaji Pegawai', description: 'Payroll dan tunjangan karyawan' },
    { name: 'Ongkir', description: 'Biaya pengiriman atau logistik' },
];

const toSafeText = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value.trim();
};

const normalizeExpenseDetails = (details: unknown): ExpenseDetail[] => {
    if (!Array.isArray(details)) return [];

    return details
        .map((item) => {
            if (!item || typeof item !== 'object') return null;
            const raw = item as { key?: unknown; value?: unknown };
            const key = toSafeText(raw.key);
            const value = toSafeText(raw.value);
            if (!key && !value) return null;
            return { key, value };
        })
        .filter((item): item is ExpenseDetail => item !== null);
};

const parseExpenseNote = (note: unknown): ParsedExpenseNote => {
    const fallbackText = typeof note === 'string' ? note : '';
    if (typeof note !== 'string' || !note.trim()) {
        return { text: fallbackText, details: [] };
    }

    try {
        const parsed = JSON.parse(note) as { text?: unknown; details?: unknown };
        return {
            text: toSafeText(parsed.text),
            details: normalizeExpenseDetails(parsed.details),
        };
    } catch {
        return { text: note, details: [] };
    }
};

const buildExpenseNote = (note: unknown, details: unknown): string => {
    const text = toSafeText(note);
    const normalizedDetails = normalizeExpenseDetails(details);
    if (!text && normalizedDetails.length === 0) {
        return '';
    }
    return JSON.stringify({ text, details: normalizedDetails });
};

const ensureDefaultExpenseLabels = async () => {
    const labelCount = await ExpenseLabel.count();
    if (labelCount > 0) return;

    const expenseCount = await Expense.count();
    if (expenseCount > 0) return;

    for (const item of DEFAULT_EXPENSE_LABELS) {
        await ExpenseLabel.findOrCreate({
            where: { name: item.name },
            defaults: item
        });
    }
};

const AR_ORDER_STATUS_FILTER = { [Op.notIn]: ['canceled', 'expired'] as string[] };

const buildAccountsReceivableInclude = (extraOrderWhere: Record<string, unknown> = {}) => ([
    {
        model: Order,
        where: { status: AR_ORDER_STATUS_FILTER, ...extraOrderWhere },
        attributes: ['id', 'customer_id', 'customer_name', 'source', 'status', 'total_amount', 'createdAt', 'updatedAt', 'expiry_date'],
        include: [
            {
                model: User,
                as: 'Customer',
                attributes: ['id', 'name', 'email', 'whatsapp_number'],
                required: false
            },
            {
                model: User,
                as: 'Courier',
                attributes: ['id', 'name', 'whatsapp_number'],
                required: false
            },
            {
                model: OrderItem,
                attributes: ['id', 'qty', 'price_at_purchase', 'cost_at_purchase'],
                include: [{
                    model: Product,
                    attributes: ['id', 'sku', 'name'],
                    required: false
                }],
                required: false
            }
        ]
    },
    {
        model: User,
        as: 'Verifier',
        attributes: ['id', 'name', 'email'],
        required: false
    }
]);

const mapAccountsReceivableRows = (invoices: Invoice[]) => {
    const nowMs = Date.now();
    return invoices.map((invoice) => {
        const plainInvoice = invoice.get({ plain: true }) as any;
        const order = plainInvoice.Order || {};
        const customer = order.Customer || null;
        const courier = order.Courier || null;
        const verifier = plainInvoice.Verifier || null;
        const orderItems = Array.isArray(order.OrderItems) ? order.OrderItems : [];

        const orderCreatedAtRaw = order.createdAt || plainInvoice.createdAt;
        const orderCreatedAtMs = orderCreatedAtRaw ? new Date(orderCreatedAtRaw).getTime() : nowMs;
        const agingDays = Math.max(0, Math.floor((nowMs - orderCreatedAtMs) / (24 * 60 * 60 * 1000)));

        const totalAmount = Number(order.total_amount || 0);
        const amountPaid = Number(plainInvoice.amount_paid || 0);
        const amountDue = Math.max(0, totalAmount - amountPaid);

        const items = orderItems.map((item: any) => {
            const qty = Number(item.qty || 0);
            const priceAtPurchase = Number(item.price_at_purchase || 0);
            return {
                id: item.id,
                qty,
                price_at_purchase: priceAtPurchase,
                cost_at_purchase: Number(item.cost_at_purchase || 0),
                subtotal: qty * priceAtPurchase,
                product: item.Product ? {
                    id: item.Product.id,
                    sku: item.Product.sku,
                    name: item.Product.name
                } : null
            };
        });

        return {
            id: plainInvoice.id,
            invoice_number: plainInvoice.invoice_number,
            payment_method: plainInvoice.payment_method,
            payment_status: plainInvoice.payment_status,
            payment_proof_url: plainInvoice.payment_proof_url,
            amount_paid: amountPaid,
            change_amount: Number(plainInvoice.change_amount || 0),
            createdAt: plainInvoice.createdAt,
            updatedAt: plainInvoice.updatedAt,
            verified_at: plainInvoice.verified_at,
            aging_days: agingDays,
            amount_due: amountDue,
            order: {
                id: order.id || null,
                customer_id: order.customer_id || null,
                customer_name: order.customer_name || customer?.name || 'Customer',
                source: order.source || null,
                status: order.status || null,
                total_amount: totalAmount,
                createdAt: order.createdAt || null,
                updatedAt: order.updatedAt || null,
                expiry_date: order.expiry_date || null,
                customer: customer ? {
                    id: customer.id,
                    name: customer.name,
                    email: customer.email,
                    whatsapp_number: customer.whatsapp_number
                } : null,
                courier: courier ? {
                    id: courier.id,
                    name: courier.name,
                    whatsapp_number: courier.whatsapp_number
                } : null,
                items
            },
            verifier: verifier ? {
                id: verifier.id,
                name: verifier.name,
                email: verifier.email
            } : null
        };
    });
};

// --- Issue Invoice (Finance step: waiting_invoice → waiting_payment or ready_to_ship) ---
export const issueInvoice = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params; // Order ID
        const userRole = req.user!.role;

        if (!['admin_finance', 'super_admin'].includes(userRole)) {
            await t.rollback();
            return res.status(403).json({ message: 'Hanya admin finance yang boleh menerbitkan invoice' });
        }

        const order = await Order.findByPk(String(id), {
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Order not found' });
        }

        if (order.status !== 'waiting_invoice') {
            await t.rollback();
            return res.status(400).json({ message: `Order status '${order.status}' tidak bisa diterbitkan invoice. Harus 'waiting_invoice'.` });
        }

        const invoice = await Invoice.findOne({
            where: { order_id: id },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!invoice) {
            await t.rollback();
            return res.status(404).json({ message: 'Invoice not found' });
        }

        const paymentMethod = invoice.payment_method;

        if (paymentMethod === 'transfer_manual') {
            // Transfer: issue invoice → customer pays → finance verifies
            await invoice.update({ payment_status: 'unpaid' }, { transaction: t });
            await order.update({ status: 'waiting_payment' }, { transaction: t });
        } else if (paymentMethod === 'cod' || paymentMethod === 'cash_store') {
            // COD/Cash: skip waiting_payment → go straight to ready_to_ship
            await invoice.update({ payment_status: 'cod_pending' }, { transaction: t });
            await order.update({ status: 'ready_to_ship' }, { transaction: t });
        } else {
            // Fallback: treat as transfer
            await invoice.update({ payment_status: 'unpaid' }, { transaction: t });
            await order.update({ status: 'waiting_payment' }, { transaction: t });
        }

        await t.commit();
        io.emit('admin:refresh_badges');

        res.json({
            message: paymentMethod === 'cod' || paymentMethod === 'cash_store'
                ? 'Invoice COD diterbitkan. Order siap dikirim.'
                : 'Invoice diterbitkan. Menunggu pembayaran customer.',
            next_status: order.status
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error issuing invoice', error });
    }
};

// --- Verification ---
export const verifyPayment = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params; // Order ID
        const { action } = req.body; // 'approve' | 'reject'
        const verifierId = req.user!.id;
        const verifierRole = req.user!.role;

        if (!['admin_finance', 'super_admin'].includes(verifierRole)) {
            await t.rollback();
            return res.status(403).json({ message: 'Hanya admin finance atau super admin yang boleh verifikasi pembayaran' });
        }

        if (action !== 'approve' && action !== 'reject') {
            await t.rollback();
            return res.status(400).json({ message: 'Invalid action' });
        }

        const invoice = await Invoice.findOne({
            where: { order_id: id },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!invoice) {
            await t.rollback();
            return res.status(404).json({ message: 'Invoice not found' });
        }

        const order = await Order.findByPk(String(id), {
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Order not found' });
        }

        if (action === 'approve') {
            const isNoProofMethod = ['cod', 'cash_store'].includes(invoice.payment_method);

            if (!isNoProofMethod && !invoice.payment_proof_url) {
                await t.rollback();
                return res.status(400).json({ message: 'Bukti transfer belum tersedia untuk diverifikasi' });
            }

            if (invoice.payment_status === 'paid') {
                await t.rollback();
                return res.status(409).json({ message: 'Pembayaran sudah pernah di-approve' });
            }

            await invoice.update({
                payment_status: 'paid',
                verified_by: verifierId,
                verified_at: new Date()
            }, { transaction: t });

            // --- Create Journal Entries for Sales & COGS ---
            const totalAmount = Number(order.total_amount);

            // 1. Journal Sales (Kas/Bank vs Penjualan)
            const paymentAccCode = invoice.payment_method === 'transfer_manual' ? '1102' : '1101';
            const paymentAcc = await Account.findOne({ where: { code: paymentAccCode }, transaction: t });
            const revenueAcc = await Account.findOne({ where: { code: '4100' }, transaction: t });

            if (paymentAcc && revenueAcc) {
                await JournalService.createEntry({
                    description: `Penjualan Order #${order.id} - ${invoice.invoice_number}`,
                    reference_type: 'order',
                    reference_id: order.id.toString(),
                    created_by: verifierId,
                    lines: [
                        { account_id: paymentAcc.id, debit: totalAmount, credit: 0 },
                        { account_id: revenueAcc.id, debit: 0, credit: totalAmount }
                    ]
                }, t);
            }

            // 2. Journal COGS (HPP vs Persediaan)
            const orderItems = await OrderItem.findAll({ where: { order_id: order.id }, transaction: t });
            const allocations = await OrderAllocation.findAll({ where: { order_id: order.id }, transaction: t });

            let totalCost = 0;
            orderItems.forEach(item => {
                const alloc = allocations.find(a => a.product_id === item.product_id);
                const allocQty = alloc ? Number(alloc.allocated_qty || 0) : 0;
                totalCost += Number(item.cost_at_purchase || 0) * allocQty;
            });

            if (totalCost > 0) {
                const hppAcc = await Account.findOne({ where: { code: '5100' }, transaction: t });
                const inventoryAcc = await Account.findOne({ where: { code: '1300' }, transaction: t });

                if (hppAcc && inventoryAcc) {
                    await JournalService.createEntry({
                        description: `HPP untuk Order #${order.id}`,
                        reference_type: 'order',
                        reference_id: order.id.toString(),
                        created_by: verifierId,
                        lines: [
                            { account_id: hppAcc.id, debit: totalCost, credit: 0 },
                            { account_id: inventoryAcc.id, debit: 0, credit: totalCost }
                        ]
                    }, t);
                }
            }

            // Transition logic based on current status
            if (order.status === 'delivered' && (invoice.payment_method === 'cod' || invoice.payment_method === 'cash_store')) {
                // COD Settlement: Driver already delivered & uploaded proof, now Finance confirms cash receipt
                await order.update({ status: 'completed' }, { transaction: t });
            } else {
                // Standard flow: Payment verified → Ready to Ship
                // (Only if not already shipped/delivered/completed to avoid regression)
                if (['waiting_payment', 'waiting_invoice', 'waiting_admin_verification'].includes(order.status)) {
                    await order.update({ status: 'ready_to_ship' }, { transaction: t });
                }
            }

        } else {
            // If rejected, maybe reset proof url? or just status 'unpaid'? 
            // Or set order status to 'pending' (waiting payment again)
            await invoice.update({
                payment_status: 'unpaid',
                payment_proof_url: null, // Force re-upload
                verified_by: null,
                verified_at: null
            }, { transaction: t });
            await order.update({ status: 'waiting_payment' }, { transaction: t });
        }

        await t.commit();
        io.emit('admin:refresh_badges');

        res.json({ message: `Payment ${action}d` });
    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error verifying payment', error });
    }
};

export const voidPayment = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params; // Invoice ID or Order ID? Let's use Invoice ID for precision
        const userId = req.user!.id;

        const invoice = await Invoice.findByPk(String(id), { include: [Order], transaction: t, lock: t.LOCK.UPDATE });
        if (!invoice) {
            await t.rollback();
            return res.status(404).json({ message: 'Invoice not found' });
        }

        if (invoice.payment_status !== 'paid') {
            await t.rollback();
            return res.status(400).json({ message: 'Invoice belum dibayar/status bukan paid.' });
        }

        // 1. Find the Journal related to this payment
        // We look for journal with reference_type='order' and reference_id=order_id created closely?
        // Or we just create a reversal based on invoice amount.
        // Better: Re-calculate what the journal WAS (Sales + COGS) and reverse it.
        // Since we don't store journal_id on invoice, we construct the reversal.

        const order = (invoice as any).Order;
        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Associated Order not found' });
        }

        // REVERSE SALES JOURNAL
        const paymentAccCode = invoice.payment_method === 'transfer_manual' ? '1102' : '1101';
        const paymentAcc = await Account.findOne({ where: { code: paymentAccCode }, transaction: t });
        const revenueAcc = await Account.findOne({ where: { code: '4100' }, transaction: t });

        if (paymentAcc && revenueAcc) {
            await JournalService.createEntry({
                description: `[VOID/REVERSAL] Penjualan Order #${order.id} - ${invoice.invoice_number}`,
                reference_type: 'order_reversal',
                reference_id: order.id.toString(),
                created_by: userId,
                lines: [
                    { account_id: paymentAcc.id, debit: 0, credit: Number(invoice.amount_paid) }, // Credit Cash
                    { account_id: revenueAcc.id, debit: Number(invoice.amount_paid), credit: 0 }  // Debit Revenue
                ]
            }, t);
        }

        // REVERSE COGS JOURNAL
        // Recalculate COGS
        const orderItems = await OrderItem.findAll({ where: { order_id: order.id }, transaction: t });
        const allocations = await OrderAllocation.findAll({ where: { order_id: order.id }, transaction: t }); // Allocations might be gone if shipped? No, allocs refer to stock.

        // If order was completed/shipped, COGS was booked.
        // We assume COGS was booked when 'paid' status was verified.

        let totalCost = 0;
        orderItems.forEach(item => {
            const alloc = allocations.find((a: any) => a.product_id === item.product_id);
            const allocQty = alloc ? Number(alloc.allocated_qty || 0) : Number(item.qty); // Fallback to qty if alloc missing (e.g. historical)
            totalCost += Number(item.cost_at_purchase || 0) * allocQty;
        });

        if (totalCost > 0) {
            const hppAcc = await Account.findOne({ where: { code: '5100' }, transaction: t });
            const inventoryAcc = await Account.findOne({ where: { code: '1300' }, transaction: t });

            if (hppAcc && inventoryAcc) {
                await JournalService.createEntry({
                    description: `[VOID/REVERSAL] HPP Order #${order.id}`,
                    reference_type: 'order_reversal',
                    reference_id: order.id.toString(),
                    created_by: userId,
                    lines: [
                        { account_id: hppAcc.id, debit: 0, credit: totalCost }, // Credit HPP (Reduce Expense)
                        { account_id: inventoryAcc.id, debit: totalCost, credit: 0 } // Debit Inventory (Increase Asset)
                    ]
                }, t);
            }
        }

        // 2. Reset Invoice
        await invoice.update({
            payment_status: 'unpaid',
            amount_paid: 0,
            verified_at: null,
            verified_by: null
        }, { transaction: t });

        // 3. Reset Order Status
        if (order.status !== 'canceled') {
            await order.update({ status: 'waiting_payment' }, { transaction: t });
        }

        await t.commit();
        io.emit('admin:refresh_badges');

        res.json({ message: 'Pembayaran berhasil di-void (Reversed)' });

    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error voiding payment', error });
    }
};

// --- Expenses ---
export const getExpenses = async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 10, startDate, endDate, category } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const whereClause: any = {};
        if (startDate && endDate) {
            whereClause.date = {
                [Op.between]: [new Date(startDate as string), new Date(endDate as string)]
            };
        }
        if (typeof category === 'string' && category.trim()) {
            whereClause.category = category.trim();
        }

        const expenses = await Expense.findAndCountAll({
            where: whereClause,
            limit: Number(limit),
            offset: Number(offset),
            order: [['date', 'DESC']]
        });

        const rows = expenses.rows.map((row) => {
            const plain = row.get({ plain: true }) as any;
            const parsed = parseExpenseNote(plain.note);
            return {
                ...plain,
                note: parsed.text,
                details: parsed.details,
            };
        });

        res.json({
            total: expenses.count,
            totalPages: Math.ceil(expenses.count / Number(limit)),
            currentPage: Number(page),
            expenses: rows
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching expenses', error });
    }
};

export const createExpense = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { category, amount, date, note, details, payment_method } = req.body;
        const userId = req.user!.id;

        const safeCategory = toSafeText(category);
        const numericAmount = Number(amount);
        if (!safeCategory) {
            await t.rollback();
            return res.status(400).json({ message: 'Kategori wajib diisi' });
        }
        if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Amount harus lebih besar dari 0' });
        }

        if (!req.file) {
            await t.rollback();
            return res.status(400).json({ message: 'Attachment/Bukti pengeluaran wajib diupload' });
        }

        let parsedDetails = details;
        if (typeof details === 'string') {
            try {
                parsedDetails = JSON.parse(details);
            } catch (e) {
                // Ignore, use as is or empty
            }
        }

        const expense = await Expense.create({
            category: safeCategory,
            amount: numericAmount,
            date: date || new Date(),
            note: buildExpenseNote(note, parsedDetails),
            status: 'requested',
            attachment_url: req.file.path,
            created_by: userId
        }, { transaction: t });

        // No journal entry at creation - moved to payment

        await t.commit();
        res.status(201).json(expense);

    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error creating expense', error });
    }
};

export const approveExpense = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params as { id: string };
        const userId = req.user!.id;

        const expense = await Expense.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!expense) {
            await t.rollback();
            return res.status(404).json({ message: 'Expense not found' });
        }

        if (expense.status !== 'requested') {
            await t.rollback();
            return res.status(400).json({ message: `Expense status is ${expense.status}, cannot approve` });
        }

        await expense.update({
            status: 'approved',
            approved_by: userId,
            approved_at: new Date()
        }, { transaction: t });

        await t.commit();
        res.json({ message: 'Expense approved', expense });
    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error approving expense', error });
    }
};

export const payExpense = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params as { id: string };
        const { account_id } = req.body;
        const userId = req.user!.id;

        const expense = await Expense.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!expense) {
            await t.rollback();
            return res.status(404).json({ message: 'Expense not found' });
        }

        if (expense.status !== 'approved') {
            await t.rollback();
            return res.status(400).json({ message: `Expense must be approved before payment. Current status: ${expense.status}` });
        }

        if (!account_id) {
            await t.rollback();
            return res.status(400).json({ message: 'Account ID (source of funds) is required' });
        }

        const paymentAcc = await Account.findByPk(account_id, { transaction: t });
        if (!paymentAcc) {
            await t.rollback();
            return res.status(404).json({ message: 'Payment account not found' });
        }

        await expense.update({
            status: 'paid',
            account_id: account_id,
            paid_at: new Date()
        }, { transaction: t });

        // --- Create Journal Entry (Expense vs Cash/Bank) ---
        // Map category to COA code
        let expenseAccountCode = '5300'; // Default: Operasional
        const catLower = expense.category.toLowerCase();
        // Simple mapping based on keywords, ideally stored in config or ExpenseLabel
        if (catLower.includes('gaji')) expenseAccountCode = '5200';
        else if (catLower.includes('listrik') || catLower.includes('utility')) expenseAccountCode = '5300'; // Or specific code
        else if (catLower.includes('transport') || catLower.includes('ongkir')) expenseAccountCode = '5500';
        else if (catLower.includes('hpp') || catLower.includes('modal')) expenseAccountCode = '5100';
        else if (catLower.includes('refund')) expenseAccountCode = '4100-REFUND'; // Example, handle carefully

        let expenseAcc = await Account.findOne({ where: { code: expenseAccountCode }, transaction: t });

        // Fallback if specific account not found, use General Expense (5900 if created?) or just keep 5300
        if (!expenseAcc) {
            expenseAcc = await Account.findOne({ where: { code: '5300' }, transaction: t });
        }

        if (expenseAcc) {
            await JournalService.createEntry({
                description: `Expense Payment: ${expense.category} - ${expense.note || ''}`,
                reference_type: 'expense',
                reference_id: expense.id.toString(),
                created_by: userId,
                date: new Date(),
                lines: [
                    { account_id: expenseAcc.id, debit: Number(expense.amount), credit: 0 },
                    { account_id: paymentAcc.id, debit: 0, credit: Number(expense.amount) }
                ]
            }, t);
        }

        await t.commit();
        res.json({ message: 'Expense paid', expense });
    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error paying expense', error });
    }
};


export const getExpenseLabels = async (_req: Request, res: Response) => {
    try {
        await ensureDefaultExpenseLabels();
        const labels = await ExpenseLabel.findAll({
            order: [['name', 'ASC']]
        });
        res.json({ labels });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching expense labels', error });
    }
};

export const createExpenseLabel = async (req: Request, res: Response) => {
    try {
        const name = toSafeText(req.body?.name);
        const description = toSafeText(req.body?.description);

        if (!name) {
            return res.status(400).json({ message: 'Nama label wajib diisi' });
        }

        const existingLabels = await ExpenseLabel.findAll({ attributes: ['name'] });
        const hasDuplicate = existingLabels.some((item) => item.name.toLowerCase() === name.toLowerCase());
        if (hasDuplicate) {
            return res.status(409).json({ message: 'Label sudah ada' });
        }

        const label = await ExpenseLabel.create({
            name,
            description: description || null
        });
        res.status(201).json({ message: 'Label created', label });
    } catch (error) {
        res.status(500).json({ message: 'Error creating expense label', error });
    }
};

export const updateExpenseLabel = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ message: 'ID label tidak valid' });
        }

        const label = await ExpenseLabel.findByPk(id);
        if (!label) {
            return res.status(404).json({ message: 'Label tidak ditemukan' });
        }

        const nextName = toSafeText(req.body?.name);
        const description = toSafeText(req.body?.description);
        if (!nextName) {
            return res.status(400).json({ message: 'Nama label wajib diisi' });
        }

        const existingLabels = await ExpenseLabel.findAll({
            where: { id: { [Op.ne]: id } },
            attributes: ['name']
        });
        const hasDuplicate = existingLabels.some((item) => item.name.toLowerCase() === nextName.toLowerCase());
        if (hasDuplicate) {
            return res.status(409).json({ message: 'Nama label sudah digunakan' });
        }

        await label.update({
            name: nextName,
            description: description || null
        });
        res.json({ message: 'Label updated', label });
    } catch (error) {
        res.status(500).json({ message: 'Error updating expense label', error });
    }
};

export const deleteExpenseLabel = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ message: 'ID label tidak valid' });
        }

        const label = await ExpenseLabel.findByPk(id);
        if (!label) {
            return res.status(404).json({ message: 'Label tidak ditemukan' });
        }

        await label.destroy();
        res.json({ message: 'Label deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting expense label', error });
    }
};

// --- Reports ---
export const getAccountsReceivable = async (req: Request, res: Response) => {
    try {
        // 1. Get AR from Invoices (payment_status != 'paid')
        const ar = await Invoice.findAll({
            where: {
                payment_status: { [Op.ne]: 'paid' } // unpaid, cod_pending
            },
            include: buildAccountsReceivableInclude(),
            order: [['createdAt', 'ASC']] // Oldest first
        });

        const invoiceRows = mapAccountsReceivableRows(ar);

        // 2. Get Driver Debts (User.debt > 0)
        const debtors = await User.findAll({
            where: {
                role: 'driver',
                debt: { [Op.gt]: 0 }
            },
            attributes: ['id', 'name', 'whatsapp_number', 'debt', 'updatedAt']
        });

        const driverRows = debtors.map(driver => {
            const debt = Number(driver.debt || 0);
            const updatedAtMs = new Date(driver.updatedAt).getTime();
            const agingDays = Math.max(0, Math.floor((Date.now() - updatedAtMs) / (24 * 60 * 60 * 1000)));

            return {
                id: `debt-${driver.id}`,
                invoice_number: `UTANG-DRIVER-${driver.name.toUpperCase().replace(/\s+/g, '-')}`,
                payment_method: 'cod_settlement',
                payment_status: 'debt',
                payment_proof_url: null,
                amount_paid: 0,
                amount_due: debt,
                aging_days: agingDays,
                createdAt: driver.updatedAt,
                updatedAt: driver.updatedAt,
                verified_at: null,
                order: {
                    id: 'DEBT',
                    customer_name: `Driver: ${driver.name}`,
                    source: 'offline',
                    status: 'active',
                    total_amount: debt,
                    createdAt: driver.updatedAt,
                    updatedAt: driver.updatedAt,
                    expiry_date: null,
                    customer: {
                        id: driver.id,
                        name: driver.name,
                        whatsapp_number: driver.whatsapp_number
                    },
                    items: []
                }
            };
        });

        res.json([...invoiceRows, ...driverRows]);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching AR', error });
    }
};

export const getAccountsReceivableDetail = async (req: Request, res: Response) => {
    try {
        const invoiceId = String(req.params.id || '').trim();
        if (!invoiceId) {
            return res.status(400).json({ message: 'invoice id wajib diisi' });
        }

        // Handle pseudo-ID for driver debt
        if (invoiceId.startsWith('debt-')) {
            const driverId = invoiceId.replace('debt-', '');
            const driver = await User.findOne({
                where: {
                    id: driverId,
                    role: 'driver',
                    debt: { [Op.gt]: 0 }
                },
                attributes: ['id', 'name', 'whatsapp_number', 'debt', 'updatedAt']
            });

            if (!driver) {
                return res.status(404).json({ message: 'Data piutang driver tidak ditemukan' });
            }

            const debt = Number(driver.debt || 0);
            const updatedAtMs = new Date(driver.updatedAt).getTime();
            const agingDays = Math.max(0, Math.floor((Date.now() - updatedAtMs) / (24 * 60 * 60 * 1000)));

            const row = {
                id: invoiceId,
                invoice_number: `UTANG-DRIVER-${driver.name.toUpperCase().replace(/\s+/g, '-')}`,
                payment_method: 'cod_settlement',
                payment_status: 'debt',
                payment_proof_url: null,
                amount_paid: 0,
                amount_due: debt,
                aging_days: agingDays,
                createdAt: driver.updatedAt,
                updatedAt: driver.updatedAt,
                verified_at: null,
                order: {
                    id: 'DEBT',
                    customer_name: `Driver: ${driver.name}`,
                    source: 'offline',
                    status: 'active',
                    total_amount: debt,
                    createdAt: driver.updatedAt,
                    updatedAt: driver.updatedAt,
                    expiry_date: null,
                    customer: {
                        id: driver.id,
                        name: driver.name,
                        whatsapp_number: driver.whatsapp_number
                    },
                    items: []
                }
            };
            return res.json(row);
        }

        const invoice = await Invoice.findOne({
            where: {
                id: invoiceId,
                payment_status: { [Op.ne]: 'paid' }
            },
            include: buildAccountsReceivableInclude()
        });

        if (!invoice) {
            return res.status(404).json({ message: 'Data piutang tidak ditemukan' });
        }

        const [row] = mapAccountsReceivableRows([invoice]);
        return res.json(row);
    } catch (error) {
        return res.status(500).json({ message: 'Error fetching AR detail', error });
    }
};

export const getProfitAndLoss = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate } = req.query;

        const dateFilter: any = {};
        if (startDate && endDate) {
            dateFilter[Op.between] = [new Date(startDate as string), new Date(endDate as string)];
        }

        // 1. Revenue (Completed Sales)
        // Orders where status = completed? Or just Paid invoices?
        // Revenue is recognized when delivered or when paid?
        // Simple PnL: Sales (Paid Invoices) - COGS - Expenses

        const sales = await Invoice.sum('amount_paid', {
            where: {
                payment_status: 'paid',
                verified_at: dateFilter // Using verified_at instead of updatedAt
            }
        }) || 0;

        // 2. COGS (Cost of Goods Sold)
        // Need to join OrderItem -> Order -> Invoice
        // Difficult to sum across join directly with Sequelize sum helper cleanly on filtered join.
        // Let's use raw query or findAll logic.
        // For PnL scale, Raw Query is better for aggregation.

        // Approach: Find all Paid Orders in date range. Sum their OrderItems.cost_at_purchase * qty.
        // Let's stick to Sequelize logic for consistency, might be slower but safer type-wise.

        const paidOrders = await Order.findAll({
            include: [{
                model: Invoice,
                where: { payment_status: 'paid', verified_at: dateFilter }
            }, {
                model: OrderItem
            }]
        });

        let cogs = 0;
        paidOrders.forEach(order => {
            if (order.OrderItems) { // OrderItems logic isn't strictly typed on instance by default in all setups, but here we included it
                // OrderItems is usually loaded as array. 
                (order as any).OrderItems.forEach((item: any) => {
                    cogs += (Number(item.cost_at_purchase) * Number(item.qty));
                });
            }
        });

        // 3. Expenses
        const opex = await Expense.sum('amount', {
            where: {
                date: dateFilter
            }
        }) || 0;

        const grossProfit = Number(sales) - cogs;
        const netProfit = grossProfit - Number(opex);

        res.json({
            period: { startDate, endDate },
            revenue: Number(sales),
            cogs,
            gross_profit: grossProfit,
            expenses: Number(opex),
            net_profit: netProfit
        });

    } catch (error) {
        res.status(500).json({ message: 'Error calculating P&L', error });
    }
};

// --- Driver COD Deposit ---

export const getDriverCodList = async (req: Request, res: Response) => {
    try {
        // 1. Get drivers with debt > 0
        const debtors = await User.findAll({
            where: {
                role: 'driver',
                debt: { [Op.gt]: 0 }
            },
            attributes: ['id', 'name', 'whatsapp_number', 'debt']
        });

        // 2. Get pending invoices
        const invoices = await Invoice.findAll({
            where: { payment_status: 'cod_pending' },
            include: [{
                model: Order,
                include: [{
                    model: User,
                    as: 'Courier',
                    attributes: ['id', 'name', 'whatsapp_number', 'debt']
                }, {
                    model: User,
                    as: 'Customer',
                    attributes: ['id', 'name']
                }]
            }]
        });

        const grouped: Record<string, any> = {};

        // Initialize from debtors
        debtors.forEach(driver => {
            grouped[driver.id] = {
                driver: {
                    id: driver.id,
                    name: driver.name,
                    whatsapp_number: driver.whatsapp_number,
                    debt: Number(driver.debt || 0)
                },
                orders: [],
                total_pending: 0
            };
        });

        // Merge/Add from invoices
        invoices.forEach((inv) => {
            const order = (inv as any).Order;
            const courier = order?.Courier;

            if (!courier) return;

            if (!grouped[courier.id]) {
                grouped[courier.id] = {
                    driver: {
                        id: courier.id,
                        name: courier.name,
                        whatsapp_number: courier.whatsapp_number,
                        debt: Number(courier.debt || 0)
                    },
                    orders: [],
                    total_pending: 0
                };
            }

            const amount = Number(order.total_amount || 0);
            grouped[courier.id].orders.push({
                id: order.id,
                order_number: order.id,
                customer_name: order.Customer?.name || 'Customer',
                total_amount: amount,
                created_at: order.createdAt
            });
            grouped[courier.id].total_pending += amount;
        });

        res.json(Object.values(grouped));
    } catch (error) {
        res.status(500).json({ message: 'Error fetching driver COD list', error });
    }
};

export const verifyDriverCod = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { driver_id, order_ids = [], amount_received } = req.body;
        const verifierId = req.user!.id;

        if (!driver_id) {
            await t.rollback();
            return res.status(400).json({ message: 'Driver ID required' });
        }

        const received = Number(amount_received);
        if (isNaN(received) || received < 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Jumlah uang tidak valid' });
        }

        if ((!order_ids || order_ids.length === 0) && received === 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Tidak ada order dipilih dan tidak ada pembayaran.' });
        }

        let invoices: any[] = [];
        let totalExpected = 0;

        if (order_ids && order_ids.length > 0) {
            const pendingInvoices = await Invoice.findAll({
                where: {
                    payment_status: 'cod_pending'
                },
                include: [{
                    model: Order,
                    where: {
                        id: { [Op.in]: order_ids },
                        courier_id: driver_id
                    }
                }],
                transaction: t,
                lock: t.LOCK.UPDATE
            });

            if (pendingInvoices.length !== order_ids.length) {
                await t.rollback();
                return res.status(409).json({ message: 'Beberapa pesanan tidak ditemukan atau statusnya bukan COD Pending' });
            }

            invoices = pendingInvoices;
            invoices.forEach((inv: any) => {
                totalExpected += Number(inv.Order.total_amount || 0);
            });
        }

        const diff = received - totalExpected;
        // diff < 0 : Shortage -> Driver Debt increases
        // diff > 0 : Surplus -> Driver Debt decreases (pay off)

        const driver = await User.findByPk(driver_id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!driver) {
            await t.rollback();
            return res.status(404).json({ message: 'Driver tidak ditemukan' });
        }

        const previousDebt = Number(driver.debt || 0);
        const newDebt = previousDebt - received;

        await driver.update({ debt: newDebt }, { transaction: t });

        if (invoices.length > 0) {
            // New logic: Find pending CodCollections for these invoices
            const invoiceIds = invoices.map(i => i.id);
            const collections = await CodCollection.findAll({
                where: {
                    invoice_id: { [Op.in]: invoiceIds },
                    driver_id: driver_id,
                    status: 'collected'
                },
                transaction: t
            });

            const collectionSum = collections.reduce((acc, c) => acc + Number(c.amount), 0);

            // Create Settlement
            const settlement = await CodSettlement.create({
                driver_id: driver_id,
                total_amount: received,
                received_by: verifierId,
                settled_at: new Date()
            }, { transaction: t });

            // Mark collections as settled
            if (collections.length > 0) {
                await CodCollection.update({
                    status: 'settled',
                    settlement_id: settlement.id
                }, {
                    where: { id: { [Op.in]: collections.map(c => c.id) } },
                    transaction: t
                });
            }

            // Update Invoices -> Paid
            await Invoice.update({
                payment_status: 'paid',
                verified_at: new Date(),
                verified_by: verifierId
            }, {
                where: { id: { [Op.in]: invoiceIds } },
                transaction: t
            });

            // Update Orders -> Completed
            await Order.update({
                status: 'completed'
            }, {
                where: { id: { [Op.in]: order_ids } },
                transaction: t
            });

            // --- Journal Entry for Settlement (Cash vs Piutang vs Revenue) ---
            // 1. Revenue & Payment
            if (totalExpected > 0 || received > 0) {
                const cashAcc = await Account.findOne({ where: { code: '1101' }, transaction: t });
                const piutangAcc = await Account.findOne({ where: { code: '1103' }, transaction: t });
                const revenueAcc = await Account.findOne({ where: { code: '4100' }, transaction: t });

                if (cashAcc && piutangAcc && revenueAcc) {
                    const journalLines: any[] = [];

                    // a. Cash Received
                    if (received > 0) {
                        journalLines.push({ account_id: cashAcc.id, debit: received, credit: 0 });

                        // b. Reduce Piutang (Clearing the balance created at Delivery)
                        journalLines.push({ account_id: piutangAcc.id, debit: 0, credit: received });
                    }

                    if (journalLines.length >= 2) {
                        await JournalService.createEntry({
                            description: `Setoran COD Settlement #${settlement.id} (Driver: ${driver.name})`,
                            reference_type: 'cod_settlement',
                            reference_id: settlement.id.toString(),
                            created_by: verifierId,
                            lines: journalLines
                        }, t);
                    }
                }

                // 2. COGS (HPP vs Inventory)
                if (invoices.length > 0) {
                    // Collect Order IDs
                    const settledOrderIds = invoices.map(inv => inv.Order.id);

                    // Fetch items & allocations for these orders
                    const orderItems = await OrderItem.findAll({
                        where: { order_id: { [Op.in]: settledOrderIds } },
                        include: [],
                        transaction: t
                    });
                    // Note: OrderAllocations might be gone if we cleared them? 
                    // Usually we keep them or move to 'shipped'. Assuming OrderAllocation persists or we use item.cost_at_purchase directly.
                    // The COGS logic in verifyPayment used allocations to verify quantity, but items have qty too.
                    // Let's rely on OrderItem cost_at_purchase * qty.
                    // IMPORTANT: cost_at_purchase is stored on OrderItem.

                    let totalCost = 0;
                    orderItems.forEach(item => {
                        totalCost += Number(item.cost_at_purchase || 0) * Number(item.qty || 0);
                    });

                    if (totalCost > 0) {
                        const hppAcc = await Account.findOne({ where: { code: '5100' }, transaction: t });
                        const inventoryAcc = await Account.findOne({ where: { code: '1300' }, transaction: t });

                        if (hppAcc && inventoryAcc) {
                            await JournalService.createEntry({
                                description: `HPP untuk COD Settlement #${settlement.id}`,
                                reference_type: 'cod_settlement',
                                reference_id: settlement.id.toString(),
                                created_by: verifierId,
                                lines: [
                                    { account_id: hppAcc.id, debit: totalCost, credit: 0 },
                                    { account_id: inventoryAcc.id, debit: 0, credit: totalCost }
                                ]
                            }, t);
                        }
                    }
                }
            }
        }

        await t.commit();

        res.json({
            message: 'Setoran COD berhasil dikonfirmasi',
            summary: {
                total_expected: totalExpected,
                received: received,
                shortage: diff < 0 ? Math.abs(diff) : 0,
                surplus: diff > 0 ? diff : 0,
                driver_debt_before: previousDebt,
                driver_debt_after: newDebt
            },
            settlement: invoices.length > 0 ? 'created' : 'skipped'
        });

    } catch (error) {
        try { await t.rollback(); } catch { }
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ message: 'Error verifying driver COD', error: errMsg });
    }
};

// --- Journals ---
export const getJournals = async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 50, startDate, endDate } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const where: any = {};
        if (startDate && endDate) {
            where.date = { [Op.between]: [startDate, endDate] };
        }

        const journals = await Journal.findAndCountAll({
            where,
            include: [{ model: JournalLine, as: 'Lines', include: [{ model: Account, as: 'Account' }] }],
            limit: Number(limit),
            offset: Number(offset),
            order: [['date', 'DESC'], ['id', 'DESC']]
        });

        res.json({
            total: journals.count,
            totalPages: Math.ceil(journals.count / Number(limit)),
            currentPage: Number(page),
            journals: journals.rows
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching journals', error });
    }
};

// --- Accounting Periods & Adjustments ---

export const getAccountingPeriods = async (req: Request, res: Response) => {
    try {
        const periods = await AccountingPeriod.findAll({
            order: [['year', 'DESC'], ['month', 'DESC']]
        });
        res.json(periods);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching periods', error });
    }
};

export const closeAccountingPeriod = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { month, year } = req.body;
        const userId = req.user!.id;

        if (!month || !year) {
            await t.rollback();
            return res.status(400).json({ message: 'Month dan Year wajib diisi' });
        }

        const [period, created] = await AccountingPeriod.findOrCreate({
            where: { month, year },
            defaults: {
                month,
                year,
                is_closed: true,
                closed_at: new Date(),
                closed_by: userId
            },
            transaction: t
        });

        if (!created && period.is_closed) {
            await t.rollback();
            return res.status(400).json({ message: 'Periode sudah ditutup sebelumnya' });
        }

        if (!created) {
            await period.update({
                is_closed: true,
                closed_at: new Date(),
                closed_by: userId
            }, { transaction: t });
        }

        await t.commit();
        res.json({ message: `Periode ${month}/${year} berhasil ditutup`, period });
    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error closing period', error });
    }
};

export const createAdjustmentJournal = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { date, description, lines } = req.body;
        const userId = req.user!.id;

        if (!lines || !Array.isArray(lines) || lines.length < 2) {
            await t.rollback();
            return res.status(400).json({ message: 'Journal adjustment minimal 2 baris (Debit/Credit)' });
        }

        // Use createAdjustmentEntry which bypasses period lock enforcement 
        // OR enforces strict "Adjustment Only" logic
        const journal = await JournalService.createAdjustmentEntry({
            date: date ? new Date(date) : new Date(),
            description: `[ADJUSTMENT] ${description}`,
            reference_type: 'adjustment', // Custom type
            created_by: userId,
            lines
        }, t);

        await t.commit();
        res.status(201).json({ message: 'Adjustment journal created', journal });
    } catch (error) {
        try { await t.rollback(); } catch { }
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ message: 'Error creating adjustment', error: msg });
    }
};
