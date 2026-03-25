import { Retur, Order, Product, User, sequelize, OrderItem, Expense, Account, DriverDebtAdjustment } from '../models';
import { Op } from 'sequelize';
import { JournalService } from './JournalService';
import { emitReturStatusChanged } from '../utils/orderNotification';
import { computeInvoiceNetTotals } from '../utils/invoiceNetTotals';
import { calculateDriverCodExposure } from '../utils/codExposure';
import { findLatestInvoiceByOrderId } from '../utils/invoiceLookup';

export class ReturService {
    static async requestRetur(payload: {
        userId: string;
        order_id: string;
        product_id: string;
        qty: number;
        reason: string;
        filePath?: string;
        userRole: string;
    }) {
        const t = await sequelize.transaction();
        try {
            const { userId, order_id, product_id, qty, reason, filePath, userRole } = payload;

            const order = await Order.findOne({
                where: { id: order_id, customer_id: userId },
                transaction: t
            });

            if (!order) {
                throw new Error('Order not found');
            }

            if (!['delivered', 'completed'].includes(order.status)) {
                throw new Error('Only delivered or completed orders can be returned');
            }

            const existingRetur = await Retur.findOne({
                where: {
                    order_id,
                    product_id,
                    status: { [Op.not]: 'rejected' }
                },
                transaction: t
            });

            if (existingRetur) {
                throw new Error('Retur untuk produk ini sudah diajukan dan sedang diproses');
            }

            const orderItem = await sequelize.models.OrderItem.findOne({
                where: { order_id, product_id },
                transaction: t
            }) as any;

            if (!orderItem) {
                throw new Error('Produk tidak ditemukan dalam pesanan ini');
            }

            if (Number(qty) > Number(orderItem.qty)) {
                throw new Error('Jumlah retur melebihi jumlah yang dibeli');
            }

            const createdRetur = await Retur.create({
                order_id,
                product_id,
                qty,
                reason,
                evidence_img: filePath || null,
                status: 'pending',
                created_by: userId
            }, { transaction: t });

            await emitReturStatusChanged({
                retur_id: String(createdRetur.id),
                order_id: String(order_id),
                from_status: null,
                to_status: 'pending',
                courier_id: null,
                triggered_by_role: String(userRole || 'customer'),
                target_roles: ['customer', 'kasir', 'super_admin'],
                target_user_ids: [String(userId)],
            }, {
                transaction: t,
                requestContext: 'retur_request_status_changed'
            });

            await t.commit();

            return createdRetur;
        } catch (error) {
            try { await t.rollback(); } catch { }
            throw error;
        }
    }

    static async getMyReturs(userId: string) {
        return Retur.findAll({
            where: { created_by: userId },
            include: [
                { model: Product, attributes: ['name', 'sku'] },
                { model: Order, attributes: ['id', 'status'] }
            ],
            order: [['createdAt', 'DESC']]
        });
    }

    static async getAllReturs(status?: string) {
        const whereClause: any = {};
        if (status) whereClause.status = status;

        return Retur.findAll({
            where: whereClause,
            include: [
                { model: User, as: 'Creator', attributes: ['id', 'name', 'whatsapp_number'] },
                { model: Product, attributes: ['id', 'name', 'sku'] },
                {
                    model: Order,
                    attributes: ['id', 'status', 'total_amount'],
                    include: [{
                        model: OrderItem,
                        attributes: ['product_id', 'price_at_purchase', 'qty'],
                        required: false
                    }]
                },
                { model: User, as: 'Courier', attributes: ['id', 'name', 'whatsapp_number'], required: false }
            ],
            order: [['createdAt', 'DESC']]
        });
    }

