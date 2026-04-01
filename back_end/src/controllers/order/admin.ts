import { Request, Response } from 'express';
import { Order, OrderIssue, OrderItem, Product, Invoice, InvoiceItem, Cart, CartItem, User, sequelize, OrderAllocation, CustomerProfile, Retur, Backorder, Category, Setting, Account } from '../../models';
import { Op, QueryTypes } from 'sequelize';
import { resolveShippingMethodByCode } from '../ShippingMethodController';
import waClient, { getStatus as getWaStatus } from '../../services/whatsappClient';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { JournalService } from '../../services/JournalService';
import { InventoryReservationService } from '../../services/InventoryReservationService';
import { emitAdminRefreshBadges, emitOrderStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders, findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../../utils/invoiceLookup';
import { recordOrderEvent, recordOrderStatusChanged } from '../../utils/orderEvent';
import { DELIVERY_EMPLOYEE_ROLES, withOrderTrackingFields, normalizeIssueNote, ISSUE_SLA_HOURS, resolveEmployeeDisplayName, ORDER_STATUS_OPTIONS } from './utils';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';
import { isLegacyOrderStatusAlias, isOrderTransitionAllowed, resolveLegacyOrderStatusAlias } from '../../utils/orderTransitions';
import { computeInvoiceNetTotalsBulk } from '../../utils/invoiceNetTotals';

export const getAllOrders = asyncWrapper(async (req: Request, res: Response) => {
    const { page = 1, limit = 10, status, search, startDate, endDate, dateFrom, dateTo, is_backorder, exclude_backorder, updatedAfter } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const includeCollectibleTotals = String((req.query as any)?.include_collectible_total || '') === 'true';

    const whereClause: any = {};
    // Used later to annotate each order with `is_backorder` for UI classification.
    // We only compute against the current page to keep this endpoint fast.
    let backorderOrderIdSetForPage: Set<string> | null = null;
    let prioritizeRecentIssueUpdates = false;
    if (status && status !== 'all') {
        const statusStr = String(status);
        const statuses = statusStr
            .split(',')
            .map((value) => resolveLegacyOrderStatusAlias(value, 'admin_order_status_query'))
            .filter(Boolean);

        if (statuses.length > 0) {
            if (statuses.includes('hold')) {
                prioritizeRecentIssueUpdates = true;
            }
            whereClause.status = { [Op.in]: statuses };
        }
    }

    const wantsBackorder = is_backorder === 'true';
    const wantsExcludeBackorder = exclude_backorder === 'true';
    if (wantsBackorder || wantsExcludeBackorder) {
        const backorderRows = await Backorder.findAll({
            where: {
                qty_pending: { [Op.gt]: 0 },
                status: { [Op.notIn]: ['fulfilled', 'canceled'] }
            },
            include: [{ model: OrderItem, attributes: ['order_id'] }],
            attributes: ['order_item_id']
        });
        const backorderOrderIds = Array.from(new Set(
            backorderRows
                .map((row: any) => row?.OrderItem?.order_id)
                .filter(Boolean)
                .map((id: any) => String(id))
        ));

        if (wantsBackorder) {
            if (backorderOrderIds.length === 0) {
                return res.json({
                    total: 0,
                    totalPages: 0,
                    currentPage: Number(page),
                    orders: []
                });
            }
            whereClause.id = { [Op.in]: backorderOrderIds };
        } else if (wantsExcludeBackorder && backorderOrderIds.length > 0) {
            whereClause.id = { [Op.notIn]: backorderOrderIds };
        }
    }

    const searchText = typeof search === 'string' ? search.trim() : '';
    if (searchText) {
        const invoiceMatches = await Invoice.findAll({
            where: { invoice_number: { [Op.like]: `%${searchText}%` } },
            attributes: ['id']
        });
        const invoiceIds = invoiceMatches.map((inv: any) => String(inv.id));
        const invoiceItems = invoiceIds.length > 0
            ? await InvoiceItem.findAll({
                where: { invoice_id: { [Op.in]: invoiceIds } },
                include: [{ model: OrderItem, attributes: ['order_id'] }]
            })
            : [];
        const orderIdsFromInvoice = Array.from(new Set(
            invoiceItems.map((item: any) => String(item?.OrderItem?.order_id || '')).filter(Boolean)
        ));

        whereClause[Op.or] = [
            { id: { [Op.like]: `%${searchText}%` } },
            { customer_name: { [Op.like]: `%${searchText}%` } },
            { customer_id: { [Op.like]: `%${searchText}%` } },
            ...(orderIdsFromInvoice.length > 0 ? [{ id: { [Op.in]: orderIdsFromInvoice } }] : []),
            { '$Customer.name$': { [Op.like]: `%${searchText}%` } },
        ];
    }

    const startRaw = typeof startDate === 'string' ? startDate : (typeof dateFrom === 'string' ? dateFrom : '');
    const endRaw = typeof endDate === 'string' ? endDate : (typeof dateTo === 'string' ? dateTo : '');

    const createdAtRange: any = {};

    if (startRaw) {
        const start = new Date(startRaw);
        if (!Number.isNaN(start.getTime())) {
            start.setHours(0, 0, 0, 0);
            createdAtRange[Op.gte] = start;
        }
    }

    if (endRaw) {
        const end = new Date(endRaw);
        if (!Number.isNaN(end.getTime())) {
            end.setHours(23, 59, 59, 999);
            createdAtRange[Op.lte] = end;
        }
    }

    if (Object.keys(createdAtRange).length > 0) {
        whereClause.createdAt = createdAtRange;
    }

    const updatedAfterRaw = typeof updatedAfter === 'string' ? updatedAfter : '';
    if (updatedAfterRaw) {
        const updatedAfterDate = new Date(updatedAfterRaw);
        if (!Number.isNaN(updatedAfterDate.getTime())) {
            whereClause.updatedAt = {
                [Op.gte]: updatedAfterDate
            };
        }
    }

    const orders = await Order.findAndCountAll({
        where: whereClause,
        include: [
            { model: User, as: 'Customer', attributes: ['id', 'name'] },
            { model: User, as: 'Courier', attributes: ['id', 'name'] },
            {
                model: OrderIssue,
                as: 'Issues',
                include: [{ model: User, as: 'IssueCreator', attributes: ['id', 'name', 'role'] }]
            },
            { model: Order, as: 'Children', attributes: ['id'] },
            {
                model: OrderAllocation,
                as: 'Allocations',
                attributes: ['id', 'allocated_qty', 'product_id', 'status']
            },
            {
                model: OrderItem,
                attributes: ['id', 'product_id', 'price_at_purchase']
            }
        ],
        distinct: true,
        limit: Number(limit),
        offset: Number(offset),
        order: prioritizeRecentIssueUpdates
            ? [['updatedAt', 'DESC'], ['createdAt', 'DESC']]
            : [['createdAt', 'DESC']]
    });

    const plainRows = orders.rows.map((row) => {
        const plain = row.get({ plain: true }) as any;
        let allocatedAmount = 0;
        const allocations = Array.isArray(plain.Allocations) ? plain.Allocations : [];
        const items = Array.isArray(plain.OrderItems) ? plain.OrderItems : [];

        allocations.forEach((alloc: any) => {
            const item = items.find((oi: any) => String(oi.product_id) === String(alloc.product_id));
            if (item) {
                allocatedAmount += Number(alloc.allocated_qty) * Number(item.price_at_purchase);
            }
        });
        return { ...plain, allocated_amount: allocatedAmount };
    });

    // Attach `is_backorder` boolean per order so the frontend can classify correctly
    // even when the order status is not `partially_fulfilled/hold`.
    const orderIdsForPage = plainRows.map((row: any) => String(row?.id || '')).filter(Boolean);
    if (orderIdsForPage.length > 0) {
        const pageBackorders = await Backorder.findAll({
            where: {
                qty_pending: { [Op.gt]: 0 },
                status: { [Op.notIn]: ['fulfilled', 'canceled'] }
            },
            include: [{
                model: OrderItem,
                attributes: ['order_id'],
                where: { order_id: { [Op.in]: orderIdsForPage } },
                required: true,
            }],
            attributes: ['id']
        });
        backorderOrderIdSetForPage = new Set(
            pageBackorders
                .map((row: any) => row?.OrderItem?.order_id)
                .filter(Boolean)
                .map((id: any) => String(id))
        );
    } else {
        backorderOrderIdSetForPage = new Set();
    }

    const annotatedRows = plainRows.map((row: any) => ({
        ...row,
        is_backorder: backorderOrderIdSetForPage ? backorderOrderIdSetForPage.has(String(row?.id || '')) : false,
    }));
    const rowsWithInvoices = await attachInvoicesToOrders(annotatedRows);
    let enrichedRows = rowsWithInvoices;
    if (includeCollectibleTotals) {
        const invoiceIds = new Set<string>();
        rowsWithInvoices.forEach((row: any) => {
            const inv = row?.Invoice;
            if (inv?.id) invoiceIds.add(String(inv.id));
            const list = Array.isArray(row?.Invoices) ? row.Invoices : [];
            list.forEach((i: any) => { if (i?.id) invoiceIds.add(String(i.id)); });
        });

        const ids = Array.from(invoiceIds).filter(Boolean);
        const totalsByInvoiceId = ids.length > 0 ? await computeInvoiceNetTotalsBulk(ids) : new Map<string, any>();

        enrichedRows = rowsWithInvoices.map((row: any) => {
            const attach = (inv: any) => {
                if (!inv?.id) return inv;
                const computed = totalsByInvoiceId.get(String(inv.id));
                if (!computed) return inv;
                return {
                    ...inv,
                    collectible_total: Number(computed.net_total || 0),
                    delivery_return_summary: computed
                };
            };
            const invoice = row?.Invoice ? attach(row.Invoice) : null;
            const invoices = Array.isArray(row?.Invoices) ? row.Invoices.map((i: any) => attach(i)) : [];
            return { ...row, Invoice: invoice, Invoices: invoices };
        });
    }

    const rows = enrichedRows.map((row) => withOrderTrackingFields(row as any));

    res.json({
        total: orders.count,
        totalPages: Math.ceil(orders.count / Number(limit)),
        currentPage: Number(page),
        orders: rows
    });
});

export const getDeliveryEmployees = asyncWrapper(async (_req: Request, res: Response) => {
    const employees = await User.findAll({
        where: {
            status: 'active',
            role: { [Op.in]: DELIVERY_EMPLOYEE_ROLES as unknown as string[] }
        },
        attributes: ['id', 'name', 'email', 'role', 'whatsapp_number'],
        order: [['name', 'ASC']]
    });

    res.json({
        employees: employees.map((item) => {
            const plain = item.get({ plain: true }) as any;
            return {
                ...plain,
                display_name: resolveEmployeeDisplayName(plain)
            };
        })
    });
});

export const updateOrderStatus = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const orderId = String(req.params.id);
        const userRole = req.user!.role;
        const { status, courier_id, issue_type, issue_note, resolution_note, reason } = req.body;
        const cancelReason = typeof reason === 'string' ? reason.trim() : '';

        const nextStatus = typeof status === 'string' ? status : '';
        if (!ORDER_STATUS_OPTIONS.includes(nextStatus as (typeof ORDER_STATUS_OPTIONS)[number])) {
            await t.rollback();
            throw new CustomError('Status order tidak valid', 400);
        }
        if (userRole !== 'super_admin' && (nextStatus === 'checked' || nextStatus === 'shipped')) {
            await t.rollback();
            throw new CustomError('Gunakan fitur Checker/Handover untuk status checked/shipped agar track record tercatat.', 409);
        }

        const order = await Order.findByPk(orderId, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!order) {
            await t.rollback();
            throw new CustomError('Order not found', 404);
        }
        let prevStatus = String(order.status || '');
        if (isLegacyOrderStatusAlias(prevStatus)) {
            const canonicalStatus = resolveLegacyOrderStatusAlias(prevStatus, 'admin_update_order_status_record');
            await order.update({ status: 'ready_to_ship', expiry_date: null }, { transaction: t });
            order.status = canonicalStatus as any;
            prevStatus = canonicalStatus;
        }

        // --- STRICT TRANSITION MAP ---
        // Other transitions are handled by dedicated endpoints:
        //   pending → waiting_invoice              (allocateOrder)
        //   waiting_invoice → ready_to_ship        (issueInvoice)
        //   shipped → delivered                     (completeDelivery)
        const ALLOWED_TRANSITIONS: Record<string, { roles: string[]; to: string[] }> = {
            'delivered': { roles: ['admin_gudang', 'admin_finance'], to: ['completed'] },
        };
        const CANCELABLE_STATUSES = [
            'pending',
            'waiting_invoice',
            'ready_to_ship',
            'allocated',
            'partially_fulfilled',
            'debt_pending',
            'processing',
            'hold',
        ];
        const canCancelByRole = ['super_admin', 'admin_gudang', 'admin_finance', 'kasir'].includes(userRole);

        if (userRole !== 'super_admin') {
            if (nextStatus === 'canceled') {
                if (!canCancelByRole || !CANCELABLE_STATUSES.includes(order.status)) {
                    await t.rollback();
                    throw new CustomError(`Role '${userRole}' tidak bisa membatalkan order dengan status '${order.status}'.`, 403);
                }
            } else {
                const rule = ALLOWED_TRANSITIONS[order.status];
                if (!rule || !rule.roles.includes(userRole) || !rule.to.includes(nextStatus)) {
                    await t.rollback();
                    throw new CustomError(`Role '${userRole}' tidak bisa mengubah status dari '${order.status}' ke '${nextStatus}'. Gunakan fitur yang sesuai (alokasi, invoice, verifikasi).`, 403);
                }
            }
        }

        const normalizedResolutionNote = normalizeIssueNote(resolution_note);
        if (prevStatus === 'hold' && nextStatus === 'shipped' && !normalizedResolutionNote) {
            await t.rollback();
            throw new CustomError('Catatan follow-up wajib diisi sebelum kirim ulang order dari status hold.', 400);
        }

        // --- Courier validation for shipped ---
        let courierIdToSave: string | null = null;
        if (nextStatus === 'shipped') {
            const invoice = await findLatestInvoiceByOrderId(orderId, { transaction: t });
            if (!invoice) {
                await t.rollback();
                throw new CustomError('Invoice tidak ditemukan untuk order ini.', 400);
            }
            // Pembayaran Transfer/COD diubah alur logikanya: bisa dikirim dulu baru bayar belakangan
            // Jadi pengecekan pesanan non-COD harus lunas kita hapus.
            // Fitur pembayaran di awal tetap berjalan karena sistem mengecek jika sudah lunas maka statusnya 'paid'.

            if (typeof courier_id !== 'string' || !courier_id.trim()) {
                await t.rollback();
                throw new CustomError('Status dikirim wajib memilih driver/kurir', 400);
            }
            const courier = await User.findOne({
                where: {
                    id: courier_id.trim(),
                    status: 'active',
                    role: { [Op.in]: DELIVERY_EMPLOYEE_ROLES as unknown as string[] }
                },
                transaction: t
            });
            if (!courier) {
                await t.rollback();
                throw new CustomError('Driver/kurir tidak ditemukan atau tidak aktif', 404);
            }
            courierIdToSave = courier.id;
        }

        const updatePayload: any = { status: nextStatus };
        if (nextStatus !== prevStatus && !isOrderTransitionAllowed(prevStatus, nextStatus)) {
            await t.rollback();
            throw new CustomError(`Transisi status tidak diizinkan: '${prevStatus}' -> '${nextStatus}'`, 409);
        }
        if (courierIdToSave) {
            updatePayload.courier_id = courierIdToSave;
        }
        await order.update(updatePayload, { transaction: t });
        await recordOrderStatusChanged({
            transaction: t,
            order_id: orderId,
            from_status: prevStatus || null,
            to_status: nextStatus,
            actor_user_id: String(req.user?.id || '').trim() || null,
            actor_role: userRole || null,
            reason: 'admin_update_order_status',
        });
        if (nextStatus === 'canceled' && cancelReason) {
            await recordOrderEvent({
                transaction: t,
                order_id: orderId,
                event_type: 'order_canceled',
                actor_user_id: String(req.user?.id || '').trim() || null,
                actor_role: userRole || null,
                reason: cancelReason,
                payload: {
                    before: { status: prevStatus },
                    after: { status: nextStatus },
                }
            });
        }

        if (nextStatus === 'shipped') {
            const invoice = await findLatestInvoiceByOrderId(orderId, { transaction: t });
            if (invoice) {
                if (String(invoice.shipment_status || '') === 'delivered' || invoice.delivered_at) {
                    await t.rollback();
                    throw new CustomError('Invoice untuk order ini sudah selesai dikirim dan tidak bisa dikembalikan ke status shipped.', 409);
                }
                if (invoice.payment_method !== 'cod') {
                    await AccountingPostingService.postGoodsOutForOrder(orderId, String(req.user!.id), t, 'non_cod');
                }
                await invoice.update({
                    shipment_status: 'shipped',
                    shipped_at: new Date(),
                    courier_id: courierIdToSave
                }, { transaction: t });
            }
        }

        // --- Issue tracking for hold ---
        if (nextStatus === 'hold') {
            const normalizedIssueType = typeof issue_type === 'string' && issue_type.trim()
                ? issue_type.trim()
                : 'shortage';
            if (normalizedIssueType !== 'shortage') {
                await t.rollback();
                throw new CustomError('Issue type tidak valid.', 400);
            }
            const dueAt = new Date(Date.now() + (ISSUE_SLA_HOURS * 60 * 60 * 1000));
            const existingOpenIssue = await OrderIssue.findOne({
                where: { order_id: orderId, status: 'open', issue_type: 'shortage' },
                transaction: t, lock: t.LOCK.UPDATE
            });
            if (existingOpenIssue) {
                await existingOpenIssue.update({ note: normalizeIssueNote(issue_note) }, { transaction: t });
            } else {
                await OrderIssue.create({
                    order_id: orderId, issue_type: 'shortage', status: 'open',
                    note: normalizeIssueNote(issue_note), due_at: dueAt,
                    created_by: req.user?.id || null,
                }, { transaction: t });
            }
        } else {
            const openIssues = await OrderIssue.findAll({
                where: { order_id: orderId, status: 'open' },
                transaction: t, lock: t.LOCK.UPDATE
            });
            for (const issue of openIssues) {
                const issueUpdatePayload: any = {
                    status: 'resolved',
                    resolved_at: new Date(),
                    resolved_by: req.user?.id || null,
                };
                if (normalizedResolutionNote && issue.issue_type === 'shortage') {
                    issueUpdatePayload.resolution_note = normalizedResolutionNote;
                }
                await issue.update({
                    ...issueUpdatePayload,
                }, { transaction: t });
            }
        }

        // If the entire order is canceled, ensure any open backorders are also canceled
        // so they don't appear in backorder/preorder reports.
        if (nextStatus === 'canceled') {
            const orderItems = await OrderItem.findAll({
                where: { order_id: orderId },
                attributes: ['id'],
                transaction: t,
                lock: t.LOCK.UPDATE
            });
            const orderItemIds = orderItems.map((row: any) => row.id);
            if (orderItemIds.length > 0) {
                await Backorder.update({
                    qty_pending: 0,
                    status: 'canceled'
                }, {
                    where: {
                        order_item_id: { [Op.in]: orderItemIds },
                        status: { [Op.notIn]: ['canceled', 'fulfilled'] }
                    },
                    transaction: t
                });
            }
        }

        if (nextStatus === 'canceled') {
            await InventoryReservationService.releaseReservationsForOrder({ order_id: orderId, transaction: t });
        }

        // If canceled, restore stock from allocations
        if (nextStatus === 'canceled' && order.stock_released === false) {
            const allocations = await OrderAllocation.findAll({
                where: { order_id: orderId }, transaction: t
            });
            for (const alloc of allocations) {
                if (alloc.allocated_qty > 0) {
                    const product = await Product.findByPk(alloc.product_id, {
                        transaction: t, lock: t.LOCK.UPDATE
                    });
                    if (product) {
                        await product.update({
                            stock_quantity: product.stock_quantity + alloc.allocated_qty,
                            allocated_quantity: Math.max(0, product.allocated_quantity - alloc.allocated_qty),
                        }, { transaction: t });
                    }
                }
            }
            await order.update({ stock_released: true }, { transaction: t });

            // Auto-Reversal for Shipped/Delivered/Completed
            if (['shipped', 'delivered', 'completed'].includes(prevStatus)) {
                const invoice = await findLatestInvoiceByOrderId(orderId, { transaction: t });
                if (invoice) {
                    // Reverse HPP
                    const invoiceItems = await InvoiceItem.findAll({
                        where: { invoice_id: invoice.id },
                        attributes: ['qty', 'unit_cost'],
                        transaction: t
                    });
                    let totalCost = 0;
                    invoiceItems.forEach((item: any) => {
                        totalCost += Number(item.unit_cost || 0) * Number(item.qty || 0);
                    });

                    if (totalCost > 0) {
                        const hppAcc = await Account.findOne({ where: { code: '5100' }, transaction: t });
                        const inventoryAcc = await Account.findOne({ where: { code: '1300' }, transaction: t });
                        if (hppAcc && inventoryAcc) {
                            await JournalService.createEntry({
                                description: `[VOID/REVERSAL] Pembatalan Order #${orderId} - HPP`,
                                reference_type: 'order_reversal',
                                reference_id: invoice.id.toString(),
                                created_by: String(req.user!.id),
                                lines: [
                                    { account_id: hppAcc.id, debit: 0, credit: totalCost },
                                    { account_id: inventoryAcc.id, debit: totalCost, credit: 0 }
                                ]
                            }, t);
                        }
                    }

                    // Reverse Sales if Paid
                    if (invoice.payment_status === 'paid' && Number(invoice.amount_paid) > 0) {
                        const paymentAccCode = invoice.payment_method === 'transfer_manual' ? '1102' : '1101';
                        const paymentAcc = await Account.findOne({ where: { code: paymentAccCode }, transaction: t });
                        const revenueAcc = await Account.findOne({ where: { code: '4100' }, transaction: t });

                        if (paymentAcc && revenueAcc) {
                            await JournalService.createEntry({
                                description: `[VOID/REVERSAL] Pembatalan Order #${orderId} - Pendapatan`,
                                reference_type: 'order_reversal',
                                reference_id: invoice.id.toString(),
                                created_by: String(req.user!.id),
                                lines: [
                                    { account_id: paymentAcc.id, debit: 0, credit: Number(invoice.amount_paid) },
                                    { account_id: revenueAcc.id, debit: Number(invoice.amount_paid), credit: 0 }
                                ]
                            }, t);
                        }
                    }
                }
            }
        }

        if (nextStatus !== prevStatus) {
            const targetRoles = nextStatus === 'shipped'
                ? ['driver', 'customer']
                : nextStatus === 'delivered'
                    ? ['admin_finance', 'customer']
                    : nextStatus === 'hold'
                        ? ['admin_gudang', 'super_admin', 'customer']
                        : nextStatus === 'completed'
                            ? ['customer']
                            : ['admin_gudang', 'admin_finance', 'kasir', 'customer'];
            await emitOrderStatusChanged({
                order_id: orderId,
                from_status: prevStatus || null,
                to_status: nextStatus,
                source: String(order.source || ''),
                payment_method: null,
                courier_id: courierIdToSave || String(order.courier_id || ''),
                triggered_by_role: userRole || null,
                target_roles: targetRoles,
                target_user_ids: courierIdToSave ? [courierIdToSave] : [],
            }, {
                transaction: t,
                requestContext: 'admin_order_status_changed'
            });
        } else {
            await emitAdminRefreshBadges({
                transaction: t,
                requestContext: 'admin_order_refresh_badges'
            });
        }
        await t.commit();
        res.json({ message: `Order status updated to ${nextStatus}` });


    } catch (error) {
        try { await t.rollback(); } catch { }
        throw error;
    }
});

