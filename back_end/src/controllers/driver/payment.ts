import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Order, OrderItem, Invoice, Product, OrderIssue, sequelize, User, CustomerProfile, Retur, CodCollection, InvoiceItem } from '../../models';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitOrderStatusChanged, emitReturStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders, findInvoicesByOrderId, findLatestInvoiceByOrderId, findOrderIdsByInvoiceId, findOrderByIdOrInvoiceId } from '../../utils/invoiceLookup';
import { isDeadlockError, FINAL_ORDER_STATUSES, COURIER_OWNERSHIP_REQUIRED_STATUSES } from './utils';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';
import { beginIdempotentRequest, clearIdempotentRequest, commitIdempotentRequest, getIdempotencyKey } from '../../utils/idempotency';
import { isOrderTransitionAllowed } from '../../utils/orderTransitions';
import { calculateDriverCodExposure } from '../../utils/codExposure';
import { computeInvoiceNetTotals } from '../../utils/invoiceNetTotals';
import { recordOrderStatusChanged } from '../../utils/orderEvent';
import { parseMoneyInput } from '../../utils/money';

export const recordPayment = asyncWrapper(async (req: Request, res: Response) => {
    const idempotencyKey = getIdempotencyKey(req);
    const idempotencyScope = `driver_record_payment:${String(req.user?.id || '')}:${String(req.params?.id || '')}`;
    if (idempotencyKey) {
        const decision = await beginIdempotentRequest(idempotencyKey, idempotencyScope);
        if (decision.action === 'replay') {
            return res.status(Number(decision.statusCode || 200)).json(decision.payload);
        }
        if (decision.action === 'conflict') {
            throw new CustomError('Permintaan pembayaran duplikat sedang diproses', 409);
        }
    }

    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const t = await sequelize.transaction();
        try {
            const { id } = req.params;
            const userId = req.user!.id;
            const file = req.file;
            const rawAmount = req.body?.amount_received ?? req.body?.amount;

            const order = await findOrderByIdOrInvoiceId(String(id), userId, { transaction: t });
            if (!order) {
                await t.rollback();
                throw new CustomError('Order atau invoice tidak ditemukan atau tidak ditugaskan ke driver ini.', 404);
            }

            const allInvoices = await findInvoicesByOrderId(String(order.id), { transaction: t });
            const unpaidCodInvoices = allInvoices.filter((inv: any) => {
                const paymentMethod = String(inv.payment_method || '').trim().toLowerCase();
                const paymentStatus = String(inv.payment_status || '').trim().toLowerCase();
                return paymentMethod === 'cod' && ['unpaid', 'draft'].includes(paymentStatus);
            });

            if (unpaidCodInvoices.length === 0) {
                const alreadyPending = allInvoices.some((inv: any) => inv.payment_method === 'cod' && inv.payment_status === 'cod_pending');
                if (alreadyPending) {
                    await t.rollback();
                    throw new CustomError('Pembayaran COD sudah dicatat sebelumnya.', 409);
                }
                await t.rollback();
                throw new CustomError('Tidak ada invoice COD yang perlu dibayar untuk order ini.', 400);
            }

            const netTotalsByInvoiceId = new Map<string, number>();
            let totalToPay = 0;
            for (const inv of unpaidCodInvoices as any[]) {
                const invId = String(inv?.id || '').trim();
                if (!invId) continue;
                const computed = await computeInvoiceNetTotals(invId, { transaction: t });
                const net = Number(computed?.net_total || 0);
                netTotalsByInvoiceId.set(invId, net);
                totalToPay += net;
            }
            totalToPay = Math.round(totalToPay * 100) / 100;
            const parsedAmount = rawAmount === undefined || rawAmount === null || String(rawAmount).trim() === ''
                ? totalToPay
                : parseMoneyInput(rawAmount);

            if (parsedAmount === null || !Number.isFinite(parsedAmount) || parsedAmount < 0) {
                await t.rollback();
                throw new CustomError('Jumlah pembayaran tidak valid.', 400);
            }

            const amountReceived = parsedAmount;
            if (Math.abs(amountReceived - totalToPay) > 0.01) {
                await t.rollback();
                throw new CustomError(`Nominal pembayaran (${amountReceived.toLocaleString()}) harus sesuai total tagihan COD setelah retur (${totalToPay.toLocaleString()}).`, 400);
            }

            let totalDelta = 0;
            for (const invoice of unpaidCodInvoices) {
                const invoiceId = String(invoice?.id || '').trim();
                const invoiceAmount = Number(netTotalsByInvoiceId.get(invoiceId) || 0);

                const existingCollection = await CodCollection.findOne({
                    where: { invoice_id: invoiceId, driver_id: userId, status: 'collected' },
                    transaction: t,
                    lock: t.LOCK.UPDATE
                });
                const previousAmount = existingCollection ? Number(existingCollection.amount || 0) : 0;
                const delta = invoiceAmount - previousAmount;
                totalDelta += delta;

                if (existingCollection) {
                    await existingCollection.update({ amount: invoiceAmount }, { transaction: t });
                } else {
                    await CodCollection.create({
                        invoice_id: invoiceId,
                        driver_id: userId,
                        amount: invoiceAmount,
                        status: 'collected'
                    }, { transaction: t });
                }

                const invoiceUpdate: any = {
                    payment_status: 'cod_pending',
                    amount_paid: invoiceAmount,
                    courier_id: userId
                };
                if (file) {
                    invoiceUpdate.payment_proof_url = file.path;
                }
                await invoice.update(invoiceUpdate, { transaction: t });
            }

            if (totalDelta !== 0) {
                const driver = await User.findByPk(userId, { transaction: t, lock: t.LOCK.UPDATE });
                if (!driver) {
                    await t.rollback();
                    throw new CustomError('Driver tidak ditemukan.', 404);
                }
                const exposure = await calculateDriverCodExposure(String(userId), { transaction: t });
                await driver.update({ debt: exposure.exposure }, { transaction: t });
            }

            const relatedOrderIds = Array.from(new Set(
                (await Promise.all(unpaidCodInvoices.map((inv: any) => findOrderIdsByInvoiceId(String(inv.id), { transaction: t }))))
                    .flat()
            )) as string[];
            const currentOrderId = String(order.id || '');
            if (currentOrderId && !relatedOrderIds.includes(currentOrderId)) {
                relatedOrderIds.push(currentOrderId);
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
            for (const orderId of deliveredOrderIds) {
                const previousStatus = String(previousStatusByOrderId[orderId] || '').toLowerCase();
                if (!isOrderTransitionAllowed(previousStatus, 'completed')) {
                    await t.rollback();
                    throw new CustomError(`Transisi status tidak diizinkan: '${previousStatus}' -> 'completed'`, 409);
                }
            }
            if (deliveredOrderIds.length > 0) {
                await Order.update(
                    { status: 'completed' },
                    { where: { id: { [Op.in]: deliveredOrderIds } }, transaction: t }
                );
            }

            await emitAdminRefreshBadges({
                transaction: t,
                requestContext: 'driver_record_payment_refresh_badges'
            });
            for (const orderId of deliveredOrderIds) {
                const prevStatus = previousStatusByOrderId[orderId] || '';
                if (prevStatus === 'completed') continue;
                const mainInvoice = unpaidCodInvoices[0];
                await recordOrderStatusChanged({
                    transaction: t,
                    order_id: orderId,
                    invoice_id: mainInvoice?.id ? String(mainInvoice.id) : null,
                    from_status: prevStatus || null,
                    to_status: 'completed',
                    actor_user_id: String(userId),
                    actor_role: String(req.user?.role || 'driver'),
                    reason: 'driver_record_payment',
                });
                await emitOrderStatusChanged({
                    order_id: orderId,
                    from_status: prevStatus || null,
                    to_status: 'completed',
                    source: String(order.source || ''),
                    payment_method: String(mainInvoice?.payment_method || 'cod'),
                    courier_id: String(order.courier_id || userId),
                    triggered_by_role: String(req.user?.role || 'driver'),
                    target_roles: ['admin_finance', 'customer', 'driver'],
                    target_user_ids: [String(userId)],
                }, {
                    transaction: t,
                    requestContext: 'driver_record_payment_status_changed'
                });
            }

            await t.commit();

            const responsePayload = {
                message: 'Pembayaran COD berhasil dicatat.',
                invoice_ids: unpaidCodInvoices.map((inv: any) => inv.id),
                amount_received: amountReceived
            };
            if (idempotencyKey) {
                await commitIdempotentRequest(idempotencyKey, idempotencyScope, 200, responsePayload);
            }
            return res.json(responsePayload);
        } catch (error) {
            try { await t.rollback(); } catch { }

            if (isDeadlockError(error) && attempt < maxAttempts) {
                await new Promise((resolve) => setTimeout(resolve, 75 * attempt));
                continue;
            }

            if (idempotencyKey) {
                await clearIdempotentRequest(idempotencyKey, idempotencyScope);
            }
            if (error instanceof CustomError) {
                throw error;
            }
            if (isDeadlockError(error)) {
                throw new CustomError('Terjadi konflik transaksi saat catat pembayaran. Silakan coba lagi.', 409);
            }
            console.error('[driver.recordPayment] unexpected error', error);
            throw new CustomError('Gagal mencatat pembayaran.', 500);
        }
    }

    throw new CustomError('Gagal mencatat pembayaran.', 500);
});

