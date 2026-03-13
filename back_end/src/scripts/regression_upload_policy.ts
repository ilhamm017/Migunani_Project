const BASE_URL = String(process.env.API_BASE_URL || 'http://127.0.0.1:5000/api/v1').replace(/\/$/, '');

export {};

type Role = 'admin_finance' | 'admin_gudang' | 'kasir' | 'customer';

const credentials: Record<Role, { email: string; password: string }> = {
  admin_finance: { email: 'finance@migunani.com', password: 'finance123' },
  admin_gudang: { email: 'gudang@migunani.com', password: 'gudang123' },
  kasir: { email: 'kasir@migunani.com', password: 'kasir123' },
  customer: { email: 'customer1@migunani.com', password: 'customer123' },
};

const tinyTextBuffer = Buffer.from('upload-policy-regression', 'utf8');
const sixMbBuffer = Buffer.alloc(6 * 1024 * 1024, 'a');

async function login(role: Role) {
  const response = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials[role])
  });
  const data = await response.json();
  if (!response.ok || typeof data?.token !== 'string') {
    throw new Error(`Login failed for ${role}: ${response.status} ${JSON.stringify(data)}`);
  }
  return String(data.token);
}

async function requestJson(token: string, method: string, path: string, body?: unknown) {
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
  return { status: response.status, data };
}

async function requestFormData(token: string, method: string, path: string, formData: FormData) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData
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
  const code = `UPL${Date.now().toString().slice(-8)}`;
  const response = await requestJson(kasirToken, 'POST', '/admin/shipping-methods', {
    code,
    name: 'Upload Regression Shipping',
    fee: 10000,
    is_active: true,
    sort_order: 997
  });
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`ensureShippingMethod failed: ${response.status} ${JSON.stringify(response.data)}`);
  }
  return code;
}

async function getFirstProductId(customerToken: string) {
  const response = await fetch(`${BASE_URL}/catalog?limit=10`, {
    headers: { Authorization: `Bearer ${customerToken}` }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`catalog failed: ${response.status} ${JSON.stringify(data)}`);
  }
  const rows = Array.isArray(data?.products) ? data.products : [];
  const product = rows.find((row: any) => Number(row?.stock_quantity || 0) > 0) || rows[0];
  assert(product?.id, 'No seeded product found');
  return String(product.id);
}

async function checkoutSingleItem(customerToken: string, productId: string, shippingCode: string) {
  const response = await requestJson(customerToken, 'POST', '/orders/checkout', {
    from_cart: false,
    payment_method: 'transfer_manual',
    shipping_method_code: shippingCode,
    shipping_address: 'Jl. Upload Regression No. 1',
    customer_note: 'upload-regression',
    items: [{ product_id: productId, qty: 1 }]
  });
  assertStatus(response.status, 201, 'checkout upload regression');
  const orderId = String((response.data as any)?.order_id || '');
  assert(orderId, 'Missing order_id');
  return orderId;
}

async function main() {
  const kasirToken = await login('kasir');
  const customerToken = await login('customer');
  const financeToken = await login('admin_finance');
  const gudangToken = await login('admin_gudang');

  const shippingCode = await ensureShippingMethod(kasirToken);
  const productId = await getFirstProductId(customerToken);
  const orderId = await checkoutSingleItem(customerToken, productId, shippingCode);

  const invalidProof = new FormData();
  invalidProof.append('proof', new Blob([tinyTextBuffer], { type: 'text/plain' }), 'proof.txt');
  const orderProofRes = await requestFormData(customerToken, 'POST', `/orders/${orderId}/proof`, invalidProof);
  assertStatus(orderProofRes.status, 400, 'order proof invalid mime');
  console.log(`PASS order proof invalid mime -> ${orderProofRes.status}`);

  const oversizeProof = new FormData();
  oversizeProof.append('proof', new Blob([sixMbBuffer], { type: 'image/png' }), 'proof.png');
  const orderProofOversize = await requestFormData(customerToken, 'POST', `/orders/${orderId}/proof`, oversizeProof);
  assertStatus(orderProofOversize.status, 400, 'order proof oversize');
  console.log(`PASS order proof oversize -> ${orderProofOversize.status}`);

  const invalidExpense = new FormData();
  invalidExpense.append('category', `Upload Invalid ${Date.now()}`);
  invalidExpense.append('amount', '7000');
  invalidExpense.append('date', new Date().toISOString());
  invalidExpense.append('note', 'invalid upload');
  invalidExpense.append('attachment', new Blob([tinyTextBuffer], { type: 'text/plain' }), 'expense.txt');
  const expenseRes = await requestFormData(financeToken, 'POST', '/admin/finance/expenses', invalidExpense);
  assertStatus(expenseRes.status, 400, 'expense attachment invalid mime');
  console.log(`PASS expense attachment invalid mime -> ${expenseRes.status}`);

  const invalidProductImage = new FormData();
  invalidProductImage.append('image', new Blob([tinyTextBuffer], { type: 'text/plain' }), 'product.txt');
  const productImageRes = await requestFormData(gudangToken, 'POST', '/admin/products/upload-image', invalidProductImage);
  assertStatus(productImageRes.status, 400, 'product image invalid mime');
  console.log(`PASS product image invalid mime -> ${productImageRes.status}`);

  const invalidChatAttachment = new FormData();
  invalidChatAttachment.append('attachment', new Blob([tinyTextBuffer], { type: 'application/x-msdownload' }), 'malware.exe');
  const chatAttachmentRes = await requestFormData('', 'POST', '/chat/web/attachment', invalidChatAttachment);
  assertStatus(chatAttachmentRes.status, 400, 'chat attachment invalid mime');
  console.log(`PASS chat attachment invalid mime -> ${chatAttachmentRes.status}`);
}

main().catch((error) => {
  console.error('\nUpload policy regression failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
