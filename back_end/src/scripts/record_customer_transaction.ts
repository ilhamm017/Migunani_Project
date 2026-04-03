import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Op } from 'sequelize';
import {
  Account,
  Backorder,
  InventoryBatch,
  InventoryBatchConsumption,
  InventoryBatchReservation,
  InventoryCostLedger,
  Invoice,
  InvoiceItem,
  Journal,
  JournalLine,
  Order,
  OrderAllocation,
  OrderEvent,
  OrderItem,
  Product,
  StockMutation,
  User,
  sequelize,
} from '../models';

const API_BASE_URL = String(process.env.API_BASE_URL || 'http://127.0.0.1:5000/api/v1').replace(/\/$/, '');

type Session = {
  token: string;
  userId: string;
  email: string;
  role: string;
};

type RoleKey = 'super_admin' | 'kasir' | 'admin_finance' | 'admin_gudang' | 'driver1' | 'customer1';

const credentials: Record<RoleKey, { email: string; password: string }> = {
  super_admin: { email: 'superadmin@migunani.com', password: 'superadmin123' },
  kasir: { email: 'kasir@migunani.com', password: 'kasir123' },
  admin_finance: { email: 'finance@migunani.com', password: 'finance123' },
  admin_gudang: { email: 'gudang@migunani.com', password: 'gudang123' },
  driver1: { email: 'driver1@migunani.com', password: 'driver123' },
  customer1: { email: 'customer1@migunani.com', password: 'customer123' },
};

const tinyPngBuffer = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pH9n4sAAAAASUVORK5CYII=',
  'base64'
);

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out: Record<string, string> = {};
  for (const raw of args) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('--')) continue;
    const [k, ...rest] = trimmed.slice(2).split('=');
    out[String(k || '').trim()] = rest.join('=').trim();
  }
  return out;
};

async function login(role: RoleKey): Promise<Session> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials[role]),
  });
  const data = await response.json();
  if (!response.ok || typeof data?.token !== 'string') {
    throw new Error(`Login failed for ${role}: ${response.status} ${JSON.stringify(data)}`);
  }
  return {
    token: data.token,
    userId: String(data?.user?.id || ''),
    email: String(data?.user?.email || credentials[role].email),
    role: String(data?.user?.role || role),
  };
}

async function requestJson(
  token: string,
  method: string,
  pathWithQuery: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
) {
  const response = await fetch(`${API_BASE_URL}${pathWithQuery}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(extraHeaders || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, ok: response.ok, data, text };
}

async function requestFormData(token: string, method: string, pathWithQuery: string, formData: FormData) {
  const response = await fetch(`${API_BASE_URL}${pathWithQuery}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, ok: response.ok, data, text };
}

