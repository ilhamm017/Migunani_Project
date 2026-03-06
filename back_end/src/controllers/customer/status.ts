import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { User, Order, sequelize } from '../../models';
import { OPEN_ORDER_STATUSES } from './types';
import { normalizeId, releaseOrderAllocationStock } from './utils';

export const updateCustomerStatus = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const id = normalizeId(req.params?.id);
        const nextStatus = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : '';
        const haltOpenOrders = req.body?.halt_open_orders !== false;

        if (!id) {
            await t.rollback();
            return res.status(400).json({ message: 'ID customer tidak valid' });
        }

        if (!['active', 'banned'].includes(nextStatus)) {
            await t.rollback();
            return res.status(400).json({ message: 'Status customer harus active or banned' });
        }

        const customer = await User.findOne({
            where: { id, role: 'customer' },
            transaction: t,
            lock: t.LOCK.UPDATE,
        });

        if (!customer) {
            await t.rollback();
            return res.status(404).json({ message: 'Customer tidak ditemukan' });
        }

        const haltedOrderIds: string[] = [];

        if (nextStatus === 'banned' && haltOpenOrders) {
            const openOrders = await Order.findAll({
                where: {
                    customer_id: customer.id,
                    status: { [Op.in]: OPEN_ORDER_STATUSES as unknown as string[] }
                },
                transaction: t,
                lock: t.LOCK.UPDATE
            });

            for (const order of openOrders) {
                if (order.status === 'canceled') continue;

                if (order.stock_released === false) {
                    await releaseOrderAllocationStock(order.id, t);
                }

                await order.update({
                    status: 'canceled',
                    stock_released: true,
                }, { transaction: t });

                haltedOrderIds.push(order.id);
            }
        }

        await customer.update({ status: nextStatus as 'active' | 'banned' }, { transaction: t });

        await t.commit();

        const message = nextStatus === 'banned'
            ? 'Customer berhasil diblokir'
            : 'Customer berhasil diaktifkan kembali';

        res.json({
            message,
            customer: {
                id: customer.id,
                name: customer.name,
                status: nextStatus,
            },
            halted_order_count: haltedOrderIds.length,
            halted_order_ids: haltedOrderIds,
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error updating customer status', error });
    }
};
