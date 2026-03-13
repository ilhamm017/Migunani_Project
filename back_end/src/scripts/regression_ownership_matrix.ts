const BASE_URL = String(process.env.API_BASE_URL || 'http://127.0.0.1:5000/api/v1').replace(/\/$/, '');

export {};

type Session = {
  token: string;
  userId: string;
};

type RoleKey =
  | 'super_admin'
  | 'admin_gudang'
  | 'admin_finance'
  | 'kasir'
  | 'driver1'
  | 'driver2'
  | 'customer1'
  | 'customer2';

const credentials: Record<RoleKey, { email: string; password: string }> = {
  super_admin: { email: 'superadmin@migunani.com', password: 'superadmin123' },
  admin_gudang: { email: 'gudang@migunani.com', password: 'gudang123' },
  admin_finance: { email: 'finance@migunani.com', password: 'finance123' },
  kasir: { email: 'kasir@migunani.com', password: 'kasir123' },
  driver1: { email: 'driver1@migunani.com', password: 'driver123' },
  driver2: { email: 'driver2@migunani.com', password: 'driver123' },
  customer1: { email: 'customer1@migunani.com', password: 'customer123' },
  customer2: { email: 'customer2@migunani.com', password: 'customer123' },
};

const tinyPngBuffer = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pH9n4sAAAAASUVORK5CYII=',
  'base64'
);

async function login(role: RoleKey): Promise<Session> {
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
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
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
  return { status: response.status, data, text };
}

