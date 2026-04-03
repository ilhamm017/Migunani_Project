export type InvoiceRef = {
  id: string;
  invoice_number?: string | null;
  payment_status?: string | null;
  payment_method?: string | null;
  payment_proof_url?: string | null;
  shipment_status?: string | null;
  total?: number | null;
  collectible_total?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  courier_id?: string | null;
  [key: string]: unknown;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const normalizeId = (value: unknown): string => String(value || '').trim();
const normalizeNumKey = (value: unknown): string => String(value || '').trim().toLowerCase();

export const collectInvoiceRefs = (orderLike: unknown, detailLike?: unknown): InvoiceRef[] => {
  const orderRow = asRecord(orderLike);
  const detailRow = asRecord(detailLike);

  const rawList: unknown[] = [];
  if (Array.isArray(detailRow.Invoices)) rawList.push(...(detailRow.Invoices as unknown[]));
  if (Array.isArray(orderRow.Invoices)) rawList.push(...(orderRow.Invoices as unknown[]));

  const invoiceA = detailRow.Invoice;
  const invoiceB = orderRow.Invoice;
  if (invoiceA && typeof invoiceA === 'object') rawList.push(invoiceA);
  if (invoiceB && typeof invoiceB === 'object') rawList.push(invoiceB);

  const byKey = new Map<string, InvoiceRef>();
  rawList.forEach((row) => {
    const r = asRecord(row);
    const id = normalizeId(r.id);
    const num = normalizeId(r.invoice_number);
    const key = id ? `id:${id}` : num ? `num:${normalizeNumKey(num)}` : '';
    if (!key) return;
    if (byKey.has(key)) return;
    byKey.set(key, { ...(r as any), id, invoice_number: num || null });
  });

  const fallbackId = normalizeId(detailRow.invoice_id || orderRow.invoice_id);
  const fallbackNum = normalizeId(detailRow.invoice_number || orderRow.invoice_number);
  if (fallbackId || fallbackNum) {
    const key = fallbackId ? `id:${fallbackId}` : `num:${normalizeNumKey(fallbackNum)}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        id: fallbackId,
        invoice_number: fallbackNum || null,
      });
    }
  }

  const list = Array.from(byKey.values()).filter((inv) => Boolean(normalizeId(inv.id)));
  list.sort((a, b) => {
    const bTs = Date.parse(String(b.createdAt || b.updatedAt || ''));
    const aTs = Date.parse(String(a.createdAt || a.updatedAt || ''));
    const bVal = Number.isFinite(bTs) ? bTs : 0;
    const aVal = Number.isFinite(aTs) ? aTs : 0;
    return bVal - aVal;
  });
  return list;
};

export const extractInvoicesFromOrder = (orderLike: unknown): InvoiceRef[] => collectInvoiceRefs(orderLike);

