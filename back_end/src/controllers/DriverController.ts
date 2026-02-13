import { Request, Response } from 'express';
import { Order, OrderItem, Invoice, Product, sequelize } from '../models';
import { Op } from 'sequelize';

export const getAssignedOrders = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id; // Driver ID
        const { status } = req.query;

        const whereClause: any = { courier_id: userId };

        // If status specified, filter. Else show active deliveries?
        if (status) {
            whereClause.status = status;
        } else {
            // Default to active assignments
            whereClause.status = { [Op.in]: ['processing', 'shipped', 'delivered'] };
        }

        const orders = await Order.findAll({
            where: whereClause,
            include: [
                { model: Invoice },
                { model: OrderItem, include: [Product] }
            ],
            order: [['updatedAt', 'DESC']]
        });

        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching assigned orders', error });
    }
};

export const completeDelivery = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params; // Order ID
        const userId = req.user!.id;
        const file = req.file; // Uploaded proof

        // Check ownership
        const order = await Order.findOne({
            where: { id, courier_id: userId },
            include: [Invoice]
        });

        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Order not found or not assigned to you' });
        }

        const invoice = await Invoice.findOne({ where: { order_id: id }, transaction: t });
        if (!invoice) {
            await t.rollback();
            return res.status(400).json({ message: 'Invoice missing' });
        }

        // Handle COD logic
        if (invoice.payment_method === 'cod') {
            await invoice.update({
                payment_status: 'cod_pending', // Money with driver
                payment_proof_url: file ? file.path : null
            }, { transaction: t });
        } else {
            // Pre-paid transfer
            // Just mark delivered? Proof usually strictly required for COD or all?
            // "Confirm payment and upload proof" - implies Proof is for Payment or Delivery?
            // Usually delivery proof (photo of item at door).
            // Let's save proof URL to invoice (or add delivery_proof_url to Order? Schema only has payment_proof_url in Invoice).
            // We'll use payment_proof_url on Invoice for now as per schema or generic proof.
            // If Transfer, maybe just delivery proof.
            if (file) {
                await invoice.update({ payment_proof_url: file.path }, { transaction: t });
            }
        }

        await order.update({ status: 'delivered' }, { transaction: t });

        await t.commit();
        res.json({ message: 'Delivery completed' });
    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: 'Error completing delivery', error });
    }
};

export const getDriverWallet = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;

        // Cash in Hand = Sum of Invoices where method=cod AND status=cod_pending AND order is delivered/completed AND Courier = userId
        // Join Order -> Invoice
        const orders = await Order.findAll({
            where: {
                courier_id: userId,
                status: 'delivered' // or completed
            },
            include: [{
                model: Invoice,
                where: {
                    payment_method: 'cod',
                    payment_status: 'cod_pending'
                }
            }]
        });

        let totalCash = 0;
        const details = [];

        for (const order of orders) {
            const inv = (order as any).Invoice; // HasOne relationship
            if (inv) {
                totalCash += Number(inv.amount_paid) > 0 ? Number(inv.amount_paid) : Number(order.total_amount);
                // If amount_paid is set (partial?), use it. Else assume full COD amount collected.
                // Invoice.amount_paid default is 0. 
                // In COD, driver collects Total Amount.
                // Let's assume Total Amount for now if amount_paid is 0.
                details.push({
                    order_id: order.id,
                    invoice_number: inv.invoice_number,
                    amount: Number(order.total_amount)
                });
            }
        }

        res.json({
            driver_id: userId,
            cash_on_hand: totalCash,
            orders: details
        });

    } catch (error) {
        res.status(500).json({ message: 'Error fetching wallet', error });
    }
};
