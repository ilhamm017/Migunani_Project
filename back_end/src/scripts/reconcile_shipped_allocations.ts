import 'dotenv/config';
import { Op } from 'sequelize';
import { Order, OrderAllocation, Product, sequelize } from '../models';

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out: Record<string, string> = {};
  for (const raw of args) {
    const trimmed = String(raw || '').trim();
    if (!trimmed.startsWith('--')) continue;
    const [k, ...rest] = trimmed.slice(2).split('=');
    out[String(k || '').trim()] = rest.join('=').trim();
  }
  return out;
};

const toBool = (raw: unknown): boolean => {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'y';
};

const toInt = (raw: unknown): number => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
};

async function main() {
  const args = parseArgs();
  const dryRun = toBool(args['dry_run']);
  const rebuild = args['rebuild'] === undefined ? true : toBool(args['rebuild']);
  const onlyOrderId = String(args['order_id'] || '').trim();
  const limit = Math.max(0, toInt(args['limit']));

  await sequelize.authenticate();

  const orderIds = onlyOrderId
    ? [onlyOrderId]
    : (await Order.findAll({
      where: { goods_out_posted_at: { [Op.not]: null } } as any,
      attributes: ['id'],
      order: [['goods_out_posted_at', 'ASC'], ['id', 'ASC']],
      ...(limit > 0 ? { limit } : {}),
    }) as any[]).map((row: any) => String(row?.id || '').trim()).filter(Boolean);

  console.log('[reconcile_shipped_allocations] candidates:', orderIds.length);
  console.log('[reconcile_shipped_allocations] dry_run:', dryRun ? 1 : 0);
  console.log('[reconcile_shipped_allocations] rebuild:', rebuild ? 1 : 0);

  let shippedAllocationRows = 0;
  let updatedProducts = 0;

  for (const orderId of orderIds) {
    if (!orderId) continue;

    const t = await sequelize.transaction();
    try {
      const order = await Order.findByPk(orderId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!order) {
        await t.rollback();
        continue;
      }
      if (!(order as any).goods_out_posted_at) {
        await t.rollback();
        continue;
      }

      const openAllocations = await OrderAllocation.findAll({
        where: {
          order_id: orderId,
          status: { [Op.in]: ['pending', 'picked'] },
          allocated_qty: { [Op.gt]: 0 },
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
        order: [['createdAt', 'ASC'], ['id', 'ASC']],
      }) as any[];

      if (openAllocations.length === 0) {
        await t.commit();
        continue;
      }

      const shippedAt = new Date((order as any).goods_out_posted_at);
      const shippedQtyByProductId = new Map<string, number>();
      for (const alloc of openAllocations) {
        const productId = String(alloc?.product_id || '').trim();
        const qty = Math.max(0, Math.trunc(Number(alloc?.allocated_qty || 0)));
        if (!productId || qty <= 0) continue;

        shippedQtyByProductId.set(productId, Number(shippedQtyByProductId.get(productId) || 0) + qty);

        if (!dryRun) {
          await alloc.update({
            status: 'shipped',
            shipped_at: shippedAt,
            picked_at: alloc?.picked_at ? new Date(alloc.picked_at) : shippedAt,
          }, { transaction: t });
          shippedAllocationRows += 1;
        }
      }

      const productIds = Array.from(shippedQtyByProductId.keys());
      if (productIds.length > 0) {
        const products = await Product.findAll({
          where: { id: { [Op.in]: productIds } },
          transaction: t,
          lock: t.LOCK.UPDATE,
        }) as any[];

        for (const product of products) {
          const productId = String(product?.id || '').trim();
          const dec = Number(shippedQtyByProductId.get(productId) || 0);
          if (!productId || dec <= 0) continue;
          const currentAllocated = Number(product?.allocated_quantity || 0);
          const nextAllocated = Math.max(0, currentAllocated - dec);
          if (dryRun) {
            console.log('[dry_run] would_update_product:', {
              product_id: productId,
              allocated_quantity_before: currentAllocated,
              decrement: dec,
              allocated_quantity_after: nextAllocated,
              order_id: orderId,
            });
            continue;
          }
          await product.update({ allocated_quantity: nextAllocated }, { transaction: t });
          updatedProducts += 1;
        }
      }

      if (dryRun) {
        console.log('[dry_run] would_ship_allocations:', {
          order_id: orderId,
          allocation_row_count: openAllocations.length,
          shipped_at: shippedAt.toISOString(),
        });
        await t.rollback();
        continue;
      }

      await t.commit();
    } catch (error) {
      try {
        await t.rollback();
      } catch {}
      throw error;
    }
  }

  if (!dryRun && rebuild) {
    console.log('[reconcile_shipped_allocations] rebuilding products.allocated_quantity from open allocations...');
    await sequelize.query(`
      UPDATE products p
      LEFT JOIN (
        SELECT product_id, SUM(allocated_qty) AS sum_alloc
        FROM order_allocations
        WHERE status IN ('pending','picked')
        GROUP BY product_id
      ) s ON s.product_id = p.id
      SET p.allocated_quantity = COALESCE(s.sum_alloc, 0);
    `);
  }

  console.log('[reconcile_shipped_allocations] shipped_allocation_rows:', shippedAllocationRows);
  console.log('[reconcile_shipped_allocations] updated_products:', updatedProducts);
}

main().catch((err) => {
  console.error('[reconcile_shipped_allocations] fatal:', err instanceof Error ? err.stack || err.message : err);
  process.exitCode = 1;
});

