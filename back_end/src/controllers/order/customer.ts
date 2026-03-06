import { Request, Response } from 'express';
import { Order, OrderIssue, OrderItem, Product, Invoice, InvoiceItem, Cart, CartItem, User, sequelize, OrderAllocation, CustomerProfile, Retur, Backorder, Category, Setting } from '../../models';
import { Op } from 'sequelize';
import { resolveShippingMethodByCode } from '../ShippingMethodController';
import waClient, { getStatus as getWaStatus } from '../../services/whatsappClient';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitOrderStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders, findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../../utils/invoiceLookup';
import { withOrderTrackingFields } from './utils';

export const getMyOrders = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;
        const { page = 1, limit = 10, status } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const whereClause: any = { customer_id: userId };
        if (status) {
            const statusStr = String(status);
            if (statusStr === 'ready_to_ship') {
                whereClause.status = { [Op.in]: ['ready_to_ship', 'waiting_payment'] };
            } else {
                whereClause.status = statusStr;
            }
        }

        const orders = await Order.findAndCountAll({
            where: whereClause,
            include: [
                { model: Retur, attributes: ['id', 'status'] },
                { model: OrderItem, attributes: ['qty'] },
                { model: OrderAllocation, as: 'Allocations', attributes: ['allocated_qty', 'status'] }
            ],
            limit: Number(limit),
            offset: Number(offset),
            order: [['createdAt', 'DESC']]
        });

        const plainOrders = orders.rows.map((row) => {
            const plain = row.get({ plain: true }) as any;
            const total_qty = (plain.OrderItems || []).reduce((sum: number, item: any) => sum + Number(item.qty || 0), 0);
            const status = String(plain.status || '').toLowerCase();
            const deliveredLikeStatus = ['shipped', 'delivered', 'completed'].includes(status);
            const allocated_qty = (plain.Allocations || []).reduce(
                (sum: number, alloc: any) => sum + Number(alloc.allocated_qty || 0),
                0
            );
            const shipped_qty = deliveredLikeStatus
                ? Math.min(total_qty, allocated_qty > 0 ? allocated_qty : total_qty)
                : 0;
            const indent_qty = Math.max(0, total_qty - shipped_qty);

            return {
                ...plain,
                total_qty,
                shipped_qty,
                indent_qty
            };
        });

        const ordersWithInvoices = await attachInvoicesToOrders(plainOrders);

        res.json({
            total: orders.count,
            totalPages: Math.ceil(orders.count / Number(limit)),
            currentPage: Number(page),
            orders: ordersWithInvoices
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching orders', error });
    }
};

export const getOrderDetails = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const orderId = String(id);
        const userId = req.user!.id;
        const userRole = req.user!.role;

        const whereClause: any = { id: orderId };

        // Customers can only see their own orders
        if (userRole === 'customer') {
            whereClause.customer_id = userId;
        }

        const productAttributes = userRole === 'customer'
            ? ['name', 'sku', 'unit']
            : ['name', 'sku', 'unit', 'stock_quantity', 'allocated_quantity'];

        const order = await Order.findOne({
            where: whereClause,
            include: [
                { model: User, as: 'Customer', attributes: ['id', 'name', 'whatsapp_number', 'email'] },
                { model: User, as: 'Courier', attributes: ['id', 'name', 'role', 'whatsapp_number'] },
                { model: OrderIssue, as: 'Issues', where: { status: 'open' }, required: false },
                { model: OrderItem, include: [{ model: Product, attributes: productAttributes }] },
                { model: OrderAllocation, as: 'Allocations' },
                { model: Order, as: 'Children' },
                { model: Retur }
            ]
        });

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const plainOrder = order.get({ plain: true }) as any;
        const [orderWithInvoices] = await attachInvoicesToOrders([plainOrder]);
        res.json(withOrderTrackingFields(orderWithInvoices));
    } catch (error) {
        res.status(500).json({ message: 'Error fetching order details', error });
    }
};

