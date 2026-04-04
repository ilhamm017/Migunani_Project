import 'dotenv/config';
import { Op } from 'sequelize';
import { Backorder, Order, OrderItem, Product, User, sequelize } from '../models';

const BASE_URL = String(process.env.API_BASE_URL || 'http://127.0.0.1:5000/api/v1').replace(/\/$/, '');

export {};

type LoginResult = {
  token: string;
  userId: string;
};

type RoleKey = 'super_admin' | 'admin_gudang' | 'kasir';

const credentials: Record<RoleKey, { email: string; password: string }> = {
  super_admin: { email: 'superadmin@migunani.com', password: 'superadmin123' },
  admin_gudang: { email: 'gudang@migunani.com', password: 'gudang123' },
  kasir: { email: 'kasir@migunani.com', password: 'kasir123' },
};

const tinyPngBuffer = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pH9n4sAAAAASUVORK5CYII=',
  'base64'
);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url: string, init: RequestInit, label: string, attempts = 8) {
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastError = err;
      const backoff = 200 + (i * 250);
      await sleep(backoff);
    }
  }
  const suffix = lastError instanceof Error ? lastError.message : String(lastError || '');
  throw new Error(`${label}: fetch failed after ${attempts} attempts. ${suffix}`);
}

async function login(role: RoleKey): Promise<LoginResult> {
  const response = await fetchWithRetry(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials[role]),
  }, `login:${role}`);
  const data = await response.json();
  if (!response.ok || typeof data?.token !== 'string') {
    throw new Error(`Login failed for ${role}: ${response.status} ${JSON.stringify(data)}`);
  }
  return {
    token: data.token,
    userId: String(data?.user?.id || ''),
  };
}

