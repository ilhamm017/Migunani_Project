import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { InventoryCostLedger, Order, PurchaseOrder, Supplier, User } from '../../models';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';

const parsePositiveInt = (value: unknown): number | null => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    const asInt = Math.trunc(parsed);
    if (asInt <= 0) return null;
    return asInt;
};

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

export const getProductStockHistory = asyncWrapper(async (req: Request, res: Response) => {
    const productId = String(req.params.product_id || '').trim();
    if (!productId) throw new CustomError('product_id wajib diisi', 400);

    const limitRaw = String(req.query.limit ?? '').trim();
    const limitParsed = limitRaw ? parsePositiveInt(limitRaw) : null;
    const limit = Math.min(200, Math.max(1, limitParsed ?? 50));

    const ledgers = await InventoryCostLedger.findAll({
        where: { product_id: productId },
        order: [['createdAt', 'DESC'], ['id', 'DESC']],
        limit
    });

    const inboundPoIds = Array.from(new Set(
        ledgers
            .filter((row: any) => String(row?.reference_type || '') === 'inbound_post')
            .map((row: any) => parsePositiveInt(row?.reference_id))
            .filter(isFiniteNumber)
    ));

    const orderIds = Array.from(new Set(
        ledgers
            .filter((row: any) => String(row?.reference_type || '') === 'order')
            .map((row: any) => String(row?.reference_id || '').trim())
            .filter(Boolean)
    ));

    const purchaseOrders = inboundPoIds.length > 0
        ? await PurchaseOrder.findAll({
            where: { id: { [Op.in]: inboundPoIds } },
            include: [{ model: Supplier, attributes: ['id', 'name'] }]
        })
        : [];
    const purchaseOrderById = new Map<number, any>();
    for (const po of purchaseOrders as any[]) {
        const id = parsePositiveInt((po as any)?.id);
        if (!id) continue;
        purchaseOrderById.set(id, po);
    }

    const orders = orderIds.length > 0
        ? await Order.findAll({
            where: { id: { [Op.in]: orderIds } },
            include: [{ model: User, as: 'Customer', attributes: ['id', 'name', 'whatsapp_number'] }]
        })
        : [];
    const orderById = new Map<string, any>();
    for (const order of orders as any[]) {
        const id = String((order as any)?.id || '').trim();
        if (!id) continue;
        orderById.set(id, order);
    }

    const history = (ledgers as any[]).map((row) => {
        const referenceType = String(row?.reference_type || '');
        const referenceId = String(row?.reference_id || '');
        const movementType = String(row?.movement_type || '');

        const base = {
            id: Number(row?.id),
            movement_type: movementType,
            qty: Number(row?.qty || 0),
            unit_cost: Number(row?.unit_cost || 0),
            total_cost: Number(row?.total_cost || 0),
            reference_type: referenceType || null,
            reference_id: referenceId || null,
            note: row?.note ? String(row.note) : null,
            createdAt: row?.createdAt
        };

        if (referenceType === 'inbound_post') {
            const poId = parsePositiveInt(referenceId);
            const po = poId ? purchaseOrderById.get(poId) : null;
            const supplier = po?.Supplier || null;
            return {
                ...base,
                inbound: poId ? {
                    purchase_order_id: poId,
                    status: po?.status ? String(po.status) : null,
                    supplier: supplier ? { id: supplier.id, name: supplier.name } : null
                } : null,
                outbound: null
            };
        }

        if (referenceType === 'order') {
            const orderId = referenceId.trim();
            const order = orderById.get(orderId) || null;
            const customer = order?.Customer || null;
            return {
                ...base,
                inbound: null,
                outbound: orderId ? {
                    order_id: orderId,
                    status: order?.status ? String(order.status) : null,
                    customer: customer ? { id: customer.id, name: customer.name, whatsapp_number: customer.whatsapp_number } : null
                } : null
            };
        }

        // Fallback: keep ledger row but without supplier/customer expansion.
        return {
            ...base,
            inbound: null,
            outbound: null,
            hint: movementType === 'in'
                ? 'in_other'
                : movementType === 'out'
                    ? 'out_other'
                    : 'adjustment'
        };
    });

    res.json({ product_id: productId, history });
});
