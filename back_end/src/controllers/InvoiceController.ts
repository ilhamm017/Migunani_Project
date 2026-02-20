import { Request, Response } from 'express';
import { Invoice, InvoiceItem, OrderItem, Product, User } from '../models';

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

        const invoiceItems = items.map((item: any) => {
            const orderItem = item?.OrderItem || null;
            const orderedQty = Number(orderItem?.qty || item?.qty || 0);
            const allocatedQty = Number(item?.qty || 0);
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
