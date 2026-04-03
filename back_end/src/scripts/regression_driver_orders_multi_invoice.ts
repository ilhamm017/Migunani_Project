import sequelize from '../config/database';
import { User, Order } from '../models';
import { findInvoicesByOrderId } from '../utils/invoiceLookup';
import { getAssignedOrders } from '../controllers/driver';

export {};

const DRIVER_EMAIL = String(process.env.DRIVER_EMAIL || 'driver1@migunani.com').trim();

type AssignedRow = {
  id?: string;
  real_order_id?: string;
  invoice_id?: string;
};

const asLower = (value: unknown) => String(value || '').trim().toLowerCase();

async function runGetAssignedOrders(params: { driverId: string; status?: string }): Promise<unknown> {
  const handler = getAssignedOrders as any;
  return await new Promise((resolve, reject) => {
    const req: any = {
      user: { id: params.driverId, role: 'driver' },
      query: params.status ? { status: params.status } : {},
    };
    const res: any = {
      json: (data: unknown) => resolve(data),
    };
    const next = (err: unknown) => reject(err || new Error('next() called'));
    handler(req, res, next);
  });
}

async function main() {
  const driver = await User.findOne({ where: { email: DRIVER_EMAIL } });
  if (!driver) {
    throw new Error(`Driver not found for email: ${DRIVER_EMAIL}`);
  }

  const candidateOrders = await Order.findAll({
    where: { courier_id: String(driver.id) },
    attributes: ['id', 'status', 'updatedAt', 'createdAt'],
    order: [['updatedAt', 'DESC']],
    limit: 50,
  });

  const targetOrder = [];
  for (const order of candidateOrders as any[]) {
    const status = asLower(order?.status);
    if (!['ready_to_ship', 'checked', 'shipped'].includes(status)) continue;
    const invoices = await findInvoicesByOrderId(String(order.id));
    if (invoices.length > 1) {
      targetOrder.push({ order, invoices });
      break;
    }
  }

  if (targetOrder.length === 0) {
    console.log('SKIP: no multi-invoice order found for driver in ready_to_ship/checked/shipped.');
    return;
  }

  const { order, invoices } = targetOrder[0] as any;
  const expectedInvoiceIds = new Set(invoices.map((inv: any) => String(inv?.id || '').trim()).filter(Boolean));
  if (expectedInvoiceIds.size <= 1) {
    console.log('SKIP: multi-invoice target did not yield >1 unique invoice id.');
    return;
  }

  const data = await runGetAssignedOrders({ driverId: String(driver.id), status: String(order.status) });
  if (!Array.isArray(data)) {
    throw new Error(`Expected array response from getAssignedOrders, got: ${typeof data}`);
  }

  const rows = data as AssignedRow[];
  const matchingRows = rows.filter((row) => String(row?.real_order_id || '').trim() === String(order.id));
  const returnedInvoiceIds = new Set(matchingRows.map((row) => String(row?.invoice_id || row?.id || '').trim()).filter(Boolean));

  if (returnedInvoiceIds.size !== expectedInvoiceIds.size) {
    throw new Error(
      `FAIL: expected ${expectedInvoiceIds.size} invoice(s) for order ${String(order.id).slice(-8)}, got ${returnedInvoiceIds.size}.`
    );
  }

  console.log(
    `PASS: /driver/orders returns all invoices for order ${String(order.id).slice(-8)} -> ${returnedInvoiceIds.size} invoice(s).`
  );
}

main()
  .catch((error) => {
    console.error('\nDriver orders multi-invoice regression failed');
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await sequelize.close();
    } catch {
      // ignore
    }
  });