export const cancelOrderItems = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const orderId = String(req.params.id || '').trim();
        const reasonRaw = typeof req.body?.reason === 'string' ? req.body.reason : '';
        const reason = reasonRaw.trim();
        const itemsRaw = Array.isArray(req.body?.items) ? req.body.items : [];

        if (!orderId) {
            await t.rollback();
            throw new CustomError('Order ID tidak valid.', 400);
        }
        if (!reason) {
            await t.rollback();
            throw new CustomError('Alasan cancel wajib diisi.', 400);
        }
        if (itemsRaw.length === 0) {
            await t.rollback();
            throw new CustomError('Tidak ada item yang dicancel.', 400);
        }

        const order = await Order.findByPk(orderId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!order) {
            await t.rollback();
            throw new CustomError('Order tidak ditemukan.', 404);
        }

        const currentStatus = String(order.status || '').trim().toLowerCase();
        const terminalStatuses = ['shipped', 'delivered', 'completed', 'expired', 'canceled'];
        if (terminalStatuses.includes(currentStatus)) {
            await t.rollback();
            throw new CustomError(`Order dengan status '${order.status}' tidak bisa cancel item.`, 409);
        }

        const actorId = String(req.user?.id || '').trim() || null;
        const actorRole = String(req.user?.role || '').trim() || null;

        type CancelOrderItemSpec = { mode: 'all' } | { mode: 'qty'; qty: number };
        const requestedCancelSpecByOrderItemId = new Map<string, CancelOrderItemSpec>();
        for (const row of itemsRaw) {
            const itemId = String(row?.order_item_id || '').trim();
            if (!itemId) continue;

            const hasCancelQty = row && Object.prototype.hasOwnProperty.call(row, 'cancel_qty');
            if (!hasCancelQty) {
                requestedCancelSpecByOrderItemId.set(itemId, { mode: 'all' });
                continue;
            }

            const rawCancelQty = (row as any)?.cancel_qty;
            if (rawCancelQty === null || rawCancelQty === undefined || rawCancelQty === '') {
                requestedCancelSpecByOrderItemId.set(itemId, { mode: 'all' });
                continue;
            }

            const qty = Math.trunc(Number(rawCancelQty));
            if (!Number.isFinite(qty) || qty <= 0) continue;

            const existing = requestedCancelSpecByOrderItemId.get(itemId);
            if (existing?.mode === 'all') continue;
            const prevQty = existing?.mode === 'qty' ? Number(existing.qty || 0) : 0;
            requestedCancelSpecByOrderItemId.set(itemId, { mode: 'qty', qty: prevQty + qty });
        }

        const requestedItemIds = Array.from(requestedCancelSpecByOrderItemId.keys());
        if (requestedItemIds.length === 0) {
            await t.rollback();
            throw new CustomError('Tidak ada item cancel yang valid.', 400);
        }

        const orderItems = await OrderItem.findAll({
            where: { order_id: orderId },
            include: [{ model: Product, attributes: ['id', 'name', 'sku'], required: false }],
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        const orderItemById = new Map<string, any>();
        orderItems.forEach((row: any) => {
            orderItemById.set(String(row?.id || '').trim(), row);
        });
        const missing = requestedItemIds.filter((id) => !orderItemById.has(id));
        if (missing.length > 0) {
            await t.rollback();
            throw new CustomError(`Item tidak ditemukan pada order ini: ${missing.join(', ')}`, 404);
        }

        const invoiceItems = await InvoiceItem.findAll({
            where: { order_item_id: { [Op.in]: requestedItemIds } },
            attributes: ['order_item_id', 'qty'],
            transaction: t
        });
        const invoicedQtyByOrderItemId: Record<string, number> = {};
        invoiceItems.forEach((row: any) => {
            const key = String(row?.order_item_id || '').trim();
            if (!key) return;
            invoicedQtyByOrderItemId[key] = Number(invoicedQtyByOrderItemId[key] || 0) + Number(row?.qty || 0);
        });

        const toCents2 = (value: number) => Math.round(value * 100) / 100;

        let beforeSubtotal = 0;
        let afterSubtotal = 0;
        const beforeQtyByOrderItemId: Record<string, number> = {};
        const afterQtyByOrderItemId: Record<string, number> = {};

        for (const row of orderItems as any[]) {
            const id = String(row?.id || '').trim();
            const qtyBefore = Math.max(0, Math.trunc(Number(row?.qty || 0)));
            const price = Number(row?.price_at_purchase || 0);
            beforeSubtotal += price * qtyBefore;
            beforeQtyByOrderItemId[id] = qtyBefore;
            afterQtyByOrderItemId[id] = qtyBefore;
        }

        const requestedCancelQtyByOrderItemId = new Map<string, number>();

        // Validate requested cancels & resolve final cancel qty (in-memory)
        for (const itemId of requestedItemIds) {
            const row = orderItemById.get(itemId);
            const qtyBefore = Math.max(0, Math.trunc(Number(row?.qty || 0)));
            const invoicedQty = Math.max(0, Math.trunc(Number(invoicedQtyByOrderItemId[itemId] || 0)));
            const cancelableQty = Math.max(0, qtyBefore - invoicedQty);

            const spec = requestedCancelSpecByOrderItemId.get(itemId);
            const requestedCancelRaw = spec?.mode === 'all'
                ? cancelableQty
                : Math.max(0, Math.trunc(Number((spec as any)?.qty || 0)));
            const requestedCancel = Math.max(0, Math.trunc(Number(requestedCancelRaw || 0)));

            if (spec?.mode === 'all' && requestedCancel <= 0) {
                await t.rollback();
                throw new CustomError(`Item ${itemId} tidak memiliki qty yang bisa dicancel (sudah ter-invoice).`, 409);
            }
            if (requestedCancel <= 0) continue;
            if (requestedCancel > cancelableQty) {
                await t.rollback();
                throw new CustomError(
                    `Qty cancel melebihi batas untuk item ${itemId} (maks ${cancelableQty}, diminta ${requestedCancel}).`,
                    409
                );
            }
            requestedCancelQtyByOrderItemId.set(itemId, requestedCancel);
        }

        const effectiveItemIds = Array.from(requestedCancelQtyByOrderItemId.keys());
        if (effectiveItemIds.length === 0) {
            await t.rollback();
            throw new CustomError('Tidak ada item yang bisa dicancel.', 400);
        }

        // Apply cancels (DB)
        for (const itemId of effectiveItemIds) {
            const row = orderItemById.get(itemId);
            const qtyBefore = Math.max(0, Math.trunc(Number(row?.qty || 0)));
            const requestedCancel = Math.max(0, Math.trunc(Number(requestedCancelQtyByOrderItemId.get(itemId) || 0)));
            if (requestedCancel <= 0) continue;

            const qtyAfter = Math.max(0, qtyBefore - requestedCancel);
            const canceledBefore = Math.max(0, Math.trunc(Number(row?.qty_canceled_manual || 0)));
            const orderedOriginal = Math.max(0, Math.trunc(Number(row?.ordered_qty_original || 0)));
            const nextOrderedOriginal = orderedOriginal > 0 ? orderedOriginal : qtyBefore;

            await row.update({
                qty: qtyAfter,
                ordered_qty_original: nextOrderedOriginal,
                qty_canceled_manual: canceledBefore + requestedCancel,
            }, { transaction: t });

            afterQtyByOrderItemId[itemId] = qtyAfter;

            await recordOrderEvent({
                transaction: t,
                order_id: orderId,
                order_item_id: itemId,
                event_type: 'order_item_canceled',
                actor_user_id: actorId,
                actor_role: actorRole,
                reason,
                payload: {
                    product_id: String(row?.product_id || ''),
                    sku: String(row?.Product?.sku || ''),
                    name: String(row?.Product?.name || ''),
                    unit_price: Number(row?.price_at_purchase || 0),
                    before: {
                        qty: qtyBefore,
                        qty_canceled_manual: canceledBefore,
                    },
                    after: {
                        qty: qtyAfter,
                        qty_canceled_manual: canceledBefore + requestedCancel,
                    },
                    delta: {
                        canceled_qty: requestedCancel,
                    }
                }
            });
        }

        // Compute after subtotal based on updated qty values
        for (const row of orderItems as any[]) {
            const id = String(row?.id || '').trim();
            const price = Number(row?.price_at_purchase || 0);
            const qtyAfter = Math.max(0, Math.trunc(Number(afterQtyByOrderItemId[id] ?? row?.qty ?? 0)));
            afterSubtotal += price * qtyAfter;
        }

        const allocations = await OrderAllocation.findAll({
            where: { order_id: orderId },
            transaction: t,
            lock: t.LOCK.UPDATE,
            order: [['createdAt', 'ASC'], ['id', 'ASC']]
        });

        const allocationsByProductId = new Map<string, any[]>();
        allocations.forEach((row: any) => {
            const productId = String(row?.product_id || '').trim();
            if (!productId) return;
            const list = allocationsByProductId.get(productId) || [];
            list.push(row);
            allocationsByProductId.set(productId, list);
        });

        const orderedByProductAfter = new Map<string, number>();
        for (const row of orderItems as any[]) {
            const itemId = String(row?.id || '').trim();
            const productId = String(row?.product_id || '').trim();
            if (!productId) continue;
            const qtyAfter = Math.max(0, Math.trunc(Number(afterQtyByOrderItemId[itemId] ?? row?.qty ?? 0)));
            orderedByProductAfter.set(productId, Number(orderedByProductAfter.get(productId) || 0) + qtyAfter);
        }

        const allocatedByProductBefore = new Map<string, number>();
        allocations.forEach((row: any) => {
            const productId = String(row?.product_id || '').trim();
            if (!productId) return;
            allocatedByProductBefore.set(productId, Number(allocatedByProductBefore.get(productId) || 0) + Number(row?.allocated_qty || 0));
        });

        const productsToAdjust: string[] = [];
        orderedByProductAfter.forEach((orderedAfter, productId) => {
            const allocatedBefore = Number(allocatedByProductBefore.get(productId) || 0);
            if (allocatedBefore > orderedAfter) productsToAdjust.push(productId);
        });

        if (productsToAdjust.length > 0) {
            const products = await Product.findAll({
                where: { id: { [Op.in]: productsToAdjust } },
                transaction: t,
                lock: t.LOCK.UPDATE
            });
            const productById = new Map<string, any>();
            products.forEach((p: any) => productById.set(String(p?.id || '').trim(), p));

            for (const productId of productsToAdjust) {
                const rows = allocationsByProductId.get(productId) || [];
                if (rows.length === 0) continue;
                const orderedAfter = Math.max(0, Math.trunc(Number(orderedByProductAfter.get(productId) || 0)));
                const allocatedBefore = Math.max(0, Number(allocatedByProductBefore.get(productId) || 0));

                const [primary, ...extras] = rows;
                await primary.update({ allocated_qty: orderedAfter }, { transaction: t });
                for (const extra of extras) {
                    if (Number(extra?.allocated_qty || 0) === 0) continue;
                    await extra.update({ allocated_qty: 0 }, { transaction: t });
                }

                const delta = orderedAfter - allocatedBefore;
                if (delta < 0) {
                    const product = productById.get(productId);
                    if (product) {
                        const absDelta = Math.abs(delta);
                        const currentStockQty = Number(product?.stock_quantity || 0);
                        await product.update({
                            stock_quantity: currentStockQty + absDelta,
                            allocated_quantity: Math.max(0, Number(product?.allocated_quantity || 0) - absDelta),
                        }, { transaction: t });
                    }
                }
            }
        }

        // Sync backorder rows for affected items
        const affectedItemIds = effectiveItemIds;
        const backorders = await Backorder.findAll({
            where: { order_item_id: { [Op.in]: affectedItemIds } },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        const backorderByItemId = new Map<string, any>();
        backorders.forEach((b: any) => backorderByItemId.set(String(b?.order_item_id || '').trim(), b));

        // Allocate per item to compute shortage after
        const allocatedAfterByProductId = new Map<string, number>();
        allocations.forEach((row: any) => {
            const productId = String(row?.product_id || '').trim();
            if (!productId) return;
            allocatedAfterByProductId.set(productId, Number(allocatedAfterByProductId.get(productId) || 0) + Number(row?.allocated_qty || 0));
        });
        const remainingByProduct = new Map<string, number>(allocatedAfterByProductId);
        const sortedItems = [...orderItems].sort((a: any, b: any) => String(a?.id || '').localeCompare(String(b?.id || '')));
        for (const row of sortedItems as any[]) {
            const itemId = String(row?.id || '').trim();
            const productId = String(row?.product_id || '').trim();
            if (!itemId || !productId) continue;
            const qtyAfter = Math.max(0, Math.trunc(Number(afterQtyByOrderItemId[itemId] ?? row?.qty ?? 0)));
            const remaining = Math.max(0, Number(remainingByProduct.get(productId) || 0));
            const allocatedQty = Math.min(qtyAfter, remaining);
            const shortageQty = Math.max(0, qtyAfter - allocatedQty);
            remainingByProduct.set(productId, Math.max(0, remaining - allocatedQty));

            const backorder = backorderByItemId.get(itemId);
            if (!backorder) continue;

            if (shortageQty > 0) {
                if (String(backorder.status || '') !== 'waiting_stock' || Number(backorder.qty_pending || 0) !== shortageQty) {
                    await backorder.update({
                        qty_pending: shortageQty,
                        status: 'waiting_stock'
                    }, { transaction: t });
                }
                continue;
            }

            const canceledQtyForItem = Math.max(0, Math.trunc(Number(requestedCancelQtyByOrderItemId.get(itemId) || 0)));
            const nextStatus = canceledQtyForItem > 0 ? 'canceled' : 'fulfilled';
            await backorder.update({
                qty_pending: 0,
                status: nextStatus,
                ...(canceledQtyForItem > 0 ? { notes: `Reason: ${reason}` } : {})
            }, { transaction: t });
        }

	        const shippingFee = Number(order.shipping_fee || 0);
	        const currentDiscount = Number(order.discount_amount || 0);
	        const ratio = beforeSubtotal > 0 ? Math.min(1, Math.max(0, afterSubtotal / beforeSubtotal)) : 0;
	        const embeddedBeforeDiscount = toCents2(orderItems.reduce((sum: number, row: any) => {
	            const id = String(row?.id || '').trim();
	            const qty = Math.max(0, Math.trunc(Number(beforeQtyByOrderItemId[id] || 0)));
	            const unitPrice = Number(row?.price_at_purchase || 0);
	            const snap = toObjectOrEmpty(row?.pricing_snapshot);
	            const basePrice = Number(snap?.base_price);
	            const safeBase = Number.isFinite(basePrice) && basePrice > 0 ? basePrice : unitPrice;
	            return sum + Math.max(0, toCents2(Math.max(0, safeBase - unitPrice) * qty));
	        }, 0));
	        const embeddedAfterDiscount = toCents2(orderItems.reduce((sum: number, row: any) => {
	            const id = String(row?.id || '').trim();
	            const qty = Math.max(0, Math.trunc(Number(afterQtyByOrderItemId[id] || 0)));
	            const unitPrice = Number(row?.price_at_purchase || 0);
	            const snap = toObjectOrEmpty(row?.pricing_snapshot);
	            const basePrice = Number(snap?.base_price);
	            const safeBase = Number.isFinite(basePrice) && basePrice > 0 ? basePrice : unitPrice;
	            return sum + Math.max(0, toCents2(Math.max(0, safeBase - unitPrice) * qty));
	        }, 0));
	        const externalDiscount = Math.max(0, toCents2(currentDiscount - embeddedBeforeDiscount));
	        const externalDiscountNext = toCents2(Math.max(0, externalDiscount * ratio));
	        const nextDiscount = toCents2(Math.max(0, embeddedAfterDiscount + externalDiscountNext));
	        const nextTotal = toCents2(Math.max(0, afterSubtotal + shippingFee - externalDiscountNext));

        const prevStatus = String(order.status || '');
        let nextStatus = prevStatus;
        if (afterSubtotal <= 0) {
            nextStatus = 'canceled';
        }

        await order.update({
            total_amount: nextTotal,
            discount_amount: nextDiscount,
            status: nextStatus as any,
            stock_released: nextStatus === 'canceled' ? true : order.stock_released
        }, { transaction: t });

        await InventoryReservationService.syncReservationsForOrder({ order_id: orderId, transaction: t });

        if (prevStatus !== nextStatus) {
            await recordOrderStatusChanged({
                transaction: t,
                order_id: orderId,
                from_status: prevStatus,
                to_status: nextStatus,
                actor_user_id: actorId,
                actor_role: actorRole,
                reason: 'admin_cancel_items',
            });
            await recordOrderEvent({
                transaction: t,
                order_id: orderId,
                event_type: 'order_canceled',
                actor_user_id: actorId,
                actor_role: actorRole,
                reason,
                payload: {
                    before: { status: prevStatus },
                    after: { status: nextStatus },
                }
            });
            await emitOrderStatusChanged({
                order_id: String(order.id),
                from_status: prevStatus,
                to_status: nextStatus,
                source: String(order.source || ''),
                payment_method: String(order.payment_method || ''),
                courier_id: String(order.courier_id || ''),
                triggered_by_role: String(actorRole || ''),
                target_roles: ['kasir', 'admin_gudang', 'admin_finance', 'customer'],
            }, {
                transaction: t,
                requestContext: 'admin_cancel_items_status_changed'
            });
        }

        await emitAdminRefreshBadges({
            transaction: t,
            requestContext: 'admin_cancel_items_refresh_badges'
        });

        await t.commit();
        res.json({
            message: 'Item berhasil dibatalkan',
            order_id: orderId,
            status: nextStatus,
            total_amount: nextTotal,
            discount_amount: nextDiscount,
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        throw error;
    }
});

export const moveOrderToIndent = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params as { id: string };
        const orderId = String(id || '').trim();
        if (!orderId) {
            await t.rollback();
            throw new CustomError('Order ID tidak valid', 400);
        }

        const order = await Order.findByPk(orderId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!order) {
            await t.rollback();
            throw new CustomError('Order not found', 404);
        }

        const currentStatus = String(order.status || '').trim().toLowerCase();
        if (['completed', 'canceled', 'expired'].includes(currentStatus)) {
            await t.rollback();
            throw new CustomError(`Order dengan status '${currentStatus}' tidak bisa dipindahkan ke indent.`, 409);
        }

        const orderItems = await OrderItem.findAll({
            where: { order_id: orderId },
            include: [{ model: Product, attributes: ['id', 'stock_quantity'] }],
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (orderItems.length === 0) {
            await t.rollback();
            throw new CustomError('Order item tidak ditemukan', 404);
        }

        const allocations = await OrderAllocation.findAll({
            where: { order_id: orderId },
            attributes: ['product_id', 'allocated_qty'],
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        const allocatedByProduct = allocations.reduce((acc: Record<string, number>, row: any) => {
            const productId = String(row?.product_id || '').trim();
            if (!productId) return acc;
            acc[productId] = Number(acc[productId] || 0) + Number(row?.allocated_qty || 0);
            return acc;
        }, {});

        const candidates = orderItems
            .map((row: any) => {
                const orderItemId = String(row?.id || '').trim();
                const productId = String(row?.product_id || '').trim();
                if (!orderItemId || !productId) return null;

                const allocatedTotalForProduct = Math.max(0, Number(allocatedByProduct[productId] || 0));
                if (allocatedTotalForProduct > 0) return null;

                const orderedQtyOriginal = Math.max(0, Number(row?.ordered_qty_original || row?.qty || 0));
                const canceledBackorderQty = Math.max(0, Number(row?.qty_canceled_backorder || 0));
                const qtyPending = Math.max(0, orderedQtyOriginal - allocatedTotalForProduct - canceledBackorderQty);
                if (qtyPending <= 0) return null;

                return { orderItemId, qtyPending };
            })
            .filter(Boolean) as Array<{ orderItemId: string; qtyPending: number }>;

        if (candidates.length === 0) {
            await t.rollback();
            throw new CustomError('Tidak ada item yang memenuhi syarat indent (belum dialokasikan).', 409);
        }

        const actorId = req.user?.id ? String(req.user.id) : null;
        const actorRole = req.user?.role ? String(req.user.role) : null;

        let createdCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;
        const touchedBackorderIds: string[] = [];

        for (const candidate of candidates) {
            const existing = await Backorder.findOne({
                where: { order_item_id: candidate.orderItemId },
                transaction: t,
                lock: t.LOCK.UPDATE
            });

            if (!existing) {
                const created = await Backorder.create({
                    order_item_id: candidate.orderItemId,
                    qty_pending: candidate.qtyPending,
                    status: 'waiting_stock',
                    notes: 'dipindahkan ke indent (manual, belum dialokasikan)'
                }, { transaction: t });
                createdCount += 1;
                touchedBackorderIds.push(String(created.id));
                await recordOrderEvent({
                    transaction: t,
                    order_id: orderId,
                    order_item_id: candidate.orderItemId,
                    event_type: 'backorder_opened',
                    actor_user_id: actorId,
                    actor_role: actorRole,
                    reason: 'move_to_indent',
                    payload: {
                        before: { shortage_qty: 0 },
                        after: { shortage_qty: candidate.qtyPending },
                        delta: { shortage_qty: candidate.qtyPending }
                    }
                });
                continue;
            }

            const beforePending = Math.max(0, Number(existing.qty_pending || 0));
            const beforeStatus = String(existing.status || '').trim().toLowerCase();
            if (beforePending === candidate.qtyPending && beforeStatus === 'waiting_stock') {
                skippedCount += 1;
                touchedBackorderIds.push(String(existing.id));
                continue;
            }

            await existing.update({
                qty_pending: candidate.qtyPending,
                status: 'waiting_stock'
            }, { transaction: t });
            updatedCount += 1;
            touchedBackorderIds.push(String(existing.id));

            const isOpening = beforePending <= 0 || ['fulfilled', 'canceled', 'cancelled'].includes(beforeStatus);
            await recordOrderEvent({
                transaction: t,
                order_id: orderId,
                order_item_id: candidate.orderItemId,
                event_type: isOpening ? 'backorder_opened' : 'backorder_reallocated',
                actor_user_id: actorId,
                actor_role: actorRole,
                reason: 'move_to_indent',
                payload: {
                    before: { shortage_qty: beforePending },
                    after: { shortage_qty: candidate.qtyPending },
                    delta: { shortage_qty: candidate.qtyPending - beforePending }
                }
            });
        }

        await emitAdminRefreshBadges({
            transaction: t,
            requestContext: 'move_order_to_indent'
        });

        await t.commit();

        res.json({
            message: 'Order berhasil dipindahkan ke indent.',
            order_id: orderId,
            created: createdCount,
            updated: updatedCount,
            skipped: skippedCount,
            backorder_ids: touchedBackorderIds
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        throw error;
    }
});

export const reportMissingItem = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const orderId = String(req.params.id);
        const userId = req.user!.id;
        const { items, note } = req.body;
        // items: [{ product_id, qty_missing }]

        const order = await Order.findByPk(orderId, {
            include: [
                { model: OrderItem },
                { model: OrderAllocation, as: 'Allocations' }
            ],
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (!order) {
            await t.rollback();
            throw new CustomError('Order not found', 404);
        }

        // 1. Validate Status: Must be Delivered or Completed
        if (!['delivered', 'completed'].includes(order.status)) {
            await t.rollback();
            throw new CustomError('Laporan barang kurang hanya bisa dibuat setelah pesanan diterima (delivered/completed).', 400);
        }

        // 2. Validate Items
        if (!Array.isArray(items) || items.length === 0) {
            await t.rollback();
            throw new CustomError('Daftar barang kurang wajib diisi.', 400);
        }

        const missingItemsData: string[] = [];

        for (const item of items) {
            const pid = String(item.product_id);
            const qtyMissing = Number(item.qty_missing);

            if (qtyMissing <= 0) continue;

            const orderItem = (order.OrderItems || []).find((oi: any) => String(oi.product_id) === pid);
            if (!orderItem) {
                await t.rollback();
                throw new CustomError(`Produk ID ${pid} tidak ada dalam pesanan ini.`, 400);
            }

            if (qtyMissing > Number(orderItem.qty)) {
                await t.rollback();
                throw new CustomError(`Jumlah barang kurang untuk produk ${pid} melebihi jumlah pesanan.`, 400);
            }

            const productName = (orderItem as any).Product?.name || pid;
            missingItemsData.push(`${productName} (Qty: ${qtyMissing})`);
        }

        if (missingItemsData.length === 0) {
            await t.rollback();
            throw new CustomError('Tidak ada item valid yang dilaporkan.', 400);
        }

        // 3. Create Order Issue
        const issueNote = `Barang Kurang: ${missingItemsData.join(', ')}. Catatan: ${note || '-'}`;
        const dueAt = new Date();
        dueAt.setHours(dueAt.getHours() + 48); // 48h SLA

        await OrderIssue.create({
            order_id: orderId,
            issue_type: 'missing_item', // Ensure this enum value is supported in your model
            status: 'open',
            note: issueNote,
            due_at: dueAt,
            created_by: userId
        }, { transaction: t });

        await emitAdminRefreshBadges({
            transaction: t,
            requestContext: 'admin_missing_item_refresh_badges'
        });
        await t.commit();
        res.status(201).json({ message: 'Laporan barang kurang berhasil dibuat. Tim kami akan segera melakukan verifikasi.' });

    } catch (error) {
        try { await t.rollback(); } catch { }
        throw error;
    }
});

const round2 = (value: number) => Math.round(Number(value || 0) * 100) / 100;
const round4 = (value: number) => Number(Number(value || 0).toFixed(4));

const toObjectOrEmpty = (value: unknown): Record<string, any> => {
    if (!value) return {};
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return {};
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, any>;
        } catch { }
        return {};
    }
    if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
    return {};
};

const getSnapshotNumber = (snapshot: any, ...keys: string[]): number | null => {
    for (const key of keys) {
        const raw = snapshot?.[key];
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
};

export const updateOrderPricing = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const userRole = String(req.user?.role || '').trim();
        const actorId = String(req.user?.id || '').trim() || null;
        const actorRole = userRole || null;

        if (!['super_admin', 'kasir'].includes(userRole)) {
            await t.rollback();
            throw new CustomError('Tidak memiliki akses', 403);
        }

        const orderId = String(req.params.id || '').trim();
        if (!orderId) {
            await t.rollback();
            throw new CustomError('Order id wajib diisi', 400);
        }

        const itemsRaw = req.body?.items;
        if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
            await t.rollback();
            throw new CustomError('Items wajib diisi', 400);
        }
        const orderReason = typeof req.body?.reason === 'string' ? String(req.body.reason).trim() : '';

        const requestedItems = itemsRaw.map((row: any) => ({
            order_item_id: String(row?.order_item_id || '').trim(),
            unit_price_override: Number(row?.unit_price_override),
            reason: typeof row?.reason === 'string' ? String(row.reason).trim() : '',
            preferred_unit_cost_present: typeof row === 'object' && row !== null && Object.prototype.hasOwnProperty.call(row, 'preferred_unit_cost'),
            preferred_unit_cost: (row as any)?.preferred_unit_cost,
        }));

        if (requestedItems.some((row) => !row.order_item_id)) {
            await t.rollback();
            throw new CustomError('order_item_id tidak valid', 400);
        }
        if (requestedItems.some((row) => !Number.isFinite(row.unit_price_override) || row.unit_price_override <= 0)) {
            await t.rollback();
            throw new CustomError('Harga deal tidak valid', 400);
        }
        if (requestedItems.some((row) => {
            if (!row.preferred_unit_cost_present) return false;
            const raw = row.preferred_unit_cost;
            if (raw === null || raw === undefined) return false;
            if (typeof raw === 'string' && raw.trim() === '') return false;
            const parsed = Number(raw);
            return !Number.isFinite(parsed) || parsed <= 0;
        })) {
            await t.rollback();
            throw new CustomError('Layer modal (preferred_unit_cost) tidak valid', 400);
        }

        const order = await Order.findByPk(orderId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!order) {
            await t.rollback();
            throw new CustomError('Order tidak ditemukan', 404);
        }

        const currentStatus = String(order.status || '').trim().toLowerCase();
        const IMMUTABLE_STATUSES = new Set(['canceled', 'expired', 'shipped', 'delivered', 'completed']);
        if (IMMUTABLE_STATUSES.has(currentStatus)) {
            await t.rollback();
            throw new CustomError(`Harga nego tidak bisa diubah pada status '${currentStatus}'.`, 409);
        }
        if ((order as any).goods_out_posted_at) {
            await t.rollback();
            throw new CustomError('Harga nego tidak bisa diubah karena goods-out sudah diposting.', 409);
        }

        // Invoice can already exist (partial invoicing/backorder). We still allow updating the order items so the next
        // invoice uses the new pricing. Previously-issued invoice lines remain unchanged because they snapshot unit_price.
        // For post-invoice adjustments to an existing invoice, use Credit Note instead.

        const orderItemIds = Array.from(new Set(requestedItems.map((row) => row.order_item_id))).filter(Boolean);
        const orderItems = await OrderItem.findAll({
            where: { id: { [Op.in]: orderItemIds }, order_id: orderId },
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (orderItems.length !== orderItemIds.length) {
            await t.rollback();
            throw new CustomError('Sebagian item order tidak ditemukan atau tidak sesuai order.', 400);
        }

        const byId = new Map(orderItems.map((row: any) => [String(row.id), row]));
        let deltaTotal = 0;
        const changes: any[] = [];
        const nowIso = new Date().toISOString();

        for (const reqItem of requestedItems) {
            const row = byId.get(reqItem.order_item_id);
            if (!row) continue;

            const oldUnit = round2(Number(row.price_at_purchase || 0));
            const newUnit = round2(Number(reqItem.unit_price_override || 0));
            const qty = Math.max(0, Number(row.qty || 0));
            const cost = round2(Number(row.cost_at_purchase || 0));
            const oldPreferredCostRaw = (row as any).preferred_unit_cost;
            const oldPreferredUnitCost = oldPreferredCostRaw === null || oldPreferredCostRaw === undefined || String(oldPreferredCostRaw).trim() === ''
                ? null
                : round4(Number(oldPreferredCostRaw));
            let nextPreferredUnitCost: number | null | undefined = undefined;
            if (reqItem.preferred_unit_cost_present) {
                const raw = reqItem.preferred_unit_cost;
                if (raw === null || raw === undefined || String(raw).trim() === '') {
                    nextPreferredUnitCost = null;
                } else {
                    const parsed = Number(raw);
                    nextPreferredUnitCost = Number.isFinite(parsed) && parsed > 0 ? round4(parsed) : null;
                }
            }

            if (newUnit <= 0 || !Number.isFinite(newUnit)) {
                await t.rollback();
                throw new CustomError('Harga deal tidak valid', 400);
            }

            if (userRole === 'kasir' && Number.isFinite(cost) && newUnit < cost) {
                await t.rollback();
                throw new CustomError('Kasir tidak boleh menurunkan harga di bawah modal', 400);
            }

            const snapshot = toObjectOrEmpty((row as any).pricing_snapshot);
            const baseline = round2(getSnapshotNumber(snapshot, 'computed_unit_price', 'computedUnitPrice') ?? oldUnit);

            // Negotiation is intended to lower price, not raise it.
            if (newUnit > baseline) {
                await t.rollback();
                throw new CustomError('Harga deal tidak boleh lebih tinggi dari harga normal', 400);
            }

            const itemReason = reqItem.reason || orderReason || '';
            const overrideEntry = {
                unit_price: newUnit,
                reason: itemReason ? itemReason : null,
                actor_user_id: actorId,
                actor_role: actorRole,
                at: nowIso
            };

            const history = Array.isArray(snapshot.override_history) ? snapshot.override_history : [];
            history.push({
                ...overrideEntry,
                prev_unit_price: oldUnit
            });

            const nextSnapshot = {
                ...snapshot,
                computed_unit_price: baseline,
                final_unit_price: newUnit,
                override: overrideEntry,
                override_history: history
            };

            const lineDelta = round2((newUnit - oldUnit) * qty);
            deltaTotal = round2(deltaTotal + lineDelta);
            changes.push({
                order_item_id: String(row.id),
                product_id: String(row.product_id || ''),
                qty,
                before_unit_price: oldUnit,
                after_unit_price: newUnit,
                baseline_unit_price: baseline,
                delta_total: lineDelta,
                reason: overrideEntry.reason,
                ...(reqItem.preferred_unit_cost_present ? {
                    before_preferred_unit_cost: oldPreferredUnitCost,
                    after_preferred_unit_cost: nextPreferredUnitCost
                } : {})
            });

            await row.update({
                price_at_purchase: newUnit,
                pricing_snapshot: nextSnapshot,
                ...(reqItem.preferred_unit_cost_present ? { preferred_unit_cost: nextPreferredUnitCost } : {})
            }, { transaction: t });
        }

        const prevTotal = round2(Number(order.total_amount || 0));
        const prevDiscount = round2(Number(order.discount_amount || 0));
        const nextTotal = Math.max(0, round2(prevTotal + deltaTotal));
        const nextDiscount = Math.max(0, round2(prevDiscount - deltaTotal));

        const prevPoints = Math.floor(Math.max(0, prevTotal) / 1000);
        const nextPoints = Math.floor(Math.max(0, nextTotal) / 1000);
        const pointsDelta = nextPoints - prevPoints;

        const pricingNoteUpdate = orderReason ? orderReason : null;
        await order.update({
            total_amount: nextTotal,
            discount_amount: nextDiscount,
            ...(pricingNoteUpdate !== null ? { pricing_override_note: pricingNoteUpdate } : {})
        }, { transaction: t });

        const customerId = String((order as any).customer_id || '').trim();
        if (customerId && pointsDelta !== 0) {
            const profile = await CustomerProfile.findOne({
                where: { user_id: customerId },
                transaction: t,
                lock: t.LOCK.UPDATE
            });
            if (profile) {
                const currentPoints = Number((profile as any).points || 0);
                const updatedPoints = Math.max(0, currentPoints + pointsDelta);
                await profile.update({ points: updatedPoints }, { transaction: t });
            } else if (pointsDelta > 0) {
                await CustomerProfile.create({
                    user_id: customerId,
                    tier: 'regular',
                    credit_limit: 0,
                    points: pointsDelta,
                    saved_addresses: []
                }, { transaction: t });
            }
        }

        const hasAnyAllocation = await OrderAllocation.findOne({
            where: { order_id: orderId, allocated_qty: { [Op.gt]: 0 } },
            attributes: ['id'],
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (hasAnyAllocation) {
            await InventoryReservationService.syncReservationsForOrder({ order_id: orderId, transaction: t });
        }

        await recordOrderEvent({
            transaction: t,
            order_id: orderId,
            event_type: 'order_pricing_adjusted',
            actor_user_id: actorId,
            actor_role: actorRole,
            reason: orderReason || null,
            payload: {
                before: { total_amount: prevTotal, discount_amount: prevDiscount },
                after: { total_amount: nextTotal, discount_amount: nextDiscount },
                delta: { total_amount: deltaTotal, points_delta: pointsDelta },
                items: changes
            }
        });

        await emitAdminRefreshBadges({
            transaction: t,
            requestContext: 'admin_order_pricing_adjusted_refresh_badges'
        });

        await t.commit();
        res.json({
            message: 'Harga nego berhasil diperbarui',
            order_id: orderId,
            total_amount: nextTotal,
            discount_amount: nextDiscount,
            points_delta: pointsDelta
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        throw error;
    }
});

export const updateOrderCostLayerPreference = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const userRole = String(req.user?.role || '').trim();
        const actorId = String(req.user?.id || '').trim() || null;
        const actorRole = userRole || null;

        if (!['super_admin', 'kasir'].includes(userRole)) {
            await t.rollback();
            throw new CustomError('Tidak memiliki akses', 403);
        }

        const orderId = String(req.params.id || '').trim();
        if (!orderId) {
            await t.rollback();
            throw new CustomError('Order id wajib diisi', 400);
        }

        const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
        if (rawItems.length === 0) {
            await t.rollback();
            throw new CustomError('Items wajib diisi', 400);
        }

        const orderReason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
        const requestedItems = rawItems
            .map((row: any) => {
                const order_item_id = String(row?.order_item_id || '').trim();
                const preferred_unit_cost_present = Object.prototype.hasOwnProperty.call(row || {}, 'preferred_unit_cost');
                const preferred_unit_cost = preferred_unit_cost_present ? (row as any).preferred_unit_cost : undefined;
                const reason = typeof row?.reason === 'string' ? row.reason.trim() : '';
                return { order_item_id, preferred_unit_cost_present, preferred_unit_cost, reason };
            })
            .filter((row: any) => Boolean(row.order_item_id));

        if (requestedItems.length === 0) {
            await t.rollback();
            throw new CustomError('Order item tidak valid.', 400);
        }

        if (requestedItems.some((row: any) => row.preferred_unit_cost_present && (() => {
            const raw = row.preferred_unit_cost;
            if (raw === null || raw === undefined) return false;
            if (typeof raw === 'string' && raw.trim() === '') return false;
            const parsed = Number(raw);
            return !Number.isFinite(parsed) || parsed <= 0;
        })())) {
            await t.rollback();
            throw new CustomError('Layer modal (preferred_unit_cost) tidak valid', 400);
        }

        const order = await Order.findByPk(orderId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!order) {
            await t.rollback();
            throw new CustomError('Order tidak ditemukan', 404);
        }

        if ((order as any).goods_out_posted_at) {
            await t.rollback();
            throw new CustomError('Layer modal tidak bisa diubah karena goods-out sudah diposting.', 409);
        }

        const currentStatus = String(order.status || '').trim().toLowerCase();
        const IMMUTABLE_STATUSES = new Set(['canceled', 'expired', 'completed', 'delivered', 'shipped']);
        if (IMMUTABLE_STATUSES.has(currentStatus)) {
            await t.rollback();
            throw new CustomError(`Layer modal tidak bisa diubah pada status '${currentStatus}'.`, 409);
        }

        const orderItemIds: string[] = Array.from(
            new Set(requestedItems.map((row: any) => String(row.order_item_id || '').trim()).filter(Boolean))
        );
        const orderItems = await OrderItem.findAll({
            where: { id: { [Op.in]: orderItemIds }, order_id: orderId },
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (orderItems.length !== orderItemIds.length) {
            await t.rollback();
            throw new CustomError('Sebagian item order tidak ditemukan atau tidak sesuai order.', 400);
        }

        const byId = new Map(orderItems.map((row: any) => [String(row.id), row]));
        const changes: any[] = [];

        for (const reqItem of requestedItems) {
            const row = byId.get(reqItem.order_item_id);
            if (!row) continue;
            if (!reqItem.preferred_unit_cost_present) continue;

            if (String((row as any).clearance_promo_id || '').trim()) {
                await t.rollback();
                throw new CustomError('Layer modal dikunci oleh promo cepat habis.', 409);
            }

            const oldPreferredRaw = (row as any).preferred_unit_cost;
            const oldPreferredUnitCost = oldPreferredRaw === null || oldPreferredRaw === undefined || String(oldPreferredRaw).trim() === ''
                ? null
                : round4(Number(oldPreferredRaw));

            let nextPreferredUnitCost: number | null = null;
            const raw = reqItem.preferred_unit_cost;
            if (raw === null || raw === undefined || String(raw).trim() === '') {
                nextPreferredUnitCost = null;
            } else {
                const parsed = Number(raw);
                nextPreferredUnitCost = Number.isFinite(parsed) && parsed > 0 ? round4(parsed) : null;
            }

            if (oldPreferredUnitCost === nextPreferredUnitCost) continue;

            await row.update({ preferred_unit_cost: nextPreferredUnitCost }, { transaction: t });
            changes.push({
                order_item_id: String(row.id),
                product_id: String((row as any).product_id || ''),
                before_preferred_unit_cost: oldPreferredUnitCost,
                after_preferred_unit_cost: nextPreferredUnitCost,
                reason: reqItem.reason || orderReason || null,
            });
        }

        const hasAnyAllocation = await OrderAllocation.findOne({
            where: { order_id: orderId, allocated_qty: { [Op.gt]: 0 } },
            attributes: ['id'],
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        let reservationSummary: any = null;
        if (hasAnyAllocation) {
            reservationSummary = await InventoryReservationService.syncReservationsForOrder({ order_id: orderId, transaction: t });
        }

        if (orderReason) {
            await order.update({ pricing_override_note: orderReason }, { transaction: t });
        }

        if (changes.length > 0 || orderReason) {
            await recordOrderEvent({
                transaction: t,
                order_id: orderId,
                event_type: 'order_pricing_adjusted',
                actor_user_id: actorId,
                actor_role: actorRole,
                reason: orderReason || null,
                payload: {
                    delta: { preferred_unit_cost_changed: changes.length > 0 },
                    items: changes
                }
            });
        }

        await emitAdminRefreshBadges({
            transaction: t,
            requestContext: 'admin_order_cost_layer_preference_refresh_badges'
        });

        await t.commit();
        res.json({
            message: changes.length > 0 ? 'Layer modal berhasil diperbarui' : 'Tidak ada perubahan layer modal',
            order_id: orderId,
            updated_items: changes.length,
            reservation_summary: reservationSummary
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        throw error;
    }
});

export const getDashboardStats = asyncWrapper(async (req: Request, res: Response) => {
    const counts = await Order.findAll({
        attributes: [
            'status',
            [sequelize.fn('COUNT', sequelize.col('id')), 'count']
        ],
        group: ['status'],
        raw: true
    }) as unknown as { status: string, count: number }[];

    const stats = {
        pending: 0,
        waiting_invoice: 0,
        delivered: 0,
        ready_to_ship: 0,
        checked: 0,
        shipped: 0,
        completed: 0,
        canceled: 0,
        waiting_admin_verification: 0,
        allocated: 0,
        partially_fulfilled: 0,
        debt_pending: 0,
        hold: 0,
        expired: 0,
        total: 0
    };

    counts.forEach(item => {
        const status = String(item.status || '');
        const count = Number(item.count || 0);
        if (status && (stats as any)[status] !== undefined) {
            (stats as any)[status] = count;
        }
        stats.total += count;
    });

    res.json(stats);
});

export const getMonitoringSummary = asyncWrapper(async (req: Request, res: Response) => {
    const scopeRaw = String(req.query.scope || 'active').trim().toLowerCase();
    const scope: 'active' | 'all' = scopeRaw === 'all' ? 'all' : 'active';

    const limitTopRaw = Number(req.query.limitTop || 20);
    const limitTop = Math.max(1, Math.min(100, Number.isFinite(limitTopRaw) ? Math.trunc(limitTopRaw) : 20));

    const startDateRaw = typeof req.query.startDate === 'string' ? req.query.startDate : '';
    const endDateRaw = typeof req.query.endDate === 'string' ? req.query.endDate : '';

    const createdAtRange: any = {};
    if (startDateRaw) {
        const start = new Date(startDateRaw);
        if (!Number.isNaN(start.getTime())) {
            start.setHours(0, 0, 0, 0);
            createdAtRange[Op.gte] = start;
        }
    }
    if (endDateRaw) {
        const end = new Date(endDateRaw);
        if (!Number.isNaN(end.getTime())) {
            end.setHours(23, 59, 59, 999);
            createdAtRange[Op.lte] = end;
        }
    }

    const orderWhere: any = {};
    if (scope === 'active') {
        orderWhere.status = { [Op.notIn]: ['completed', 'canceled', 'expired'] };
    }
    if (Object.keys(createdAtRange).length > 0) {
        orderWhere.createdAt = createdAtRange;
    }

    const toNumber = (value: unknown): number => {
        const n = Number(value || 0);
        return Number.isFinite(n) ? n : 0;
    };

    const statusRows = await Order.findAll({
        attributes: [
            'status',
            [sequelize.fn('COUNT', sequelize.col('id')), 'count']
        ],
        where: orderWhere,
        group: ['status'],
        raw: true
    }) as unknown as { status: string, count: number }[];

    const byStatus: Record<string, number> = {};
    let orderTotal = 0;
    statusRows.forEach((row) => {
        const status = String((row as any)?.status || '').trim();
        const count = toNumber((row as any)?.count);
        if (!status) return;
        byStatus[status] = count;
        orderTotal += count;
    });

    const orderedRow = await OrderItem.findOne({
        attributes: [[sequelize.fn('SUM', sequelize.col('OrderItem.qty')), 'sum_qty']],
        include: [{ model: Order, attributes: [], required: true, where: orderWhere }],
        raw: true
    }) as unknown as { sum_qty?: unknown } | null;

    const canceledRow = await OrderItem.findOne({
        attributes: [
            [sequelize.fn('SUM', sequelize.col('OrderItem.qty_canceled_manual')), 'sum_manual'],
            [sequelize.fn('SUM', sequelize.col('OrderItem.qty_canceled_backorder')), 'sum_backorder'],
        ],
        include: [{ model: Order, attributes: [], required: true, where: orderWhere }],
        raw: true
    }) as unknown as { sum_manual?: unknown; sum_backorder?: unknown } | null;

    const allocatedRow = await OrderAllocation.findOne({
        attributes: [[sequelize.fn('SUM', sequelize.col('OrderAllocation.allocated_qty')), 'sum_allocated']],
        include: [{ model: Order, attributes: [], required: true, where: orderWhere }],
        raw: true
    }) as unknown as { sum_allocated?: unknown } | null;

    const backorderRow = await Backorder.findOne({
        attributes: [[sequelize.fn('SUM', sequelize.col('Backorder.qty_pending')), 'sum_pending']],
        where: {
            qty_pending: { [Op.gt]: 0 },
            status: { [Op.notIn]: ['fulfilled', 'canceled'] }
        },
        include: [{
            model: OrderItem,
            attributes: [],
            required: true,
            include: [{ model: Order, attributes: [], required: true, where: orderWhere }]
        }],
        raw: true
    }) as unknown as { sum_pending?: unknown } | null;

    const range: { startDate?: string; endDate?: string } = {};
    if (startDateRaw) range.startDate = startDateRaw;
    if (endDateRaw) range.endDate = endDateRaw;

    const sqlFilters: string[] = [];
    const replacements: Record<string, unknown> = { limitTop };

    if (scope === 'active') {
        sqlFilters.push("o.status NOT IN ('completed','canceled','expired')");
    }
    if (createdAtRange[Op.gte]) {
        sqlFilters.push('o.createdAt >= :startAt');
        replacements.startAt = createdAtRange[Op.gte];
    }
    if (createdAtRange[Op.lte]) {
        sqlFilters.push('o.createdAt <= :endAt');
        replacements.endAt = createdAtRange[Op.lte];
    }

    const orderFilterSql = sqlFilters.length > 0 ? `AND ${sqlFilters.join(' AND ')}` : '';

    const topBackorderOrders = await sequelize.query(
        `
        SELECT
          o.id AS order_id,
          COALESCE(NULLIF(o.customer_name, ''), c.name) AS customer_name,
          o.status AS status,
          o.createdAt AS createdAt,
          SUM(b.qty_pending) AS qty_pending
        FROM backorders b
        JOIN order_items oi ON oi.id = b.order_item_id
        JOIN orders o ON o.id = oi.order_id
        LEFT JOIN users c ON c.id = o.customer_id
        WHERE b.qty_pending > 0
          AND b.status NOT IN ('fulfilled', 'canceled')
          ${orderFilterSql}
        GROUP BY o.id, o.customer_name, c.name, o.status, o.createdAt
        ORDER BY qty_pending DESC
        LIMIT :limitTop
        `,
        { replacements, type: QueryTypes.SELECT }
    ) as Array<{ order_id: string; customer_name: string; status: string; createdAt: string; qty_pending: unknown }>;

    const topCanceledOrders = await sequelize.query(
        `
        SELECT
          o.id AS order_id,
          COALESCE(NULLIF(o.customer_name, ''), c.name) AS customer_name,
          o.status AS status,
          o.createdAt AS createdAt,
          SUM(oi.qty_canceled_manual + oi.qty_canceled_backorder) AS qty_canceled
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        LEFT JOIN users c ON c.id = o.customer_id
        WHERE (oi.qty_canceled_manual > 0 OR oi.qty_canceled_backorder > 0)
          ${orderFilterSql}
        GROUP BY o.id, o.customer_name, c.name, o.status, o.createdAt
        ORDER BY qty_canceled DESC
        LIMIT :limitTop
        `,
        { replacements, type: QueryTypes.SELECT }
    ) as Array<{ order_id: string; customer_name: string; status: string; createdAt: string; qty_canceled: unknown }>;

    res.json({
        scope,
        range,
        quantities: {
            ordered_net: toNumber((orderedRow as any)?.sum_qty),
            allocated: toNumber((allocatedRow as any)?.sum_allocated),
            backorder_pending: toNumber((backorderRow as any)?.sum_pending),
            canceled: toNumber((canceledRow as any)?.sum_manual) + toNumber((canceledRow as any)?.sum_backorder),
        },
        orders: {
            by_status: byStatus,
            total: orderTotal
        },
        top: {
            backorder_orders: (Array.isArray(topBackorderOrders) ? topBackorderOrders : []).map((row) => ({
                order_id: String((row as any)?.order_id || ''),
                customer_name: String((row as any)?.customer_name || ''),
                status: String((row as any)?.status || ''),
                createdAt: String((row as any)?.createdAt || ''),
                qty_pending: toNumber((row as any)?.qty_pending),
            })),
            canceled_orders: (Array.isArray(topCanceledOrders) ? topCanceledOrders : []).map((row) => ({
                order_id: String((row as any)?.order_id || ''),
                customer_name: String((row as any)?.customer_name || ''),
                status: String((row as any)?.status || ''),
                createdAt: String((row as any)?.createdAt || ''),
                qty_canceled: toNumber((row as any)?.qty_canceled),
            })),
        }
    });
});

export const getMonitoringSkuSummary = asyncWrapper(async (req: Request, res: Response) => {
    const scopeRaw = String(req.query.scope || 'active').trim().toLowerCase();
    const scope: 'active' | 'all' = scopeRaw === 'all' ? 'all' : 'active';

    const pageRaw = Number(req.query.page || 1);
    const limitRaw = Number(req.query.limit || 50);
    const page = Math.max(1, Number.isFinite(pageRaw) ? Math.trunc(pageRaw) : 1);
    const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 50));
    const offset = (page - 1) * limit;

    const searchText = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const startDateRaw = typeof req.query.startDate === 'string' ? req.query.startDate : '';
    const endDateRaw = typeof req.query.endDate === 'string' ? req.query.endDate : '';

    const createdAtRange: any = {};
    if (startDateRaw) {
        const start = new Date(startDateRaw);
        if (!Number.isNaN(start.getTime())) {
            start.setHours(0, 0, 0, 0);
            createdAtRange[Op.gte] = start;
        }
    }
    if (endDateRaw) {
        const end = new Date(endDateRaw);
        if (!Number.isNaN(end.getTime())) {
            end.setHours(23, 59, 59, 999);
            createdAtRange[Op.lte] = end;
        }
    }

    const filters: string[] = [];
    const replacements: Record<string, unknown> = {
        limit,
        offset,
        search: `%${searchText}%`,
    };

    if (scope === 'active') {
        filters.push("o.status NOT IN ('completed','canceled','expired')");
    }
    if (createdAtRange[Op.gte]) {
        filters.push('o.createdAt >= :startAt');
        replacements.startAt = createdAtRange[Op.gte];
    }
    if (createdAtRange[Op.lte]) {
        filters.push('o.createdAt <= :endAt');
        replacements.endAt = createdAtRange[Op.lte];
    }
    if (searchText) {
        filters.push('(p.sku LIKE :search OR p.name LIKE :search)');
    }

    const whereSql = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

    const countRows = await sequelize.query(
        `
        SELECT COUNT(*) AS total
        FROM (
          SELECT p.id
          FROM (
            SELECT
              oi.order_id AS order_id,
              oi.product_id AS product_id,
              SUM(oi.qty) AS ordered_net_qty,
              SUM(oi.qty_canceled_manual + oi.qty_canceled_backorder) AS canceled_qty
            FROM order_items oi
            GROUP BY oi.order_id, oi.product_id
          ) ia
          JOIN orders o ON o.id = ia.order_id
          JOIN products p ON p.id = ia.product_id
          ${whereSql}
          GROUP BY p.id
        ) t
        `,
        { replacements, type: QueryTypes.SELECT }
    ) as Array<{ total: unknown }>;

    const total = Math.max(0, Number((countRows?.[0] as any)?.total || 0));
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const rows = await sequelize.query(
        `
        SELECT
          p.id AS product_id,
          p.sku AS sku,
          p.name AS name,
          p.status AS product_status,
          p.stock_quantity AS stock_quantity,
          p.min_stock AS min_stock,
          COUNT(DISTINCT o.id) AS order_count,
          SUM(ia.ordered_net_qty) AS ordered_net_qty,
          SUM(IFNULL(aa.allocated_qty, 0)) AS allocated_qty,
          SUM(IFNULL(ba.backorder_pending_qty, 0)) AS backorder_pending_qty,
          SUM(ia.canceled_qty) AS canceled_qty
        FROM (
          SELECT
            oi.order_id AS order_id,
            oi.product_id AS product_id,
            SUM(oi.qty) AS ordered_net_qty,
            SUM(oi.qty_canceled_manual + oi.qty_canceled_backorder) AS canceled_qty
          FROM order_items oi
          GROUP BY oi.order_id, oi.product_id
        ) ia
        JOIN orders o ON o.id = ia.order_id
        JOIN products p ON p.id = ia.product_id
        LEFT JOIN (
          SELECT
            oa.order_id AS order_id,
            oa.product_id AS product_id,
            SUM(oa.allocated_qty) AS allocated_qty
          FROM order_allocations oa
          GROUP BY oa.order_id, oa.product_id
        ) aa ON aa.order_id = ia.order_id AND aa.product_id = ia.product_id
        LEFT JOIN (
          SELECT
            oi.order_id AS order_id,
            oi.product_id AS product_id,
            SUM(b.qty_pending) AS backorder_pending_qty
          FROM backorders b
          JOIN order_items oi ON oi.id = b.order_item_id
          WHERE b.qty_pending > 0
            AND b.status NOT IN ('fulfilled', 'canceled')
          GROUP BY oi.order_id, oi.product_id
        ) ba ON ba.order_id = ia.order_id AND ba.product_id = ia.product_id
        ${whereSql}
        GROUP BY p.id, p.sku, p.name, p.status, p.stock_quantity, p.min_stock
        ORDER BY backorder_pending_qty DESC, ordered_net_qty DESC, p.sku ASC
        LIMIT :limit OFFSET :offset
        `,
        { replacements, type: QueryTypes.SELECT }
    ) as Array<Record<string, unknown>>;

    const range: { startDate?: string; endDate?: string } = {};
    if (startDateRaw) range.startDate = startDateRaw;
    if (endDateRaw) range.endDate = endDateRaw;

    const toNumber = (value: unknown): number => {
        const n = Number(value || 0);
        return Number.isFinite(n) ? n : 0;
    };

    res.json({
        scope,
        range,
        page,
        limit,
        total,
        totalPages,
        rows: (Array.isArray(rows) ? rows : []).map((row) => {
            const orderedNetQty = Math.max(0, Math.trunc(toNumber((row as any)?.ordered_net_qty)));
            const allocatedQty = Math.max(0, Math.trunc(toNumber((row as any)?.allocated_qty)));
            const backorderPendingQty = Math.max(0, Math.trunc(toNumber((row as any)?.backorder_pending_qty)));
            const canceledQty = Math.max(0, Math.trunc(toNumber((row as any)?.canceled_qty)));
            const stockQty = Math.trunc(toNumber((row as any)?.stock_quantity));
            const minStock = Math.max(0, Math.trunc(toNumber((row as any)?.min_stock)));
            return {
                product_id: String((row as any)?.product_id || ''),
                sku: String((row as any)?.sku || ''),
                name: String((row as any)?.name || ''),
                product_status: String((row as any)?.product_status || ''),
                stock_quantity: stockQty,
                min_stock: minStock,
                order_count: Math.max(0, Math.trunc(toNumber((row as any)?.order_count))),
                ordered_net_qty: orderedNetQty,
                allocated_qty: allocatedQty,
                backorder_pending_qty: backorderPendingQty,
                canceled_qty: canceledQty,
                unallocated_qty: Math.max(0, orderedNetQty - allocatedQty),
                suggested_purchase_qty: Math.max(0, backorderPendingQty - Math.max(0, stockQty)),
            };
        }),
    });
});