async function requestJson(
  token: string,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
) {
  const response = await fetchWithRetry(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(extraHeaders || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, `${method}:${path}`);
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

async function requestFormData(
  token: string,
  method: string,
  path: string,
  formData: FormData,
  extraHeaders?: Record<string, string>
) {
  const response = await fetchWithRetry(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(extraHeaders || {}),
    },
    body: formData,
  }, `${method}:${path}`);
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

function assertStatus(actual: number, expected: number, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assert(condition: unknown, label: string) {
  if (!condition) throw new Error(label);
}

function round2(value: unknown): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function ensureShippingMethod(kasirToken: string) {
  const code = `SPLIT${Date.now().toString().slice(-8)}`;
  const listRes = await requestJson(kasirToken, 'GET', '/admin/shipping-methods');
  assertStatus(listRes.status, 200, 'shipping list');

  const createRes = await requestJson(kasirToken, 'POST', '/admin/shipping-methods', {
    code,
    name: 'Regression Split Shipping',
    fee: 10000,
    is_active: true,
    sort_order: 999,
  });
  if (createRes.status !== 200 && createRes.status !== 201) {
    throw new Error(`ensureShippingMethod failed: ${createRes.status} ${JSON.stringify(createRes.data)}`);
  }
  return code;
}

async function getSeededCustomerId() {
  const row = await User.findOne({
    where: { role: 'customer', status: 'active' } as any,
    attributes: ['id'],
    order: [['createdAt', 'ASC']],
  }) as any;
  const customerId = String(row?.id || '').trim();
  assert(customerId, 'No active customer user found in DB (seed customers/staff first)');
  return customerId;
}

async function getFirstProductForAllocation(minStockQty: number) {
  const row = await Product.findOne({
    where: {
      status: 'active',
      stock_quantity: { [Op.gte]: minStockQty },
    } as any,
    attributes: ['id', 'base_price', 'stock_quantity'],
    order: [['stock_quantity', 'DESC'], ['id', 'ASC']],
  }) as any;
  assert(row?.id, 'No seeded product with sufficient stock found in DB');
  return {
    productId: String(row.id),
    basePrice: round2(row.base_price),
    stockQty: Math.max(0, Math.trunc(Number(row.stock_quantity || 0))),
  };
}

async function checkoutManualOrder(
  kasirToken: string,
  customerId: string,
  productId: string,
  qty: number,
  unitPriceOverride: number,
  shippingCode: string
) {
  const key = `regtest-backorder-split-checkout-${Date.now()}`;
  const response = await requestJson(
    kasirToken,
    'POST',
    '/orders/checkout',
    {
      from_cart: false,
      customer_id: customerId,
      source: 'whatsapp',
      payment_method: 'transfer_manual',
      shipping_method_code: shippingCode,
      shipping_address: 'Jl. Regression Split No. 1',
      customer_note: 'regression-backorder-split',
      items: [{
        product_id: productId,
        qty,
        unit_price_override: unitPriceOverride,
        unit_price_override_reason: 'regression_backorder_split',
      }]
    },
    { 'Idempotency-Key': key }
  );
  assertStatus(response.status, 201, 'checkout manual order');
  const orderId = String((response.data as any)?.order_id || '');
  assert(orderId, 'Missing order_id after checkout');
  return orderId;
}

async function allocateQty(kasirToken: string, orderId: string, productId: string, qty: number) {
  const response = await requestJson(kasirToken, 'POST', `/allocation/${orderId}`, {
    items: [{ product_id: productId, qty }]
  });
  assertStatus(response.status, 200, `allocate ${orderId}`);
}

async function issueInvoice(kasirToken: string, orderId: string) {
  const response = await requestJson(kasirToken, 'POST', `/admin/finance/orders/${orderId}/issue-invoice`);
  assertStatus(response.status, 200, `issue invoice ${orderId}`);
  const invoiceId = String((response.data as any)?.invoice_id || '');
  assert(invoiceId, `Missing invoice_id after issue invoice ${orderId}`);
  return invoiceId;
}

async function shipInvoiceViaHandover(superAdminToken: string, adminGudangToken: string, invoiceId: string, driverId: string) {
  const assign = await requestJson(adminGudangToken, 'PATCH', `/invoices/${invoiceId}/assign-driver`, { courier_id: driverId });
  assertStatus(assign.status, 200, `assign driver invoice ${invoiceId}`);

  const form = new FormData();
  form.append('invoice_id', invoiceId);
  form.append('result', 'pass');
  const check = await requestFormData(superAdminToken, 'POST', '/admin/delivery-handovers/check', form);
  assertStatus(check.status, 200, `delivery handover check ${invoiceId}`);
  const handoverId = String((check.data as any)?.handover_id || '');
  assert(handoverId, `Missing handover_id for invoice ${invoiceId}`);

  const handover = await requestJson(superAdminToken, 'POST', `/admin/delivery-handovers/${handoverId}/handover`, {});
  assertStatus(handover.status, 200, `delivery handover to driver ${invoiceId}`);
}

async function main() {
  await sequelize.authenticate();

  const superAdmin = await login('super_admin');
  const adminGudang = await login('admin_gudang');
  const kasir = await login('kasir');

  const driverUser = await User.findOne({
    where: { role: 'driver', status: 'active' } as any,
    attributes: ['id'],
    order: [['createdAt', 'ASC']],
  }) as any;
  const driverId = String(driverUser?.id || '').trim();
  assert(driverId, 'No active driver user found in DB (seed staff first)');

  const shippingCode = await ensureShippingMethod(kasir.token);
  const customerId = await getSeededCustomerId();
  const product = await getFirstProductForAllocation(5);

  const orderQty = 8;
  const allocQty = 5;

  const unitPriceOverride = product.basePrice > 0
    ? Math.max(1, round2(product.basePrice - 1000))
    : 10000;
  assert(unitPriceOverride > 0, 'unitPriceOverride must be > 0');

  const parentOrderId = await checkoutManualOrder(
    kasir.token,
    customerId,
    product.productId,
    orderQty,
    unitPriceOverride,
    shippingCode
  );

  const before = await Order.findByPk(parentOrderId) as any;
  assert(before, `Order not found in DB: ${parentOrderId}`);
  const beforeTotals = {
    total_amount: round2(before.total_amount),
    discount_amount: round2(before.discount_amount),
    shipping_fee: round2(before.shipping_fee),
  };

  await allocateQty(kasir.token, parentOrderId, product.productId, allocQty);
  const invoiceId = await issueInvoice(kasir.token, parentOrderId);

  const childOrder = await Order.findOne({
    where: { parent_order_id: parentOrderId },
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
  }) as any;
  assert(childOrder?.id, 'Missing child order after auto-split');

  const parentAfter = await Order.findByPk(parentOrderId) as any;
  assert(parentAfter, `Parent order not found after split: ${parentOrderId}`);

  const parentItems = await OrderItem.findAll({ where: { order_id: parentOrderId }, order: [['id', 'ASC']] }) as any[];
  const childItems = await OrderItem.findAll({ where: { order_id: String(childOrder.id) }, order: [['id', 'ASC']] }) as any[];
  assert(parentItems.length > 0, 'Parent order has no items');
  assert(childItems.length > 0, 'Child order has no items');

  const parentTotalQty = parentItems.reduce((sum, row) => sum + Math.max(0, Math.trunc(Number(row?.qty || 0))), 0);
  const childTotalQty = childItems.reduce((sum, row) => sum + Math.max(0, Math.trunc(Number(row?.qty || 0))), 0);
  assert(parentTotalQty === allocQty, `Parent qty mismatch: expected ${allocQty}, got ${parentTotalQty}`);
  assert(childTotalQty === orderQty - allocQty, `Child qty mismatch: expected ${orderQty - allocQty}, got ${childTotalQty}`);

  const parentBackorders = await Backorder.findAll({
    include: [{ model: OrderItem, required: true, where: { order_id: parentOrderId } }],
    where: { qty_pending: { [Op.gt]: 0 }, status: { [Op.notIn]: ['fulfilled', 'canceled'] } },
  }) as any[];
  assert(parentBackorders.length === 0, 'Parent order still has active backorder after split');

  const childBackorders = await Backorder.findAll({
    include: [{ model: OrderItem, required: true, where: { order_id: String(childOrder.id) } }],
    where: { qty_pending: { [Op.gt]: 0 }, status: { [Op.in]: ['waiting_stock', 'ready'] } },
  }) as any[];
  assert(childBackorders.length > 0, 'Child order missing active backorder rows');

  const afterTotals = {
    parent: {
      total_amount: round2(parentAfter.total_amount),
      discount_amount: round2(parentAfter.discount_amount),
      shipping_fee: round2(parentAfter.shipping_fee),
    },
    child: {
      total_amount: round2(childOrder.total_amount),
      discount_amount: round2(childOrder.discount_amount),
      shipping_fee: round2(childOrder.shipping_fee),
    }
  };

  const totalSum = round2(afterTotals.parent.total_amount + afterTotals.child.total_amount);
  const discountSum = round2(afterTotals.parent.discount_amount + afterTotals.child.discount_amount);
  const shippingSum = round2(afterTotals.parent.shipping_fee + afterTotals.child.shipping_fee);

  assert(totalSum === beforeTotals.total_amount, `total_amount split mismatch: before=${beforeTotals.total_amount} after_sum=${totalSum}`);
  assert(discountSum === beforeTotals.discount_amount, `discount_amount split mismatch: before=${beforeTotals.discount_amount} after_sum=${discountSum}`);
  assert(shippingSum === beforeTotals.shipping_fee, `shipping_fee split mismatch: before=${beforeTotals.shipping_fee} after_sum=${shippingSum}`);

  // For single item order, fee split should follow qty ratio (5/8 of fee, remainder to child).
  assert(afterTotals.parent.shipping_fee === 6250, `parent shipping fee mismatch: expected 6250, got ${afterTotals.parent.shipping_fee}`);
  assert(afterTotals.child.shipping_fee === 3750, `child shipping fee mismatch: expected 3750, got ${afterTotals.child.shipping_fee}`);

  await shipInvoiceViaHandover(superAdmin.token, adminGudang.token, invoiceId, driverId);

  const allocateAgain = await requestJson(kasir.token, 'POST', `/allocation/${parentOrderId}`, {
    items: [{ product_id: product.productId, qty: allocQty }]
  });
  assertStatus(allocateAgain.status, 409, 'allocation should be blocked after goods-out');

  console.log('[regression_backorder_split] PASS', {
    parent_order_id: parentOrderId,
    child_order_id: String(childOrder.id),
    invoice_id: invoiceId,
  });
}

main().catch((err) => {
  console.error('[regression_backorder_split] FAIL:', err instanceof Error ? err.stack || err.message : err);
  process.exitCode = 1;
});
