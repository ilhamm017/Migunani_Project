import { Request, Response } from 'express';
import { Retur, Order, Product, User, sequelize, OrderItem, Expense } from '../models';
import { Op } from 'sequelize';

// --- Customer Endpoints ---

export const requestRetur = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const userId = req.user!.id;
        const { order_id, product_id, qty, reason } = req.body;
        const file = req.file; // Evidence Image

        const order = await Order.findOne({
            where: { id: order_id, customer_id: userId },
            transaction: t
        });

        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Order not found' });
        }

        // Validate Status: Only Shipped, Delivered, Completed orders can be returned?
        // Usually returns are for Delivered items.
        if (!['delivered', 'completed'].includes(order.status)) {
            await t.rollback();
            return res.status(400).json({ message: 'Only delivered or completed orders can be returned' });
        }

        // Prevent duplicate return requests for the same product in this order
        const existingRetur = await Retur.findOne({
            where: {
                order_id,
                product_id,
                status: { [Op.not]: 'rejected' }
            },
            transaction: t
        });

        if (existingRetur) {
            await t.rollback();
            return res.status(400).json({ message: 'Retur untuk produk ini sudah diajukan dan sedang diproses' });
        }

        // Validate quantity against purchased quantity (OrderItem)
        const orderItem = await sequelize.models.OrderItem.findOne({
            where: { order_id, product_id },
            transaction: t
        }) as any;

        if (!orderItem) {
            await t.rollback();
            return res.status(400).json({ message: 'Produk tidak ditemukan dalam pesanan ini' });
        }

        if (Number(qty) > Number(orderItem.qty)) {
            await t.rollback();
            return res.status(400).json({ message: 'Jumlah retur melebihi jumlah yang dibeli' });
        }

        await Retur.create({
            order_id,
            product_id,
            qty,
            reason,
            evidence_img: file ? file.path : null,
            status: 'pending',
            created_by: userId
        }, { transaction: t });

        await t.commit();
        res.status(201).json({ message: 'Return request submitted successfully' });

    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error submitting return request', error });
    }
};

export const getMyReturs = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;
        const returs = await Retur.findAll({
            where: { created_by: userId },
            include: [
                { model: Product, attributes: ['name', 'sku'] },
                { model: Order, attributes: ['id', 'status'] }
            ],
            order: [['createdAt', 'DESC']]
        });
        res.json(returs);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching returns', error });
    }
};

// --- Admin Endpoints ---

