import { Op } from 'sequelize';
import {
  Cart,
  CartItem,
  CodCollection,
  CreditNote,
  CreditNoteLine,
  Backorder,
  DriverDebtAdjustment,
  Invoice,
  InvoiceItem,
  Order,
  OrderAllocation,
  OrderEvent,
  OrderIssue,
  OrderItem,
  Retur,
  ReturHandover,
  ReturHandoverItem,
  User,
  sequelize,
} from '../models';

type PurgeSummary = Record<string, number>;

const argValue = (flag: string): string | null => {
  const idx = process.argv.findIndex((v) => v === flag);
  if (idx === -1) return null;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith('-')) return null;
  return String(next).trim();
};

const hasFlag = (flag: string): boolean => process.argv.includes(flag);

const chunk = <T>(items: T[], size: number): T[][] => {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const add = (summary: PurgeSummary, key: string, value: number) => {
  summary[key] = (summary[key] || 0) + value;
};

async function countByIn<T extends { count: (opts: any) => Promise<number> }>(
  model: T,
  where: any,
  summary: PurgeSummary,
  key: string
) {
  const total = await (model as any).count({ where, logging: false });
  add(summary, key, total);
}

async function destroyByIn<T extends { destroy: (opts: any) => Promise<number> }>(
  model: T,
  where: any,
  summary: PurgeSummary,
  key: string,
  tx: any
) {
  const deleted = await (model as any).destroy({ where, transaction: tx, logging: false });
  add(summary, key, deleted);
}

async function main() {
  const email = (argValue('--email') || String(process.argv[2] || '')).trim();
  const execute = hasFlag('--execute') || hasFlag('--confirm');
  const dryRun = hasFlag('--dry-run') || !execute;

  if (!email || !email.includes('@')) {
    console.error('Usage: ts-node src/scripts/purge_customer_transactions.ts --email <email> [--execute]');
    console.error('Defaults to dry-run unless --execute/--confirm is provided.');
    process.exitCode = 2;
    return;
  }

  try {
    await sequelize.authenticate();
  } catch (err) {
    console.error('[purge] Failed to connect to DB. Ensure env vars DB_HOST/DB_USER/DB_PASS/DB_NAME are set.');
    console.error(err);
    process.exitCode = 1;
    return;
  }

  const user = await User.findOne({ where: { email }, logging: false });
  if (!user) {
    console.error(`[purge] User not found for email: ${email}`);
    process.exitCode = 1;
    return;
  }

  const customerId = String((user as any).id);

  const orders = await Order.findAll({
    where: { customer_id: customerId },
    attributes: ['id', 'parent_order_id'],
    logging: false,
  });
  const orderIds = orders.map((o: any) => String(o.id)).filter(Boolean);

  const orderItems = orderIds.length > 0
    ? await OrderItem.findAll({
      where: { order_id: { [Op.in]: orderIds } },
      attributes: ['id'],
      logging: false,
    })
    : [];
  const orderItemIds = orderItems.map((row: any) => String(row.id)).filter(Boolean);

  const backorders = orderItemIds.length > 0
    ? await Backorder.findAll({
      where: { order_item_id: { [Op.in]: orderItemIds } },
      attributes: ['id'],
      logging: false,
    })
    : [];
  const backorderIds = backorders.map((row: any) => String(row.id)).filter(Boolean);

  const invoices = await Invoice.findAll({
    where: {
      [Op.or]: [
        { customer_id: customerId },
        ...(orderIds.length > 0 ? [{ order_id: { [Op.in]: orderIds } }] : []),
      ],
    },
    attributes: ['id'],
    logging: false,
  });
  const invoiceIds = invoices.map((i: any) => String(i.id)).filter(Boolean);

  const creditNotes = invoiceIds.length > 0
    ? await CreditNote.findAll({ where: { invoice_id: { [Op.in]: invoiceIds } }, attributes: ['id'], logging: false })
    : [];
  const creditNoteIds = creditNotes.map((c: any) => String(c.id)).filter(Boolean);

  const returs = orderIds.length > 0
    ? await Retur.findAll({ where: { order_id: { [Op.in]: orderIds } }, attributes: ['id'], logging: false })
    : [];
  const returIds = returs.map((r: any) => String(r.id)).filter(Boolean);

  const handovers = invoiceIds.length > 0
    ? await ReturHandover.findAll({ where: { invoice_id: { [Op.in]: invoiceIds } }, attributes: ['id'], logging: false })
    : [];
  const handoverIds = handovers.map((h: any) => String(h.id)).filter(Boolean);

  const handoverItems = (handoverIds.length > 0 || returIds.length > 0)
    ? await ReturHandoverItem.findAll({
      where: {
        [Op.or]: [
          ...(handoverIds.length > 0 ? [{ handover_id: { [Op.in]: handoverIds } }] : []),
          ...(returIds.length > 0 ? [{ retur_id: { [Op.in]: returIds } }] : []),
        ],
      },
      attributes: ['id'],
      logging: false,
    })
    : [];
  const handoverItemIds = Array.from(new Set(handoverItems.map((row: any) => String(row.id)).filter(Boolean)));

  const driverDebtAdjustments = (invoiceIds.length > 0 || returIds.length > 0)
    ? await DriverDebtAdjustment.findAll({
      where: {
        [Op.or]: [
          ...(invoiceIds.length > 0 ? [{ invoice_id: { [Op.in]: invoiceIds } }] : []),
          ...(returIds.length > 0 ? [{ retur_id: { [Op.in]: returIds } }] : []),
        ],
      },
      attributes: ['id'],
      logging: false,
    })
    : [];
  const driverDebtAdjustmentIds = Array.from(new Set(driverDebtAdjustments.map((row: any) => String(row.id)).filter(Boolean)));

  const orderEvents = (orderIds.length > 0 || invoiceIds.length > 0)
    ? await OrderEvent.findAll({
      where: {
        [Op.or]: [
          ...(orderIds.length > 0 ? [{ order_id: { [Op.in]: orderIds } }] : []),
          ...(invoiceIds.length > 0 ? [{ invoice_id: { [Op.in]: invoiceIds } }] : []),
        ],
      },
      attributes: ['id'],
      logging: false,
    })
    : [];
  const orderEventIds = Array.from(new Set(orderEvents.map((row: any) => String(row.id)).filter(Boolean)));

  const carts = await Cart.findAll({
    where: { user_id: customerId },
    attributes: ['id'],
    logging: false,
  });
  const cartIds = carts.map((c: any) => String(c.id)).filter(Boolean);

  const summary: PurgeSummary = {};

  const inClauseBatchSize = 1000;
  const whereInBatches = <T>(column: string, ids: T[]) =>
    chunk(ids, inClauseBatchSize).map((batch) => ({ [column]: { [Op.in]: batch } }));

  // Count what would be affected
  if (cartIds.length > 0) {
    await countByIn(CartItem, { cart_id: { [Op.in]: cartIds } }, summary, 'cart_items');
    await countByIn(Cart, { id: { [Op.in]: cartIds } }, summary, 'carts');
  }
  if (orderIds.length > 0) {
    await countByIn(OrderAllocation, { order_id: { [Op.in]: orderIds } }, summary, 'order_allocations');
    await countByIn(OrderIssue, { order_id: { [Op.in]: orderIds } }, summary, 'order_issues');
    await countByIn(OrderItem, { order_id: { [Op.in]: orderIds } }, summary, 'order_items');
    await countByIn(Retur, { order_id: { [Op.in]: orderIds } }, summary, 'returs');
    await countByIn(Order, { id: { [Op.in]: orderIds } }, summary, 'orders');
  }
  if (backorderIds.length > 0) {
    await countByIn(Backorder, { id: { [Op.in]: backorderIds } }, summary, 'backorders');
  }
  if (orderEventIds.length > 0) {
    await countByIn(OrderEvent, { id: { [Op.in]: orderEventIds } }, summary, 'order_events');
  }
  if (invoiceIds.length > 0) {
    await countByIn(InvoiceItem, { invoice_id: { [Op.in]: invoiceIds } }, summary, 'invoice_items');
    await countByIn(CodCollection, { invoice_id: { [Op.in]: invoiceIds } }, summary, 'cod_collections');
    await countByIn(ReturHandover, { invoice_id: { [Op.in]: invoiceIds } }, summary, 'retur_handovers');
    await countByIn(CreditNote, { invoice_id: { [Op.in]: invoiceIds } }, summary, 'credit_notes');
    await countByIn(Invoice, { id: { [Op.in]: invoiceIds } }, summary, 'invoices');
  }
  if (creditNoteIds.length > 0) {
    await countByIn(CreditNoteLine, { credit_note_id: { [Op.in]: creditNoteIds } }, summary, 'credit_note_lines');
  }
  if (handoverItemIds.length > 0) {
    await countByIn(ReturHandoverItem, { id: { [Op.in]: handoverItemIds } }, summary, 'retur_handover_items');
  }
  if (driverDebtAdjustmentIds.length > 0) {
    await countByIn(DriverDebtAdjustment, { id: { [Op.in]: driverDebtAdjustmentIds } }, summary, 'driver_debt_adjustments');
  }

  const printSummary = (title: string) => {
    console.log(`\n[purge] ${title}`);
    console.log(`[purge] email=${email}`);
    console.log(`[purge] customer_id=${customerId}`);
    console.log(`[purge] orders=${orderIds.length}, invoices=${invoiceIds.length}, returs=${returIds.length}`);
    const keys = Object.keys(summary).sort();
    if (keys.length === 0) {
      console.log('[purge] Nothing to purge.');
      return;
    }
    for (const key of keys) {
      console.log(`- ${key}: ${summary[key]}`);
    }
  };

  if (dryRun) {
    printSummary('Dry-run (no rows deleted). Add --execute to actually delete.');
    return;
  }

  await sequelize.transaction(async (tx) => {
    // Carts
    if (cartIds.length > 0) {
      await destroyByIn(CartItem, { cart_id: { [Op.in]: cartIds } }, summary, 'cart_items_deleted', tx);
      await destroyByIn(Cart, { id: { [Op.in]: cartIds } }, summary, 'carts_deleted', tx);
    }

    // Events can reference both orders and invoices; delete them early to avoid FK constraints.
    if (orderEventIds.length > 0) {
      await destroyByIn(OrderEvent, { [Op.or]: whereInBatches('id', orderEventIds) }, summary, 'order_events_deleted', tx);
    }

    // Invoice-linked children
    if (handoverItemIds.length > 0) {
      await destroyByIn(ReturHandoverItem, { [Op.or]: whereInBatches('id', handoverItemIds) }, summary, 'retur_handover_items_deleted', tx);
    }
    if (handoverIds.length > 0) {
      await destroyByIn(ReturHandover, { [Op.or]: whereInBatches('id', handoverIds) }, summary, 'retur_handovers_deleted', tx);
    }
    if (driverDebtAdjustmentIds.length > 0) {
      await destroyByIn(DriverDebtAdjustment, { [Op.or]: whereInBatches('id', driverDebtAdjustmentIds) }, summary, 'driver_debt_adjustments_deleted', tx);
    }
    if (creditNoteIds.length > 0) {
      await destroyByIn(CreditNoteLine, { [Op.or]: whereInBatches('credit_note_id', creditNoteIds) }, summary, 'credit_note_lines_deleted', tx);
    }
    if (invoiceIds.length > 0) {
      await destroyByIn(CreditNote, { [Op.or]: whereInBatches('invoice_id', invoiceIds) }, summary, 'credit_notes_deleted', tx);
      await destroyByIn(CodCollection, { [Op.or]: whereInBatches('invoice_id', invoiceIds) }, summary, 'cod_collections_deleted', tx);
      await destroyByIn(InvoiceItem, { [Op.or]: whereInBatches('invoice_id', invoiceIds) }, summary, 'invoice_items_deleted', tx);
      await destroyByIn(Invoice, { [Op.or]: whereInBatches('id', invoiceIds) }, summary, 'invoices_deleted', tx);
    }

    // Order-linked children
    if (orderIds.length > 0) {
      await destroyByIn(OrderAllocation, { [Op.or]: whereInBatches('order_id', orderIds) }, summary, 'order_allocations_deleted', tx);
      await destroyByIn(OrderIssue, { [Op.or]: whereInBatches('order_id', orderIds) }, summary, 'order_issues_deleted', tx);
      await destroyByIn(Retur, { [Op.or]: whereInBatches('order_id', orderIds) }, summary, 'returs_deleted', tx);
      if (backorderIds.length > 0) {
        await destroyByIn(Backorder, { [Op.or]: whereInBatches('id', backorderIds) }, summary, 'backorders_deleted', tx);
      }
      await destroyByIn(OrderItem, { [Op.or]: whereInBatches('order_id', orderIds) }, summary, 'order_items_deleted', tx);

      // Delete children orders first (non-null parent_order_id), then roots.
      await destroyByIn(Order, { customer_id: customerId, parent_order_id: { [Op.ne]: null } }, summary, 'orders_deleted', tx);
      await destroyByIn(Order, { customer_id: customerId, parent_order_id: null }, summary, 'orders_deleted', tx);
    }
  });

  printSummary('Executed purge (rows deleted).');
}

main().catch((err) => {
  console.error('[purge] Unhandled error:', err);
  process.exitCode = 1;
});
