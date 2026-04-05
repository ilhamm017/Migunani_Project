import { Retur, Order, Product, User, sequelize, OrderItem, InvoiceItem, Expense, Account, DriverDebtAdjustment, Invoice } from '../models';
import { Op, Transaction } from 'sequelize';
import { JournalService } from './JournalService';
import { InventoryCostService } from './InventoryCostService';
import { emitReturStatusChanged } from '../utils/orderNotification';
import { computeInvoiceNetTotals } from '../utils/invoiceNetTotals';
import { calculateDriverCodExposure } from '../utils/codExposure';
import { ensureSingleInvoiceOrRequireInvoiceId } from '../utils/invoiceAmbiguity';
import { CustomError } from '../utils/CustomError';
import { resolveSingleCustomerIdForInvoice, syncCustomerCodInvoiceDelta, toCodResolutionStatus } from '../utils/codCustomerDelta';

export class ReturService {
    private static computeRefundFromOrderItems(params: {
        returQty: number;
        productId: string;
        orderItems: Array<{ product_id?: unknown; qty?: unknown; price_at_purchase?: unknown }>;
    }) {
        const targetProductId = String(params.productId || '').trim();
        const returQty = Math.max(0, Math.trunc(Number(params.returQty || 0)));
        if (!targetProductId || returQty <= 0) return 0;

        const rows = (Array.isArray(params.orderItems) ? params.orderItems : [])
            .map((row) => ({
                product_id: String((row as any)?.product_id || '').trim(),
                qty: Math.max(0, Math.trunc(Number((row as any)?.qty || 0))),
                price_at_purchase: Number((row as any)?.price_at_purchase || 0),
            }))
            .filter((row) => row.product_id === targetProductId && row.qty > 0 && Number.isFinite(row.price_at_purchase) && row.price_at_purchase > 0);

        if (rows.length === 0) return 0;

        // Allocate refund qty across order item rows (FIFO by input order).
        let remaining = returQty;
        let total = 0;
        for (const row of rows) {
            if (remaining <= 0) break;
            const take = Math.min(remaining, row.qty);
            remaining -= take;
            total += take * row.price_at_purchase;
        }
        return Math.max(0, Math.round(total * 100) / 100);
    }