export const getAllReturs = async (req: Request, res: Response) => {
    try {
        const { status } = req.query;
        const whereClause: any = {};
        if (status) whereClause.status = status;

        const returs = await Retur.findAll({
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
        res.json(returs);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching returns', error });
    }
};

export const updateReturStatus = async (req: Request, res: Response) => {
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

        const id = String(req.params.id);
        const { status, admin_response, courier_id, refund_amount, is_back_to_stock } = req.body;
        const userRole = req.user!.role;
        const requestedStatus = String(status || '').trim();

        if (!isAdminAllowedReturStatus(requestedStatus)) {
            await t.rollback();
            return res.status(400).json({ message: 'Status retur tidak valid untuk endpoint admin' });
        }
        const nextStatus: AdminAllowedReturStatus = requestedStatus;

        const retur = await Retur.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!retur) {
            await t.rollback();
            return res.status(404).json({ message: 'Retur request not found' });
        }

        const isWarehouseAdmin = ['super_admin', 'admin_gudang'].includes(userRole);
        if (!isWarehouseAdmin) {
            await t.rollback();
            return res.status(403).json({ message: 'Hanya Admin Gudang atau Super Admin yang dapat mengubah status retur' });
        }

        const transitionIsValid = (
            (retur.status === 'pending' && ['approved', 'rejected'].includes(nextStatus)) ||
            (retur.status === 'approved' && nextStatus === 'pickup_assigned') ||
            (retur.status === 'handed_to_warehouse' && nextStatus === 'received') ||
            (retur.status === 'received' && nextStatus === 'completed')
        );

        if (!transitionIsValid) {
            await t.rollback();
            return res.status(409).json({
                message: `Transisi status tidak diizinkan dari ${retur.status} ke ${nextStatus}`
            });
        }

        const updateData: {
            status: AdminAllowedReturStatus;
            admin_response?: string | null;
            courier_id?: string | null;
            refund_amount?: number | null;
            is_back_to_stock?: boolean | null;
        } = { status: nextStatus };

        if (admin_response !== undefined) {
            updateData.admin_response = admin_response;
        }

        if (nextStatus === 'pickup_assigned') {
            const normalizedCourierId = String(courier_id || '').trim();
            if (!normalizedCourierId) {
                await t.rollback();
                return res.status(400).json({ message: 'courier_id wajib diisi saat menugaskan pickup retur' });
            }
            const courier = await User.findOne({
                where: { id: normalizedCourierId, role: 'driver' },
                transaction: t
            });
            if (!courier) {
                await t.rollback();
                return res.status(404).json({ message: 'Driver tidak ditemukan' });
            }
            updateData.courier_id = normalizedCourierId;
            if (refund_amount !== undefined) {
                updateData.refund_amount = Number(refund_amount);
            }
        }

        if (nextStatus === 'completed' && is_back_to_stock !== undefined) {
            updateData.is_back_to_stock = Boolean(is_back_to_stock);
        }

        await retur.update(updateData, { transaction: t });

        // Logic for completion: if is_back_to_stock is true, increment product stock
        if (nextStatus === 'completed' && is_back_to_stock === true) {
            const product = await Product.findByPk(retur.product_id, { transaction: t, lock: t.LOCK.UPDATE });
            if (product) {
                await product.update({
                    stock_quantity: Number(product.stock_quantity) + Number(retur.qty)
                }, { transaction: t });
            }
        }

        await t.commit();
        res.json({ message: `Retur status updated to ${nextStatus}`, retur });

    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error updating return status', error });
    }
};
// --- Finance Endpoints ---

export const disburseRefund = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const id = String(req.params.id);
        const { note } = req.body; // Optional note
        const adminId = req.user!.id;

        const retur = await Retur.findByPk(id, {
            include: [
                { model: Order, include: [{ model: OrderItem }] },
                { model: Product }
            ],
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (!retur) {
            await t.rollback();
            return res.status(404).json({ message: 'Retur request not found' });
        }

        // Logic check: only finance/super_admin
        if (!['super_admin', 'admin_finance'].includes(req.user!.role)) {
            await t.rollback();
            return res.status(403).json({ message: 'Hanya Admin Finance atau Super Admin yang dapat mencairkan dana' });
        }

        if (retur.refund_disbursed_at) {
            await t.rollback();
            return res.status(400).json({ message: 'Dana retur ini sudah dicairkan sebelumnya' });
        }

        const refundAmount = Number(retur.refund_amount || 0);
        if (refundAmount <= 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Nominal refund belum diatur atau 0' });
        }

        // Create Expense Record
        const expenseNote = `Refund Retur: ${(retur as any).Product?.name} (Order #${retur.order_id.slice(0, 8)}). ${note || ''}`;

        // Import Expense model dynamically to avoid circular dependency issues if any, 
        // OR assume it's imported in the header. (I will check imports)
        // I'll assume I need to update imports.
        // For now, I will use `const { Expense } = require('../models');` inside if I can't update imports cleanly?
        // No, I should update imports.

        // Let's assume standard import at top.
        // I will add imports in a separate call if needed.

        await Expense.create({
            category: 'Refund Retur',
            amount: refundAmount,
            date: new Date(),
            note: expenseNote,
            created_by: adminId
        }, { transaction: t });

        // Update Retur
        await retur.update({
            refund_disbursed_at: new Date(),
            refund_disbursed_by: adminId,
            refund_note: note || null
        }, { transaction: t });

        await t.commit();
        res.json({ message: 'Dana refund berhasil dicairkan dan tercatat di pengeluaran', retur });

    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error disbursing refund', error });
    }
};
