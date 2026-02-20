import { Request, Response } from 'express';
import { Order, OrderItem, Invoice, Product, OrderIssue, sequelize, User, CustomerProfile, Retur, CodCollection, InvoiceItem } from '../models';
import { JournalService } from '../services/JournalService';
import { Op } from 'sequelize';
import { AccountingPostingService } from '../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitOrderStatusChanged, emitReturStatusChanged } from '../utils/orderNotification';
import { attachInvoicesToOrders, findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../utils/invoiceLookup';

const FINAL_ORDER_STATUSES = new Set(['delivered', 'completed', 'canceled', 'cancelled']);
const COURIER_OWNERSHIP_REQUIRED_STATUSES = new Set(['ready_to_ship', 'shipped']);
const isDeadlockError = (error: any): boolean => {
    const code = error?.parent?.code || error?.original?.code || error?.code;
    return code === 'ER_LOCK_DEADLOCK';
};

export const getAssignedOrders = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id; // Driver ID
        const { status, startDate, endDate } = req.query;

        const whereClause: any = { courier_id: userId };

        // If status specified, filter. Else show active deliveries?
        if (status) {
            const statusStr = String(status);
            if (statusStr.includes(',')) {
                whereClause.status = { [Op.in]: statusStr.split(',').map(s => s.trim()) };
            } else {
                whereClause.status = status;
            }
        } else {
            // Default to active assignments
            whereClause.status = { [Op.in]: ['ready_to_ship', 'shipped'] };
        }

        if (startDate || endDate) {
            const dateFilter: any = {};
            if (startDate) {
                const start = new Date(String(startDate));
                start.setHours(0, 0, 0, 0);
                dateFilter[Op.gte] = start;
            }
            if (endDate) {
                const end = new Date(String(endDate));
                end.setHours(23, 59, 59, 999);
                dateFilter[Op.lte] = end;
            }
            whereClause.updatedAt = dateFilter;
        }

        const orders = await Order.findAll({
            where: whereClause,
            include: [
                { model: OrderItem, include: [Product] },
                {
                    model: User,
                    as: 'Customer',
                    include: [{ model: CustomerProfile }]
                }
            ],
            order: [['updatedAt', 'DESC']]
        });

        const plainOrders = orders.map((order: any) => order.get({ plain: true }) as any);
        const ordersWithInvoices = await attachInvoicesToOrders(plainOrders);

        res.json(ordersWithInvoices);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching assigned orders', error });
    }
};

export const completeDelivery = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params; // Order ID
        const userId = req.user!.id;
        const file = req.file; // Uploaded proof

        // Check ownership
        const order = await Order.findOne({
            where: { id, courier_id: userId }
        });

        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Order not found or not assigned to you' });
        }

        const invoice = await findLatestInvoiceByOrderId(String(id), { transaction: t });
        if (!invoice) {
            await t.rollback();
            return res.status(400).json({ message: 'Invoice missing' });
        }
        const previousOrderStatus = String(order.status || '');

        if (invoice.payment_method === 'cod') {
            await AccountingPostingService.postGoodsOutForOrder(order.id, String(userId), t, 'cod');
        }

        const paymentMethod = String(invoice.payment_method || '').toLowerCase();
        const paymentStatus = String(invoice.payment_status || '').toLowerCase();
        const nextOrderStatus =
            (paymentMethod === 'cod' && paymentStatus === 'cod_pending')
                || (paymentMethod === 'transfer_manual' && paymentStatus === 'paid')
                || (paymentMethod === 'cash_store' && paymentStatus === 'paid')
                ? 'completed'
                : 'delivered';

        // Save delivery proof photo to order (separate from payment proof)
        const updatePayload: any = { status: nextOrderStatus };
        if (file) {
            updatePayload.delivery_proof_url = file.path;
        }
        await order.update(updatePayload, { transaction: t });

        await t.commit();
        emitOrderStatusChanged({
            order_id: String(order.id),
            from_status: previousOrderStatus,
            to_status: nextOrderStatus,
            source: String(order.source || ''),
            payment_method: String(invoice.payment_method || ''),
            courier_id: String(order.courier_id || userId),
            triggered_by_role: String(req.user?.role || 'driver'),
            target_roles: nextOrderStatus === 'completed' ? ['admin_finance', 'customer'] : ['admin_finance'],
        });
        res.json({ message: `Delivery ${nextOrderStatus === 'completed' ? 'completed' : 'marked delivered'}` });
    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: 'Error completing delivery', error });
    }
};

