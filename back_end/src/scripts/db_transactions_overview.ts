import { Op, col, fn, literal } from 'sequelize';
import fs from 'fs/promises';
import path from 'path';

import {
  sequelize,
  CodCollection,
  CodSettlement,
  CustomerBalanceEntry,
  Expense,
  Invoice,
  Journal,
  JournalLine,
  Order,
  PosSale,
  SupplierPayment,
} from '../models';

type Args = {
  limit: number;
  out: string | null;
};

const parseArgs = (): Args => {
  const args = process.argv.slice(2);
  const outArg = args.find((item) => item.startsWith('--out='));
  const limitArg = args.find((item) => item.startsWith('--limit='));

  const limitRaw = limitArg ? Number(limitArg.slice('--limit='.length)) : 25;
  const limit = Number.isFinite(limitRaw) && limitRaw >= 0 ? Math.floor(limitRaw) : 25;

  const out = outArg ? outArg.slice('--out='.length).trim() : null;

  return { limit, out: out || null };
};

const safeString = (value: unknown): string => String(value ?? '');

const formatMoney = (value: unknown): number => {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(2));
};

const toIso = (value: unknown): string | null => {
  const d = value instanceof Date ? value : value ? new Date(String(value)) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toISOString();
};

const modelStats = async (model: any) => {
  const rows = await model.findAll({
    attributes: [
      [fn('COUNT', literal('*')), 'count'],
      [fn('MIN', col('createdAt')), 'min_created_at'],
      [fn('MAX', col('createdAt')), 'max_created_at'],
    ],
    raw: true,
  });
  const row = rows?.[0] || {};
  return {
    count: Number(row.count || 0),
    min_created_at: toIso(row.min_created_at),
    max_created_at: toIso(row.max_created_at),
  };
};

const sumColumn = async (model: any, field: string) => {
  const rows = await model.findAll({
    attributes: [[fn('SUM', col(field)), 'sum']],
    raw: true,
  });
  return formatMoney(rows?.[0]?.sum);
};

const groupCount = async (model: any, field: string) => {
  const rows = await model.findAll({
    attributes: [[col(field), field], [fn('COUNT', literal('*')), 'count']],
    group: [col(field)],
    raw: true,
  });
  const out: Record<string, number> = {};
  for (const row of rows) {
    out[safeString(row[field])] = Number(row.count || 0);
  }
  return out;
};

const main = async () => {
  const { limit, out } = parseArgs();
  const dbName = safeString(process.env.DB_NAME || 'migunani_motor_db');
  const dbHost = safeString(process.env.DB_HOST || 'localhost');

  await sequelize.authenticate();

  const summary = {
    orders: {
      ...(await modelStats(Order)),
      sum_total_amount: await sumColumn(Order, 'total_amount'),
      by_status: await groupCount(Order, 'status'),
    },
    invoices: {
      ...(await modelStats(Invoice)),
      sum_total: await sumColumn(Invoice, 'total'),
      sum_amount_paid: await sumColumn(Invoice, 'amount_paid'),
      by_payment_status: await groupCount(Invoice, 'payment_status'),
    },
    pos_sales: {
      ...(await modelStats(PosSale)),
      sum_total: await sumColumn(PosSale, 'total'),
      by_status: await groupCount(PosSale, 'status'),
    },
    expenses: {
      ...(await modelStats(Expense)),
      sum_amount: await sumColumn(Expense, 'amount'),
      by_status: await groupCount(Expense, 'status'),
    },
    journals: {
      ...(await modelStats(Journal)),
      by_reference_type: await groupCount(Journal, 'reference_type'),
    },
    journal_lines: {
      ...(await modelStats(JournalLine)),
      sum_debit: await sumColumn(JournalLine, 'debit'),
      sum_credit: await sumColumn(JournalLine, 'credit'),
    },
    customer_balance_entries: {
      ...(await modelStats(CustomerBalanceEntry)),
      sum_amount: await sumColumn(CustomerBalanceEntry, 'amount'),
      by_entry_type: await groupCount(CustomerBalanceEntry, 'entry_type'),
    },
    supplier_payments: {
      ...(await modelStats(SupplierPayment)),
      sum_amount: await sumColumn(SupplierPayment, 'amount'),
    },
    cod_settlements: {
      ...(await modelStats(CodSettlement)),
      sum_total_amount: await sumColumn(CodSettlement, 'total_amount'),
      sum_diff_amount: await sumColumn(CodSettlement, 'diff_amount'),
    },
    cod_collections: {
      ...(await modelStats(CodCollection)),
      sum_amount: await sumColumn(CodCollection, 'amount'),
      by_status: await groupCount(CodCollection, 'status'),
    },
  };

  const samples = limit === 0 ? {} : {
    orders: await Order.findAll({
      limit,
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'source', 'status', 'payment_method', 'total_amount', 'discount_amount', 'createdAt', 'updatedAt'],
      raw: true,
    }),
    invoices: await Invoice.findAll({
      limit,
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'invoice_number', 'sales_channel', 'payment_method', 'payment_status', 'subtotal', 'tax_amount', 'total', 'amount_paid', 'amount_received', 'verified_at', 'createdAt'],
      raw: true,
    }),
    pos_sales: await PosSale.findAll({
      limit,
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'receipt_no', 'receipt_number', 'status', 'subtotal', 'tax_amount', 'total', 'amount_received', 'change_amount', 'paid_at', 'createdAt'],
      raw: true,
    }),
    expenses: await Expense.findAll({
      limit,
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'category', 'amount', 'date', 'status', 'approved_at', 'paid_at', 'createdAt'],
      raw: true,
    }),
    journals: await Journal.findAll({
      limit,
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'date', 'reference_type', 'reference_id', 'posted_at', 'createdAt'],
      raw: true,
    }),
    journal_lines: await JournalLine.findAll({
      limit,
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'journal_id', 'account_id', 'debit', 'credit', 'createdAt'],
      raw: true,
    }),
    customer_balance_entries: await CustomerBalanceEntry.findAll({
      limit,
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'customer_id', 'amount', 'entry_type', 'reference_type', 'reference_id', 'createdAt'],
      raw: true,
    }),
    supplier_payments: await SupplierPayment.findAll({
      limit,
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'supplier_invoice_id', 'amount', 'account_id', 'paid_at', 'createdAt'],
      raw: true,
    }),
    cod_settlements: await CodSettlement.findAll({
      limit,
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'driver_id', 'total_amount', 'total_expected', 'diff_amount', 'settled_at', 'createdAt'],
      raw: true,
    }),
    cod_collections: await CodCollection.findAll({
      limit,
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'invoice_id', 'driver_id', 'amount', 'status', 'createdAt'],
      raw: true,
    }),
  };

  const report = {
    generated_at: new Date().toISOString(),
    db: { host: dbHost, name: dbName },
    summary,
    sample_limit_per_table: limit,
    samples,
  };

  if (out) {
    const absoluteOut = path.resolve(process.cwd(), out);
    await fs.mkdir(path.dirname(absoluteOut), { recursive: true });
    await fs.writeFile(absoluteOut, JSON.stringify(report, null, 2), 'utf8');
    console.log(`[report] wrote ${absoluteOut}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  await sequelize.close();
};

main().catch(async (error) => {
  console.error('[db_transactions_overview] failed:', error);
  try {
    await sequelize.close();
  } catch {
    // ignore
  }
  process.exit(1);
});

