import 'dotenv/config';
import { Op } from 'sequelize';
import { Account, Invoice, Journal, JournalLine, sequelize } from '../models';
import { JournalService } from '../services/JournalService';

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out: Record<string, string> = {};
  for (const raw of args) {
    const trimmed = String(raw || '').trim();
    if (!trimmed.startsWith('--')) continue;
    const [k, ...rest] = trimmed.slice(2).split('=');
    out[String(k || '').trim()] = rest.join('=').trim();
  }
  return out;
};

const toBool = (raw: unknown): boolean => {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'y';
};

const round2 = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

async function main() {
  const args = parseArgs();
  const dryRun = toBool(args['dry_run']);
  const allowAdjustment = toBool(args['allow_adjustment']);
  const onlyInvoiceId = String(args['invoice_id'] || '').trim();

  await sequelize.authenticate();

  const revenueAcc = await Account.findOne({ where: { code: '4100' } });
  if (!revenueAcc) throw new Error('Akun 4100 (Penjualan) tidak ditemukan.');

  const deferredAcc = await Account.findOne({ where: { code: '2300' } });
  if (!deferredAcc) throw new Error('Akun 2300 (Pendapatan Ditangguhkan) tidak ditemukan.');

  const journals = await Journal.findAll({
    where: {
      reference_type: 'payment_verify',
      ...(onlyInvoiceId ? { reference_id: onlyInvoiceId } : {}),
    } as any,
    include: [
      {
        model: JournalLine,
        as: 'Lines',
        required: true,
        where: {
          account_id: revenueAcc.id,
          credit: { [Op.gt]: 0 },
        },
      },
    ],
    order: [['date', 'ASC'], ['id', 'ASC']],
  }) as any[];

  const byInvoiceId = new Map<string, { invoiceId: string; createdBy: string; date: Date; amount: number; journalIds: number[] }>();
  for (const journal of journals) {
    const invoiceId = String(journal?.reference_id || '').trim();
    if (!invoiceId) continue;

    const lines = Array.isArray(journal?.Lines) ? journal.Lines : [];
    const amount = round2(
      lines.reduce((sum: number, line: any) => sum + Math.max(0, Number(line?.credit || 0)), 0)
    );
    if (amount <= 0) continue;

    const prev = byInvoiceId.get(invoiceId);
    byInvoiceId.set(invoiceId, {
      invoiceId,
      createdBy: String(prev?.createdBy || journal?.created_by || '').trim() || String(journal?.created_by || '').trim(),
      date: prev?.date || (journal?.date ? new Date(journal.date) : new Date()),
      amount: round2((prev?.amount || 0) + amount),
      journalIds: [...(prev?.journalIds || []), Number(journal?.id)].filter((id) => Number.isFinite(id)),
    });
  }

  const invoiceIds = Array.from(byInvoiceId.keys());
  const invoiceById = new Map<string, any>();
  if (invoiceIds.length > 0) {
    const invoices = await Invoice.findAll({
      where: { id: { [Op.in]: invoiceIds } },
      attributes: ['id', 'invoice_number'],
    }) as any[];
    invoices.forEach((row: any) => invoiceById.set(String(row?.id || '').trim(), row));
  }

  let skippedExisting = 0;
  let created = 0;

  console.log('[reconcile_payment_verify_to_deferred] candidates:', byInvoiceId.size);
  console.log('[reconcile_payment_verify_to_deferred] dry_run:', dryRun ? 1 : 0);
  console.log('[reconcile_payment_verify_to_deferred] allow_adjustment:', allowAdjustment ? 1 : 0);

  for (const candidate of byInvoiceId.values()) {
    const idempotencyKey = `payment_verify_reclass_${candidate.invoiceId}`;
    const existing = await Journal.findOne({ where: { idempotency_key: idempotencyKey } });
    if (existing) {
      skippedExisting += 1;
      continue;
    }

    const invoice = invoiceById.get(candidate.invoiceId);
    const invoiceLabel = invoice ? String(invoice?.invoice_number || invoice?.id || candidate.invoiceId) : candidate.invoiceId;

    const input = {
      date: candidate.date,
      description: `Reclass payment_verify -> deferred revenue (Invoice ${invoiceLabel})`,
      reference_type: 'payment_verify_reclass',
      reference_id: candidate.invoiceId,
      created_by: candidate.createdBy,
      idempotency_key: idempotencyKey,
      lines: [
        { account_id: revenueAcc.id, debit: candidate.amount, credit: 0 },
        { account_id: deferredAcc.id, debit: 0, credit: candidate.amount },
      ],
    };

    if (dryRun) {
      console.log('[dry_run] would_reclass:', {
        invoice_id: candidate.invoiceId,
        invoice: invoiceLabel,
        amount: candidate.amount,
        journal_ids: candidate.journalIds,
        idempotency_key: idempotencyKey,
      });
      continue;
    }

    const t = await sequelize.transaction();
    try {
      const existingInsideTx = await Journal.findOne({
        where: { idempotency_key: idempotencyKey },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (existingInsideTx) {
        skippedExisting += 1;
        await t.rollback();
        continue;
      }

      try {
        await JournalService.createEntry(input as any, t);
      } catch (error: any) {
        const message = String(error?.message || error || '').trim();
        const isPeriodLockError = message.toLowerCase().includes('periode akuntansi') && message.toLowerCase().includes('ditutup');
        if (!allowAdjustment || !isPeriodLockError) throw error;
        await JournalService.createAdjustmentEntry(input as any, t);
      }

      await t.commit();
      created += 1;
    } catch (error) {
      try {
        await t.rollback();
      } catch {}
      throw error;
    }
  }

  console.log('[reconcile_payment_verify_to_deferred] created:', created);
  console.log('[reconcile_payment_verify_to_deferred] skipped_existing:', skippedExisting);
}

main().catch((err) => {
  console.error('[reconcile_payment_verify_to_deferred] fatal:', err instanceof Error ? err.stack || err.message : err);
  process.exitCode = 1;
});

