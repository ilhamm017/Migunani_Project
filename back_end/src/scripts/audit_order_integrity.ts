import 'dotenv/config';
import { Op } from 'sequelize';
import { Backorder, Order, OrderAllocation, OrderItem, sequelize } from '../models';

type Args = {
  order_id?: string;
  limit?: string;
  json?: string;
};

const parseArgs = (): Args => {
  const out: Record<string, string> = {};
  for (const raw of process.argv.slice(2)) {
    const trimmed = String(raw || '').trim();
    if (!trimmed.startsWith('--')) continue;
    const [k, ...rest] = trimmed.slice(2).split('=');
    out[String(k || '').trim()] = rest.join('=').trim();
  }
  return out as Args;
};

const toBool = (raw: unknown): boolean => {
  const val = String(raw ?? '').trim().toLowerCase();
  return val === '1' || val === 'true' || val === 'yes' || val === 'y';
};

const toInt = (raw: unknown): number => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
};

const safeLower = (value: unknown): string => String(value || '').trim().toLowerCase();

const n = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const distributeAllocationToOrderItems = (
  orderItemsRaw: any[],
  allocationsRaw: any[]
): Map<string, { ordered_qty: number; allocated_qty: number; shortage_qty: number }> => {
  const orderItems = Array.isArray(orderItemsRaw) ? orderItemsRaw : [];
  const allocations = Array.isArray(allocationsRaw) ? allocationsRaw : [];

  const allocatedByProduct = new Map<string, number>();
  allocations.forEach((row: any) => {
    const productId = String(row?.product_id || '').trim();
    if (!productId) return;
    allocatedByProduct.set(productId, n(allocatedByProduct.get(productId)) + n(row?.allocated_qty));
  });

  const itemsByProduct = new Map<string, any[]>();
  orderItems.forEach((row: any) => {
    const productId = String(row?.product_id || '').trim();
    if (!productId) return;
    const bucket = itemsByProduct.get(productId) || [];
    bucket.push(row);
    itemsByProduct.set(productId, bucket);
  });

  const out = new Map<string, { ordered_qty: number; allocated_qty: number; shortage_qty: number }>();
  itemsByProduct.forEach((bucket, productId) => {
    let remaining = Math.max(0, Math.trunc(n(allocatedByProduct.get(productId))));
    const sorted = [...bucket].sort((a, b) => {
      const aId = Number(a?.id);
      const bId = Number(b?.id);
      if (Number.isFinite(aId) && Number.isFinite(bId)) return aId - bId;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
    for (const item of sorted) {
      const id = String(item?.id || '').trim();
      if (!id) continue;
      const orderedQty = Math.max(0, Math.trunc(n(item?.qty)));
      const allocatedQty = Math.max(0, Math.min(orderedQty, remaining));
      remaining = Math.max(0, remaining - allocatedQty);
      out.set(id, {
        ordered_qty: orderedQty,
        allocated_qty: allocatedQty,
        shortage_qty: Math.max(0, orderedQty - allocatedQty),
      });
    }
  });

  return out;
};

async function main() {
  const args = parseArgs();
  const onlyOrderId = String(args.order_id || '').trim();
  const limit = Math.max(0, toInt(args.limit || 200));
  const asJson = toBool(args.json);

  await sequelize.authenticate();

  const orders = onlyOrderId
    ? (await Order.findAll({ where: { id: onlyOrderId }, limit: 1 }) as any[])
    : (await Order.findAll({
      where: { status: { [Op.notIn]: ['canceled', 'expired'] } },
      attributes: ['id', 'status', 'goods_out_posted_at', 'updatedAt', 'createdAt'],
      order: [['updatedAt', 'DESC'], ['id', 'ASC']],
      limit,
    }) as any[]);

  const orderIds = orders.map((o: any) => String(o?.id || '').trim()).filter(Boolean);
  console.log('[audit_order_integrity] candidates:', orderIds.length);
  if (!onlyOrderId) console.log('[audit_order_integrity] limit:', limit);

  if (orderIds.length === 0) return;

  const allocations = await OrderAllocation.findAll({
    where: { order_id: { [Op.in]: orderIds } },
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
  }) as any[];
  const items = await OrderItem.findAll({
    where: { order_id: { [Op.in]: orderIds } },
    order: [['id', 'ASC']],
  }) as any[];
  const backorders = await Backorder.findAll({
    include: [{
      model: OrderItem,
      required: true,
      attributes: ['id', 'order_id'],
      where: { order_id: { [Op.in]: orderIds } }
    }],
    attributes: ['id', 'order_item_id', 'qty_pending', 'status'],
  }) as any[];

  const allocationsByOrderId = new Map<string, any[]>();
  allocations.forEach((row: any) => {
    const orderId = String(row?.order_id || '').trim();
    if (!orderId) return;
    const bucket = allocationsByOrderId.get(orderId) || [];
    bucket.push(row);
    allocationsByOrderId.set(orderId, bucket);
  });
  const itemsByOrderId = new Map<string, any[]>();
  items.forEach((row: any) => {
    const orderId = String(row?.order_id || '').trim();
    if (!orderId) return;
    const bucket = itemsByOrderId.get(orderId) || [];
    bucket.push(row);
    itemsByOrderId.set(orderId, bucket);
  });
  const backorderByOrderItemId = new Map<string, any>();
  backorders.forEach((row: any) => {
    const orderItemId = String(row?.order_item_id || '').trim();
    if (!orderItemId) return;
    backorderByOrderItemId.set(orderItemId, row);
  });

  const problems: any[] = [];

  for (const order of orders as any[]) {
    const orderId = String(order?.id || '').trim();
    if (!orderId) continue;

    const orderItems = itemsByOrderId.get(orderId) || [];
    const orderAllocs = allocationsByOrderId.get(orderId) || [];
    const breakdown = distributeAllocationToOrderItems(orderItems, orderAllocs);

    const openAllocQty = orderAllocs
      .filter((row: any) => ['pending', 'picked'].includes(safeLower(row?.status)) && n(row?.allocated_qty) > 0)
      .reduce((sum: number, row: any) => sum + Math.max(0, Math.trunc(n(row?.allocated_qty))), 0);

    const shippedByProduct = new Map<string, number>();
    const totalByProduct = new Map<string, number>();
    orderAllocs.forEach((row: any) => {
      const productId = String(row?.product_id || '').trim();
      if (!productId) return;
      totalByProduct.set(productId, n(totalByProduct.get(productId)) + n(row?.allocated_qty));
      if (safeLower(row?.status) === 'shipped') {
        shippedByProduct.set(productId, n(shippedByProduct.get(productId)) + n(row?.allocated_qty));
      }
    });

    const shippedGtTotal: Array<{ product_id: string; shipped: number; total: number }> = [];
    for (const [productId, shipped] of shippedByProduct.entries()) {
      const total = n(totalByProduct.get(productId));
      if (shipped > total) {
        shippedGtTotal.push({ product_id: productId, shipped, total });
      }
    }

    const backorderMismatches: Array<{ order_item_id: string; expected: number; actual: number; status: string }> = [];
    for (const item of orderItems as any[]) {
      const orderItemId = String(item?.id || '').trim();
      if (!orderItemId) continue;
      const expected = Math.max(0, Math.trunc(n(breakdown.get(orderItemId)?.shortage_qty)));
      const bo = backorderByOrderItemId.get(orderItemId);
      const actualRaw = bo ? Math.max(0, Math.trunc(n(bo?.qty_pending))) : 0;
      const status = bo ? String(bo?.status || '') : 'none';
      const actual = safeLower(status) === 'canceled' ? 0 : actualRaw;
      if (expected !== actual) {
        backorderMismatches.push({ order_item_id: orderItemId, expected, actual, status });
      }
    }

    const goodsOutPostedAt = order?.goods_out_posted_at ? new Date(order.goods_out_posted_at) : null;
    const hasOpenAllocationsAfterGoodsOut = Boolean(goodsOutPostedAt) && openAllocQty > 0;

    if (hasOpenAllocationsAfterGoodsOut || shippedGtTotal.length > 0 || backorderMismatches.length > 0) {
      const row = {
        order_id: orderId,
        status: String(order?.status || ''),
        goods_out_posted_at: goodsOutPostedAt ? goodsOutPostedAt.toISOString() : null,
        open_allocations_qty: openAllocQty,
        shipped_gt_total_by_product: shippedGtTotal,
        backorder_mismatches: backorderMismatches,
      };
      problems.push(row);
      if (asJson) {
        console.log(JSON.stringify(row));
      } else {
        console.log('\n[audit_order_integrity] problem:', {
          order_id: orderId,
          status: row.status,
          goods_out_posted_at: row.goods_out_posted_at,
          open_allocations_qty: openAllocQty,
          shipped_gt_total_count: shippedGtTotal.length,
          backorder_mismatch_count: backorderMismatches.length,
        });
      }
    }
  }

  console.log('\n[audit_order_integrity] problem_count:', problems.length);
  if (!asJson && problems.length > 0) {
    console.log('[audit_order_integrity] tips: rerun with --json=true for full payload, or --order_id=<id> to zoom in.');
  }
}

main().catch((err) => {
  console.error('[audit_order_integrity] fatal:', err instanceof Error ? err.stack || err.message : err);
  process.exitCode = 1;
});