function assertStatus(actual: number, expected: number, label: string, payload?: unknown) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}${payload ? ` payload=${JSON.stringify(payload)}` : ''}`);
  }
}

function assert(condition: unknown, label: string) {
  if (!condition) throw new Error(label);
}

const toQtyInt = (value: unknown) => Math.max(0, Math.trunc(Number(value || 0)));

async function ensureShippingMethod(kasirToken: string, marker: string) {
  const code = `REC${Date.now().toString().slice(-8)}`;
  const createRes = await requestJson(kasirToken, 'POST', '/admin/shipping-methods', {
    code,
    name: `Recorder Shipping (${marker})`,
    fee: 10000,
    is_active: true,
    sort_order: 997,
  });
  if (createRes.status !== 200 && createRes.status !== 201) {
    throw new Error(`ensureShippingMethod failed: ${createRes.status} ${JSON.stringify(createRes.data)}`);
  }
  return code;
}

async function checkoutSingleItem(customerToken: string, productId: string, shippingCode: string, marker: string, qty: number) {
  const response = await requestJson(
    customerToken,
    'POST',
    '/orders/checkout',
    {
      from_cart: false,
      payment_method: 'transfer_manual',
      shipping_method_code: shippingCode,
      shipping_address: 'Jl. Recorder Transaction No. 1',
      customer_note: marker,
      items: [{ product_id: productId, qty }],
    },
    { 'Idempotency-Key': `record-checkout-${Date.now()}` }
  );
  assertStatus(response.status, 201, 'checkout', response.data);
  const orderId = String((response.data as any)?.order_id || '');
  if (!orderId) throw new Error('checkout: missing order_id');
  return orderId;
}

async function allocateFullOrder(kasirToken: string, orderId: string) {
  const detail = await requestJson(kasirToken, 'GET', `/orders/${orderId}`);
  assertStatus(detail.status, 200, 'order detail (kasir)', detail.data);
  const items = Array.isArray((detail.data as any)?.OrderItems) ? (detail.data as any).OrderItems : [];
  const payload = items
    .map((item: any) => ({ product_id: String(item?.product_id || ''), qty: Number(item?.qty || 0) }))
    .filter((item: any) => item.product_id && item.qty > 0);
  if (payload.length === 0) throw new Error('allocate: no allocatable items');
  const response = await requestJson(kasirToken, 'POST', `/allocation/${orderId}`, { items: payload });
  assertStatus(response.status, 200, 'allocate', response.data);
}

async function issueInvoice(kasirToken: string, orderId: string) {
  const response = await requestJson(kasirToken, 'POST', `/admin/finance/orders/${orderId}/issue-invoice`);
  assertStatus(response.status, 200, 'issue invoice', response.data);
  const invoiceId = String((response.data as any)?.invoice_id || '');
  if (!invoiceId) throw new Error('issue invoice: missing invoice_id');
  return invoiceId;
}

async function uploadPaymentProof(customerToken: string, orderId: string) {
  const form = new FormData();
  form.append('proof', new Blob([tinyPngBuffer], { type: 'image/png' }), 'proof.png');
  const response = await requestFormData(customerToken, 'POST', `/orders/${orderId}/proof`, form);
  assertStatus(response.status, 200, 'upload payment proof', response.data);
}

async function verifyPayment(adminFinanceToken: string, orderId: string) {
  const response = await requestJson(adminFinanceToken, 'PATCH', `/admin/finance/orders/${orderId}/verify`, { action: 'approve' });
  assertStatus(response.status, 200, 'verify payment', response.data);
}

async function shipOrder(adminGudangToken: string, orderId: string, courierId: string) {
  const response = await requestJson(adminGudangToken, 'PATCH', `/orders/admin/${orderId}/status`, {
    status: 'shipped',
    courier_id: courierId,
  });
  assertStatus(response.status, 200, 'ship order', response.data);
}

async function assignInvoiceDriver(adminGudangToken: string, invoiceId: string, courierId: string) {
  const response = await requestJson(adminGudangToken, 'PATCH', `/invoices/${invoiceId}/assign-driver`, { courier_id: courierId });
  assertStatus(response.status, 200, 'assign invoice driver', response.data);
}

async function checkInvoice(superAdminToken: string, invoiceId: string) {
  const form = new FormData();
  form.append('invoice_id', invoiceId);
  form.append('result', 'pass');
  form.append('note', 'record_customer_transaction');
  form.append('evidence', new Blob([tinyPngBuffer], { type: 'image/png' }), 'check.png');
  const response = await requestFormData(superAdminToken, 'POST', '/admin/delivery-handovers/check', form);
  assertStatus(response.status, 200, 'delivery handover check', response.data);
  const handoverId = Number((response.data as any)?.handover_id);
  if (!Number.isFinite(handoverId) || handoverId <= 0) throw new Error('delivery handover check: missing handover_id');
  return handoverId;
}

async function handoverToDriver(superAdminToken: string, handoverId: number) {
  const response = await requestJson(superAdminToken, 'POST', `/admin/delivery-handovers/${handoverId}/handover`);
  assertStatus(response.status, 200, 'delivery handover to driver', response.data);
}

async function completeDelivery(driverToken: string, orderId: string) {
  const form = new FormData();
  form.append('proof', new Blob([tinyPngBuffer], { type: 'image/png' }), 'delivery.png');
  const response = await requestFormData(driverToken, 'POST', `/driver/orders/${orderId}/complete`, form);
  assertStatus(response.status, 200, 'complete delivery', response.data);
}

const toPlain = (row: any) => (row && typeof row.get === 'function' ? row.get({ plain: true }) : row);

async function snapshotBaseline(productIds: string[]) {
  const [products, batches] = await Promise.all([
    Product.findAll({ where: { id: { [Op.in]: productIds } }, order: [['sku', 'ASC']] }),
    InventoryBatch.findAll({
      where: { product_id: { [Op.in]: productIds } },
      order: [['product_id', 'ASC'], ['createdAt', 'ASC'], ['id', 'ASC']],
    }),
  ]);
  return {
    products: products.map(toPlain),
    inventory_batches: batches.map(toPlain),
  };
}

async function snapshotDb(params: { since: Date; orderId?: string; invoiceId?: string; productIds: string[] }) {
  const { since, orderId, invoiceId, productIds } = params;

  const [products, batches, allocations, reservations, consumptions, costLedger, stockMutations] = await Promise.all([
    Product.findAll({
      where: { id: { [Op.in]: productIds } },
      order: [['sku', 'ASC']],
    }),
    InventoryBatch.findAll({
      where: { product_id: { [Op.in]: productIds } },
      order: [['product_id', 'ASC'], ['createdAt', 'ASC'], ['id', 'ASC']],
    }),
    orderId
      ? OrderAllocation.findAll({ where: { order_id: orderId }, order: [['createdAt', 'ASC'], ['id', 'ASC']] })
      : Promise.resolve([]),
    orderId
      ? InventoryBatchReservation.findAll({ where: { order_id: orderId }, order: [['createdAt', 'ASC'], ['id', 'ASC']] })
      : Promise.resolve([]),
    InventoryBatchConsumption.findAll({
      where: {
        product_id: { [Op.in]: productIds },
        createdAt: { [Op.gte]: since },
        ...(orderId ? { reference_id: String(orderId) } : {}),
      } as any,
      order: [['createdAt', 'ASC'], ['id', 'ASC']],
    }),
    InventoryCostLedger.findAll({
      where: { product_id: { [Op.in]: productIds }, createdAt: { [Op.gte]: since } } as any,
      order: [['createdAt', 'ASC'], ['id', 'ASC']],
    }),
    StockMutation.findAll({
      where: { product_id: { [Op.in]: productIds }, createdAt: { [Op.gte]: since } } as any,
      order: [['createdAt', 'ASC'], ['id', 'ASC']],
    }),
  ]);

  const batchIds = (batches as any[])
    .map((row: any) => String(row?.id || '').trim())
    .filter(Boolean);
  const reservationSumsByBatch = batchIds.length > 0
    ? await InventoryBatchReservation.findAll({
      where: { batch_id: { [Op.in]: batchIds } } as any,
      attributes: ['batch_id', [sequelize.fn('SUM', sequelize.col('qty_reserved')), 'qty_reserved_sum']],
      group: ['batch_id'],
    })
    : [];

  const [order, orderItems, backorders, orderEvents, invoice, invoiceItems] = await Promise.all([
    orderId ? Order.findByPk(orderId) : Promise.resolve(null),
    orderId ? OrderItem.findAll({ where: { order_id: orderId }, order: [['createdAt', 'ASC'], ['id', 'ASC']] }) : Promise.resolve([]),
    orderId
      ? (async () => {
        const items = await OrderItem.findAll({ where: { order_id: orderId }, attributes: ['id'] });
        const ids = items.map((r: any) => String(r.id)).filter(Boolean);
        if (ids.length === 0) return [];
        return Backorder.findAll({ where: { order_item_id: { [Op.in]: ids } }, order: [['createdAt', 'ASC'], ['id', 'ASC']] });
      })()
      : Promise.resolve([]),
    orderId ? OrderEvent.findAll({ where: { order_id: orderId }, order: [['createdAt', 'ASC'], ['id', 'ASC']] }) : Promise.resolve([]),
    invoiceId ? Invoice.findByPk(invoiceId) : Promise.resolve(null),
    invoiceId ? InvoiceItem.findAll({ where: { invoice_id: invoiceId }, order: [['createdAt', 'ASC'], ['id', 'ASC']] }) : Promise.resolve([]),
  ]);

  const [journals, journalLines, accounts] = await Promise.all([
    Journal.findAll({
      where: {
        createdAt: { [Op.gte]: since },
        ...(invoiceId || orderId
          ? {
            [Op.or]: [
              ...(invoiceId ? [{ reference_id: String(invoiceId) }] : []),
              ...(orderId ? [{ reference_id: String(orderId) }] : []),
            ],
          }
          : {}),
      } as any,
      order: [['createdAt', 'ASC'], ['id', 'ASC']],
    }),
    JournalLine.findAll({
      where: { createdAt: { [Op.gte]: since } } as any,
      order: [['createdAt', 'ASC'], ['id', 'ASC']],
    }),
    Account.findAll({ order: [['id', 'ASC']] }),
  ]);

  const accountById = new Map<number, any>();
  accounts.forEach((row: any) => accountById.set(Number(row.id), toPlain(row)));

  const linesByJournalId = new Map<number, any[]>();
  (journalLines as any[]).forEach((row: any) => {
    const journalId = Number((row as any).journal_id);
    const bucket = linesByJournalId.get(journalId) || [];
    bucket.push({
      ...toPlain(row),
      account: accountById.get(Number((row as any).account_id)) || null,
    });
    linesByJournalId.set(journalId, bucket);
  });

  return {
    products: products.map(toPlain),
    inventory_batches: batches.map(toPlain),
    order: order ? toPlain(order) : null,
    order_items: orderItems.map(toPlain),
	    order_allocations: (allocations as any[]).map(toPlain),
	    backorders: (backorders as any[]).map(toPlain),
	    inventory_batch_reservations: (reservations as any[]).map(toPlain),
	    inventory_batch_reservation_sums_by_batch: (reservationSumsByBatch as any[]).map(toPlain),
	    inventory_batch_consumptions: (consumptions as any[]).map(toPlain),
	    inventory_cost_ledger: (costLedger as any[]).map(toPlain),
	    stock_mutations: (stockMutations as any[]).map(toPlain),
	    order_events: (orderEvents as any[]).map(toPlain),
    invoice: invoice ? toPlain(invoice) : null,
    invoice_items: (invoiceItems as any[]).map(toPlain),
    journals: (journals as any[]).map((j: any) => {
      const plain = toPlain(j);
      return { ...plain, lines: linesByJournalId.get(Number(plain.id)) || [] };
    }),
  };
}

async function pickProductIdOrThrow(qty: number) {
  const product = await Product.findOne({
    where: {
      status: 'active',
      stock_quantity: { [Op.gte]: qty },
    } as any,
    order: [['stock_quantity', 'DESC'], ['updatedAt', 'DESC']],
  });
  if (!product) throw new Error('No product with stock found to run transaction record.');
  return String((product as any).id);
}

async function main() {
  const args = parseArgs();
  const customerEmail = String(args['customer_email'] || credentials.customer1.email).trim().toLowerCase();
  const qty = Math.max(1, Math.trunc(Number(args['qty'] || 1) || 1));
  const marker = String(args['marker'] || `record-tx:${customerEmail}:${Date.now()}`).trim();

  // Allow overriding customer1 email for a one-off run (password stays aligned with seed scripts).
  if (customerEmail && customerEmail !== credentials.customer1.email) {
    credentials.customer1.email = customerEmail;
  }

  await sequelize.authenticate();

  const runId = `record_customer_transaction_${Date.now()}`;
  const since = new Date();

  const sessions: Record<RoleKey, Session> = {
    super_admin: await login('super_admin'),
    kasir: await login('kasir'),
    admin_finance: await login('admin_finance'),
    admin_gudang: await login('admin_gudang'),
    driver1: await login('driver1'),
    customer1: await login('customer1'),
  };

  const productId = await pickProductIdOrThrow(qty);
  const productIds = [productId];

  const before = await snapshotBaseline(productIds);
  const stageSnapshots: Record<string, unknown> = {};

  let orderId = '';
  let invoiceId = '';
  const steps: Array<{ step: string; ok: boolean; status?: number; data?: unknown; at: string }> = [];
  let error: unknown = null;

  const capture = async (stage: string) => {
    stageSnapshots[stage] = await snapshotDb({
      since,
      orderId: orderId || undefined,
      invoiceId: invoiceId || undefined,
      productIds,
    });
  };

	  const assertStageAfterAllocate = (stage: any) => {
	    const reservations: any[] = Array.isArray(stage?.inventory_batch_reservations) ? stage.inventory_batch_reservations : [];
	    assert(reservations.length > 0, 'Expected inventory_batch_reservations rows after allocate.');

	    const reservedBatchIds: string[] = Array.from(new Set(
	      reservations
	        .map((row: any) => String(row?.batch_id || '').trim())
	        .filter((value: string) => Boolean(value))
	    ));
	    assert(reservedBatchIds.length > 0, 'Expected at least one batch_id in inventory_batch_reservations after allocate.');

    const batches = Array.isArray(stage?.inventory_batches) ? stage.inventory_batches : [];
    const sums = Array.isArray(stage?.inventory_batch_reservation_sums_by_batch)
      ? stage.inventory_batch_reservation_sums_by_batch
      : [];
    const sumByBatchId = new Map<string, number>();
    sums.forEach((row: any) => {
      const batchId = String(row?.batch_id || '').trim();
      if (!batchId) return;
      sumByBatchId.set(batchId, toQtyInt((row as any)?.qty_reserved_sum ?? row?.qty_reserved ?? 0));
    });

    for (const batchId of reservedBatchIds) {
      const batch = batches.find((b: any) => String(b?.id || '').trim() === batchId);
      assert(batch, `Missing InventoryBatch ${batchId} in snapshot.`);
      const expected = toQtyInt(sumByBatchId.get(batchId) || 0);
      const actual = toQtyInt((batch as any)?.qty_reserved);
      assert(
        actual === expected,
        `inventory_batches.qty_reserved drift for batch ${batchId}: batch.qty_reserved=${actual}, sum(reservations)=${expected}.`
      );
    }
  };

  const assertStageAfterVerifyPayment = (stage: any) => {
    const journals = Array.isArray(stage?.journals) ? stage.journals : [];
    const paymentVerify = journals.filter((j: any) => String(j?.reference_type || '').trim() === 'payment_verify');
    assert(paymentVerify.length > 0, 'Expected payment_verify journal after verify payment.');

    const hasRevenue4100 = paymentVerify.some((j: any) =>
      (Array.isArray(j?.lines) ? j.lines : []).some((l: any) =>
        String(l?.account?.code || '').trim() === '4100' && Number(l?.credit || 0) > 0
      )
    );
    assert(!hasRevenue4100, 'payment_verify journal must NOT credit account 4100 (revenue).');

    const hasDeferred2300 = paymentVerify.some((j: any) =>
      (Array.isArray(j?.lines) ? j.lines : []).some((l: any) =>
        String(l?.account?.code || '').trim() === '2300' && Number(l?.credit || 0) > 0
      )
    );
    assert(hasDeferred2300, 'payment_verify journal must credit account 2300 (deferred revenue).');
  };

  const assertStageAfterCheckInvoice = (stage: any) => {
    const allocations = Array.isArray(stage?.order_allocations) ? stage.order_allocations : [];
    const active = allocations.filter((a: any) => Number(a?.allocated_qty || 0) > 0);
    assert(active.length > 0, 'Expected at least one OrderAllocation row after check invoice.');
    const allPicked = active.every((a: any) => String(a?.status || '').trim() === 'picked');
    assert(allPicked, 'All active OrderAllocation rows must be status=picked after check invoice.');
  };

  const assertStageAfterHandover = (stage: any) => {
    const allocations = Array.isArray(stage?.order_allocations) ? stage.order_allocations : [];
    const active = allocations.filter((a: any) => Number(a?.allocated_qty || 0) > 0);
    assert(active.length > 0, 'Expected at least one OrderAllocation row after handover.');
    const allShipped = active.every((a: any) => String(a?.status || '').trim() === 'shipped');
    assert(allShipped, 'All active OrderAllocation rows must be status=shipped after handover/goods-out.');

    const journals = Array.isArray(stage?.journals) ? stage.journals : [];
    const credit4100 = journals.flatMap((j: any) =>
      (Array.isArray(j?.lines) ? j.lines : [])
        .filter((l: any) => String(l?.account?.code || '').trim() === '4100' && Number(l?.credit || 0) > 0)
        .map((l: any) => ({ reference_type: String(j?.reference_type || ''), credit: Number(l?.credit || 0) }))
    );
    assert(credit4100.length === 1, `Expected exactly 1 credit line to account 4100 after handover, got ${credit4100.length}.`);
    assert(String(credit4100[0]?.reference_type || '').trim() === 'order_goods_out', 'Credit 4100 must come from order_goods_out journal (non-COD).');

    const baselineProduct = (Array.isArray(before?.products) ? before.products : []).find((p: any) => String(p?.id || '') === productId);
    const currentProduct = (Array.isArray(stage?.products) ? stage.products : []).find((p: any) => String(p?.id || '') === productId);
    const baselineAllocated = Number(baselineProduct?.allocated_quantity || 0);
    const currentAllocated = Number(currentProduct?.allocated_quantity || 0);
    assert(
      currentAllocated === baselineAllocated,
      `Product.allocated_quantity must return to baseline after shipment (baseline=${baselineAllocated}, current=${currentAllocated}).`
    );
  };

  const assertStageAfterCompleteDelivery = (stage: any) => {
    const orderStatus = String(stage?.order?.status || '').trim();
    const reservations = Array.isArray(stage?.inventory_batch_reservations) ? stage.inventory_batch_reservations : [];
    assert(
      reservations.length === 0,
      `Expected no inventory_batch_reservations after delivery completion (order status='${orderStatus}'), got ${reservations.length}.`
    );
  };

  try {
    const shippingCode = await ensureShippingMethod(sessions.kasir.token, marker);
    steps.push({ step: 'ensureShippingMethod', ok: true, at: new Date().toISOString(), data: { shippingCode } });

    orderId = await checkoutSingleItem(sessions.customer1.token, productId, shippingCode, marker, qty);
    steps.push({ step: 'checkout', ok: true, at: new Date().toISOString(), data: { orderId } });
    await capture('after_checkout');

	    await allocateFullOrder(sessions.kasir.token, orderId);
	    steps.push({ step: 'allocate', ok: true, at: new Date().toISOString() });
	    await capture('after_allocate');
	    assertStageAfterAllocate(stageSnapshots['after_allocate'] as any);

	    invoiceId = await issueInvoice(sessions.kasir.token, orderId);
	    steps.push({ step: 'issueInvoice', ok: true, at: new Date().toISOString(), data: { invoiceId } });
	    await capture('after_issue_invoice');

    await uploadPaymentProof(sessions.customer1.token, orderId);
    steps.push({ step: 'uploadPaymentProof', ok: true, at: new Date().toISOString() });
    await capture('after_upload_proof');

    await verifyPayment(sessions.admin_finance.token, orderId);
    steps.push({ step: 'verifyPayment', ok: true, at: new Date().toISOString() });
    await capture('after_verify_payment');
    assertStageAfterVerifyPayment(stageSnapshots['after_verify_payment'] as any);

    await assignInvoiceDriver(sessions.admin_gudang.token, invoiceId, sessions.driver1.userId);
    steps.push({ step: 'assignInvoiceDriver', ok: true, at: new Date().toISOString() });
    await capture('after_assign_driver');

    const handoverId = await checkInvoice(sessions.super_admin.token, invoiceId);
    steps.push({ step: 'checkInvoice', ok: true, at: new Date().toISOString(), data: { handover_id: handoverId } });
    await capture('after_check_invoice');
    assertStageAfterCheckInvoice(stageSnapshots['after_check_invoice'] as any);

    await handoverToDriver(sessions.super_admin.token, handoverId);
    steps.push({ step: 'handoverToDriver', ok: true, at: new Date().toISOString(), data: { handover_id: handoverId } });
    await capture('after_handover_to_driver');
    assertStageAfterHandover(stageSnapshots['after_handover_to_driver'] as any);

	    await completeDelivery(sessions.driver1.token, orderId);
	    steps.push({ step: 'completeDelivery', ok: true, at: new Date().toISOString() });
	    await capture('after_complete_delivery');
	    assertStageAfterCompleteDelivery(stageSnapshots['after_complete_delivery'] as any);
	  } catch (err) {
	    error = err;
	    steps.push({ step: 'failed', ok: false, at: new Date().toISOString(), data: err instanceof Error ? { message: err.message, stack: err.stack } : err });
	  }

  const after = await snapshotDb({ since, orderId: orderId || undefined, invoiceId: invoiceId || undefined, productIds });

  const customer = await User.findOne({ where: { email: customerEmail } });
  const outDir = path.join(process.cwd(), 'testing');
  const outPath = path.join(outDir, `${runId}.json`);
  fs.mkdirSync(outDir, { recursive: true });

  const report = {
    run_id: runId,
    created_at: new Date().toISOString(),
    api_base_url: API_BASE_URL,
    marker,
    customer: customer ? toPlain(customer) : { email: customerEmail },
    actors: sessions,
    input: { qty, product_id: productId },
    ids: { order_id: orderId || null, invoice_id: invoiceId || null },
    steps,
    status: error ? 'failed' : 'ok',
    error: error
      ? error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : error
      : null,
    snapshots: {
      before,
      stages: stageSnapshots,
      after,
    },
  };

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`[record] status=${report.status}`);
  console.log(`[record] out=${outPath}`);
  if (orderId) console.log(`[record] order_id=${orderId}`);
  if (invoiceId) console.log(`[record] invoice_id=${invoiceId}`);

  await sequelize.close();
  if (error) process.exit(1);
}

main().catch(async (err) => {
  console.error('[record] fatal:', err instanceof Error ? err.stack || err.message : err);
  try {
    await sequelize.close();
  } catch {
    // ignore
  }
  process.exit(1);
});