    static async requestRetur(payload: {
        userId: string;
        order_id: string;
        invoice_id?: string;
        product_id: string;
        qty: number;
        reason: string;
        filePath?: string;
        userRole: string;
    }) {
        const t = await sequelize.transaction();
        try {
            const { userId, order_id, invoice_id, product_id, qty, reason, filePath, userRole } = payload;

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

            const orderItems = await OrderItem.findAll({
                where: { order_id, product_id },
                transaction: t
            });

            const purchasedQty = (orderItems as any[]).reduce((sum, row: any) => sum + Math.max(0, Number(row?.qty || 0)), 0);
            if (purchasedQty <= 0) {
                throw new Error('Produk tidak ditemukan dalam pesanan ini');
            }

            if (Number(qty) > purchasedQty) {
                throw new Error('Jumlah retur melebihi jumlah yang dibeli');
            }

            const invoiceSelection = await ensureSingleInvoiceOrRequireInvoiceId({
                order_id: String(order_id),
                invoice_id: String(invoice_id || '').trim() || null,
                transaction: t,
                lock: t.LOCK.SHARE,
                if_none: { statusCode: 404, message: 'Invoice tidak ditemukan untuk order ini' },
            });

            const createdRetur = await Retur.create({
                order_id,
                invoice_id: String((invoiceSelection as any)?.invoice?.id || '') || null,
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

    static async getAllReturs(status?: string, returType?: string) {
        const whereClause: any = {};
        if (status) whereClause.status = status;
        const normalizedType = typeof returType === 'string' ? returType.trim() : '';
        if (normalizedType) {
            const allowed = ['customer_request', 'delivery_refusal', 'delivery_damage'] as const;
            if (!(allowed as readonly string[]).includes(normalizedType)) {
                throw new Error('retur_type tidak valid');
            }
            whereClause.retur_type = normalizedType;
        }

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
            invoice_id?: string;
            admin_response?: string;
            courier_id?: string;
            refund_amount?: number;
            is_back_to_stock?: boolean;
            qty_received?: number;
        },
        user: { id: string; role: string },
        options?: { transaction?: Transaction }
    ) {
        const externalTx = options?.transaction;
        const t = externalTx || await sequelize.transaction();
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
                invoice_id?: string | null;
                admin_response?: string | null;
                courier_id?: string | null;
                refund_amount?: number | null;
                is_back_to_stock?: boolean | null;
                qty_received?: number | null;
            } = { status: nextStatus };

            if (admin_response !== undefined) {
                updateData.admin_response = admin_response;
            }

            if (payload.invoice_id !== undefined) {
                const invoiceSelection = await ensureSingleInvoiceOrRequireInvoiceId({
                    order_id: String((retur as any).order_id || ''),
                    invoice_id: String(payload.invoice_id || '').trim() || null,
                    transaction: t,
                    lock: t.LOCK.SHARE,
                    if_none: { statusCode: 404, message: 'Invoice terkait tidak ditemukan untuk retur.' },
                });
                updateData.invoice_id = String((invoiceSelection as any).invoice?.id || '') || null;
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
                const baselineItems = await OrderItem.findAll({
                    where: {
                        order_id: String((retur as any).order_id || ''),
                        product_id: String((retur as any).product_id || ''),
                    },
                    attributes: ['product_id', 'qty', 'price_at_purchase'],
                    transaction: t,
                });
                const computedBaseline = ReturService.computeRefundFromOrderItems({
                    returQty: Number((retur as any)?.qty || 0),
                    productId: String((retur as any)?.product_id || ''),
                    orderItems: baselineItems as any,
                });

                const requestedRefund = refund_amount === undefined ? null : Number(refund_amount);
                const hasValidRequested = requestedRefund !== null && Number.isFinite(requestedRefund) && requestedRefund > 0;
                if (computedBaseline > 0) {
                    // Guardrail: do not allow setting refund lower than the purchase price baseline.
                    updateData.refund_amount = hasValidRequested
                        ? Math.max(requestedRefund as number, computedBaseline)
                        : computedBaseline;
                } else if (hasValidRequested) {
                    updateData.refund_amount = requestedRefund as number;
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
                    const invoiceSelection = await ensureSingleInvoiceOrRequireInvoiceId({
                        order_id: String(retur.order_id),
                        invoice_id: String((retur as any).invoice_id || payload.invoice_id || '').trim() || null,
                        transaction: t,
                        lock: t.LOCK.SHARE,
                        if_none: { statusCode: 404, message: 'Invoice terkait tidak ditemukan untuk retur delivery' },
                    });
                    const latestInvoice = invoiceSelection.invoice;

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
                    const receivedQtyRaw = Number((retur as any).qty_received);
                    const returnQty = Number.isFinite(receivedQtyRaw) ? Math.max(0, Math.trunc(receivedQtyRaw)) : Number(retur.qty);
                    await product.update({
                        stock_quantity: oldStock + returnQty
                    }, { transaction: t });

                    // --- Journal for Return to Stock (Persediaan vs HPP Reversal) ---
                    const invoice = (await ensureSingleInvoiceOrRequireInvoiceId({
                        order_id: String(retur.order_id),
                        invoice_id: String((retur as any).invoice_id || payload.invoice_id || '').trim() || null,
                        transaction: t,
                        lock: t.LOCK.SHARE,
                        if_none: { statusCode: 404, message: 'Invoice terkait tidak ditemukan untuk retur.' },
                    })).invoice;
                    const invoiceItems = invoice
                        ? await InvoiceItem.findAll({
                            where: { invoice_id: String(invoice.id) },
                            attributes: ['qty', 'unit_cost'],
                            include: [{
                                model: OrderItem,
                                attributes: ['id', 'order_id', 'product_id'],
                                required: true,
                                where: {
                                    order_id: String(retur.order_id),
                                    product_id: String(retur.product_id),
                                }
                            }],
                            transaction: t,
                            lock: t.LOCK.SHARE
                        })
                        : [];

                    let weightedUnitCost = 0;
                    if (invoiceItems.length > 0) {
                        let totalQty = 0;
                        let totalCost = 0;
                        invoiceItems.forEach((row: any) => {
                            const qty = Math.max(0, Math.trunc(Number(row?.qty || 0)));
                            if (qty <= 0) return;
                            totalQty += qty;
                            totalCost += Number(row?.unit_cost || 0) * qty;
                        });
                        weightedUnitCost = totalQty > 0 ? (totalCost / totalQty) : 0;
                    }
                    if (!Number.isFinite(weightedUnitCost) || weightedUnitCost <= 0) {
                        weightedUnitCost = Number(product.base_price || 0);
                    }

                    await InventoryCostService.recordInbound({
                        product_id: String(retur.product_id),
                        qty: returnQty,
                        unit_cost: weightedUnitCost,
                        reference_type: 'retur_stock',
                        reference_id: String(retur.id),
                        note: `Retur back to stock (Order #${String(retur.order_id).slice(0, 8)})`,
                        transaction: t
                    });

                    const totalCost = weightedUnitCost * returnQty;

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

                // Auto-sync COD customer delta after retur completion (expected invoice net may change).
                try {
                    const invoiceSelection = await ensureSingleInvoiceOrRequireInvoiceId({
                        order_id: String(retur.order_id),
                        invoice_id: String((retur as any).invoice_id || payload.invoice_id || '').trim() || null,
                        transaction: t,
                        lock: t.LOCK.SHARE,
                        if_none: { statusCode: 404, message: 'Invoice terkait tidak ditemukan untuk retur.' },
                    });
                    const invoice = invoiceSelection.invoice as any;
                    const method = String(invoice?.payment_method || '').trim().toLowerCase();
                    if (method === 'cod') {
                        const invoiceId = String(invoice.id);
                        const totals = await computeInvoiceNetTotals(invoiceId, { transaction: t });
                        const expectedFinal = Math.max(0, Math.round(Number(totals.net_total || 0) * 100) / 100);
                        const collected = Math.max(0, Math.round(Number(invoice.amount_paid || 0) * 100) / 100);
                        const desiredCustomerDelta = Math.round((collected - expectedFinal) * 100) / 100;

                        const customerId = await resolveSingleCustomerIdForInvoice(invoiceId, { transaction: t });
                        await syncCustomerCodInvoiceDelta({
                            invoiceId,
                            customerId,
                            desiredDelta: desiredCustomerDelta,
                            createdBy: String(user.id),
                            note: `COD invoice delta (retur completed): expected=${expectedFinal}, collected=${collected}, delta=${desiredCustomerDelta}.`,
                            idempotencyKey: `balance_cod_invoice_delta_adj_${invoiceId}_retur_${String(retur.id)}`,
                            transaction: t
                        });
                        await invoice.update(
                            { cod_resolution_status: toCodResolutionStatus(desiredCustomerDelta) },
                            { transaction: t }
                        );
                    }
                } catch (error) {
                    try {
                        const invoiceId = String((retur as any)?.invoice_id || payload.invoice_id || '').trim();
                        if (invoiceId) {
                            const inv = await Invoice.findByPk(invoiceId, { transaction: t, lock: t.LOCK.UPDATE }) as any;
                            if (inv && String(inv?.payment_method || '').trim().toLowerCase() === 'cod') {
                                await inv.update({ cod_resolution_status: 'needs_recalc' }, { transaction: t });
                            }
                        }
                    } catch { }
                    console.warn('[ReturService] failed to auto-sync cod_invoice_delta after retur completed', error);
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

            if (!externalTx) {
                await t.commit();
            }

            return { retur, nextStatus };
        } catch (error) {
            if (!externalTx) {
                try { await t.rollback(); } catch { }
            }
            throw error;
        }
    }

    static async disburseRefund(
        id: string,
        note: string | undefined,
        user: { id: string; role: string },
        opts?: { refund_amount_override?: number }
    ) {
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

            if (String((retur as any).retur_type || 'customer_request') !== 'customer_request') {
                throw new Error('Refund hanya berlaku untuk retur customer_request (retur pelanggan).');
            }

            if (!['super_admin', 'admin_finance'].includes(user.role)) {
                throw new Error('Hanya Admin Finance atau Super Admin yang dapat mencairkan dana');
            }

            if (retur.refund_disbursed_at) {
                throw new Error('Dana retur ini sudah dicairkan sebelumnya');
            }

            const overrideRaw = opts?.refund_amount_override;
            const overrideParsed = overrideRaw === undefined ? null : Number(overrideRaw);
            if (overrideParsed !== null) {
                if (!Number.isFinite(overrideParsed) || overrideParsed <= 0) {
                    throw new Error('Nominal refund override tidak valid');
                }
                await retur.update({ refund_amount: overrideParsed }, { transaction: t });
            }

            let refundAmount = Number(retur.refund_amount || 0);
            if (refundAmount <= 0) {
                const computed = ReturService.computeRefundFromOrderItems({
                    returQty: Number((retur as any)?.qty || 0),
                    productId: String((retur as any)?.product_id || ''),
                    orderItems: Array.isArray((retur as any)?.Order?.OrderItems) ? (retur as any).Order.OrderItems : [],
                });
                if (computed <= 0) {
                    throw new Error('Nominal refund belum diatur atau 0');
                }
                await retur.update({ refund_amount: computed }, { transaction: t });
                refundAmount = computed;
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