export const recordPayment = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params;
        const userId = req.user!.id;
        const file = req.file;
        const rawAmount = req.body?.amount_received ?? req.body?.amount;

        const order = await Order.findOne({
            where: { id, courier_id: userId },
            transaction: t
        });
        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Order tidak ditemukan atau tidak ditugaskan ke driver ini.' });
        }

        const invoice = await findLatestInvoiceByOrderId(String(id), { transaction: t });
        if (!invoice) {
            await t.rollback();
            return res.status(400).json({ message: 'Invoice tidak ditemukan.' });
        }

        if (invoice.payment_method !== 'cod') {
            await t.rollback();
            return res.status(400).json({ message: 'Metode pembayaran bukan COD.' });
        }

        if (invoice.payment_status === 'paid') {
            await t.rollback();
            return res.status(409).json({ message: 'Invoice sudah lunas.' });
        }

        const invoiceTotal = Number(invoice.total || order.total_amount || 0);
        const parsedAmount = rawAmount === undefined || rawAmount === null || String(rawAmount).trim() === ''
            ? invoiceTotal
            : Number(rawAmount);
        if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Jumlah pembayaran tidak valid.' });
        }
        const amountReceived = parsedAmount;
        if (Math.abs(amountReceived - invoiceTotal) > 0.01) {
            await t.rollback();
            return res.status(400).json({ message: 'Nominal pembayaran harus sesuai total invoice.' });
        }

        const existingCollection = await CodCollection.findOne({
            where: { invoice_id: invoice.id, driver_id: userId, status: 'collected' },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        const previousAmount = existingCollection ? Number(existingCollection.amount || 0) : 0;
        const delta = amountReceived - previousAmount;

        if (existingCollection) {
            await existingCollection.update({ amount: amountReceived }, { transaction: t });
        } else {
            await CodCollection.create({
                invoice_id: invoice.id,
                driver_id: userId,
                amount: amountReceived,
                status: 'collected'
            }, { transaction: t });
        }

        if (delta !== 0) {
            const driver = await User.findByPk(userId, { transaction: t, lock: t.LOCK.UPDATE });
            if (!driver) {
                await t.rollback();
                return res.status(404).json({ message: 'Driver tidak ditemukan.' });
            }
            const previousDebt = Number(driver.debt || 0);
            const nextDebt = Math.max(0, previousDebt + delta);
            await driver.update({ debt: nextDebt }, { transaction: t });
        }

        const invoiceUpdate: any = {
            payment_status: 'cod_pending',
            amount_paid: amountReceived
        };
        if (file) {
            invoiceUpdate.payment_proof_url = file.path;
        }
        await invoice.update(invoiceUpdate, { transaction: t });

        const relatedOrderIds = await findOrderIdsByInvoiceId(String(invoice.id), { transaction: t });
        if (invoice.order_id) {
            relatedOrderIds.push(String(invoice.order_id));
        }
        const uniqueOrderIds = Array.from(new Set(relatedOrderIds.filter(Boolean)));
        const relatedOrders = uniqueOrderIds.length > 0
            ? await Order.findAll({
                where: { id: { [Op.in]: uniqueOrderIds } },
                transaction: t,
                lock: t.LOCK.UPDATE
            })
            : [order];
        const previousStatusByOrderId: Record<string, string> = {};
        relatedOrders.forEach((row: any) => {
            previousStatusByOrderId[String(row.id)] = String(row.status || '');
        });

        const deliveredOrderIds = relatedOrders
            .filter((row: any) => String(row.status || '') === 'delivered')
            .map((row: any) => String(row.id));
        if (deliveredOrderIds.length > 0) {
            await Order.update(
                { status: 'completed' },
                { where: { id: { [Op.in]: deliveredOrderIds } }, transaction: t }
            );
        }

        await t.commit();
        emitAdminRefreshBadges();
        deliveredOrderIds.forEach((orderId) => {
            const prevStatus = previousStatusByOrderId[orderId] || '';
            if (prevStatus === 'completed') return;
            emitOrderStatusChanged({
                order_id: orderId,
                from_status: prevStatus || null,
                to_status: 'completed',
                source: String(order.source || ''),
                payment_method: String(invoice.payment_method || ''),
                courier_id: String(order.courier_id || userId),
                triggered_by_role: String(req.user?.role || 'driver'),
                target_roles: ['admin_finance', 'customer', 'driver'],
                target_user_ids: [String(userId)],
            });
        });

        return res.json({
            message: 'Pembayaran COD berhasil dicatat.',
            invoice_id: invoice.id,
            amount_received: amountReceived
        });
    } catch (error) {
        await t.rollback();
        return res.status(500).json({ message: 'Gagal mencatat pembayaran.', error });
    }
};

