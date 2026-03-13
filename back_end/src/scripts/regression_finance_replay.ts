import { Op } from 'sequelize';
import { CodSettlement, Invoice } from '../models';

const BASE_URL = String(process.env.API_BASE_URL || 'http://127.0.0.1:5000/api/v1').replace(/\/$/, '');

export {};

type LoginResult = {
  token: string;
  userId: string;
};

type RoleKey = 'super_admin' | 'admin_gudang' | 'admin_finance' | 'kasir' | 'driver' | 'customer';

const credentials: Record<RoleKey, { email: string; password: string }> = {
  super_admin: { email: 'superadmin@migunani.com', password: 'superadmin123' },
  admin_gudang: { email: 'gudang@migunani.com', password: 'gudang123' },
  admin_finance: { email: 'finance@migunani.com', password: 'finance123' },
  kasir: { email: 'kasir@migunani.com', password: 'kasir123' },
  driver: { email: 'driver1@migunani.com', password: 'driver123' },
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

async function requestFormData(
  token: string,
  method: string,
  path: string,
  formData: FormData,
  extraHeaders?: Record<string, string>
) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(extraHeaders || {})
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
  const listRes = await requestJson(kasirToken, 'GET', '/admin/shipping-methods');
  assertStatus(listRes.status, 200, 'shipping list');

  const createRes = await requestJson(kasirToken, 'POST', '/admin/shipping-methods', {
    code,
    name: 'Regression Test Shipping',
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
  assert(product?.id, 'No seeded product found for regression');
  return String(product.id);
}

async function checkoutSingleItem(customerToken: string, productId: string, paymentMethod: 'transfer_manual' | 'cod', shippingCode: string) {
  const key = `regtest-checkout-${paymentMethod}-${Date.now()}`;
  const response = await requestJson(
    customerToken,
    'POST',
    '/orders/checkout',
    {
      from_cart: false,
      payment_method: paymentMethod,
      shipping_method_code: shippingCode,
      shipping_address: 'Jl. Regression Test No. 1',
      customer_note: `regression-${paymentMethod}`,
      items: [{ product_id: productId, qty: 1 }]
    },
    { 'Idempotency-Key': key }
  );
  assertStatus(response.status, 201, `checkout ${paymentMethod}`);
  const orderId = String((response.data as any)?.order_id || '');
  assert(orderId, `Missing order_id for checkout ${paymentMethod}`);
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

async function issueInvoice(kasirToken: string, orderId: string, extraHeaders?: Record<string, string>) {
  const response = await requestJson(kasirToken, 'POST', `/admin/finance/orders/${orderId}/issue-invoice`, undefined, extraHeaders);
  assertStatus(response.status, 200, `issue invoice ${orderId}`);
  const invoiceId = String((response.data as any)?.invoice_id || '');
  assert(invoiceId, `Missing invoice_id after issue invoice ${orderId}`);
  return invoiceId;
}

async function issueInvoiceBatch(kasirToken: string, orderIds: string[], extraHeaders?: Record<string, string>) {
  const response = await requestJson(
    kasirToken,
    'POST',
    '/admin/finance/invoices/issue-batch',
    { order_ids: orderIds },
    extraHeaders
  );
  assertStatus(response.status, 200, 'issue invoice batch');
  const invoiceId = String((response.data as any)?.invoice_id || '');
  assert(invoiceId, 'Missing invoice_id after issue invoice batch');
  return invoiceId;
}

async function issueInvoiceByItems(
  kasirToken: string,
  items: Array<{ order_item_id: string; qty: number }>,
  extraHeaders?: Record<string, string>
) {
  const response = await requestJson(
    kasirToken,
    'POST',
    '/admin/finance/invoices/issue-items',
    { items },
    extraHeaders
  );
  assertStatus(response.status, 200, 'issue invoice by items');
  const invoiceId = String((response.data as any)?.invoice_id || '');
  assert(invoiceId, 'Missing invoice_id after issue invoice by items');
  return invoiceId;
}

async function getInvoiceDetail(token: string, invoiceId: string) {
  const response = await requestJson(token, 'GET', `/invoices/${invoiceId}`);
  assertStatus(response.status, 200, `invoice detail ${invoiceId}`);
  return response.data as any;
}

async function getInvoiceCountForOrder(orderId: string) {
  return await Invoice.count({ where: { order_id: orderId } });
}

async function uploadPaymentProof(customerToken: string, orderId: string) {
  const form = new FormData();
  form.append('proof', new Blob([tinyPngBuffer], { type: 'image/png' }), 'proof.png');
  const response = await requestFormData(customerToken, 'POST', `/orders/${orderId}/proof`, form);
  assertStatus(response.status, 200, `upload payment proof ${orderId}`);
}

async function shipOrder(adminGudangToken: string, orderId: string, driverId: string) {
  const response = await requestJson(adminGudangToken, 'PATCH', `/orders/admin/${orderId}/status`, {
    status: 'shipped',
    courier_id: driverId
  });
  assertStatus(response.status, 200, `ship order ${orderId}`);
}

async function completeDelivery(driverToken: string, orderId: string) {
  const form = new FormData();
  form.append('proof', new Blob([tinyPngBuffer], { type: 'image/png' }), 'delivery.png');
  const response = await requestFormData(driverToken, 'POST', `/driver/orders/${orderId}/complete`, form);
  assertStatus(response.status, 200, `complete delivery ${orderId}`);
}

async function getDriverAssignedOrders(driverToken: string, status: string) {
  const response = await requestJson(driverToken, 'GET', `/driver/orders?status=${encodeURIComponent(status)}`);
  assertStatus(response.status, 200, `driver orders ${status}`);
  return Array.isArray(response.data) ? response.data : [];
}

async function getJournalCountByReferenceType(financeToken: string, referenceType: string) {
  const response = await requestJson(financeToken, 'GET', '/admin/finance/journals?limit=100');
  assertStatus(response.status, 200, `journals list ${referenceType}`);
  const rows = Array.isArray((response.data as any)?.journals) ? (response.data as any).journals : [];
  return rows.filter((row: any) => String(row?.reference_type || '') === referenceType).length;
}

async function getJournalCountByDescription(financeToken: string, snippet: string) {
  const response = await requestJson(financeToken, 'GET', '/admin/finance/journals?limit=200');
  assertStatus(response.status, 200, `journals list description:${snippet}`);
  const rows = Array.isArray((response.data as any)?.journals) ? (response.data as any).journals : [];
  return rows.filter((row: any) => String(row?.description || '').includes(snippet)).length;
}

async function getJournalCountByReference(financeToken: string, referenceType: string, referenceId: string) {
  const response = await requestJson(financeToken, 'GET', '/admin/finance/journals?limit=100');
  assertStatus(response.status, 200, `journals list ${referenceType}:${referenceId}`);
  const rows = Array.isArray((response.data as any)?.journals) ? (response.data as any).journals : [];
  return rows.filter((row: any) =>
    String(row?.reference_type || '') === referenceType &&
    String(row?.reference_id || '') === referenceId
  ).length;
}

async function getFirstAccountIdByCode(financeToken: string, code: string) {
  const response = await requestJson(financeToken, 'GET', '/admin/accounts');
  assertStatus(response.status, 200, `accounts list ${code}`);
  const rows = Array.isArray(response.data) ? response.data : [];
  const match = rows.find((row: any) => String(row?.code || '') === code);
  assert(match?.id, `Account with code ${code} not found`);
  return Number(match.id);
}

async function getFirstSupplierId(token: string) {
  const response = await requestJson(token, 'GET', '/admin/suppliers');
  assertStatus(response.status, 200, 'suppliers list');
  const rows = Array.isArray((response.data as any)?.suppliers)
    ? (response.data as any).suppliers
    : Array.isArray(response.data)
      ? response.data
      : [];
  const match = rows[0];
  assert(match?.id, 'No seeded supplier found');
  return Number(match.id);
}

async function getExpenseLabels(financeToken: string) {
  const response = await requestJson(financeToken, 'GET', '/admin/finance/expense-labels');
  assertStatus(response.status, 200, 'expense labels list');
  return Array.isArray((response.data as any)?.labels) ? (response.data as any).labels : [];
}

async function topUpProductStock(adminGudangToken: string, productId: string, qty: number) {
  const response = await requestJson(adminGudangToken, 'POST', '/admin/inventory/mutation', {
    product_id: productId,
    type: 'in',
    qty,
    note: 'Regression stock top-up'
  });
  assertStatus(response.status, 200, `top up stock ${productId}`);
}

async function createExpense(financeToken: string, category: string, amount: number) {
  const form = new FormData();
  form.append('category', category);
  form.append('amount', String(amount));
  form.append('date', new Date().toISOString());
  form.append('note', `Regression expense ${category}`);
  form.append('attachment', new Blob([tinyPngBuffer], { type: 'image/png' }), 'expense.png');
  const response = await requestFormData(financeToken, 'POST', '/admin/finance/expenses', form);
  assertStatus(response.status, 201, `create expense ${category}`);
  const expenseId = Number((response.data as any)?.id || 0);
  assert(expenseId > 0, `Missing expense id for ${category}`);
  return expenseId;
}

async function createExpenseLabel(financeToken: string, name: string, description: string) {
  const response = await requestJson(financeToken, 'POST', '/admin/finance/expense-labels', { name, description });
  assertStatus(response.status, 201, `create expense label ${name}`);
  const labelId = Number((response.data as any)?.label?.id || 0);
  assert(labelId > 0, `Missing expense label id for ${name}`);
  return labelId;
}

async function createAdjustmentJournal(financeToken: string, payload: Record<string, unknown>, idempotencyKey: string) {
  return await requestJson(
    financeToken,
    'POST',
    '/admin/finance/journals/adjustment',
    payload,
    { 'Idempotency-Key': idempotencyKey }
  );
}

async function createCreditNote(financeToken: string, invoiceId: string, amount: number) {
  const response = await requestJson(financeToken, 'POST', '/admin/finance/credit-notes', {
    invoice_id: invoiceId,
    reason: 'Regression credit note',
    mode: 'receivable',
    amount,
    tax_amount: 0,
    lines: []
  });
  assertStatus(response.status, 201, `create credit note ${invoiceId}`);
  const creditNoteId = String((response.data as any)?.credit_note?.id || '');
  assert(creditNoteId, `Missing credit note id for invoice ${invoiceId}`);
  return creditNoteId;
}

async function createPurchaseOrderForSupplier(kasirToken: string, supplierId: number, totalCost: number) {
  const response = await requestJson(kasirToken, 'POST', '/admin/inventory/po', {
    supplier_id: supplierId,
    total_cost: totalCost,
    items: []
  });
  assertStatus(response.status, 201, `create PO supplier=${supplierId}`);
  const purchaseOrderId = String((response.data as any)?.id || '');
  assert(purchaseOrderId, `Missing purchase_order_id for supplier ${supplierId}`);
  return purchaseOrderId;
}

async function createSupplierInvoice(financeToken: string, purchaseOrderId: string, total: number) {
  const response = await requestJson(financeToken, 'POST', '/admin/finance/supplier-invoice', {
    purchase_order_id: purchaseOrderId,
    invoice_number: `SUP-REG-${Date.now()}`,
    total,
    subtotal: total,
    tax_amount: 0,
    tax_percent: 0,
    due_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
  });
  assertStatus(response.status, 201, `create supplier invoice PO=${purchaseOrderId}`);
  const supplierInvoiceId = Number((response.data as any)?.id || 0);
  assert(supplierInvoiceId > 0, `Missing supplier invoice id for PO ${purchaseOrderId}`);
  return supplierInvoiceId;
}

async function submitReturRequest(customerToken: string, orderId: string, productId: string) {
  const form = new FormData();
  form.append('order_id', orderId);
  form.append('product_id', productId);
  form.append('qty', '1');
  form.append('reason', 'Regression retur refund replay');
  form.append('evidence_img', new Blob([tinyPngBuffer], { type: 'image/png' }), 'retur-proof.png');
  const response = await requestFormData(customerToken, 'POST', '/retur/request', form);
  assertStatus(response.status, 201, `submit retur request ${orderId}`);
}

async function getMyReturs(customerToken: string) {
  const response = await requestJson(customerToken, 'GET', '/retur/my');
  assertStatus(response.status, 200, 'retur my');
  return Array.isArray(response.data) ? response.data : [];
}

async function getReturIdForOrder(customerToken: string, orderId: string, productId: string) {
  const rows = await getMyReturs(customerToken);
  const match = rows.find((row: any) =>
    String(row?.order_id || '') === orderId &&
    String(row?.product_id || '') === productId
  );
  assert(match?.id, `Retur not found for order ${orderId}`);
  return String(match.id);
}

async function updateReturStatus(kasirToken: string, returId: string, body: Record<string, unknown>) {
  const response = await requestJson(kasirToken, 'PUT', `/retur/${returId}/status`, body);
  assertStatus(response.status, 200, `retur status update ${returId}:${String(body.status || '')}`);
}

async function updateDriverReturStatus(driverToken: string, returId: string, status: 'picked_up' | 'handed_to_warehouse') {
  const response = await requestJson(driverToken, 'PATCH', `/driver/retur/${returId}/status`, { status });
  assertStatus(response.status, 200, `driver retur status ${returId}:${status}`);
}

async function disburseReturRefund(financeToken: string, returId: string, note: string) {
  return await requestJson(financeToken, 'POST', `/retur/${returId}/disburse`, { note });
}

async function runTransferReplay(financeToken: string, kasirToken: string, customerToken: string, productId: string, shippingCode: string) {
  console.log('\n## Transfer verify replay');
  const orderId = await checkoutSingleItem(customerToken, productId, 'transfer_manual', shippingCode);
  await allocateFullOrder(kasirToken, orderId);
  const invoiceId = await issueInvoice(kasirToken, orderId);
  await uploadPaymentProof(customerToken, orderId);

  const before = await getJournalCountByReference(financeToken, 'payment_verify', invoiceId);
  const first = await requestJson(financeToken, 'PATCH', `/admin/finance/orders/${orderId}/verify`, { action: 'approve' });
  assertStatus(first.status, 200, 'verify payment first approve');
  const afterFirst = await getJournalCountByReference(financeToken, 'payment_verify', invoiceId);
  assert(afterFirst === before + 1, `payment_verify journal count expected +1, got ${before} -> ${afterFirst}`);

  const second = await requestJson(financeToken, 'PATCH', `/admin/finance/orders/${orderId}/verify`, { action: 'approve' });
  assertStatus(second.status, 409, 'verify payment replay approve');
  const afterSecond = await getJournalCountByReference(financeToken, 'payment_verify', invoiceId);
  assert(afterSecond === afterFirst, `payment_verify journal count changed on replay: ${afterFirst} -> ${afterSecond}`);

  console.log(`PASS transfer order=${orderId} invoice=${invoiceId} journals ${before}->${afterFirst}->${afterSecond}`);
}

async function runIssueInvoiceReplay(
  kasirToken: string,
  customerToken: string,
  adminGudangToken: string,
  productId: string,
  shippingCode: string
) {
  console.log('\n## Issue invoice replay');
  const orderId = await checkoutSingleItem(customerToken, productId, 'transfer_manual', shippingCode);
  await allocateFullOrder(kasirToken, orderId);

  const before = await getInvoiceCountForOrder(orderId);
  const idemKey = `regtest-issue-invoice-${orderId}`;
  const firstInvoiceId = await issueInvoice(kasirToken, orderId, { 'Idempotency-Key': idemKey });
  const afterFirst = await getInvoiceCountForOrder(orderId);
  assert(afterFirst === before + 1, `invoice count expected +1, got ${before} -> ${afterFirst}`);

  const replayResponse = await requestJson(
    kasirToken,
    'POST',
    `/admin/finance/orders/${orderId}/issue-invoice`,
    undefined,
    { 'Idempotency-Key': idemKey }
  );
  assertStatus(replayResponse.status, 200, 'issue invoice replay');
  const replayInvoiceId = String((replayResponse.data as any)?.invoice_id || '');
  assert(replayInvoiceId === firstInvoiceId, `issue invoice replay should return same invoice_id, got ${firstInvoiceId} vs ${replayInvoiceId}`);
  const afterSecond = await getInvoiceCountForOrder(orderId);
  assert(afterSecond === afterFirst, `invoice count changed on replay: ${afterFirst} -> ${afterSecond}`);

  const orderDetail = await getOrderDetail(adminGudangToken, orderId);
  assert(String(orderDetail?.status || '') === 'ready_to_ship', `Order ${orderId} should be ready_to_ship after invoice issue replay`);
  console.log(`PASS issue invoice order=${orderId} invoices ${before}->${afterFirst}->${afterSecond}`);
}

async function runIssueInvoiceByItemsReplay(
  kasirToken: string,
  customerToken: string,
  adminGudangToken: string,
  productId: string,
  shippingCode: string
) {
  console.log('\n## Issue invoice by items replay');
  const orderId = await checkoutSingleItem(customerToken, productId, 'transfer_manual', shippingCode);
  await allocateFullOrder(kasirToken, orderId);

  const detail = await getOrderDetail(kasirToken, orderId);
  const items = Array.isArray(detail?.OrderItems) ? detail.OrderItems : [];
  const firstItem = items.find((row: any) => Number(row?.qty || 0) > 0) || items[0];
  assert(firstItem?.id, `No invoiceable item found for order ${orderId}`);
  const payload = [{ order_item_id: String(firstItem.id), qty: 1 }];

  const before = await getInvoiceCountForOrder(orderId);
  const idemKey = `regtest-issue-invoice-items-${orderId}`;
  const firstInvoiceId = await issueInvoiceByItems(kasirToken, payload, { 'Idempotency-Key': idemKey });
  const afterFirst = await getInvoiceCountForOrder(orderId);
  assert(afterFirst === before + 1, `invoice-by-items count expected +1, got ${before} -> ${afterFirst}`);

  const replayResponse = await requestJson(
    kasirToken,
    'POST',
    '/admin/finance/invoices/issue-items',
    { items: payload },
    { 'Idempotency-Key': idemKey }
  );
  assertStatus(replayResponse.status, 200, 'issue invoice by items replay');
  const replayInvoiceId = String((replayResponse.data as any)?.invoice_id || '');
  assert(replayInvoiceId === firstInvoiceId, `issue invoice by items replay should return same invoice_id, got ${firstInvoiceId} vs ${replayInvoiceId}`);
  const afterSecond = await getInvoiceCountForOrder(orderId);
  assert(afterSecond === afterFirst, `invoice-by-items count changed on replay: ${afterFirst} -> ${afterSecond}`);

  const orderDetail = await getOrderDetail(adminGudangToken, orderId);
  assert(String(orderDetail?.status || '') === 'ready_to_ship', `Order ${orderId} should be ready_to_ship after invoice-by-items replay`);
  console.log(`PASS issue invoice by items order=${orderId} invoices ${before}->${afterFirst}->${afterSecond}`);
}

async function runCodReplay(
  financeToken: string,
  kasirToken: string,
  adminGudangToken: string,
  driverToken: string,
  driverId: string,
  customerToken: string,
  productId: string,
  shippingCode: string
) {
  console.log('\n## COD verify replay');
  const orderId = await checkoutSingleItem(customerToken, productId, 'cod', shippingCode);
  await allocateFullOrder(kasirToken, orderId);
  const invoiceId = await issueInvoice(kasirToken, orderId);
  const invoice = await getInvoiceDetail(financeToken, invoiceId);
  const invoiceTotal = Number(invoice?.total || 0);
  assert(invoiceTotal > 0, `Invalid COD invoice total for ${invoiceId}`);

  await shipOrder(adminGudangToken, orderId, driverId);
  await completeDelivery(driverToken, orderId);

  const before = 0;
  const startedAt = new Date();
  const idemKey = `regtest-cod-verify-${orderId}`;
  const first = await requestJson(financeToken, 'POST', '/admin/finance/driver-cod/verify', {
    driver_id: driverId,
    order_ids: [orderId],
    amount_received: invoiceTotal
  }, { 'Idempotency-Key': idemKey });
  assertStatus(first.status, 200, 'verify COD first');
  const createdSettlement = await CodSettlement.findOne({
    where: {
      driver_id: driverId,
      createdAt: { [Op.gte]: startedAt }
    } as any,
    order: [['createdAt', 'DESC']]
  });
  const settlementId = String(createdSettlement?.id || (first.data as any)?.settlement_id || '');
  assert(settlementId, `Missing settlement_id for COD verify ${orderId}`);
  const afterFirst = await getJournalCountByReference(financeToken, 'cod_settlement', settlementId);
  assert(afterFirst === before + 1, `cod_settlement journal count expected +1, got ${before} -> ${afterFirst}`);

  const second = await requestJson(financeToken, 'POST', '/admin/finance/driver-cod/verify', {
    driver_id: driverId,
    order_ids: [orderId],
    amount_received: invoiceTotal
  }, { 'Idempotency-Key': idemKey });
  assertStatus(second.status, 200, 'verify COD replay');
  const afterSecond = await getJournalCountByReference(financeToken, 'cod_settlement', settlementId);
  assert(afterSecond === afterFirst, `cod_settlement journal count changed on replay: ${afterFirst} -> ${afterSecond}`);

  console.log(`PASS cod order=${orderId} invoice=${invoiceId} journals ${before}->${afterFirst}->${afterSecond}`);
}

async function runMultiOrderDeliveryConsistency(
  kasirToken: string,
  adminGudangToken: string,
  driverToken: string,
  driverId: string,
  customerToken: string,
  productId: string,
  shippingCode: string
) {
  console.log('\n## Multi-order invoice delivery consistency');
  const orderIdA = await checkoutSingleItem(customerToken, productId, 'transfer_manual', shippingCode);
  const orderIdB = await checkoutSingleItem(customerToken, productId, 'transfer_manual', shippingCode);

  await allocateFullOrder(kasirToken, orderIdA);
  await allocateFullOrder(kasirToken, orderIdB);

  const invoiceId = await issueInvoiceBatch(kasirToken, [orderIdA, orderIdB]);

  await shipOrder(adminGudangToken, orderIdA, driverId);
  await shipOrder(adminGudangToken, orderIdB, driverId);

  await completeDelivery(driverToken, invoiceId);

  const invoice = await getInvoiceDetail(kasirToken, invoiceId);
  assert(String(invoice?.shipment_status || '').toLowerCase() === 'delivered', `Invoice ${invoiceId} should be delivered`);

  const detailA = await getOrderDetail(kasirToken, orderIdA);
  const detailB = await getOrderDetail(kasirToken, orderIdB);
  const statusA = String(detailA?.status || '').toLowerCase();
  const statusB = String(detailB?.status || '').toLowerCase();

  assert(statusA !== 'shipped', `Order ${orderIdA} should not remain shipped after invoice complete`);
  assert(statusB !== 'shipped', `Order ${orderIdB} should not remain shipped after invoice complete`);
  assert(['delivered', 'completed', 'partially_fulfilled'].includes(statusA), `Unexpected final status for ${orderIdA}: ${statusA}`);
  assert(['delivered', 'completed', 'partially_fulfilled'].includes(statusB), `Unexpected final status for ${orderIdB}: ${statusB}`);

  const shippedRows = await getDriverAssignedOrders(driverToken, 'shipped');
  const stillActionable = shippedRows.some((row: any) => String(row?.invoice_id || row?.id || '') === invoiceId);
  assert(!stillActionable, `Invoice ${invoiceId} should not remain in driver shipped task list after complete delivery`);

  console.log(`PASS multi-order delivery invoice=${invoiceId} orderA=${orderIdA}:${statusA} orderB=${orderIdB}:${statusB}`);
}

async function runReturRefundReplay(
  financeToken: string,
  kasirToken: string,
  adminGudangToken: string,
  driverToken: string,
  driverId: string,
  customerToken: string,
  productId: string,
  shippingCode: string
) {
  console.log('\n## Retur refund replay');
  const orderId = await checkoutSingleItem(customerToken, productId, 'transfer_manual', shippingCode);
  await allocateFullOrder(kasirToken, orderId);
  await issueInvoice(kasirToken, orderId);
  await uploadPaymentProof(customerToken, orderId);

  const approve = await requestJson(financeToken, 'PATCH', `/admin/finance/orders/${orderId}/verify`, { action: 'approve' });
  assertStatus(approve.status, 200, 'verify payment before retur');
  await shipOrder(adminGudangToken, orderId, driverId);
  await completeDelivery(driverToken, orderId);

  const detail = await getOrderDetail(customerToken, orderId);
  const items = Array.isArray(detail?.OrderItems) ? detail.OrderItems : [];
  const firstItem = items.find((row: any) => Number(row?.qty || 0) > 0) || items[0];
  assert(firstItem?.product_id, `No returnable product found for order ${orderId}`);
  const returProductId = String(firstItem.product_id);

  await submitReturRequest(customerToken, orderId, returProductId);
  const returId = await getReturIdForOrder(customerToken, orderId, returProductId);

  await updateReturStatus(kasirToken, returId, { status: 'approved', admin_response: 'approved for regression' });
  await updateReturStatus(kasirToken, returId, {
    status: 'pickup_assigned',
    courier_id: driverId,
    refund_amount: 5000
  });
  await updateDriverReturStatus(driverToken, returId, 'picked_up');
  await updateDriverReturStatus(driverToken, returId, 'handed_to_warehouse');
  await updateReturStatus(kasirToken, returId, { status: 'received' });
  await updateReturStatus(kasirToken, returId, { status: 'completed', is_back_to_stock: false });

  const before = await getJournalCountByReference(financeToken, 'retur_refund', returId);
  const first = await disburseReturRefund(financeToken, returId, 'regression refund replay');
  assertStatus(first.status, 200, 'retur refund first disburse');
  const afterFirst = await getJournalCountByReference(financeToken, 'retur_refund', returId);
  assert(afterFirst === before + 1, `retur_refund journal count expected +1, got ${before} -> ${afterFirst}`);

  const second = await disburseReturRefund(financeToken, returId, 'regression refund replay');
  assertStatus(second.status, 400, 'retur refund replay disburse');
  const afterSecond = await getJournalCountByReference(financeToken, 'retur_refund', returId);
  assert(afterSecond === afterFirst, `retur_refund journal count changed on replay: ${afterFirst} -> ${afterSecond}`);

  console.log(`PASS retur order=${orderId} retur=${returId} journals ${before}->${afterFirst}->${afterSecond}`);
}

async function runExpenseReplay(financeToken: string) {
  console.log('\n## Expense approve/pay replay');
  const expenseId = await createExpense(financeToken, `Operasional Regression ${Date.now()}`, 7000);
  const paymentAccountId = await getFirstAccountIdByCode(financeToken, '1101');

  const approveFirst = await requestJson(financeToken, 'POST', `/admin/finance/expenses/${expenseId}/approve`);
  assertStatus(approveFirst.status, 200, 'expense approve first');

  const approveSecond = await requestJson(financeToken, 'POST', `/admin/finance/expenses/${expenseId}/approve`);
  assertStatus(approveSecond.status, 400, 'expense approve replay');

  const beforePay = await getJournalCountByReference(financeToken, 'expense', String(expenseId));
  const payFirst = await requestJson(financeToken, 'POST', `/admin/finance/expenses/${expenseId}/pay`, {
    account_id: paymentAccountId
  });
  assertStatus(payFirst.status, 200, 'expense pay first');
  const afterFirstPay = await getJournalCountByReference(financeToken, 'expense', String(expenseId));
  assert(afterFirstPay === beforePay + 1, `expense journal count expected +1, got ${beforePay} -> ${afterFirstPay}`);

  const paySecond = await requestJson(financeToken, 'POST', `/admin/finance/expenses/${expenseId}/pay`, {
    account_id: paymentAccountId
  });
  assertStatus(paySecond.status, 400, 'expense pay replay');
  const afterSecondPay = await getJournalCountByReference(financeToken, 'expense', String(expenseId));
  assert(afterSecondPay === afterFirstPay, `expense journal count changed on replay: ${afterFirstPay} -> ${afterSecondPay}`);

  console.log(`PASS expense id=${expenseId} journals ${beforePay}->${afterFirstPay}->${afterSecondPay}`);
}

async function runCreditNoteReplay(
  financeToken: string,
  kasirToken: string,
  customerToken: string,
  productId: string,
  shippingCode: string
) {
  console.log('\n## Credit note post replay');
  const orderId = await checkoutSingleItem(customerToken, productId, 'transfer_manual', shippingCode);
  await allocateFullOrder(kasirToken, orderId);
  const invoiceId = await issueInvoice(kasirToken, orderId);
  await uploadPaymentProof(customerToken, orderId);
  const approve = await requestJson(financeToken, 'PATCH', `/admin/finance/orders/${orderId}/verify`, { action: 'approve' });
  assertStatus(approve.status, 200, 'verify payment before credit note');

  const creditNoteId = await createCreditNote(financeToken, invoiceId, 3000);
  const before = await getJournalCountByReference(financeToken, 'credit_note', creditNoteId);
  const first = await requestJson(financeToken, 'POST', `/admin/finance/credit-notes/${creditNoteId}/post`, { pay_now: false });
  assertStatus(first.status, 200, 'credit note post first');
  const afterFirst = await getJournalCountByReference(financeToken, 'credit_note', creditNoteId);
  assert(afterFirst === before + 1, `credit_note journal count expected +1, got ${before} -> ${afterFirst}`);

  const second = await requestJson(financeToken, 'POST', `/admin/finance/credit-notes/${creditNoteId}/post`, { pay_now: false });
  assertStatus(second.status, 409, 'credit note post replay');
  const afterSecond = await getJournalCountByReference(financeToken, 'credit_note', creditNoteId);
  assert(afterSecond === afterFirst, `credit_note journal count changed on replay: ${afterFirst} -> ${afterSecond}`);

  console.log(`PASS credit_note order=${orderId} invoice=${invoiceId} cn=${creditNoteId} journals ${before}->${afterFirst}->${afterSecond}`);
}

async function runVoidInvoiceReplay(
  financeToken: string,
  kasirToken: string,
  customerToken: string,
  productId: string,
  shippingCode: string
) {
  console.log('\n## Invoice void replay');
  const orderId = await checkoutSingleItem(customerToken, productId, 'transfer_manual', shippingCode);
  await allocateFullOrder(kasirToken, orderId);
  const invoiceId = await issueInvoice(kasirToken, orderId);
  await uploadPaymentProof(customerToken, orderId);
  const approve = await requestJson(financeToken, 'PATCH', `/admin/finance/orders/${orderId}/verify`, { action: 'approve' });
  assertStatus(approve.status, 200, 'verify payment before void');

  const before = await getJournalCountByReference(financeToken, 'order_reversal', invoiceId);
  const idemKey = `regtest-void-invoice-${invoiceId}`;
  const first = await requestJson(financeToken, 'POST', `/admin/finance/invoices/${invoiceId}/void`, undefined, {
    'Idempotency-Key': idemKey
  });
  assertStatus(first.status, 200, 'invoice void first');
  const afterFirst = await getJournalCountByReference(financeToken, 'order_reversal', invoiceId);
  assert(afterFirst > before, `order_reversal journal count should increase, got ${before} -> ${afterFirst}`);

  const second = await requestJson(financeToken, 'POST', `/admin/finance/invoices/${invoiceId}/void`, undefined, {
    'Idempotency-Key': idemKey
  });
  assertStatus(second.status, 200, 'invoice void replay');
  const afterSecond = await getJournalCountByReference(financeToken, 'order_reversal', invoiceId);
  assert(afterSecond === afterFirst, `order_reversal journal count changed on replay: ${afterFirst} -> ${afterSecond}`);

  console.log(`PASS void invoice=${invoiceId} journals ${before}->${afterFirst}->${afterSecond}`);
}

async function runSupplierInvoicePaymentReplay(financeToken: string, kasirToken: string) {
  console.log('\n## Supplier invoice pay replay');
  const supplierId = await getFirstSupplierId(kasirToken);
  const purchaseOrderId = await createPurchaseOrderForSupplier(kasirToken, supplierId, 9000);
  const supplierInvoiceId = await createSupplierInvoice(financeToken, purchaseOrderId, 9000);
  const paymentAccountId = await getFirstAccountIdByCode(financeToken, '1101');

  const before = 0;
  const first = await requestJson(financeToken, 'POST', '/admin/finance/supplier-invoice/pay', {
    invoice_id: supplierInvoiceId,
    amount: 9000,
    account_id: paymentAccountId,
    note: 'Regression supplier payment'
  });
  assertStatus(first.status, 200, 'supplier invoice pay first');
  const paymentId = String((first.data as any)?.payment?.id || '');
  assert(paymentId, `Missing supplier payment id for invoice ${supplierInvoiceId}`);
  const afterFirst = await getJournalCountByReference(financeToken, 'supplier_payment', paymentId);
  assert(afterFirst === before + 1, `supplier_payment journal count expected +1, got ${before} -> ${afterFirst}`);

  const second = await requestJson(financeToken, 'POST', '/admin/finance/supplier-invoice/pay', {
    invoice_id: supplierInvoiceId,
    amount: 9000,
    account_id: paymentAccountId,
    note: 'Regression supplier payment'
  });
  assertStatus(second.status, 409, 'supplier invoice pay replay');
  const afterSecond = await getJournalCountByReference(financeToken, 'supplier_payment', paymentId);
  assert(afterSecond === afterFirst, `supplier_payment journal count changed on replay: ${afterFirst} -> ${afterSecond}`);

  console.log(`PASS supplier invoice=${supplierInvoiceId} journals ${before}->${afterFirst}->${afterSecond}`);
}

async function runExpenseLabelReplay(financeToken: string) {
  console.log('\n## Expense label mutation replay');
  const labelNameA = `Regression Label A ${Date.now()}`;
  const labelNameB = `Regression Label B ${Date.now()}`;
  const beforeLabels = await getExpenseLabels(financeToken);
  const beforeCountA = beforeLabels.filter((row: any) => String(row?.name || '') === labelNameA).length;

  const labelAId = await createExpenseLabel(financeToken, labelNameA, 'label A');
  const afterCreateA = await getExpenseLabels(financeToken);
  const afterCreateCountA = afterCreateA.filter((row: any) => String(row?.name || '') === labelNameA).length;
  assert(afterCreateCountA === beforeCountA + 1, `expense label A expected +1, got ${beforeCountA} -> ${afterCreateCountA}`);

  const duplicateCreate = await requestJson(financeToken, 'POST', '/admin/finance/expense-labels', {
    name: labelNameA,
    description: 'duplicate'
  });
  assertStatus(duplicateCreate.status, 409, 'expense label create replay');
  const afterDuplicateCreate = await getExpenseLabels(financeToken);
  const afterDuplicateCountA = afterDuplicateCreate.filter((row: any) => String(row?.name || '') === labelNameA).length;
  assert(afterDuplicateCountA === afterCreateCountA, `expense label A count changed on duplicate create: ${afterCreateCountA} -> ${afterDuplicateCountA}`);

  const labelBId = await createExpenseLabel(financeToken, labelNameB, 'label B');
  const updateConflict = await requestJson(financeToken, 'PUT', `/admin/finance/expense-labels/${labelBId}`, {
    name: labelNameA,
    description: 'conflict update'
  });
  assertStatus(updateConflict.status, 409, 'expense label update replay');

  const deleteFirst = await requestJson(financeToken, 'DELETE', `/admin/finance/expense-labels/${labelAId}`);
  assertStatus(deleteFirst.status, 200, 'expense label delete first');
  const afterDelete = await getExpenseLabels(financeToken);
  const afterDeleteCountA = afterDelete.filter((row: any) => String(row?.name || '') === labelNameA).length;
  assert(afterDeleteCountA === 0, `expense label A should be deleted, count=${afterDeleteCountA}`);

  const deleteSecond = await requestJson(financeToken, 'DELETE', `/admin/finance/expense-labels/${labelAId}`);
  assertStatus(deleteSecond.status, 404, 'expense label delete replay');

  console.log(`PASS expense labels create/update/delete labelA=${labelAId} labelB=${labelBId}`);
}

async function runAdjustmentReplay(financeToken: string) {
  console.log('\n## Adjustment journal replay');
  const cashAccountId = await getFirstAccountIdByCode(financeToken, '1101');
  const revenueAccountId = await getFirstAccountIdByCode(financeToken, '4100');
  const marker = `Regression Adjustment ${Date.now()}`;
  const before = await getJournalCountByDescription(financeToken, marker);
  const idemKey = `regtest-adjustment-${Date.now()}`;
  const payload = {
    date: new Date().toISOString(),
    description: marker,
    lines: [
      { account_id: cashAccountId, debit: 1234, credit: 0 },
      { account_id: revenueAccountId, debit: 0, credit: 1234 }
    ]
  };

  const first = await createAdjustmentJournal(financeToken, payload, idemKey);
  assertStatus(first.status, 201, 'adjustment first');
  const afterFirst = await getJournalCountByDescription(financeToken, marker);
  assert(afterFirst === before + 1, `adjustment journal count expected +1, got ${before} -> ${afterFirst}`);

  const second = await createAdjustmentJournal(financeToken, payload, idemKey);
  assertStatus(second.status, 201, 'adjustment replay');
  const afterSecond = await getJournalCountByDescription(financeToken, marker);
  assert(afterSecond === afterFirst, `adjustment journal count changed on replay: ${afterFirst} -> ${afterSecond}`);

  console.log(`PASS adjustment marker="${marker}" journals ${before}->${afterFirst}->${afterSecond}`);
}

async function runPeriodCloseReplay(superAdminToken: string) {
  console.log('\n## Period close replay');
  const uniqueSeed = Date.now();
  const month = Number((uniqueSeed % 12) + 1);
  const year = Number(2200 + (uniqueSeed % 50000));
  const first = await requestJson(superAdminToken, 'POST', '/admin/finance/periods/close', { month, year });
  assertStatus(first.status, 200, 'period close first');
  const second = await requestJson(superAdminToken, 'POST', '/admin/finance/periods/close', { month, year });
  assertStatus(second.status, 400, 'period close replay');
  console.log(`PASS period close ${month}/${year}`);
}

async function main() {
  const sessions = {} as Record<RoleKey, LoginResult>;
  for (const role of Object.keys(credentials) as RoleKey[]) {
    sessions[role] = await login(role);
  }

  const shippingCode = await ensureShippingMethod(sessions.kasir.token);
  const productId = await getFirstProductId(sessions.customer.token);

  await topUpProductStock(sessions.admin_gudang.token, productId, 10);
  await runIssueInvoiceReplay(
    sessions.kasir.token,
    sessions.customer.token,
    sessions.admin_gudang.token,
    productId,
    shippingCode
  );

  await topUpProductStock(sessions.admin_gudang.token, productId, 10);
  await runIssueInvoiceByItemsReplay(
    sessions.kasir.token,
    sessions.customer.token,
    sessions.admin_gudang.token,
    productId,
    shippingCode
  );

  await topUpProductStock(sessions.admin_gudang.token, productId, 10);
  await runTransferReplay(
    sessions.admin_finance.token,
    sessions.kasir.token,
    sessions.customer.token,
    productId,
    shippingCode
  );

  await topUpProductStock(sessions.admin_gudang.token, productId, 10);
  await runCodReplay(
    sessions.admin_finance.token,
    sessions.kasir.token,
    sessions.admin_gudang.token,
    sessions.driver.token,
    sessions.driver.userId,
    sessions.customer.token,
    productId,
    shippingCode
  );

  await topUpProductStock(sessions.admin_gudang.token, productId, 20);
  await runMultiOrderDeliveryConsistency(
    sessions.kasir.token,
    sessions.admin_gudang.token,
    sessions.driver.token,
    sessions.driver.userId,
    sessions.customer.token,
    productId,
    shippingCode
  );

  await topUpProductStock(sessions.admin_gudang.token, productId, 10);
  await runReturRefundReplay(
    sessions.admin_finance.token,
    sessions.kasir.token,
    sessions.admin_gudang.token,
    sessions.driver.token,
    sessions.driver.userId,
    sessions.customer.token,
    productId,
    shippingCode
  );

  await runExpenseReplay(sessions.admin_finance.token);
  await runExpenseLabelReplay(sessions.admin_finance.token);
  await runAdjustmentReplay(sessions.admin_finance.token);
  await runPeriodCloseReplay(sessions.super_admin.token);

  await topUpProductStock(sessions.admin_gudang.token, productId, 10);
  await runCreditNoteReplay(
    sessions.admin_finance.token,
    sessions.kasir.token,
    sessions.customer.token,
    productId,
    shippingCode
  );

  await topUpProductStock(sessions.admin_gudang.token, productId, 10);
  await runVoidInvoiceReplay(
    sessions.admin_finance.token,
    sessions.kasir.token,
    sessions.customer.token,
    productId,
    shippingCode
  );

  await runSupplierInvoicePaymentReplay(
    sessions.admin_finance.token,
    sessions.kasir.token
  );

  console.log('\nFinance replay regression passed');
}

main().catch((error) => {
  console.error('\nFinance replay regression failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
