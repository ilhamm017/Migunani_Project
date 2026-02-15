import { Request, Response } from 'express';
import { Order, OrderItem, Invoice, Product, OrderIssue, sequelize, User, CustomerProfile, Retur } from '../models';
import { Op } from 'sequelize';

export const getAssignedOrders = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id; // Driver ID
        const { status, startDate, endDate } = req.query;

        const whereClause: any = { courier_id: userId };

        // If status specified, filter. Else show active deliveries?
        if (status) {
            const statusStr = String(status);
            if (statusStr.includes(',')) {
                whereClause.status = { [Op.in]: statusStr.split(',').map(s => s.trim()) };
            } else {
                whereClause.status = status;
            }
        } else {
            // Default to active assignments
            whereClause.status = { [Op.in]: ['ready_to_ship', 'shipped'] };
        }

        if (startDate || endDate) {
            const dateFilter: any = {};
            if (startDate) {
                const start = new Date(String(startDate));
                start.setHours(0, 0, 0, 0);
                dateFilter[Op.gte] = start;
            }
            if (endDate) {
                const end = new Date(String(endDate));
                end.setHours(23, 59, 59, 999);
                dateFilter[Op.lte] = end;
            }
            whereClause.updatedAt = dateFilter;
        }

        const orders = await Order.findAll({
            where: whereClause,
            include: [
                { model: Invoice },
                { model: OrderItem, include: [Product] },
                {
                    model: User,
                    as: 'Customer',
                    include: [{ model: CustomerProfile }]
                }
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
            }, { transaction: t });
        }

        // Save delivery proof photo to order (separate from payment proof)
        const updatePayload: any = { status: 'delivered' };
        if (file) {
            updatePayload.delivery_proof_url = file.path;
        }
        await order.update(updatePayload, { transaction: t });

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

        // Calculated COD exposure from open COD invoices (for audit/comparison).
        const orders = await Order.findAll({
            where: {
                courier_id: userId,
                status: { [Op.in]: ['delivered', 'completed'] }
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
                details.push({
                    order_id: order.id,
                    invoice_number: inv.invoice_number,
                    amount: Number(order.total_amount)
                });
            }
        }

        // Finance source of truth for driver settlement.
        const driverUser = await User.findByPk(userId, {
            attributes: ['id', 'name', 'debt']
        });
        const debtFromFinance = Number(driverUser?.debt || 0);

        res.json({
            driver_id: userId,
            // Keep backward compatibility: frontend reads cash_on_hand.
            // This now follows Finance debt value so numbers match Finance dashboard.
            cash_on_hand: debtFromFinance,
            debt: debtFromFinance,
            cod_pending_calculated: totalCash,
            orders: details
        });

    } catch (error) {
        res.status(500).json({ message: 'Error fetching wallet', error });
    }
};

export const reportIssue = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params; // Order ID
        const { note } = req.body;
        const userId = req.user!.id;

        const order = await Order.findOne({
            where: { id, courier_id: userId }
        });

        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Order tidak ditemukan atau bukan tugas Anda' });
        }

        // Create issue record
        await OrderIssue.create({
            order_id: String(id),
            issue_type: 'shortage',
            status: 'open',
            note: note || 'Barang kurang/bermasalah saat pengiriman',
            due_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // Default 24h to resolve
            created_by: userId
        }, { transaction: t });

        // Status order tetap 'shipped' (karena belum selesai secara sempurna)
        // Atau bisa diupdate ke status custom jika ada.

        await t.commit();
        res.json({ message: 'Masalah berhasil dilaporkan' });
    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: 'Gagal melaporkan masalah', error });
    }
};

export const getAssignedReturs = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;
        const returs = await Retur.findAll({
            where: {
                courier_id: userId,
                status: { [Op.in]: ['pickup_assigned', 'picked_up', 'handed_to_warehouse'] }
            },
            include: [
                { model: Product, attributes: ['name', 'sku'] },
                {
                    model: User,
                    as: 'Creator',
                    attributes: ['id', 'name', 'whatsapp_number'],
                    include: [{ model: CustomerProfile }]
                },
                { model: Order, attributes: ['id', 'status'] }
            ],
            order: [['updatedAt', 'DESC']]
        });
        res.json(returs);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching assigned returns', error });
    }
};

export const getAssignedReturDetail = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;
        const id = String(req.params.id || '');

        if (!id) {
            return res.status(400).json({ message: 'Retur ID wajib diisi' });
        }

        const retur = await Retur.findOne({
            where: {
                id,
                courier_id: userId
            },
            include: [
                { model: Product, attributes: ['id', 'name', 'sku'] },
                {
                    model: User,
                    as: 'Creator',
                    attributes: ['id', 'name', 'whatsapp_number'],
                    include: [{ model: CustomerProfile }]
                },
                { model: Order, attributes: ['id', 'status', 'total_amount'] },
                { model: User, as: 'Courier', attributes: ['id', 'name', 'whatsapp_number'] }
            ]
        });

        if (!retur) {
            return res.status(404).json({ message: 'Retur tidak ditemukan atau bukan tugas Anda' });
        }

        return res.json(retur);
    } catch (error) {
        return res.status(500).json({ message: 'Error fetching retur detail', error });
    }
};

export const updateAssignedReturStatus = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const driverAllowedStatuses = ['picked_up', 'handed_to_warehouse'] as const;
        type DriverAllowedReturStatus = (typeof driverAllowedStatuses)[number];
        const isDriverAllowedReturStatus = (value: string): value is DriverAllowedReturStatus =>
            (driverAllowedStatuses as readonly string[]).includes(value);

        const userId = req.user!.id;
        const id = String(req.params.id || '');
        const requestedStatus = String(req.body?.status || '').trim();

        if (!id || !requestedStatus) {
            await t.rollback();
            return res.status(400).json({ message: 'Retur ID dan status wajib diisi' });
        }

        if (!isDriverAllowedReturStatus(requestedStatus)) {
            await t.rollback();
            return res.status(400).json({ message: 'Status tidak valid untuk aksi driver' });
        }
        const nextStatus: DriverAllowedReturStatus = requestedStatus;

        const retur = await Retur.findOne({
            where: {
                id,
                courier_id: userId
            },
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (!retur) {
            await t.rollback();
            return res.status(404).json({ message: 'Retur tidak ditemukan atau bukan tugas Anda' });
        }

        if (nextStatus === 'picked_up' && retur.status !== 'pickup_assigned') {
            await t.rollback();
            return res.status(409).json({ message: 'Barang hanya bisa dipickup dari status pickup_assigned' });
        }

        if (nextStatus === 'handed_to_warehouse' && retur.status !== 'picked_up') {
            await t.rollback();
            return res.status(409).json({ message: 'Barang hanya bisa diserahkan ke gudang setelah pickup' });
        }

        await retur.update({ status: nextStatus }, { transaction: t });
        await t.commit();

        return res.json({
            message: nextStatus === 'picked_up'
                ? 'Pickup barang retur berhasil dikonfirmasi'
                : 'Penyerahan barang ke gudang berhasil dikonfirmasi',
            retur
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        return res.status(500).json({ message: 'Error updating retur task status', error });
    }
};
