import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Order, OrderItem, Invoice, Product, OrderIssue, sequelize, User, CustomerProfile, Retur, CodCollection, InvoiceItem } from '../../models';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitOrderStatusChanged, emitReturStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders, findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../../utils/invoiceLookup';
import { isDeadlockError, FINAL_ORDER_STATUSES, COURIER_OWNERSHIP_REQUIRED_STATUSES } from './utils';

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

