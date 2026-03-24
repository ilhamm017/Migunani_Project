import { Request, Response } from 'express';
import { Order, OrderIssue, OrderItem, Product, Invoice, InvoiceItem, Cart, CartItem, User, sequelize, OrderAllocation, CustomerProfile, Retur, Backorder, Category, Setting, Account } from '../../models';
import { Op } from 'sequelize';
import { resolveShippingMethodByCode } from '../ShippingMethodController';
import waClient, { getStatus as getWaStatus } from '../../services/whatsappClient';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { JournalService } from '../../services/JournalService';
import { emitAdminRefreshBadges, emitOrderStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders, findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../../utils/invoiceLookup';
import { recordOrderEvent } from '../../utils/orderEvent';
import { DELIVERY_EMPLOYEE_ROLES, withOrderTrackingFields, normalizeIssueNote, ISSUE_SLA_HOURS, resolveEmployeeDisplayName, ORDER_STATUS_OPTIONS } from './utils';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';
import { isLegacyOrderStatusAlias, isOrderTransitionAllowed, resolveLegacyOrderStatusAlias } from '../../utils/orderTransitions';

export const getAllOrders = asyncWrapper(async (req: Request, res: Response) => {
    const { page = 1, limit = 10, status, search, startDate, endDate, dateFrom, dateTo, is_backorder, exclude_backorder, updatedAfter } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

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
    const rows = rowsWithInvoices.map((row) => withOrderTrackingFields(row as any));

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
        const { status, courier_id, issue_type, issue_note, resolution_note } = req.body;

        const nextStatus = typeof status === 'string' ? status : '';
        if (!ORDER_STATUS_OPTIONS.includes(nextStatus as (typeof ORDER_STATUS_OPTIONS)[number])) {
            await t.rollback();
            throw new CustomError('Status order tidak valid', 400);
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
            'ready_to_ship': { roles: ['admin_gudang'], to: ['shipped'] },
            'hold': { roles: ['admin_gudang'], to: ['shipped'] },
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
                attributes: ['id', 'product_id', 'qty', 'ordered_qty_original', 'qty_canceled_backorder'],
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

            // Keep OrderItem backorder fields in sync with Backorder cancellation so
            // customer/admin detail pages don't show "Backorder Aktif" for canceled orders.
            if (orderItems.length > 0) {
                const allocations = await OrderAllocation.findAll({
                    where: { order_id: orderId },
                    attributes: ['product_id', 'allocated_qty'],
                    transaction: t,
                    lock: t.LOCK.UPDATE
                });
                const allocatedByProduct = allocations.reduce((acc: Record<string, number>, row: any) => {
                    const productId = String(row?.product_id || '').trim();
                    if (!productId) return acc;
                    acc[productId] = Number(acc[productId] || 0) + Math.max(0, Number(row?.allocated_qty || 0));
                    return acc;
                }, {});

                const itemsByProduct = new Map<string, any[]>();
                orderItems.forEach((item: any) => {
                    const productId = String(item?.product_id || '').trim();
                    if (!productId) return;
                    const rows = itemsByProduct.get(productId) || [];
                    rows.push(item);
                    itemsByProduct.set(productId, rows);
                });

                const allocatedByItemId: Record<string, number> = {};
                itemsByProduct.forEach((rows, productId) => {
                    let remaining = Math.max(0, Number(allocatedByProduct[productId] || 0));
                    const sortedRows = [...rows].sort((a: any, b: any) => String(a?.id || '').localeCompare(String(b?.id || '')));
                    sortedRows.forEach((row: any) => {
                        const itemId = String(row?.id || '');
                        const activeQty = Math.max(0, Number(row?.qty || 0));
                        const allocatedQty = Math.max(0, Math.min(remaining, activeQty));
                        allocatedByItemId[itemId] = allocatedQty;
                        remaining = Math.max(0, remaining - allocatedQty);
                    });
                });

                for (const item of orderItems as any[]) {
                    const itemId = String(item?.id || '').trim();
                    if (!itemId) continue;
                    const orderedQtyOriginal = Math.max(0, Number(item?.ordered_qty_original || item?.qty || 0));
                    const allocatedQtyTotal = Math.max(0, Number(allocatedByItemId[itemId] || 0));
                    const canceledBefore = Math.max(0, Number(item?.qty_canceled_backorder || 0));
                    const remainingToCancel = Math.max(0, orderedQtyOriginal - allocatedQtyTotal - canceledBefore);
                    if (remainingToCancel <= 0) continue;

                    await OrderItem.update({
                        qty_canceled_backorder: canceledBefore + remainingToCancel,
                    }, {
                        where: { id: itemId },
                        transaction: t
                    });
                }
            }
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

                const productStock = Number(row?.Product?.stock_quantity);
                if (!Number.isFinite(productStock) || productStock > 0) return null;

                const orderedQtyOriginal = Math.max(0, Number(row?.ordered_qty_original || row?.qty || 0));
                const canceledBackorderQty = Math.max(0, Number(row?.qty_canceled_backorder || 0));
                const qtyPending = Math.max(0, orderedQtyOriginal - allocatedTotalForProduct - canceledBackorderQty);
                if (qtyPending <= 0) return null;

                return { orderItemId, qtyPending };
            })
            .filter(Boolean) as Array<{ orderItemId: string; qtyPending: number }>;

        if (candidates.length === 0) {
            await t.rollback();
            throw new CustomError('Tidak ada item yang memenuhi syarat indent (stok 0 dan belum dialokasikan).', 409);
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
                    notes: 'dipindahkan ke indent (stok 0, belum dialokasikan)'
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
