import {
  CartItem,
  CreditNoteLine,
  InventoryCostLedger,
  OrderAllocation,
  OrderItem,
  Product,
  PurchaseOrderItem,
  Retur,
  StockMutation,
  StockOpnameItem,
  sequelize,
} from '../models';

type UpdateSummary = Record<string, number>;

const argValue = (flag: string): string | null => {
  const idx = process.argv.findIndex((v) => v === flag);
  if (idx === -1) return null;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith('-')) return null;
  return String(next).trim();
};

const hasFlag = (flag: string): boolean => process.argv.includes(flag);

const add = (summary: UpdateSummary, key: string, value: number) => {
  summary[key] = (summary[key] || 0) + value;
};

async function updateProductId(
  model: any,
  label: string,
  fromProductId: string,
  toProductId: string,
  tx: any,
  summary: UpdateSummary
) {
  const [affected] = await model.update(
    { product_id: toProductId },
    { where: { product_id: fromProductId }, transaction: tx, logging: false }
  );
  add(summary, label, Number(affected || 0));
}

async function main() {
  const fromSku = (argValue('--from-sku') || argValue('--fromSku') || '').trim();
  const toSku = (argValue('--to-sku') || argValue('--toSku') || '').trim();
  const execute = hasFlag('--execute') || hasFlag('--confirm');
  const dryRun = hasFlag('--dry-run') || !execute;
  const summary: UpdateSummary = {};

  if (!fromSku || !toSku) {
    console.error(
      'Usage: ts-node src/scripts/repoint_product_transactions_by_sku.ts --from-sku <SKU_LAMA> --to-sku <SKU_BARU> [--execute]'
    );
    console.error('Defaults to dry-run unless --execute/--confirm is provided.');
    process.exitCode = 2;
    return;
  }

  if (fromSku === toSku) {
    console.error('from-sku dan to-sku tidak boleh sama.');
    process.exitCode = 2;
    return;
  }

  try {
    const fromProduct = await Product.findOne({ where: { sku: fromSku }, logging: false });
    const toProduct = await Product.findOne({ where: { sku: toSku }, logging: false });

    if (!fromProduct) {
      console.error(`Product dengan SKU "${fromSku}" tidak ditemukan.`);
      process.exitCode = 2;
      return;
    }
    if (!toProduct) {
      console.error(`Product dengan SKU "${toSku}" tidak ditemukan.`);
      process.exitCode = 2;
      return;
    }

    const fromProductId = String(fromProduct.id);
    const toProductId = String(toProduct.id);

    console.log(`From SKU: ${fromSku} (product_id=${fromProductId})`);
    console.log(`To   SKU: ${toSku} (product_id=${toProductId})`);
    console.log(`Mode: ${dryRun ? 'DRY-RUN (no changes)' : 'EXECUTE (will commit)'}`);

    await sequelize.transaction(async (tx) => {
      await updateProductId(OrderItem, 'order_items', fromProductId, toProductId, tx, summary);
      await updateProductId(OrderAllocation, 'order_allocations', fromProductId, toProductId, tx, summary);
      await updateProductId(CartItem, 'cart_items', fromProductId, toProductId, tx, summary);
      await updateProductId(StockMutation, 'stock_mutations', fromProductId, toProductId, tx, summary);
      await updateProductId(StockOpnameItem, 'stock_opname_items', fromProductId, toProductId, tx, summary);
      await updateProductId(PurchaseOrderItem, 'purchase_order_items', fromProductId, toProductId, tx, summary);
      await updateProductId(Retur, 'returs', fromProductId, toProductId, tx, summary);
      await updateProductId(InventoryCostLedger, 'inventory_cost_ledger', fromProductId, toProductId, tx, summary);
      await updateProductId(CreditNoteLine, 'credit_note_lines', fromProductId, toProductId, tx, summary);

      if (dryRun) {
        throw new Error('__DRY_RUN_ROLLBACK__');
      }
    });

    console.log('Update selesai:');
    console.table(summary);
    process.exit(0);
  } catch (error: any) {
    if (String(error?.message || '') === '__DRY_RUN_ROLLBACK__') {
      console.log('Dry-run selesai (rollback). Ringkasan baris yang *akan* diupdate:');
      console.table(summary);
      console.log('Jalankan lagi dengan --execute untuk menerapkan perubahan.');
      process.exit(0);
      return;
    }
    console.error('❌ Gagal repoint transaksi berdasarkan SKU:', error);
    process.exit(1);
  }
}

main();