export const updatePaymentMethod = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    const safeRollback = async () => {
        if (!(t as any).finished) {
            await t.rollback();
        }
    };
    try {
        const { id } = req.params;
        const userId = req.user!.id;
        const rawMethod = String(req.body?.payment_method || '').trim().toLowerCase();
        if (!['cod', 'transfer_manual'].includes(rawMethod)) {
            await safeRollback();
            return res.status(400).json({ message: 'Metode pembayaran tidak valid.' });
        }
        const nextMethod = rawMethod as 'cod' | 'transfer_manual';

        const order = await Order.findOne({
            where: { id, courier_id: userId },
            transaction: t
        });
        if (!order) {
            await safeRollback();
            return res.status(404).json({ message: 'Order tidak ditemukan atau tidak ditugaskan ke driver ini.' });
        }

        const invoice = await findLatestInvoiceByOrderId(String(id), { transaction: t });
        if (!invoice) {
            await safeRollback();
            return res.status(400).json({ message: 'Invoice tidak ditemukan.' });
        }

        if (invoice.payment_status === 'paid') {
            await safeRollback();
            return res.status(409).json({ message: 'Invoice sudah lunas, metode pembayaran tidak bisa diubah.' });
        }

        if (invoice.payment_status === 'cod_pending' && invoice.payment_method !== nextMethod) {
            await safeRollback();
            return res.status(409).json({ message: 'Pembayaran COD sudah dicatat, metode tidak bisa diubah.' });
        }

        const relatedOrderIds = await findOrderIdsByInvoiceId(String(invoice.id), { transaction: t });
        if (invoice.order_id) {
            relatedOrderIds.push(String(invoice.order_id));
        }
        const uniqueOrderIds = Array.from(new Set(relatedOrderIds.filter(Boolean)));
        if (uniqueOrderIds.length > 0) {
            const orders = await Order.findAll({
                where: { id: { [Op.in]: uniqueOrderIds } },
                transaction: t
            });
            const activeOrders = orders.filter((row) => {
                const status = String(row.status || '').toLowerCase();
                return !FINAL_ORDER_STATUSES.has(status);
            });
            const mismatchOrders = activeOrders.filter((row) => {
                const status = String(row.status || '').toLowerCase();
                if (!COURIER_OWNERSHIP_REQUIRED_STATUSES.has(status)) return false;
                const courierId = String(row.courier_id || '').trim();
                if (!courierId) return false;
                return courierId !== String(userId);
            });
            const hasMismatch = mismatchOrders.length > 0;
            if (hasMismatch) {
                await safeRollback();
                return res.status(403).json({
                    message: 'Metode pembayaran hanya bisa diubah oleh driver yang menangani semua order aktif di invoice.',
                    conflicting_order_ids: mismatchOrders.map((row) => String(row.id)),
                });
            }
        }

        await invoice.update({ payment_method: nextMethod }, { transaction: t });
        if (uniqueOrderIds.length > 0) {
            await Order.update(
                { payment_method: nextMethod },
                { where: { id: { [Op.in]: uniqueOrderIds } }, transaction: t }
            );
        }

        await t.commit();
        emitAdminRefreshBadges();

        return res.json({
            message: 'Metode pembayaran diperbarui.',
            payment_method: nextMethod
        });
    } catch (error) {
        await safeRollback();
        if (isDeadlockError(error)) {
            return res.status(409).json({
                message: 'Terjadi konflik transaksi saat ubah metode pembayaran. Silakan coba lagi.',
                code: 'PAYMENT_METHOD_DEADLOCK'
            });
        }
        console.error('[DriverController.updatePaymentMethod] Failed to update payment method', {
            order_id: String(req.params?.id || ''),
            driver_id: String(req.user?.id || ''),
            payment_method: String(req.body?.payment_method || ''),
            error: error instanceof Error ? error.message : String(error)
        });
        return res.status(500).json({ message: 'Gagal memperbarui metode pembayaran.', error });
    }
};

