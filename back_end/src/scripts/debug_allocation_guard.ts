import { Op } from 'sequelize';
import { Backorder, Order, OrderAllocation, OrderItem, Product, sequelize } from '../models';
import { findInvoicesByOrderId } from '../utils/invoiceLookup';

const safeLower = (v: unknown) => String(v || '').trim().toLowerCase();

const isInvoiceShipmentPassedWarehouse = (shipmentStatusRaw: unknown): boolean => {
  const shipmentStatus = safeLower(shipmentStatusRaw);
  return shipmentStatus === 'shipped' || shipmentStatus === 'delivered' || shipmentStatus === 'canceled';
};

const BACKORDER_FILL_GRACE_MS = 24 * 60 * 60 * 1000;

async function main() {
  const orderId = String(process.argv[2] || '').trim();
  if (!orderId) {
    console.error('Usage: ts-node src/scripts/debug_allocation_guard.ts <orderId>');
    process.exitCode = 2;
    return;
  }

  try {
    const order = await Order.findByPk(orderId, {
      include: [{
        model: OrderItem,
        include: [{ model: Product, attributes: ['id', 'sku', 'name', 'stock_quantity', 'allocated_quantity'] }]
      }],
      logging: false
    });
    if (!order) {
      console.error(`Order not found: ${orderId}`);
      process.exitCode = 1;
      return;
    }

    const orderItems = Array.isArray((order as any).OrderItems) ? (order as any).OrderItems : [];
    const orderItemIds = orderItems.map((row: any) => String(row?.id || '')).filter(Boolean);

    const activeBackorderRows = orderItemIds.length > 0
      ? await Backorder.findAll({
        include: [{
          model: OrderItem,
          required: true,
          where: { order_id: orderId }
        }],
        where: {
          qty_pending: { [Op.gt]: 0 },
          status: { [Op.notIn]: ['fulfilled', 'canceled'] }
        },
        attributes: ['id', 'order_item_id', 'qty_pending', 'status', 'createdAt', 'updatedAt']
      })
      : [];

    const allocations = await OrderAllocation.findAll({ where: { order_id: orderId } });
    const invoices = await findInvoicesByOrderId(orderId);

    const nowMs = Date.now();
    const invoiceSummaries = invoices
      .map((inv: any) => {
        const createdAt = inv?.createdAt ? new Date(inv.createdAt) : null;
        const createdAtMs = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.getTime() : 0;
        const ageMs = createdAtMs ? (nowMs - createdAtMs) : 0;
        return {
          id: String(inv?.id || ''),
          invoice_number: String(inv?.invoice_number || ''),
          shipment_status: String(inv?.shipment_status || ''),
          payment_status: String(inv?.payment_status || ''),
          createdAt: createdAt ? createdAt.toISOString() : null,
          age_hours: createdAtMs ? Math.round((ageMs / (60 * 60 * 1000)) * 10) / 10 : null,
          passed_warehouse: isInvoiceShipmentPassedWarehouse(inv?.shipment_status),
          in_grace_window: createdAtMs ? (ageMs <= BACKORDER_FILL_GRACE_MS) : null,
        };
      })
      .sort((a: any, b: any) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

    const blockingInvoice = invoiceSummaries.find((s: any) =>
      s.createdAt && !s.passed_warehouse && s.in_grace_window === false
    ) || null;

    const summary = {
      order: {
        id: String(order.id),
        status: String((order as any).status || ''),
        customer_id: String((order as any).customer_id || ''),
        createdAt: (order as any).createdAt ? new Date((order as any).createdAt).toISOString() : null,
      },
      order_items: orderItems.map((row: any) => ({
        id: String(row?.id || ''),
        product_id: String(row?.product_id || ''),
        qty: Number(row?.qty || 0),
        ordered_qty_original: row?.ordered_qty_original == null ? null : Number(row?.ordered_qty_original || 0),
        qty_canceled_backorder: row?.qty_canceled_backorder == null ? null : Number(row?.qty_canceled_backorder || 0),
        product: row?.Product ? {
          id: String(row.Product.id || ''),
          sku: String(row.Product.sku || ''),
          name: String(row.Product.name || ''),
          stock_quantity: Number(row.Product.stock_quantity || 0),
          allocated_quantity: Number(row.Product.allocated_quantity || 0),
        } : null
      })),
      allocations_count: allocations.length,
      allocations: allocations.map((a: any) => ({
        id: String(a?.id || ''),
        product_id: String(a?.product_id || ''),
        allocated_qty: Number(a?.allocated_qty || 0),
        status: String(a?.status || ''),
      })),
      has_active_backorder: activeBackorderRows.length > 0,
      active_backorders_count: activeBackorderRows.length,
      blocking_invoice: blockingInvoice
        ? { invoice_number: blockingInvoice.invoice_number || blockingInvoice.id, shipment_status: blockingInvoice.shipment_status, age_hours: blockingInvoice.age_hours }
        : null,
      invoices: invoiceSummaries,
      active_backorders: activeBackorderRows.map((bo: any) => ({
        id: String(bo?.id || ''),
        order_item_id: String(bo?.order_item_id || ''),
        qty_pending: Number(bo?.qty_pending || 0),
        status: String(bo?.status || ''),
        createdAt: bo?.createdAt ? new Date(bo.createdAt).toISOString() : null,
      })),
    };

    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error('Unexpected error:', error);
    process.exitCode = 1;
  } finally {
    try {
      await sequelize.close();
    } catch {
      // ignore
    }
  }
}

main();