    static async updateReturStatus(
        id: string,
        payload: {
            status: string;
            admin_response?: string;
            courier_id?: string;
            refund_amount?: number;
            is_back_to_stock?: boolean;
            qty_received?: number;
        },
        user: { id: string; role: string }
    ) {
        const t = await sequelize.transaction();
        try {
            const adminAllowedStatuses = [
                'approved',
                'rejected',
                'pickup_assigned',
                'received',
                'completed'
            ] as const;
            type AdminAllowedReturStatus = (typeof adminAllowedStatuses)[number];
            const isAdminAllowedReturStatus = (value: string): value is AdminAllowedReturStatus =>
                (adminAllowedStatuses as readonly string[]).includes(value);

            const { status, admin_response, courier_id, refund_amount, is_back_to_stock } = payload;
            const requestedStatus = String(status || '').trim();

            if (!isAdminAllowedReturStatus(requestedStatus)) {
                throw new Error('Status retur tidak valid untuk endpoint admin');
            }
            const nextStatus: AdminAllowedReturStatus = requestedStatus;

            const retur = await Retur.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
            if (!retur) {
                throw new Error('Retur request not found');
            }

            const isReturOperator = ['super_admin', 'kasir', 'admin_gudang'].includes(user.role);
            if (!isReturOperator) {
                throw new Error('Hanya Kasir, Admin Gudang, atau Super Admin yang dapat mengubah status retur');
            }

            const transitionIsValid = (
                (retur.status === 'pending' && ['approved', 'rejected'].includes(nextStatus)) ||
                (retur.status === 'approved' && nextStatus === 'pickup_assigned') ||
                (retur.status === 'handed_to_warehouse' && nextStatus === 'received') ||
                (retur.status === 'received' && nextStatus === 'completed')
            );

            if (!transitionIsValid) {
                throw new Error(`Transisi status tidak diizinkan dari ${retur.status} ke ${nextStatus}`);
            }

            const updateData: {
                status: AdminAllowedReturStatus;
                admin_response?: string | null;
                courier_id?: string | null;
                refund_amount?: number | null;
                is_back_to_stock?: boolean | null;
                qty_received?: number | null;
            } = { status: nextStatus };

            if (admin_response !== undefined) {
                updateData.admin_response = admin_response;
            }

            if (nextStatus === 'pickup_assigned') {
                const normalizedCourierId = String(courier_id || '').trim();
                if (!normalizedCourierId) {
                    throw new Error('courier_id wajib diisi saat menugaskan pickup retur');
                }
                const courier = await User.findOne({
                    where: { id: normalizedCourierId, role: 'driver' },
                    transaction: t
                });
                if (!courier) {
                    throw new Error('Driver tidak ditemukan');
                }
                updateData.courier_id = normalizedCourierId;
                if (refund_amount !== undefined) {
                    updateData.refund_amount = Number(refund_amount);
                }
            }

            if (nextStatus === 'completed' && is_back_to_stock !== undefined) {
                updateData.is_back_to_stock = Boolean(is_back_to_stock);
            }

            if (nextStatus === 'received') {
                const rawQtyReceived = payload.qty_received;
                const isDeliveryRetur = ['delivery_refusal', 'delivery_damage'].includes(String((retur as any).retur_type || ''));
                if (isDeliveryRetur) {
                    const parsed = Number(rawQtyReceived);
                    if (!Number.isFinite(parsed)) {
                        throw new Error('qty_received wajib diisi saat verifikasi retur delivery');
                    }
                    const receivedQty = Math.max(0, Math.min(Number(retur.qty || 0), Math.trunc(parsed)));
                    if (receivedQty > Number(retur.qty || 0)) {
                        throw new Error('qty_received melebihi qty retur');
                    }
                    updateData.qty_received = receivedQty;
                } else if (rawQtyReceived !== undefined && rawQtyReceived !== null && String(rawQtyReceived).trim() !== '') {
                    const parsed = Number(rawQtyReceived);
                    if (!Number.isFinite(parsed) || parsed < 0) {
                        throw new Error('qty_received tidak valid');
                    }
                    updateData.qty_received = Math.max(0, Math.min(Number(retur.qty || 0), Math.trunc(parsed)));
                }
            }

            const previousStatus = String(retur.status || '');
            await retur.update(updateData, { transaction: t });

            // Delivery refusal mismatch: if received less than claimed, create driver debt adjustment.
            if (
                nextStatus === 'received'
                && String((retur as any).retur_type || '') === 'delivery_refusal'
            ) {
                const driverId = String((retur as any).courier_id || '').trim();
                if (!driverId) {
                    throw new Error('Retur delivery tidak memiliki courier_id');
                }
                const claimedQty = Math.max(0, Math.trunc(Number(retur.qty || 0)));
                const receivedQty = Math.max(0, Math.trunc(Number((retur as any).qty_received || updateData.qty_received || 0)));

                if (receivedQty < claimedQty) {
                    const latestInvoice = await findLatestInvoiceByOrderId(String(retur.order_id), { transaction: t });
                    if (!latestInvoice) {
                        throw new Error('Invoice terkait tidak ditemukan untuk retur delivery');
                    }

                    const claimedTotals = await computeInvoiceNetTotals(String(latestInvoice.id), {
                        transaction: t,
                        effective_qty_override_by_retur_id: { [String(retur.id)]: claimedQty }
                    });
                    const receivedTotals = await computeInvoiceNetTotals(String(latestInvoice.id), { transaction: t });
                    const deltaDue = Math.max(0, Math.round((receivedTotals.net_total - claimedTotals.net_total) * 100) / 100);

                    if (deltaDue > 0) {
                        const existing = await DriverDebtAdjustment.findOne({
                            where: { retur_id: String(retur.id) },
                            transaction: t,
                            lock: t.LOCK.UPDATE
                        });
                        const note = `Selisih verifikasi retur delivery (Retur #${String(retur.id).slice(0, 8)}): received ${receivedQty}/${claimedQty}.`;
                        if (existing) {
                            await existing.update({
                                driver_id: driverId,
                                invoice_id: String(latestInvoice.id),
                                amount: deltaDue,
                                status: 'open',
                                note,
                                created_by: String(user.id)
                            }, { transaction: t });
                        } else {
                            await DriverDebtAdjustment.create({
                                driver_id: driverId,
                                invoice_id: String(latestInvoice.id),
                                retur_id: String(retur.id),
                                amount: deltaDue,
                                status: 'open',
                                note,
                                created_by: String(user.id)
                            }, { transaction: t });
                        }

                        // Refresh driver debt snapshot.
                        const driver = await User.findByPk(driverId, { transaction: t, lock: t.LOCK.UPDATE });
                        if (driver) {
                            const exposure = await calculateDriverCodExposure(driverId, { transaction: t });
                            await driver.update({ debt: exposure.exposure }, { transaction: t });
                        }
                    }
                }
            }

            // Logic for completion: if is_back_to_stock is true, increment product stock
            if (nextStatus === 'completed' && is_back_to_stock === true) {
                const product = await Product.findByPk(retur.product_id, { transaction: t, lock: t.LOCK.UPDATE });
                if (product) {
                    const oldStock = Number(product.stock_quantity);
                    const returnQty = Number(retur.qty);
                    await product.update({
                        stock_quantity: oldStock + returnQty
                    }, { transaction: t });

                    // --- Journal for Return to Stock (Persediaan vs HPP Reversal) ---
                    const orderItem = await OrderItem.findOne({
                        where: { order_id: retur.order_id, product_id: retur.product_id },
                        transaction: t
                    });

                    const unitCost = Number(orderItem?.cost_at_purchase || product.base_price || 0);
                    const totalCost = unitCost * returnQty;

                    if (totalCost > 0) {
                        const inventoryAcc = await Account.findOne({ where: { code: '1300' }, transaction: t });
                        const hppAcc = await Account.findOne({ where: { code: '5100' }, transaction: t });

                        if (inventoryAcc && hppAcc) {
                            await JournalService.createEntry({
                                description: `Retur Barang ke Stok (Order #${retur.order_id.slice(0, 8)})`,
                                reference_type: 'retur_stock',
                                reference_id: retur.id,
                                created_by: user.id,
                                lines: [
                                    { account_id: inventoryAcc.id, debit: totalCost, credit: 0 },
                                    { account_id: hppAcc.id, debit: 0, credit: totalCost }
                                ]
                            }, t);
                        }
                    }
                }
            }

            await emitReturStatusChanged({
                retur_id: String(retur.id),
                order_id: String(retur.order_id),
                from_status: previousStatus || null,
                to_status: nextStatus,
                courier_id: String(retur.courier_id || updateData.courier_id || ''),
                triggered_by_role: String(user.role || ''),
                target_roles: ['customer', 'kasir', 'admin_finance', 'driver', 'super_admin'],
                target_user_ids: updateData.courier_id ? [String(updateData.courier_id)] : (retur.courier_id ? [String(retur.courier_id)] : []),
            }, {
                transaction: t,
                requestContext: 'retur_admin_status_changed'
            });

            await t.commit();

            return { retur, nextStatus };
        } catch (error) {
            try { await t.rollback(); } catch { }
            throw error;
        }
    }

