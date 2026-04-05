import { Op, QueryTypes } from 'sequelize';

import {
  sequelize,
  CodSettlement,
  Invoice,
} from '../models';

import { computeInvoiceNetTotalsBulk } from '../utils/invoiceNetTotals';
import { resolveSingleCustomerIdForInvoice } from '../utils/codCustomerDelta';
import { CustomerBalanceService } from '../services/CustomerBalanceService';

type Args = {
  apply: boolean;
  limit: number;
  settlementId: number | null;
};

const round2 = (value: unknown) => Math.round(Number(value || 0) * 100) / 100;

const parseArgs = (): Args => {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const settlementArg = args.find((a) => a.startsWith('--settlement-id='));
  const limitRaw = limitArg ? Number(limitArg.slice('--limit='.length)) : 200;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 200;
  const settlementIdRaw = settlementArg ? Number(settlementArg.slice('--settlement-id='.length)) : NaN;
  const settlementId = Number.isFinite(settlementIdRaw) && settlementIdRaw > 0 ? Math.floor(settlementIdRaw) : null;
  return { apply, limit, settlementId };
};

const allocateProRata = (total: number, weightsByKey: Map<string, number>) => {
  const keys = Array.from(weightsByKey.entries())
    .map(([key, weight]) => ({ key: String(key).trim(), weight: Math.max(0, round2(weight)) }))
    .filter((row) => row.key && row.weight > 0)
    .sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      return a.key.localeCompare(b.key);
    });

  const out = new Map<string, number>();
  const normalized = round2(total);
  if (!Number.isFinite(normalized) || normalized === 0 || keys.length === 0) return out;

  const totalWeight = round2(keys.reduce((sum, row) => sum + row.weight, 0));
  if (totalWeight <= 0) return out;

  let allocated = 0;
  for (const row of keys) {
    const raw = normalized * (row.weight / totalWeight);
    const amt = round2(raw);
    out.set(row.key, amt);
    allocated = round2(allocated + amt);
  }

  // Distribute rounding remainder deterministically
  let remainder = round2(normalized - allocated);
  const step = remainder > 0 ? 0.01 : -0.01;
  let guard = 0;
  while (remainder !== 0 && guard < 10000) {
    for (const row of keys) {
      if (remainder === 0) break;
      out.set(row.key, round2((out.get(row.key) || 0) + step));
      remainder = round2(remainder - step);
      guard += 1;
      if (remainder === 0 || guard >= 10000) break;
    }
  }

  // Drop zeros
  Array.from(out.entries()).forEach(([k, v]) => {
    if (round2(v) === 0) out.delete(k);
    else out.set(k, round2(v));
  });
  return out;
};

const safeParseInvoiceIds = (value: unknown): string[] => {
  if (!value) return [];
  const raw = String(value);
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return Array.from(new Set(parsed.map((v) => String(v || '').trim()).filter(Boolean)));
  } catch {
    return [];
  }
};

