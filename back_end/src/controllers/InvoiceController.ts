import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Invoice, InvoiceItem, OrderAllocation, OrderItem, Product, User } from '../models';

export const getInvoiceDetail = async (req: Request, res: Response) => {
    try {
        const invoiceId = String(req.params.id || '').trim();
        if (!invoiceId) {
            return res.status(400).json({ message: 'invoice id wajib diisi' });
        }

        const invoice = await Invoice.findByPk(invoiceId, {
            include: [
                {
                    model: InvoiceItem,
                    as: 'Items',
                    attributes: ['id', 'qty', 'unit_price', 'line_total', 'order_item_id'],
                    include: [
                        {
                            model: OrderItem,
                            attributes: ['id', 'order_id', 'product_id', 'qty'],
                            include: [{ model: Product, attributes: ['name', 'sku', 'unit'] }]
                        }
                    ]
                }
            ]
        });

        if (!invoice) {
            return res.status(404).json({ message: 'Invoice tidak ditemukan' });
        }

        const user = req.user!;
        if (String(user?.role || '') === 'customer') {
            const customerId = String(invoice.getDataValue('customer_id') || '');
            if (!customerId || customerId !== String(user.id)) {
                return res.status(403).json({ message: 'Tidak memiliki akses ke invoice ini.' });
            }
        }

        const plain = invoice.get({ plain: true }) as any;
        const items = Array.isArray(plain.Items) ? plain.Items : [];
        const orderIdSet = new Set<string>();
        items.forEach((item: any) => {
            const orderId = String(item?.OrderItem?.order_id || '').trim();
            if (orderId) orderIdSet.add(orderId);
        });
        const orderIds = Array.from(orderIdSet);

        let allocatedByOrderItemId = new Map<string, number>();
        if (orderIds.length > 0) {
            const orderItems = await OrderItem.findAll({
                where: { order_id: { [Op.in]: orderIds } },
                attributes: ['id', 'order_id', 'product_id', 'qty'],
            });
            const allocations = await OrderAllocation.findAll({
                where: { order_id: { [Op.in]: orderIds } },
                attributes: ['order_id', 'product_id', 'allocated_qty'],
            });

            const allocByOrderProduct = new Map<string, number>();
            allocations.forEach((alloc: any) => {
                const key = `${String(alloc.order_id)}::${String(alloc.product_id)}`;
                allocByOrderProduct.set(key, Number(allocByOrderProduct.get(key) || 0) + Number(alloc.allocated_qty || 0));
            });

            const orderItemsByOrderProduct = new Map<string, any[]>();
            orderItems.forEach((oi: any) => {
                const key = `${String(oi.order_id)}::${String(oi.product_id)}`;
                const list = orderItemsByOrderProduct.get(key) || [];
                list.push(oi);
                orderItemsByOrderProduct.set(key, list);
            });

            orderItemsByOrderProduct.forEach((list, key) => {
                let remaining = Number(allocByOrderProduct.get(key) || 0);
                const sorted = [...list].sort((a, b) => {
                    const aId = Number(a.id);
                    const bId = Number(b.id);
                    if (Number.isFinite(aId) && Number.isFinite(bId)) return aId - bId;
                    return String(a.id).localeCompare(String(b.id));
                });
                sorted.forEach((oi) => {
                    const orderedQty = Number(oi.qty || 0);
                    const allocQty = Math.min(orderedQty, Math.max(0, remaining));
                    remaining = Math.max(0, remaining - allocQty);
                    allocatedByOrderItemId.set(String(oi.id), allocQty);
                });
            });
        }

        const invoiceItems = items.map((item: any) => {
            const orderItem = item?.OrderItem || null;
            const orderedQty = Number(orderItem?.qty || 0);
            const allocatedQty = Number(allocatedByOrderItemId.get(String(orderItem?.id || '')) || 0);
            const remainingQty = Math.max(0, orderedQty - allocatedQty);
            return {
                ...item,
                ordered_qty: orderedQty,
                allocated_qty: allocatedQty,
                remaining_qty: remainingQty,
            };
        });

        const customerId = String(plain?.customer_id || '');
        const customer = customerId
            ? await User.findOne({
                where: { id: customerId },
                attributes: ['id', 'name', 'email', 'whatsapp_number']
            })
            : null;

        return res.json({
            ...plain,
            InvoiceItems: invoiceItems,
            order_ids: orderIds,
            customer: customer ? customer.get({ plain: true }) : null,
        });
    } catch (error) {
        console.error('Error fetching invoice detail:', error);
        return res.status(500).json({ message: 'Error fetching invoice detail', error });
    }
};
