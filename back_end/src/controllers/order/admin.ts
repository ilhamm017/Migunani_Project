import { Request, Response } from 'express';
import { Order, OrderIssue, OrderItem, Product, Invoice, InvoiceItem, Cart, CartItem, User, sequelize, OrderAllocation, CustomerProfile, Retur, Backorder, Category, Setting } from '../../models';
import { Op } from 'sequelize';
import { resolveShippingMethodByCode } from '../ShippingMethodController';
import waClient, { getStatus as getWaStatus } from '../../services/whatsappClient';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitOrderStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders, findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../../utils/invoiceLookup';
import { DELIVERY_EMPLOYEE_ROLES, withOrderTrackingFields, normalizeIssueNote, ISSUE_SLA_HOURS, resolveEmployeeDisplayName, ORDER_STATUS_OPTIONS } from './utils';

export const getAllOrders = async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 10, status, search, startDate, endDate, dateFrom, dateTo, is_backorder, exclude_backorder, updatedAfter } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const whereClause: any = {};
        let prioritizeRecentIssueUpdates = false;
        if (status && status !== 'all') {
            const statusStr = String(status);
            const statuses = statusStr.split(',').map(s => s.trim()).filter(Boolean);

            if (statuses.length > 0) {
                if (statuses.includes('ready_to_ship') && !statuses.includes('waiting_payment')) {
                    statuses.push('waiting_payment');
                }
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
            ],
            distinct: true,
            limit: Number(limit),
            offset: Number(offset),
            order: prioritizeRecentIssueUpdates
                ? [['updatedAt', 'DESC'], ['createdAt', 'DESC']]
                : [['createdAt', 'DESC']]
        });

        const plainRows = orders.rows.map((row) => row.get({ plain: true }) as any);
        const rowsWithInvoices = await attachInvoicesToOrders(plainRows);
        const rows = rowsWithInvoices.map((row) => withOrderTrackingFields(row as any));

        res.json({
            total: orders.count,
            totalPages: Math.ceil(orders.count / Number(limit)),
            currentPage: Number(page),
            orders: rows
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching orders', error });
    }
};

export const getDeliveryEmployees = async (_req: Request, res: Response) => {
    try {
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
    } catch (error) {
        res.status(500).json({ message: 'Error fetching delivery employees', error });
    }
};