async function requestFormData(token: string, method: string, path: string, formData: FormData) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`
    },
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

async function ensureShippingMethod(kasirToken: string) {
  const code = `OWN${Date.now().toString().slice(-8)}`;
  const createRes = await requestJson(kasirToken, 'POST', '/admin/shipping-methods', {
    code,
    name: 'Ownership Regression Shipping',
    fee: 10000,
    is_active: true,
    sort_order: 998
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

async function checkoutSingleItem(customerToken: string, productId: string, shippingCode: string) {
  const response = await requestJson(customerToken, 'POST', '/orders/checkout', {
    from_cart: false,
    payment_method: 'transfer_manual',
    shipping_method_code: shippingCode,
    shipping_address: 'Jl. Ownership Regression No. 1',
    customer_note: 'ownership-regression',
    items: [{ product_id: productId, qty: 1 }]
  }, { 'Idempotency-Key': `ownership-checkout-${Date.now()}` });
  assertStatus(response.status, 201, 'checkout');
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
  const invoiceId = String((response.data as any)?.invoice_id || '');
  assert(invoiceId, 'Missing invoice_id');
  return invoiceId;
}

async function uploadPaymentProof(customerToken: string, orderId: string) {
  const form = new FormData();
  form.append('proof', new Blob([tinyPngBuffer], { type: 'image/png' }), 'proof.png');
  const response = await requestFormData(customerToken, 'POST', `/orders/${orderId}/proof`, form);
  assertStatus(response.status, 200, 'upload payment proof');
}

async function completeDelivery(driverToken: string, orderId: string) {
  const form = new FormData();
  form.append('proof', new Blob([tinyPngBuffer], { type: 'image/png' }), 'delivery.png');
  const response = await requestFormData(driverToken, 'POST', `/driver/orders/${orderId}/complete`, form);
  assertStatus(response.status, 200, 'complete delivery');
}

async function submitReturRequest(customerToken: string, orderId: string, productId: string) {
  const form = new FormData();
  form.append('order_id', orderId);
  form.append('product_id', productId);
  form.append('qty', '1');
  form.append('reason', 'Ownership regression retur');
  form.append('evidence_img', new Blob([tinyPngBuffer], { type: 'image/png' }), 'retur.png');
  const response = await requestFormData(customerToken, 'POST', '/retur/request', form);
  assertStatus(response.status, 201, 'retur request');
}

async function getReturId(customerToken: string, orderId: string, productId: string) {
  const response = await requestJson(customerToken, 'GET', '/retur/my');
  assertStatus(response.status, 200, 'retur my');
  const rows = Array.isArray(response.data) ? response.data : [];
  const match = rows.find((row: any) =>
    String(row?.order_id || '') === orderId &&
    String(row?.product_id || '') === productId
  );
  assert(match?.id, 'Retur not found');
  return String(match.id);
}

async function updateReturStatus(kasirToken: string, returId: string, body: Record<string, unknown>) {
  const response = await requestJson(kasirToken, 'PUT', `/retur/${returId}/status`, body);
  assertStatus(response.status, 200, `retur status ${String(body.status || '')}`);
}

async function main() {
  const sessions = {} as Record<RoleKey, Session>;
  for (const role of Object.keys(credentials) as RoleKey[]) {
    sessions[role] = await login(role);
  }

  const shippingCode = await ensureShippingMethod(sessions.kasir.token);
  const productId = await getFirstProductId(sessions.customer1.token);
  const orderId = await checkoutSingleItem(sessions.customer1.token, productId, shippingCode);
  await allocateFullOrder(sessions.kasir.token, orderId);
  const invoiceId = await issueInvoice(sessions.kasir.token, orderId);

  const otherCustomerOrder = await requestJson(sessions.customer2.token, 'GET', `/orders/${orderId}`);
  assertStatus(otherCustomerOrder.status, 404, 'customer2 order detail');
  console.log(`PASS customer2 order detail -> ${otherCustomerOrder.status}`);

  const ownerInvoice = await requestJson(sessions.customer1.token, 'GET', `/invoices/${invoiceId}`);
  assertStatus(ownerInvoice.status, 200, 'customer1 invoice detail');
  console.log(`PASS customer1 invoice detail -> ${ownerInvoice.status}`);

  const otherCustomerInvoice = await requestJson(sessions.customer2.token, 'GET', `/invoices/${invoiceId}`);
  assertStatus(otherCustomerInvoice.status, 403, 'customer2 invoice detail');
  console.log(`PASS customer2 invoice detail -> ${otherCustomerInvoice.status}`);

  const unrelatedDriverInvoiceBeforeAssign = await requestJson(sessions.driver2.token, 'GET', `/invoices/${invoiceId}`);
  assertStatus(unrelatedDriverInvoiceBeforeAssign.status, 403, 'driver2 invoice before assign');
  console.log(`PASS driver2 invoice before assign -> ${unrelatedDriverInvoiceBeforeAssign.status}`);

  await uploadPaymentProof(sessions.customer1.token, orderId);
  const verify = await requestJson(sessions.admin_finance.token, 'PATCH', `/admin/finance/orders/${orderId}/verify`, { action: 'approve' });
  assertStatus(verify.status, 200, 'verify payment');

  const ship = await requestJson(sessions.admin_gudang.token, 'PATCH', `/orders/admin/${orderId}/status`, {
    status: 'shipped',
    courier_id: sessions.driver1.userId
  });
  assertStatus(ship.status, 200, 'ship order');

  const assignedDriverInvoice = await requestJson(sessions.driver1.token, 'GET', `/invoices/${invoiceId}`);
  assertStatus(assignedDriverInvoice.status, 200, 'driver1 assigned invoice');
  console.log(`PASS driver1 assigned invoice detail -> ${assignedDriverInvoice.status}`);

  const unrelatedDriverInvoice = await requestJson(sessions.driver2.token, 'GET', `/invoices/${invoiceId}`);
  assertStatus(unrelatedDriverInvoice.status, 403, 'driver2 unrelated invoice');
  console.log(`PASS driver2 unrelated invoice detail -> ${unrelatedDriverInvoice.status}`);

  await completeDelivery(sessions.driver1.token, orderId);

  await submitReturRequest(sessions.customer1.token, orderId, productId);
  const returId = await getReturId(sessions.customer1.token, orderId, productId);
  await updateReturStatus(sessions.kasir.token, returId, { status: 'approved', admin_response: 'ok' });
  await updateReturStatus(sessions.kasir.token, returId, {
    status: 'pickup_assigned',
    courier_id: sessions.driver1.userId,
    refund_amount: 5000
  });

  const assignedDriverRetur = await requestJson(sessions.driver1.token, 'GET', `/driver/retur/${returId}`);
  assertStatus(assignedDriverRetur.status, 200, 'driver1 retur detail');
  console.log(`PASS driver1 retur detail -> ${assignedDriverRetur.status}`);

  const unrelatedDriverRetur = await requestJson(sessions.driver2.token, 'GET', `/driver/retur/${returId}`);
  assertStatus(unrelatedDriverRetur.status, 404, 'driver2 retur detail');
  console.log(`PASS driver2 retur detail -> ${unrelatedDriverRetur.status}`);

  const unrelatedDriverReturUpdate = await requestJson(sessions.driver2.token, 'PATCH', `/driver/retur/${returId}/status`, { status: 'picked_up' });
  assertStatus(unrelatedDriverReturUpdate.status, 404, 'driver2 retur update');
  console.log(`PASS driver2 retur update -> ${unrelatedDriverReturUpdate.status}`);

  const customerFinanceList = await requestJson(sessions.customer1.token, 'GET', '/admin/finance/ar');
  assertStatus(customerFinanceList.status, 403, 'customer finance ar');
  console.log(`PASS customer finance AR -> ${customerFinanceList.status}`);

  const driverFinanceList = await requestJson(sessions.driver2.token, 'GET', '/admin/finance/journals');
  assertStatus(driverFinanceList.status, 403, 'driver finance journals');
  console.log(`PASS driver finance journals -> ${driverFinanceList.status}`);

  const financeAccounts = await requestJson(sessions.admin_finance.token, 'GET', '/admin/accounts');
  assertStatus(financeAccounts.status, 200, 'admin_finance accounts');
  console.log(`PASS admin_finance accounts -> ${financeAccounts.status}`);

  const customerAccounts = await requestJson(sessions.customer1.token, 'GET', '/admin/accounts');
  assertStatus(customerAccounts.status, 403, 'customer accounts');
  console.log(`PASS customer accounts -> ${customerAccounts.status}`);

  const driverAccounts = await requestJson(sessions.driver2.token, 'GET', '/admin/accounts');
  assertStatus(driverAccounts.status, 403, 'driver accounts');
  console.log(`PASS driver accounts -> ${driverAccounts.status}`);

  const financeExpenses = await requestJson(sessions.admin_finance.token, 'GET', '/admin/finance/expenses');
  assertStatus(financeExpenses.status, 200, 'admin_finance expenses');
  console.log(`PASS admin_finance expenses -> ${financeExpenses.status}`);

  const customerExpenses = await requestJson(sessions.customer1.token, 'GET', '/admin/finance/expenses');
  assertStatus(customerExpenses.status, 403, 'customer expenses');
  console.log(`PASS customer expenses -> ${customerExpenses.status}`);

  const financeExpenseLabels = await requestJson(sessions.admin_finance.token, 'GET', '/admin/finance/expense-labels');
  assertStatus(financeExpenseLabels.status, 200, 'admin_finance expense labels');
  console.log(`PASS admin_finance expense labels -> ${financeExpenseLabels.status}`);

  const driverExpenseLabels = await requestJson(sessions.driver2.token, 'GET', '/admin/finance/expense-labels');
  assertStatus(driverExpenseLabels.status, 403, 'driver expense labels');
  console.log(`PASS driver expense labels -> ${driverExpenseLabels.status}`);

  const superAdminWhatsapp = await requestJson(sessions.super_admin.token, 'GET', '/whatsapp/status');
  assertStatus(superAdminWhatsapp.status, 200, 'super_admin whatsapp status');
  console.log(`PASS super_admin whatsapp status -> ${superAdminWhatsapp.status}`);

  const kasirWhatsapp = await requestJson(sessions.kasir.token, 'GET', '/whatsapp/status');
  assertStatus(kasirWhatsapp.status, 200, 'kasir whatsapp status');
  console.log(`PASS kasir whatsapp status -> ${kasirWhatsapp.status}`);

  const financeWhatsapp = await requestJson(sessions.admin_finance.token, 'GET', '/whatsapp/status');
  assertStatus(financeWhatsapp.status, 403, 'admin_finance whatsapp status');
  console.log(`PASS admin_finance whatsapp status -> ${financeWhatsapp.status}`);

  const kasirAllocation = await requestJson(sessions.kasir.token, 'GET', '/allocation/pending');
  assertStatus(kasirAllocation.status, 200, 'kasir allocation pending');
  console.log(`PASS kasir allocation pending -> ${kasirAllocation.status}`);

  const financeAllocation = await requestJson(sessions.admin_finance.token, 'GET', '/allocation/pending');
  assertStatus(financeAllocation.status, 403, 'admin_finance allocation pending');
  console.log(`PASS admin_finance allocation pending -> ${financeAllocation.status}`);

  const customerAllocation = await requestJson(sessions.customer1.token, 'GET', '/allocation/pending');
  assertStatus(customerAllocation.status, 403, 'customer allocation pending');
  console.log(`PASS customer allocation pending -> ${customerAllocation.status}`);

  console.log('\nOwnership matrix regression passed');
}

main().catch((error) => {
  console.error('\nOwnership matrix regression failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