export const getDriverWallet = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;

        // Calculated COD exposure from open COD invoices (for audit/comparison).
        const orders = await Order.findAll({
            where: {
                courier_id: userId,
                status: { [Op.in]: ['delivered', 'completed'] }
            },
            attributes: ['id']
        });

        const orderIds = orders.map((order) => String(order.id));
        let totalCash = 0;
        const details = [];

        if (orderIds.length > 0) {
            const orderItems = await OrderItem.findAll({
                where: { order_id: { [Op.in]: orderIds } },
                attributes: ['id', 'order_id']
            });
            const orderItemIds = orderItems.map((item: any) => String(item.id));
            const orderItemToOrderId = new Map<string, string>();
            orderItems.forEach((item: any) => {
                orderItemToOrderId.set(String(item.id), String(item.order_id));
            });

            if (orderItemIds.length > 0) {
                const invoiceItems = await InvoiceItem.findAll({
                    where: { order_item_id: { [Op.in]: orderItemIds } },
                    include: [{
                        model: Invoice,
                        where: {
                            payment_method: 'cod',
                            payment_status: 'cod_pending'
                        },
                        required: true
                    }]
                });

                const invoiceMap = new Map<string, { invoice: any; orderIds: Set<string> }>();
                invoiceItems.forEach((item: any) => {
                    const invoice = item.Invoice;
                    if (!invoice) return;
                    const invoiceId = String(invoice.id);
                    const orderId = orderItemToOrderId.get(String(item.order_item_id)) || '';
                    const entry = invoiceMap.get(invoiceId) || { invoice, orderIds: new Set<string>() };
                    if (orderId) entry.orderIds.add(orderId);
                    invoiceMap.set(invoiceId, entry);
                });

                for (const entry of invoiceMap.values()) {
                    const inv = entry.invoice;
                    const invoiceTotal = Number(inv.total || 0);
                    const amount = Number(inv.amount_paid) > 0 ? Number(inv.amount_paid) : invoiceTotal;
                    totalCash += amount;
                    details.push({
                        order_id: Array.from(entry.orderIds)[0] || null,
                        invoice_number: inv.invoice_number,
                        amount,
                        order_ids: Array.from(entry.orderIds)
                    });
                }
            }
        }

        // Finance source of truth for driver settlement.
        const driverUser = await User.findByPk(userId, {
            attributes: ['id', 'name', 'debt']
        });
        const debtFromFinance = Number(driverUser?.debt || 0);

        res.json({
            driver_id: userId,
            // Keep backward compatibility: frontend reads cash_on_hand.
            // This now follows Finance debt value so numbers match Finance dashboard.
            cash_on_hand: debtFromFinance,
            debt: debtFromFinance,
            cod_pending_calculated: totalCash,
            orders: details
        });

    } catch (error) {
        res.status(500).json({ message: 'Error fetching wallet', error });
    }
};

