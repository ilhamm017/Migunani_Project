import { Op } from 'sequelize';
import { Invoice, sequelize } from '../models';
import { computeInvoiceNetTotalsBulk } from '../utils/invoiceNetTotals';
import { parseMoneyInput } from '../utils/money';

const round2 = (value: unknown) => Math.round((Number(value) || 0) * 100) / 100;

const parseArgFlag = (name: string) => process.argv.includes(name);
const parseArgValue = (name: string, fallback: string) => {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return fallback;
  const v = process.argv[idx + 1];
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
};

async function main() {
  const dryRun = parseArgFlag('--dry-run');
  const limit = Math.max(1, Math.min(5000, Number(parseArgValue('--limit', '500')) || 500));
  const epsilon = Math.max(0, parseMoneyInput(parseArgValue('--epsilon', '0.01')) ?? 0.01);

  console.log(`[reconcile] dryRun=${dryRun} limit=${limit} epsilon=${epsilon}`);

  const candidates = await Invoice.findAll({
    where: {
      payment_method: 'cod',
      payment_status: 'paid',
      shipment_status: { [Op.not]: 'canceled' },
    },
    attributes: ['id', 'invoice_number', 'amount_received', 'payment_status', 'payment_method', 'verified_at', 'verified_by'],
    order: [['updatedAt', 'DESC']],
    limit,
  });

  if (candidates.length === 0) {
    console.log('[reconcile] no candidates found.');
    return;
  }

  const invoiceIds = candidates.map((inv: any) => String(inv.id)).filter(Boolean);
  const netTotals = await computeInvoiceNetTotalsBulk(invoiceIds);

  const toReopen: Array<{ id: string; invoice_number: string; expected: number; received: number; outstanding: number }> = [];
  for (const inv of candidates as any[]) {
    const id = String(inv.id);
    const expected = Math.max(0, round2(netTotals.get(id)?.net_total));
    const received = Math.max(0, round2(inv.amount_received));
    const outstanding = round2(expected - received);
    if (expected > 0 && outstanding > epsilon) {
      toReopen.push({ id, invoice_number: String(inv.invoice_number || ''), expected, received, outstanding });
    }
  }

  console.log(`[reconcile] paid invoices with outstanding > epsilon: ${toReopen.length}/${candidates.length}`);
  toReopen.slice(0, 20).forEach((r) => {
    console.log(`- ${r.invoice_number || r.id}: expected=${r.expected} received=${r.received} outstanding=${r.outstanding}`);
  });
  if (dryRun || toReopen.length === 0) return;

  const t = await sequelize.transaction();
  try {
    for (const row of toReopen) {
      await Invoice.update(
        { payment_status: 'cod_pending' },
        { where: { id: row.id }, transaction: t }
      );
    }
    await t.commit();
    console.log(`[reconcile] updated ${toReopen.length} invoices to cod_pending.`);
  } catch (err) {
    try { await t.rollback(); } catch { }
    throw err;
  }
}

main().catch((err) => {
  console.error('[reconcile] failed:', err);
  process.exit(1);
});