export const updateOrderStatus = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const orderId = String(req.params.id);
        const userRole = req.user!.role;
        const { status, courier_id, issue_type, issue_note, resolution_note } = req.body;

        const nextStatus = typeof status === 'string' ? status : '';
        if (!ORDER_STATUS_OPTIONS.includes(nextStatus as (typeof ORDER_STATUS_OPTIONS)[number])) {
            await t.rollback();
            return res.status(400).json({ message: 'Status order tidak valid' });
        }

        const order = await Order.findByPk(orderId, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Order not found' });
        }
        let prevStatus = String(order.status || '');
        if (prevStatus === 'waiting_payment') {
            await order.update({ status: 'ready_to_ship', expiry_date: null }, { transaction: t });
            order.status = 'ready_to_ship' as any;
            prevStatus = 'ready_to_ship';
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
                    return res.status(403).json({
                        message: `Role '${userRole}' tidak bisa membatalkan order dengan status '${order.status}'.`
                    });
                }
            } else {
                const rule = ALLOWED_TRANSITIONS[order.status];
                if (!rule || !rule.roles.includes(userRole) || !rule.to.includes(nextStatus)) {
                    await t.rollback();
                    return res.status(403).json({
                        message: `Role '${userRole}' tidak bisa mengubah status dari '${order.status}' ke '${nextStatus}'. Gunakan fitur yang sesuai (alokasi, invoice, verifikasi).`
                    });
                }
            }
        }

        const normalizedResolutionNote = normalizeIssueNote(resolution_note);
        if (prevStatus === 'hold' && nextStatus === 'shipped' && !normalizedResolutionNote) {
            await t.rollback();
            return res.status(400).json({ message: 'Catatan follow-up wajib diisi sebelum kirim ulang order dari status hold.' });
        }

        // --- Courier validation for shipped ---
        let courierIdToSave: string | null = null;
        if (nextStatus === 'shipped') {
            if (typeof courier_id !== 'string' || !courier_id.trim()) {
                await t.rollback();
                return res.status(400).json({ message: 'Status dikirim wajib memilih driver/kurir' });
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
                return res.status(404).json({ message: 'Driver/kurir tidak ditemukan atau tidak aktif' });
            }
            courierIdToSave = courier.id;
        }

        const updatePayload: any = { status: nextStatus };
        if (courierIdToSave) {
            updatePayload.courier_id = courierIdToSave;
        }
        await order.update(updatePayload, { transaction: t });

        if (nextStatus === 'shipped') {
            const invoice = await findLatestInvoiceByOrderId(orderId, { transaction: t });
            if (invoice && invoice.payment_method !== 'cod') {
                await AccountingPostingService.postGoodsOutForOrder(orderId, String(req.user!.id), t, 'non_cod');
            }
        }

        // --- Issue tracking for hold ---
        if (nextStatus === 'hold') {
            const normalizedIssueType = typeof issue_type === 'string' && issue_type.trim()
                ? issue_type.trim()
                : 'shortage';
            if (normalizedIssueType !== 'shortage') {
                await t.rollback();
                return res.status(400).json({ message: 'Issue type tidak valid.' });
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
        }

        await t.commit();
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
            emitOrderStatusChanged({
                order_id: orderId,
                from_status: prevStatus || null,
                to_status: nextStatus,
                source: String(order.source || ''),
                payment_method: null,
                courier_id: courierIdToSave || String(order.courier_id || ''),
                triggered_by_role: userRole || null,
                target_roles: targetRoles,
                target_user_ids: courierIdToSave ? [courierIdToSave] : [],
            });
        } else {
            emitAdminRefreshBadges();
        }
        res.json({ message: `Order status updated to ${nextStatus}` });


    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error updating order status', error });
    }
};

export const reportMissingItem = async (req: Request, res: Response) => {
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
            return res.status(404).json({ message: 'Order not found' });
        }

        // 1. Validate Status: Must be Delivered or Completed
        if (!['delivered', 'completed'].includes(order.status)) {
            await t.rollback();
            return res.status(400).json({ message: 'Laporan barang kurang hanya bisa dibuat setelah pesanan diterima (delivered/completed).' });
        }

        // 2. Validate Items
        if (!Array.isArray(items) || items.length === 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Daftar barang kurang wajib diisi.' });
        }

        const missingItemsData: string[] = [];

        for (const item of items) {
            const pid = String(item.product_id);
            const qtyMissing = Number(item.qty_missing);

            if (qtyMissing <= 0) continue;

            const orderItem = (order.OrderItems || []).find((oi: any) => String(oi.product_id) === pid);
            if (!orderItem) {
                await t.rollback();
                return res.status(400).json({ message: `Produk ID ${pid} tidak ada dalam pesanan ini.` });
            }

            if (qtyMissing > Number(orderItem.qty)) {
                await t.rollback();
                return res.status(400).json({ message: `Jumlah barang kurang untuk produk ${pid} melebihi jumlah pesanan.` });
            }

            const productName = (orderItem as any).Product?.name || pid;
            missingItemsData.push(`${productName} (Qty: ${qtyMissing})`);
        }

        if (missingItemsData.length === 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Tidak ada item valid yang dilaporkan.' });
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

        await t.commit();
        emitAdminRefreshBadges();
        res.status(201).json({ message: 'Laporan barang kurang berhasil dibuat. Tim kami akan segera melakukan verifikasi.' });

    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Gagal membuat laporan barang kurang', error });
    }
};

export const getDashboardStats = async (req: Request, res: Response) => {
    try {
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
            waiting_payment: 0,
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
            if (status === 'waiting_payment') {
                stats.ready_to_ship += count;
                stats.total += count;
                return;
            }
            if (status && (stats as any)[status] !== undefined) {
                (stats as any)[status] = count;
            }
            stats.total += count;
        });

        res.json(stats);
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ message: 'Error fetching stats', error });
    }
};