export const updatePaymentMethod = asyncWrapper(async (req: Request, res: Response) => {
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
            throw new CustomError('Metode pembayaran tidak valid.', 400);
        }
        const nextMethod = rawMethod as 'cod' | 'transfer_manual';

        const order = await findOrderByIdOrInvoiceId(String(id), userId, { transaction: t });
        if (!order) {
            await safeRollback();
            throw new CustomError('Order atau invoice tidak ditemukan atau tidak ditugaskan ke driver ini.', 404);
        }

        const invoice = await findLatestInvoiceByOrderId(String(order.id), { transaction: t });
        if (!invoice) {
            await safeRollback();
            throw new CustomError('Invoice tidak ditemukan.', 400);
        }

        if (invoice.payment_status === 'paid') {
            await safeRollback();
            throw new CustomError('Invoice sudah lunas, metode pembayaran tidak bisa diubah.', 409);
        }

        if (invoice.payment_status === 'cod_pending' && invoice.payment_method !== nextMethod) {
            await safeRollback();
            throw new CustomError('Pembayaran COD sudah dicatat, metode tidak bisa diubah.', 409);
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
                throw new CustomError('Metode pembayaran hanya bisa diubah oleh driver yang menangani semua order aktif di invoice.', 403);
            }
        }

        const currentPaymentStatus = String(invoice.payment_status || '').trim().toLowerCase();
        const invoiceUpdate: { payment_method: 'cod' | 'transfer_manual'; payment_status?: 'unpaid' } = {
            payment_method: nextMethod
        };
        if (currentPaymentStatus === 'draft') {
            invoiceUpdate.payment_status = 'unpaid';
        }

        await invoice.update(invoiceUpdate, { transaction: t });
        if (uniqueOrderIds.length > 0) {
            await Order.update(
                { payment_method: nextMethod },
                { where: { id: { [Op.in]: uniqueOrderIds } }, transaction: t }
            );
        }

        await emitAdminRefreshBadges({
            transaction: t,
            requestContext: 'driver_update_payment_method_refresh_badges'
        });

        await t.commit();

        return res.json({
            message: 'Metode pembayaran diperbarui.',
            payment_method: nextMethod
        });
    } catch (error) {
        await safeRollback();
        if (error instanceof CustomError) {
            throw error;
        }
        if (isDeadlockError(error)) {
            throw new CustomError('Terjadi konflik transaksi saat ubah metode pembayaran. Silakan coba lagi.', 409);
        }
        throw new CustomError('Gagal memperbarui metode pembayaran.', 500);
    }
});
