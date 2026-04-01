import { InvoiceItem } from '../models';

const BASE_URL = String(process.env.API_BASE_URL || 'http://127.0.0.1:5000/api/v1').replace(/\/$/, '');

export {};

type LoginResult = {
  token: string;
  userId: string;
};

type RoleKey = 'super_admin' | 'kasir' | 'driver' | 'customer';

const credentials: Record<RoleKey, { email: string; password: string }> = {
  super_admin: { email: 'superadmin@migunani.com', password: 'superadmin123' },
  kasir: { email: 'kasir@migunani.com', password: 'kasir123' },
  driver: { email: 'driver@migunani.com', password: 'driver123' },
  customer: { email: 'customer@migunani.com', password: 'customer123' },
};

async function login(role: RoleKey): Promise<LoginResult> {
  const response = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials[role])
  });
  const data = await response.json();
  if (!response.ok || typeof data?.token !== 'string') {
    throw new Error(`Login failed for ${role}: ${response.status} ${JSON.stringify(data)}`);
  }
  return {
    token: data.token,
    userId: String(data?.user?.id || '')
  };
}

async function requestJson(
  token: string,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(extraHeaders || {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
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

async function ensureShippingMethod(kasirToken: string) {
  const code = `REG${Date.now().toString().slice(-8)}`;
  const createRes = await requestJson(kasirToken, 'POST', '/admin/shipping-methods', {
    code,
    name: 'Regression Shipping (Partial Retur Scope)',
    fee: 10000,
    is_active: true,
    sort_order: 999
  });
  if (createRes.status !== 200 && createRes.status !== 201) {
    throw new Error(`ensureShippingMethod failed: ${createRes.status} ${JSON.stringify(createRes.data)}`);
  }
  return code;
}

async function getFirstProductId(customerToken: string) {
  const response = await requestJson(customerToken, 'GET', '/catalog?limit=20');
  assertStatus(response.status, 200, 'catalog list');
  const rows = Array.isArray((response.data as any)?.products)
    ? (response.data as any).products
    : Array.isArray((response.data as any)?.data)
      ? (response.data as any).data
      : Array.isArray(response.data)
        ? response.data
        : [];
  const product = rows.find((row: any) => Number(row?.stock_quantity || 0) > 0) || rows[0];
  assert(product?.id, 'No seeded product found for regression');
  return String(product.id);
}

async function checkoutSingleItem(customerToken: string, productId: string, qty: number, shippingCode: string) {
  const key = `regtest-checkout-partial-retur-scope-${Date.now()}`;
  const response = await requestJson(
    customerToken,
    'POST',
    '/orders/checkout',
    {
      from_cart: false,
      payment_method: 'cod',
      shipping_method_code: shippingCode,
      shipping_address: 'Jl. Regression Test No. 2',
      customer_note: 'regression-partial-retur-scope',
      items: [{ product_id: productId, qty }]
    },
    { 'Idempotency-Key': key }
  );
  assertStatus(response.status, 201, 'checkout cod');
  const orderId = String((response.data as any)?.order_id || '');
  assert(orderId, 'Missing order_id after checkout');
  return orderId;
}

async function getOrderDetail(token: string, orderId: string) {
  const response = await requestJson(token, 'GET', `/orders/${orderId}`);
  assertStatus(response.status, 200, `order detail ${orderId}`);
  return response.data as any;
}

async function allocateFullOrder(kasirToken: string, orderId: string) {
  const detail = await getOrderDetail(kasirToken, orderId);
  const items = Array.isArray(detail?.OrderItems) ? detail.OrderItems : [];
  const payload = items.map((item: any) => ({
    product_id: String(item?.product_id || ''),
    qty: Number(item?.qty || 0)
  })).filter((item: any) => item.product_id && item.qty > 0);
  assert(payload.length > 0, `No allocatable items for order ${orderId}`);
  const response = await requestJson(kasirToken, 'POST', `/allocation/${orderId}`, { items: payload });
  assertStatus(response.status, 200, `allocate order ${orderId}`);
}

async function issueInvoiceByItems(kasirToken: string, items: Array<{ order_item_id: string; qty: number }>) {
  const response = await requestJson(kasirToken, 'POST', '/admin/finance/invoices/issue-items', { items });
  assertStatus(response.status, 200, 'issue invoice by items');
  const invoiceId = String((response.data as any)?.invoice_id || '');
  assert(invoiceId, 'Missing invoice_id after issue invoice by items');
  return invoiceId;
}

async function assignInvoiceDriver(superAdminToken: string, invoiceId: string, driverId: string) {
  const response = await requestJson(superAdminToken, 'PATCH', `/invoices/${invoiceId}/assign-driver`, { courier_id: driverId });
  assertStatus(response.status, 200, 'assign invoice driver');
}

async function createDeliveryRetur(driverToken: string, invoiceId: string, productId: string, qty: number) {
  const response = await requestJson(driverToken, 'POST', `/driver/orders/${invoiceId}/retur`, {
    retur_type: 'delivery_refusal',
    items: [{ product_id: productId, qty }]
  });
  if (response.status !== 201 && response.status !== 200) {
    throw new Error(`createDeliveryRetur failed: ${response.status} ${JSON.stringify(response.data)}`);
  }
}

async function getInvoiceDetail(token: string, invoiceId: string) {
  const response = await requestJson(token, 'GET', `/invoices/${invoiceId}`);
  assertStatus(response.status, 200, `invoice detail ${invoiceId}`);
  return response.data as any;
}

async function main() {
  const [{ token: superAdminToken }, { token: kasirToken }, { token: customerToken }, driver] = await Promise.all([
    login('super_admin'),
    login('kasir'),
    login('customer'),
    login('driver'),
  ]);

  const shippingCode = await ensureShippingMethod(kasirToken);
  const productId = await getFirstProductId(customerToken);
  const orderId = await checkoutSingleItem(customerToken, productId, 5, shippingCode);
  await allocateFullOrder(kasirToken, orderId);

  const orderDetail = await getOrderDetail(kasirToken, orderId);
  const orderItems = Array.isArray(orderDetail?.OrderItems) ? orderDetail.OrderItems : [];
  const orderItemId = String(orderItems?.[0]?.id || '').trim();
  assert(orderItemId, 'Missing order_item_id after checkout');

  const invoice1Id = await issueInvoiceByItems(kasirToken, [{ order_item_id: orderItemId, qty: 2 }]);
  await assignInvoiceDriver(superAdminToken, invoice1Id, driver.userId);
  await createDeliveryRetur(driver.token, invoice1Id, productId, 1);

  const invoice2Id = await issueInvoiceByItems(kasirToken, [{ order_item_id: orderItemId, qty: 3 }]);

  const inv1 = await getInvoiceDetail(kasirToken, invoice1Id);
  const inv2 = await getInvoiceDetail(kasirToken, invoice2Id);

  const inv1Return = Number(inv1?.delivery_return_summary?.return_total || 0);
  const inv2Return = Number(inv2?.delivery_return_summary?.return_total || 0);

  assert(inv1Return > 0, `invoice1 return_total should be > 0, got ${inv1Return}`);
  assert(inv2Return <= 0, `invoice2 return_total should be 0, got ${inv2Return}`);

  // Extra sanity: ensure split was actually created from the same order_item_id.
  const inv1Items = await InvoiceItem.findAll({ where: { invoice_id: String(invoice1Id) }, attributes: ['order_item_id', 'qty'] });
  const inv2Items = await InvoiceItem.findAll({ where: { invoice_id: String(invoice2Id) }, attributes: ['order_item_id', 'qty'] });
  const inv1OrderItem = String((inv1Items as any[])?.[0]?.order_item_id || '').trim();
  const inv2OrderItem = String((inv2Items as any[])?.[0]?.order_item_id || '').trim();
  assert(inv1OrderItem && inv1OrderItem === inv2OrderItem, 'Expected both invoices to reference the same order_item_id');

  // eslint-disable-next-line no-console
  console.log('[OK] Retur hanya memotong invoice pertama; invoice kedua tidak ikut terpotong.', {
    invoice1Id,
    invoice2Id,
    invoice1ReturnTotal: inv1Return,
    invoice2ReturnTotal: inv2Return,
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[FAIL]', err);
  process.exitCode = 1;
});