const main = async () => {
  const { apply, limit, settlementId } = parseArgs();

  await sequelize.authenticate();

  const settlementFilter = settlementId ? ' AND reference_id = :settlementId' : '';
  const legacyGroups = await sequelize.query(
    `SELECT reference_id AS settlement_id, customer_id, SUM(amount) AS amount
     FROM customer_balance_entries
     WHERE entry_type = 'cod_settlement_delta'
       AND reference_type = 'cod_settlement'
       ${settlementFilter}
     GROUP BY reference_id, customer_id
     HAVING SUM(amount) <> 0
     ORDER BY reference_id ASC
     LIMIT :limit`,
    {
      type: QueryTypes.SELECT,
      replacements: { limit, settlementId: settlementId || null },
    }
  ) as Array<{ settlement_id: string; customer_id: string; amount: number }>;

  const settlementIds = Array.from(new Set(
    legacyGroups.map((r) => Number(r.settlement_id)).filter((n) => Number.isFinite(n) && n > 0)
  ));

  console.log(`[reconcile] mode=${apply ? 'apply' : 'dry-run'} settlements=${settlementIds.length} groups=${legacyGroups.length}`);

  let createdInvoiceDelta = 0;
  let createdReversals = 0;
  let skipped = 0;

  for (const sid of settlementIds) {
    const settlement = await CodSettlement.findByPk(sid) as any;
    if (!settlement) {
      console.warn(`[reconcile] skip settlement ${sid}: not found`);
      skipped += 1;
      continue;
    }

    const invoiceIds = safeParseInvoiceIds(settlement.invoice_ids_json);
    if (invoiceIds.length === 0) {
      console.warn(`[reconcile] skip settlement ${sid}: invoice_ids_json empty`);
      skipped += 1;
      continue;
    }

    const netTotals = await computeInvoiceNetTotalsBulk(invoiceIds);
    const invoiceById = new Map<string, any>();
    const invoices = await Invoice.findAll({
      where: { id: { [Op.in]: invoiceIds } },
      attributes: ['id', 'payment_method', 'amount_paid'],
    }) as any[];
    invoices.forEach((inv) => invoiceById.set(String(inv.id), inv));

    const invoiceCustomerId = new Map<string, string>();
    for (const invId of invoiceIds) {
      try {
        const customerId = await resolveSingleCustomerIdForInvoice(invId);
        invoiceCustomerId.set(invId, customerId);
      } catch (e) {
        console.warn(`[reconcile] settlement ${sid} invoice ${invId}: cannot resolve customer, skip invoice delta allocation`);
      }
    }

    const legacyByCustomerId = legacyGroups
      .filter((g) => Number(g.settlement_id) === sid)
      .map((g) => ({ customerId: String(g.customer_id || '').trim(), amount: round2(g.amount) }))
      .filter((g) => g.customerId && g.amount !== 0);

    if (legacyByCustomerId.length === 0) continue;

    const t = apply ? await sequelize.transaction() : null;
    try {
      for (const legacy of legacyByCustomerId) {
        const customerId = legacy.customerId;
        const amount = legacy.amount;

        // Only allocate to invoices belonging to this customer
        const customerInvoiceIds = invoiceIds.filter((invId) => invoiceCustomerId.get(invId) === customerId);
        if (customerInvoiceIds.length === 0) continue;

        const weightsByInvoiceId = new Map<string, number>();
        for (const invId of customerInvoiceIds) {
          const expectedNet = Math.max(0, round2(netTotals.get(invId)?.net_total || 0));
          weightsByInvoiceId.set(invId, expectedNet > 0 ? expectedNet : 1);
        }
        const allocations = allocateProRata(amount, weightsByInvoiceId);

        for (const [invId, alloc] of allocations.entries()) {
          if (!alloc) continue;
          const inv = invoiceById.get(invId);
          const method = String(inv?.payment_method || '').trim().toLowerCase();
          if (method !== 'cod') continue;

          const idempotencyKey = `balance_cod_invoice_delta_legacy_${sid}_${invId}`;
          if (!apply) {
            console.log(`[dry-run] create cod_invoice_delta invoice=${invId} customer=${customerId} amount=${alloc} key=${idempotencyKey}`);
            continue;
          }

          try {
            await CustomerBalanceService.createEntry({
              customer_id: customerId,
              amount: alloc,
              entry_type: 'cod_invoice_delta',
              reference_type: 'invoice',
              reference_id: invId,
              created_by: String(settlement.received_by || '') || null,
              note: `Legacy migrate from cod_settlement_delta #${sid}: amount=${alloc}.`,
              idempotency_key: idempotencyKey,
            }, { transaction: t || undefined });
            createdInvoiceDelta += 1;
          } catch (error: any) {
            const name = String(error?.name || '');
            const msg = String(error?.message || '');
            const sqlMsg = String(error?.original?.sqlMessage || error?.parent?.sqlMessage || '');
            const isUnique = name.includes('Unique') || /duplicate/i.test(msg) || /duplicate/i.test(sqlMsg);
            if (!isUnique) throw error;
          }
        }

        const reverseKey = `balance_cod_settlement_delta_reverse_${sid}_${customerId}`;
        if (!apply) {
          console.log(`[dry-run] reverse cod_settlement_delta settlement=${sid} customer=${customerId} amount=${-amount} key=${reverseKey}`);
          continue;
        }
        try {
          await CustomerBalanceService.createEntry({
            customer_id: customerId,
            amount: round2(-amount),
            entry_type: 'cod_settlement_delta',
            reference_type: 'cod_settlement',
            reference_id: String(sid),
            created_by: String(settlement.received_by || '') || null,
            note: `Legacy reversal cod_settlement_delta #${sid}.`,
            idempotency_key: reverseKey,
          }, { transaction: t || undefined });
          createdReversals += 1;
        } catch (error: any) {
          const name = String(error?.name || '');
          const msg = String(error?.message || '');
          const sqlMsg = String(error?.original?.sqlMessage || error?.parent?.sqlMessage || '');
          const isUnique = name.includes('Unique') || /duplicate/i.test(msg) || /duplicate/i.test(sqlMsg);
          if (!isUnique) throw error;
        }
      }

      if (t) await t.commit();
    } catch (error) {
      if (t) {
        try { await t.rollback(); } catch { }
      }
      throw error;
    }
  }

  console.log(`[reconcile] done created_invoice_delta=${createdInvoiceDelta} created_reversals=${createdReversals} skipped=${skipped}`);
};

main().catch((err) => {
  console.error('[reconcile] failed:', err);
  process.exitCode = 1;
});