export const reportIssue = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    let isCommitted = false;
    try {
        const { id } = req.params; // Order ID
        const noteRaw = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
        const checklistSnapshotRaw = typeof req.body?.checklist_snapshot === 'string'
            ? req.body.checklist_snapshot.trim()
            : '';
        const userId = req.user!.id;
        const evidence = req.file;

        if (noteRaw.length < 5) {
            await t.rollback();
            return res.status(400).json({ message: 'Catatan laporan wajib diisi minimal 5 karakter.' });
        }

        const order = await Order.findOne({
            where: { id, courier_id: userId },
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Order tidak ditemukan atau bukan tugas Anda' });
        }

        if (!['ready_to_ship', 'shipped'].includes(String(order.status || '').toLowerCase())) {
            await t.rollback();
            return res.status(409).json({ message: 'Laporan kekurangan hanya bisa dibuat pada order yang masih aktif dikirim.' });
        }

        let finalNote = noteRaw;
        if (checklistSnapshotRaw) {
            let normalizedSnapshot = checklistSnapshotRaw;
            try {
                const parsed = JSON.parse(checklistSnapshotRaw);
                normalizedSnapshot = JSON.stringify(parsed);
            } catch {
                // Keep raw snapshot as-is when it is not valid JSON.
            }
            if (normalizedSnapshot.length > 1800) {
                normalizedSnapshot = `${normalizedSnapshot.slice(0, 1800)}...`;
            }
            finalNote = `${noteRaw}\n\n[CHECKLIST_SNAPSHOT] ${normalizedSnapshot}`;
        }

        const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const previousStatus = String(order.status || '');
        const existingIssue = await OrderIssue.findOne({
            where: {
                order_id: String(id),
                issue_type: 'shortage',
                status: 'open'
            },
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (existingIssue) {
            await existingIssue.update({
                note: finalNote,
                due_at: dueAt,
                created_by: userId,
                evidence_url: evidence?.path || existingIssue.evidence_url || null,
                resolution_note: null,
            }, { transaction: t });
        } else {
            await OrderIssue.create({
                order_id: String(id),
                issue_type: 'shortage',
                status: 'open',
                note: finalNote,
                due_at: dueAt,
                created_by: userId,
                evidence_url: evidence?.path || null,
                resolution_note: null,
            }, { transaction: t });
        }

        await order.update({
            status: 'hold',
            courier_id: null as any,
        }, { transaction: t });

        await t.commit();
        isCommitted = true;

        let paymentMethod: string | null = null;
        try {
            const invoice = await findLatestInvoiceByOrderId(String(order.id));
            paymentMethod = typeof invoice?.payment_method === 'string'
                ? String(invoice.payment_method)
                : null;
        } catch (invoiceLookupError) {
            console.warn('[DriverController.reportIssue] Invoice lookup failed after commit', {
                order_id: String(order.id),
                driver_id: String(userId),
                error: invoiceLookupError instanceof Error ? invoiceLookupError.message : String(invoiceLookupError)
            });
        }

        emitOrderStatusChanged({
            order_id: String(order.id),
            from_status: previousStatus || null,
            to_status: 'hold',
            source: String(order.source || ''),
            payment_method: paymentMethod,
            courier_id: null,
            triggered_by_role: String(req.user?.role || 'driver'),
            target_roles: ['admin_gudang', 'super_admin'],
        });
        res.json({ message: 'Masalah berhasil dilaporkan' });
    } catch (error) {
        if (!isCommitted) {
            await t.rollback();
        }
        console.error('[DriverController.reportIssue] Failed to submit driver issue report', {
            order_id: String(req.params?.id || ''),
            driver_id: String(req.user?.id || ''),
            driver_role: String(req.user?.role || ''),
            error: error instanceof Error ? error.message : String(error)
        });
        res.status(500).json({ message: 'Gagal melaporkan masalah', error });
    }
};

export const getAssignedReturs = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;
        const returs = await Retur.findAll({
            where: {
                courier_id: userId,
                status: { [Op.in]: ['pickup_assigned', 'picked_up', 'handed_to_warehouse'] }
            },
            include: [
                { model: Product, attributes: ['name', 'sku'] },
                {
                    model: User,
                    as: 'Creator',
                    attributes: ['id', 'name', 'whatsapp_number'],
                    include: [{ model: CustomerProfile }]
                },
                { model: Order, attributes: ['id', 'status'] }
            ],
            order: [['updatedAt', 'DESC']]
        });
        res.json(returs);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching assigned returns', error });
    }
};