export const uploadPaymentProof = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params;
        const orderId = String(id);
        const userId = req.user!.id;
        const file = req.file;

        if (!file) {
            await t.rollback();
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const order = await Order.findOne({
            where: { id: orderId, customer_id: userId },
            include: [{ model: User, as: 'Customer', attributes: ['id', 'name', 'whatsapp_number'] }],
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Order not found' });
        }
        const prevStatus = String(order.status || '');

        const invoice = await findLatestInvoiceByOrderId(orderId, { transaction: t });
        if (!invoice) {
            await t.rollback();
            return res.status(404).json({ message: 'Invoice not found' });
        }

        if (invoice.payment_status === 'paid') {
            await t.rollback();
            return res.status(400).json({ message: 'Pesanan sudah dibayar.' });
        }

        if (invoice.payment_proof_url) {
            await t.rollback();
            return res.status(400).json({ message: 'Bukti transfer sudah diunggah dan sedang dalam verifikasi.' });
        }

        // In real app, upload to S3/Cloudinary and get URL. 
        // Here we store the local path or filename.
        await invoice.update({
            payment_proof_url: file.path,
            // Keep unpaid until admin_finance verifies transfer.
            payment_status: 'unpaid',
            verified_by: null,
            verified_at: null,
        }, { transaction: t });

        const relatedOrderIds = await findOrderIdsByInvoiceId(String(invoice.id), { transaction: t });
        if (relatedOrderIds.length === 0) {
            relatedOrderIds.push(String(order.id));
        }

        await Order.update(
            { status: 'waiting_admin_verification' },
            { where: { id: { [Op.in]: relatedOrderIds } }, transaction: t }
        );
        // After upload, status becomes waiting_admin_verification until finance approves.

        await t.commit();
        if (prevStatus !== 'waiting_admin_verification') {
            emitOrderStatusChanged({
                order_id: String(order.id),
                from_status: prevStatus || null,
                to_status: 'waiting_admin_verification',
                source: String(order.source || ''),
                payment_method: String(invoice.payment_method || ''),
                courier_id: String(order.courier_id || ''),
                triggered_by_role: String(req.user?.role || 'customer'),
                target_roles: ['admin_finance', 'customer'],
            });
        } else {
            emitAdminRefreshBadges();
        }


        // --- ASYNC NOTIFICATIONS (POST-COMMIT) ---

        // --- ASYNC NOTIFICATIONS (POST-COMMIT) ---
        // Separate try-catch to ensure request succeeds even if notif fails
        (async () => {
            try {
                console.log(`[Notif] Starting payment proof notification for Order #${order.id}`);
                console.log(`[Notif] WA Client Status: ${getWaStatus()}`);

                const customerMsg = `[Migunani Motor] Bukti pembayaran untuk pesanan #${order.id} telah kami terima. Pembayaran Anda akan segera diverifikasi oleh tim finance kami. Terima kasih!`;
                // @ts-ignore
                const customerWaRaw = order.Customer?.whatsapp_number || (order as any).whatsapp_number;
                const customerWa = customerWaRaw ? String(customerWaRaw).trim() : '';

                console.log(`[Notif] Target Customer WA: ${customerWa}`);

                if (customerWa) {
                    const target = customerWa.includes('@c.us') ? customerWa : `${customerWa}@c.us`;
                    console.log(`[Notif] Sending to customer: ${target}`);
                    await waClient.sendMessage(target, customerMsg);
                    console.log(`[Notif] Sent to customer success`);
                } else {
                    console.warn(`[Notif] No customer WA found for order ${order.id}`);
                }

                // Notify Finance Admins
                const financeAdmins = await User.findAll({ where: { role: 'admin_finance', status: 'active' } });
                console.log(`[Notif] Finance Admins found: ${financeAdmins.length}`);

                const adminMsg = `[PEMBAYARAN] Bukti transfer baru diunggah untuk Invoice ${invoice.invoice_number || order.id}.\nCustomer: ${order.customer_name || 'Customer'}\nSilakan verifikasi di panel admin.`;

                for (const admin of financeAdmins) {
                    if (admin.whatsapp_number) {
                        const target = admin.whatsapp_number.includes('@c.us') ? admin.whatsapp_number : `${admin.whatsapp_number}@c.us`;
                        console.log(`[Notif] Sending to admin ${admin.name} (${target})`);
                        await waClient.sendMessage(target, adminMsg);
                    }
                }
                console.log(`[Notif] Notification sequence completed`);
            } catch (notifError) {
                console.error('[Notif] Notification error (full stack):', notifError);
            }
        })();

        res.json({ message: 'Payment proof uploaded' });
    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error uploading proof', error });
    }
};
