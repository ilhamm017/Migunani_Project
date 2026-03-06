import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { User, CustomerProfile, Order, sequelize } from '../../models';
import { attachInvoicesToOrders } from '../../utils/invoiceLookup';
import { OPEN_ORDER_STATUSES } from './types';
import { normalizeId, parsePositiveNumber, applyCustomerSearch, applyStatusFilter } from './utils';

export const searchCustomers = async (req: Request, res: Response) => {
    try {
        const { search, status = 'active', limit = 20 } = req.query;

        const whereClause: any = {
            role: 'customer',
        };
        applyStatusFilter(whereClause, status);
        applyCustomerSearch(whereClause, search);

        const customers = await User.findAll({
            where: whereClause,
            attributes: ['id', 'name', 'whatsapp_number', 'email', 'status', 'debt', 'createdAt'],
            include: [
                { model: CustomerProfile, attributes: ['tier', 'credit_limit', 'points'] }
            ],
            limit: parsePositiveNumber(limit, 20, 100),
            order: [['createdAt', 'DESC']]
        });

        res.json({ customers });
    } catch (error) {
        res.status(500).json({ message: 'Error searching customers', error });
    }
};

export const getCustomers = async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 20, search, status = 'all' } = req.query;
        const safePage = parsePositiveNumber(page, 1, 100000);
        const safeLimit = parsePositiveNumber(limit, 20, 100);
        const offset = (safePage - 1) * safeLimit;

        const whereClause: any = {
            role: 'customer',
        };
        applyStatusFilter(whereClause, status);
        applyCustomerSearch(whereClause, search);

        const customers = await User.findAndCountAll({
            where: whereClause,
            attributes: ['id', 'name', 'whatsapp_number', 'email', 'status', 'debt', 'createdAt', 'updatedAt'],
            include: [
                { model: CustomerProfile, attributes: ['tier', 'credit_limit', 'points'] }
            ],
            distinct: true,
            limit: safeLimit,
            offset,
            order: [['createdAt', 'DESC']]
        });

        const customerIds = customers.rows.map((item: any) => item.id);
        const openOrderRows = customerIds.length
            ? await Order.findAll({
                attributes: [
                    'customer_id',
                    [sequelize.fn('COUNT', sequelize.col('id')), 'count']
                ],
                where: {
                    customer_id: { [Op.in]: customerIds },
                    status: { [Op.in]: OPEN_ORDER_STATUSES as unknown as string[] }
                },
                group: ['customer_id'],
                raw: true
            }) as unknown as Array<{ customer_id: string; count: number }>
            : [];

        const openOrderCountByCustomer = new Map<string, number>();
        for (const row of openOrderRows) {
            openOrderCountByCustomer.set(String(row.customer_id), Number(row.count || 0));
        }

        const rows = customers.rows.map((item: any) => {
            const plain = item.get({ plain: true }) as any;
            return {
                ...plain,
                open_order_count: openOrderCountByCustomer.get(item.id) || 0,
            };
        });

        res.json({
            total: customers.count,
            totalPages: Math.ceil(customers.count / safeLimit),
            currentPage: safePage,
            customers: rows,
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching customers', error });
    }
};

export const getCustomerById = async (req: Request, res: Response) => {
    try {
        const id = normalizeId(req.params?.id);
        if (!id) {
            return res.status(400).json({ message: 'ID customer tidak valid' });
        }

        const customer = await User.findOne({
            where: { id, role: 'customer' },
            attributes: ['id', 'name', 'whatsapp_number', 'email', 'status', 'debt', 'createdAt', 'updatedAt'],
            include: [
                { model: CustomerProfile, attributes: ['tier', 'credit_limit', 'points', 'saved_addresses'] }
            ]
        });

        if (!customer) {
            return res.status(404).json({ message: 'Customer tidak ditemukan' });
        }

        const orderCountRows = await Order.findAll({
            attributes: [
                'status',
                [sequelize.fn('COUNT', sequelize.col('id')), 'count']
            ],
            where: { customer_id: id },
            group: ['status'],
            raw: true,
        }) as unknown as Array<{ status: string; count: number }>;

        const statusCounts: Record<string, number> = {};
        let totalOrders = 0;
        let openOrders = 0;
        for (const row of orderCountRows) {
            const count = Number(row.count || 0);
            statusCounts[row.status] = count;
            totalOrders += count;
            if (OPEN_ORDER_STATUSES.includes(row.status as (typeof OPEN_ORDER_STATUSES)[number])) {
                openOrders += count;
            }
        }

        res.json({
            customer,
            summary: {
                total_orders: totalOrders,
                open_orders: openOrders,
                status_counts: statusCounts,
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching customer detail', error });
    }
};

export const getCustomerOrders = async (req: Request, res: Response) => {
    try {
        const customerId = normalizeId(req.params?.id);
        if (!customerId) {
            return res.status(400).json({ message: 'ID customer tidak valid' });
        }

        const customer = await User.findOne({
            where: { id: customerId, role: 'customer' },
            attributes: ['id']
        });
        if (!customer) {
            return res.status(404).json({ message: 'Customer tidak ditemukan' });
        }

        const { page = 1, limit = 20, scope = 'all', status } = req.query;
        const safePage = parsePositiveNumber(page, 1, 100000);
        const safeLimit = parsePositiveNumber(limit, 20, 100);
        const offset = (safePage - 1) * safeLimit;

        const whereClause: any = {
            customer_id: customerId,
        };

        const scopeParam = typeof scope === 'string' ? scope.trim().toLowerCase() : 'all';
        const statusParam = typeof status === 'string' ? status.trim() : '';

        if (scopeParam === 'open') {
            whereClause.status = { [Op.in]: OPEN_ORDER_STATUSES as unknown as string[] };
        } else if (statusParam && statusParam !== 'all') {
            whereClause.status = statusParam;
        }

        const orders = await Order.findAndCountAll({
            where: whereClause,
            distinct: true,
            limit: safeLimit,
            offset,
            order: [['createdAt', 'DESC']]
        });

        const plainOrders = orders.rows.map((row: any) => row.get({ plain: true }) as any);
        const ordersWithInvoices = await attachInvoicesToOrders(plainOrders);

        res.json({
            total: orders.count,
            totalPages: Math.ceil(orders.count / safeLimit),
            currentPage: safePage,
            orders: ordersWithInvoices,
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching customer orders', error });
    }
};
