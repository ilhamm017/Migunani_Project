import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Order, OrderAllocation, Product, User } from '../../models';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';

type PicklistView = 'product' | 'customer';

const parseCsv = (raw: unknown): string[] => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map((v) => String(v)).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
    return String(raw)
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
};

const safeLower = (v: unknown): string => String(v || '').trim().toLowerCase();

export const getPicklist = asyncWrapper(async (req: Request, res: Response) => {
    const view = (safeLower(req.query?.view) as PicklistView) || 'product';
    const q = String(req.query?.q || '').trim();

    const allocationStatusesRaw = safeLower(req.query?.allocation_status || 'pending');
    const allocationStatuses =
        allocationStatusesRaw === 'all'
            ? []
            : parseCsv(allocationStatusesRaw).map((v) => safeLower(v));

    const orderStatuses = (() => {
        const raw = parseCsv(req.query?.order_status);
        if (raw.length > 0) return raw.map((v) => safeLower(v));
        return ['allocated', 'partially_fulfilled'];
    })();

    const limitRaw = Number(req.query?.limit ?? 5000);
    const limit = Number.isFinite(limitRaw) ? Math.min(20000, Math.max(1, Math.trunc(limitRaw))) : 5000;

    const allocations = await OrderAllocation.findAll({
        where: {
            allocated_qty: { [Op.gt]: 0 },
            ...(allocationStatuses.length > 0 ? { status: { [Op.in]: allocationStatuses } } : {}),
        },
        include: [
            {
                model: Product,
                as: 'Product',
                attributes: ['id', 'name', 'sku', 'image_url', 'bin_location'],
                required: false,
            },
            {
                model: Order,
                attributes: ['id', 'status', 'customer_id', 'customer_name', 'createdAt'],
                where: {
                    ...(orderStatuses.length > 0 ? { status: { [Op.in]: orderStatuses } } : {}),
                },
                required: true,
                include: [
                    {
                        model: User,
                        as: 'Customer',
                        attributes: ['id', 'name'],
                        required: false,
                    },
                ],
            },
        ],
        order: [['updatedAt', 'DESC'], ['id', 'DESC']],
        limit,
    });

    const rowsPlain = allocations.map((row: any) => row.get({ plain: true }));
    const filtered = q
        ? rowsPlain.filter((row: any) => {
            const product = row?.Product || {};
            const order = row?.Order || {};
            const customerName = String(order?.Customer?.name || order?.customer_name || '');
            const haystack = [
                product?.name,
                product?.sku,
                product?.bin_location,
                customerName,
                order?.id,
                order?.status,
            ]
                .map((v) => String(v || '').toLowerCase())
                .join(' | ');
            return haystack.includes(q.toLowerCase());
        })
        : rowsPlain;

    const totalQty = filtered.reduce((sum: number, row: any) => sum + Number(row?.allocated_qty || 0), 0);
    const orderIds = new Set(filtered.map((row: any) => String(row?.Order?.id || '')).filter(Boolean));
    const customerNames = new Set(
        filtered
            .map((row: any) => String(row?.Order?.Customer?.name || row?.Order?.customer_name || '').trim())
            .filter(Boolean)
    );
    const productIds = new Set(filtered.map((row: any) => String(row?.product_id || row?.Product?.id || '')).filter(Boolean));

    if (view !== 'product' && view !== 'customer') {
        throw new CustomError("Query 'view' harus salah satu dari: product, customer", 400);
    }

    if (view === 'product') {
        const byProduct = new Map<string, any>();
        for (const row of filtered) {
            const productId = String(row?.product_id || row?.Product?.id || '').trim();
            if (!productId) continue;

            const existing = byProduct.get(productId);
            const product = row?.Product || {};
            const order = row?.Order || {};
            const customerName = String(order?.Customer?.name || order?.customer_name || 'Customer');

            if (!existing) {
                byProduct.set(productId, {
                    product_id: productId,
                    sku: product?.sku || '',
                    name: product?.name || 'Produk',
                    image_url: product?.image_url || null,
                    bin_location: product?.bin_location || null,
                    total_allocated_qty: Number(row?.allocated_qty || 0),
                    order_ids: new Set<string>([String(order?.id || '')].filter(Boolean)),
                    customer_names: new Set<string>([customerName].filter(Boolean)),
                });
            } else {
                existing.total_allocated_qty += Number(row?.allocated_qty || 0);
                if (order?.id) existing.order_ids.add(String(order.id));
                if (customerName) existing.customer_names.add(customerName);
            }
        }

        const rows = Array.from(byProduct.values())
            .map((r) => ({
                product_id: r.product_id,
                sku: r.sku,
                name: r.name,
                image_url: r.image_url,
                bin_location: r.bin_location,
                total_allocated_qty: r.total_allocated_qty,
                order_count: r.order_ids.size,
                customer_count: r.customer_names.size,
            }))
            .sort((a: any, b: any) => {
                const binA = String(a.bin_location || '');
                const binB = String(b.bin_location || '');
                if (binA !== binB) return binA.localeCompare(binB);
                return String(a.sku || '').localeCompare(String(b.sku || ''));
            });

        return res.json({
            view,
            q,
            allocation_status: allocationStatusesRaw,
            order_status: orderStatuses,
            totals: {
                total_allocated_qty: totalQty,
                order_count: orderIds.size,
                customer_count: customerNames.size,
                product_count: productIds.size,
            },
            rows,
        });
    }

    // view === 'customer'
    const byOrder = new Map<string, any>();
    for (const row of filtered) {
        const order = row?.Order || {};
        const orderId = String(order?.id || '').trim();
        if (!orderId) continue;

        const customerName = String(order?.Customer?.name || order?.customer_name || 'Customer');
        const existing = byOrder.get(orderId);
        const product = row?.Product || {};
        const item = {
            allocation_id: row?.id,
            allocation_status: row?.status,
            product_id: String(row?.product_id || product?.id || ''),
            sku: product?.sku || '',
            name: product?.name || 'Produk',
            image_url: product?.image_url || null,
            bin_location: product?.bin_location || null,
            allocated_qty: Number(row?.allocated_qty || 0),
        };

        if (!existing) {
            byOrder.set(orderId, {
                order_id: orderId,
                order_status: order?.status || null,
                created_at: order?.createdAt || null,
                customer_id: order?.customer_id || null,
                customer_name: customerName,
                items: [item],
            });
        } else {
            existing.items.push(item);
        }
    }

    const rows = Array.from(byOrder.values())
        .map((o) => {
            const sortedItems = Array.isArray(o.items)
                ? [...o.items].sort((a: any, b: any) => {
                    const binA = String(a.bin_location || '');
                    const binB = String(b.bin_location || '');
                    if (binA !== binB) return binA.localeCompare(binB);
                    return String(a.sku || '').localeCompare(String(b.sku || ''));
                })
                : [];
            return {
                ...o,
                item_count: sortedItems.length,
                total_allocated_qty: sortedItems.reduce((sum: number, it: any) => sum + Number(it.allocated_qty || 0), 0),
                items: sortedItems,
            };
        })
        .sort((a: any, b: any) => {
            const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
            const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
            if (aTime !== bTime) return aTime - bTime; // FIFO
            return String(a.order_id).localeCompare(String(b.order_id));
        });

    return res.json({
        view,
        q,
        allocation_status: allocationStatusesRaw,
        order_status: orderStatuses,
        totals: {
            total_allocated_qty: totalQty,
            order_count: orderIds.size,
            customer_count: customerNames.size,
            product_count: productIds.size,
        },
        rows,
    });
});

