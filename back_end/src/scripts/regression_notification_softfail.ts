const BASE_URL = String(process.env.API_BASE_URL || 'http://127.0.0.1:5000/api/v1').replace(/\/$/, '');

export {};

type LoginResult = {
  token: string;
  userId: string;
};

type RoleKey = 'super_admin' | 'admin_gudang' | 'kasir' | 'customer';

const credentials: Record<RoleKey, { email: string; password: string }> = {
  super_admin: { email: 'superadmin@migunani.com', password: 'superadmin123' },
  admin_gudang: { email: 'gudang@migunani.com', password: 'gudang123' },
  kasir: { email: 'kasir@migunani.com', password: 'kasir123' },
  customer: { email: 'customer1@migunani.com', password: 'customer123' },
};

const tinyPngBuffer = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pH9n4sAAAAASUVORK5CYII=',
  'base64'
);

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
  body?: unknown
) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
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
  return { status: response.status, data, text };
}

async function requestFormData(token: string, method: string, path: string, formData: FormData) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data, text };
}

function assertStatus(actual: number, expected: number, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assert(condition: unknown, label: string) {
  if (!condition) throw new Error(label);
}

async function ensureWhatsappStopped(kasirToken: string) {
  const statusRes = await requestJson(kasirToken, 'GET', '/whatsapp/status');
  assertStatus(statusRes.status, 200, 'whatsapp status');
  const status = String((statusRes.data as any)?.status || '');
  if (status !== 'READY') return status;

  const logoutRes = await requestJson(kasirToken, 'POST', '/whatsapp/logout', {});
  assertStatus(logoutRes.status, 200, 'whatsapp logout');

  for (let i = 0; i < 10; i += 1) {
    const poll = await requestJson(kasirToken, 'GET', '/whatsapp/status');
    assertStatus(poll.status, 200, 'whatsapp status poll');
    const polledStatus = String((poll.data as any)?.status || '');
    if (polledStatus !== 'READY') {
      return polledStatus;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('WhatsApp client still READY after logout');
}

async function ensureShippingMethod(kasirToken: string) {
  const code = `NOTIF${Date.now().toString().slice(-8)}`;
  const createRes = await requestJson(kasirToken, 'POST', '/admin/shipping-methods', {
    code,
    name: 'Notification Regression Shipping',
    fee: 10000,
    is_active: true,
    sort_order: 997
  });
  if (createRes.status !== 200 && createRes.status !== 201) {
    throw new Error(`ensureShippingMethod failed: ${createRes.status} ${JSON.stringify(createRes.data)}`);
  }
  return code;
}

async function getFirstProductId(customerToken: string) {
  const response = await requestJson(customerToken, 'GET', '/catalog?limit=10');
  assertStatus(response.status, 200, 'catalog list');
  const rows = Array.isArray((response.data as any)?.products)
    ? (response.data as any).products
    : Array.isArray((response.data as any)?.data)
      ? (response.data as any).data
      : Array.isArray(response.data)
        ? response.data
        : [];
  const product = rows.find((row: any) => Number(row?.stock_quantity || 0) > 0) || rows[0];
  assert(product?.id, 'No seeded product found');
  return String(product.id);
}

async function topUpProductStock(kasirToken: string, productId: string, qty: number) {
  const response = await requestJson(kasirToken, 'POST', '/admin/inventory/mutation', {
    product_id: productId,
    type: 'in',
    qty,
    note: 'Notification regression stock top-up'
  });
  if (response.status !== 200 && response.status !== 403) {
    throw new Error(`top up stock unexpected status: ${response.status}`);
  }
}

async function checkoutSingleItem(customerToken: string, productId: string, shippingCode: string) {
  const response = await requestJson(customerToken, 'POST', '/orders/checkout', {
    from_cart: false,
    payment_method: 'transfer_manual',
    shipping_method_code: shippingCode,
    shipping_address: 'Jl. Notification Regression No. 1',
    customer_note: 'notification-softfail',
    items: [{ product_id: productId, qty: 1 }]
  });
  assertStatus(response.status, 201, 'checkout transfer');
  const orderId = String((response.data as any)?.order_id || '');
  assert(orderId, 'Missing order_id');
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
  assert(payload.length > 0, 'No allocatable items');
  const response = await requestJson(kasirToken, 'POST', `/allocation/${orderId}`, { items: payload });
  assertStatus(response.status, 200, 'allocate');
}

async function issueInvoice(kasirToken: string, orderId: string) {
  const response = await requestJson(kasirToken, 'POST', `/admin/finance/orders/${orderId}/issue-invoice`);
  assertStatus(response.status, 200, 'issue invoice');
}

async function uploadPaymentProof(customerToken: string, orderId: string) {
  const form = new FormData();
  form.append('proof', new Blob([tinyPngBuffer], { type: 'image/png' }), 'proof.png');
  const response = await requestFormData(customerToken, 'POST', `/orders/${orderId}/proof`, form);
  assertStatus(response.status, 200, 'upload payment proof softfail');
}

async function getOrderStatus(customerToken: string, orderId: string) {
  const detail = await getOrderDetail(customerToken, orderId);
  return String(detail?.status || '');
}

async function openSupportThread(kasirToken: string, customerId: string) {
  const response = await requestJson(kasirToken, 'POST', '/chat/threads/open', {
    mode: 'support',
    target_user_id: customerId
  });
  assertStatus(response.status, 201, 'open support thread');
  const threadId = String((response.data as any)?.thread?.id || '');
  assert(threadId, 'Missing thread id');
  return threadId;
}

async function main() {
  const superAdmin = await login('super_admin');
  const adminGudang = await login('admin_gudang');
  const kasir = await login('kasir');
  const customer = await login('customer');

  const waStatus = await ensureWhatsappStopped(kasir.token);
  assert(waStatus !== 'READY', `Expected WA not READY, got ${waStatus}`);

  const otpRes = await requestJson(superAdmin.token, 'POST', '/admin/customers/otp/send', {
    whatsapp_number: `628555${Date.now().toString().slice(-7)}`
  });
  assertStatus(otpRes.status, 409, 'customer otp softfail');
  assert(String(otpRes.text).includes('WhatsApp bot belum terhubung'), 'OTP softfail message mismatch');
  console.log(`PASS otp softfail -> ${otpRes.status}`);

  const shippingCode = await ensureShippingMethod(kasir.token);
  const productId = await getFirstProductId(customer.token);
  await topUpProductStock(adminGudang.token, productId, 5);
  const orderId = await checkoutSingleItem(customer.token, productId, shippingCode);
  await allocateFullOrder(kasir.token, orderId);
  await issueInvoice(kasir.token, orderId);
  await uploadPaymentProof(customer.token, orderId);
  const orderStatus = await getOrderStatus(customer.token, orderId);
  assert(orderStatus === 'waiting_admin_verification', `Expected waiting_admin_verification, got ${orderStatus}`);
  console.log(`PASS payment proof softfail -> 200, status=${orderStatus}`);

  const threadId = await openSupportThread(kasir.token, customer.userId);
  const chatRes = await requestJson(kasir.token, 'POST', `/chat/threads/${threadId}/messages`, {
    message: 'Regression softfail WhatsApp',
    channel: 'whatsapp'
  });
  assertStatus(chatRes.status, 409, 'chat whatsapp softfail');
  assert(String(chatRes.text).includes('WhatsApp belum terhubung'), 'chat softfail message mismatch');
  console.log(`PASS chat whatsapp softfail -> ${chatRes.status}`);

  console.log('\nNotification softfail regression passed');
}

main().catch((error) => {
  console.error('\nNotification softfail regression failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
