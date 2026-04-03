import {
  Backorder,
  Cart,
  CartItem,
  CodCollection,
  CodSettlement,
  CreditNote,
  CreditNoteLine,
  CustomerBalanceEntry,
  DeliveryHandover,
  DeliveryHandoverItem,
  DriverBalanceAdjustment,
  DriverDebtAdjustment,
  Expense,
  Invoice,
  InvoiceCostOverride,
  InvoiceItem,
  Journal,
  JournalLine,
  Order,
  OrderAllocation,
  OrderEvent,
  OrderIssue,
  OrderItem,
  PosSale,
  PosSaleItem,
  Retur,
  ReturHandover,
  ReturHandoverItem,
  SupplierInvoice,
  SupplierPayment,
  sequelize,
} from '../models';

type PurgeTarget = {
  key: string;
  model: any;
};

const hasFlag = (flag: string) => process.argv.includes(flag);
const argValue = (flag: string): string | null => {
  const idx = process.argv.findIndex((v) => v === flag);
  if (idx === -1) return null;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith('-')) return null;
  return String(next).trim();
};

const targetsInDeleteOrder: PurgeTarget[] = [
  // Children first
  { key: 'journal_lines', model: JournalLine },
  { key: 'journals', model: Journal },

  { key: 'cod_collections', model: CodCollection },
  { key: 'cod_settlements', model: CodSettlement },

  { key: 'supplier_payments', model: SupplierPayment },
  { key: 'supplier_invoices', model: SupplierInvoice },

  { key: 'customer_balance_entries', model: CustomerBalanceEntry },
  { key: 'expenses', model: Expense },

  { key: 'pos_sale_items', model: PosSaleItem },
  { key: 'pos_sales', model: PosSale },

  { key: 'invoice_cost_overrides', model: InvoiceCostOverride },
  { key: 'invoice_items', model: InvoiceItem },
  { key: 'delivery_handover_items', model: DeliveryHandoverItem },
  { key: 'delivery_handovers', model: DeliveryHandover },
  { key: 'retur_handover_items', model: ReturHandoverItem },
  { key: 'retur_handovers', model: ReturHandover },
  { key: 'credit_note_lines', model: CreditNoteLine },
  { key: 'credit_notes', model: CreditNote },
  { key: 'driver_balance_adjustments', model: DriverBalanceAdjustment },
  { key: 'driver_debt_adjustments', model: DriverDebtAdjustment },
  { key: 'returs', model: Retur },
  { key: 'invoices', model: Invoice },

  { key: 'backorders', model: Backorder },
  { key: 'order_allocations', model: OrderAllocation },
  { key: 'order_issues', model: OrderIssue },
  { key: 'order_events', model: OrderEvent },
  { key: 'order_items', model: OrderItem },
  { key: 'orders', model: Order },

  { key: 'cart_items', model: CartItem },
  { key: 'carts', model: Cart },
];

const main = async () => {
  const execute = hasFlag('--execute') || hasFlag('--confirm');
  const dryRun = hasFlag('--dry-run') || !execute;
  const requirePhrase = String(argValue('--i-understand') || '').trim();
  const okPhrase = 'DELETE_ALL_TRANSACTIONS';

  if (execute && requirePhrase !== okPhrase) {
    console.error('[purge_all] Refusing to run without explicit confirmation phrase.');
    console.error(`Usage: ts-node src/scripts/purge_all_transactions.ts --execute --i-understand ${okPhrase}`);
    console.error('Defaults to dry-run unless --execute is provided.');
    process.exitCode = 2;
    return;
  }

  await sequelize.authenticate();

  const counts: Record<string, number> = {};
  for (const t of targetsInDeleteOrder) {
    counts[t.key] = await t.model.count({ logging: false });
  }

  console.log('\n[purge_all] Targets (transaction tables only)');
  for (const t of targetsInDeleteOrder) {
    console.log(`- ${t.key}: ${counts[t.key]}`);
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`[purge_all] Total rows (sum of tables) = ${total}`);
  console.log(`[purge_all] mode=${dryRun ? 'dry-run' : 'execute'}`);

  if (dryRun) {
    console.log('\n[purge_all] Dry-run only. Re-run with:');
    console.log(`ts-node src/scripts/purge_all_transactions.ts --execute --i-understand ${okPhrase}`);
    return;
  }

  await sequelize.transaction(async (tx) => {
    for (const t of targetsInDeleteOrder) {
      const deleted = await t.model.destroy({
        where: {},
        transaction: tx,
        logging: false,
        individualHooks: false,
      });
      console.log(`[purge_all] deleted ${t.key}: ${deleted}`);
    }
  });

  console.log('\n[purge_all] Done.');
};

main().catch((error) => {
  console.error('[purge_all] failed:', error);
  process.exitCode = 1;
});