    static async disburseRefund(id: string, note: string | undefined, user: { id: string; role: string }) {
        const t = await sequelize.transaction();
        try {
            const retur = await Retur.findByPk(id, {
                include: [
                    { model: Order, include: [{ model: OrderItem }] },
                    { model: Product }
                ],
                transaction: t,
                lock: t.LOCK.UPDATE
            });

            if (!retur) {
                throw new Error('Retur request not found');
            }

            if (!['super_admin', 'admin_finance'].includes(user.role)) {
                throw new Error('Hanya Admin Finance atau Super Admin yang dapat mencairkan dana');
            }

            if (retur.refund_disbursed_at) {
                throw new Error('Dana retur ini sudah dicairkan sebelumnya');
            }

            const refundAmount = Number(retur.refund_amount || 0);
            if (refundAmount <= 0) {
                throw new Error('Nominal refund belum diatur atau 0');
            }

            const expenseNote = `Refund Retur: ${(retur as any).Product?.name} (Order #${retur.order_id.slice(0, 8)}). ${note || ''}`;

            const expense = await Expense.create({
                category: 'Refund Retur',
                amount: refundAmount,
                date: new Date(),
                note: expenseNote,
                created_by: user.id
            }, { transaction: t });

            const refundAcc = await Account.findOne({ where: { code: '5400' }, transaction: t });
            const paymentAcc = await Account.findOne({ where: { code: '1101' }, transaction: t });

            if (refundAcc && paymentAcc) {
                await JournalService.createEntry({
                    description: expenseNote,
                    reference_type: 'retur_refund',
                    reference_id: retur.id,
                    created_by: user.id,
                    lines: [
                        { account_id: refundAcc.id, debit: refundAmount, credit: 0 },
                        { account_id: paymentAcc.id, debit: 0, credit: refundAmount }
                    ]
                }, t);
            }

            await retur.update({
                refund_disbursed_at: new Date(),
                refund_disbursed_by: user.id,
                refund_note: note || null
            }, { transaction: t });

            await emitReturStatusChanged({
                retur_id: String(retur.id),
                order_id: String(retur.order_id),
                from_status: String(retur.status || ''),
                to_status: String(retur.status || ''),
                courier_id: String((retur as any).courier_id || ''),
                triggered_by_role: String(user.role || ''),
                target_roles: ['customer', 'admin_finance', 'kasir', 'super_admin'],
            }, {
                transaction: t,
                requestContext: 'retur_refund_status_changed'
            });

            await t.commit();

            return retur;
        } catch (error) {
            try { await t.rollback(); } catch { }
            throw error;
        }
    }
}