export const getAssignedReturDetail = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;
        const id = String(req.params.id || '');

        if (!id) {
            return res.status(400).json({ message: 'Retur ID wajib diisi' });
        }

        const retur = await Retur.findOne({
            where: {
                id,
                courier_id: userId
            },
            include: [
                { model: Product, attributes: ['id', 'name', 'sku'] },
                {
                    model: User,
                    as: 'Creator',
                    attributes: ['id', 'name', 'whatsapp_number'],
                    include: [{ model: CustomerProfile }]
                },
                { model: Order, attributes: ['id', 'status', 'total_amount'] },
                { model: User, as: 'Courier', attributes: ['id', 'name', 'whatsapp_number'] }
            ]
        });

        if (!retur) {
            return res.status(404).json({ message: 'Retur tidak ditemukan atau bukan tugas Anda' });
        }

        return res.json(retur);
    } catch (error) {
        return res.status(500).json({ message: 'Error fetching retur detail', error });
    }
};

export const updateAssignedReturStatus = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const driverAllowedStatuses = ['picked_up', 'handed_to_warehouse'] as const;
        type DriverAllowedReturStatus = (typeof driverAllowedStatuses)[number];
        const isDriverAllowedReturStatus = (value: string): value is DriverAllowedReturStatus =>
            (driverAllowedStatuses as readonly string[]).includes(value);

        const userId = req.user!.id;
        const id = String(req.params.id || '');
        const requestedStatus = String(req.body?.status || '').trim();

        if (!id || !requestedStatus) {
            await t.rollback();
            return res.status(400).json({ message: 'Retur ID dan status wajib diisi' });
        }

        if (!isDriverAllowedReturStatus(requestedStatus)) {
            await t.rollback();
            return res.status(400).json({ message: 'Status tidak valid untuk aksi driver' });
        }
        const nextStatus: DriverAllowedReturStatus = requestedStatus;

        const retur = await Retur.findOne({
            where: {
                id,
                courier_id: userId
            },
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (!retur) {
            await t.rollback();
            return res.status(404).json({ message: 'Retur tidak ditemukan atau bukan tugas Anda' });
        }

        if (nextStatus === 'picked_up' && retur.status !== 'pickup_assigned') {
            await t.rollback();
            return res.status(409).json({ message: 'Barang hanya bisa dipickup dari status pickup_assigned' });
        }

        if (nextStatus === 'handed_to_warehouse' && retur.status !== 'picked_up') {
            await t.rollback();
            return res.status(409).json({ message: 'Barang hanya bisa diserahkan ke kasir setelah pickup' });
        }

        const previousStatus = String(retur.status || '');
        await retur.update({ status: nextStatus }, { transaction: t });
        await t.commit();
        emitReturStatusChanged({
            retur_id: String(retur.id),
            order_id: String(retur.order_id),
            from_status: previousStatus || null,
            to_status: nextStatus,
            courier_id: String(retur.courier_id || userId),
            triggered_by_role: String(req.user?.role || 'driver'),
            target_roles: ['driver', 'kasir', 'admin_finance', 'customer', 'super_admin'],
            target_user_ids: [String(userId)],
        });

        return res.json({
            message: nextStatus === 'picked_up'
                ? 'Pickup barang retur berhasil dikonfirmasi'
                : 'Penyerahan barang ke kasir berhasil dikonfirmasi',
            retur
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        const err: any = error;
        const detail = String(err?.original?.sqlMessage || err?.message || '');
        const enumMismatch = detail.includes("Data truncated for column 'status'")
            || detail.includes("Incorrect enum value")
            || detail.includes("Unknown column 'status'")
            || detail.includes("Column 'status'");
        if (enumMismatch) {
            return res.status(409).json({
                message: 'Status retur belum sinkron di database. Restart backend untuk sinkronisasi enum status retur.',
                detail
            });
        }
        return res.status(500).json({ message: 'Error updating retur task status', error });
    }
};
