'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, AlertTriangle, CheckCircle2, ClipboardCheck, Camera, Send } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';

type QuickState = 'match' | 'short' | 'missing';

type ChecklistRow = {
  key: string;
  productName: string;
  expectedQty: number;
  actualQty: number;
  note: string;
  quickState: QuickState;
  orderIds: string[];
};

type SavedChecklist = {
  scopeId: string;
  invoiceId?: string | null;
  orderIds: string[];
  savedAt: string;
  rows: ChecklistRow[];
};

const normalizeInvoiceRef = (raw: unknown) => String(raw || '').trim();
const isOrderDoneStatus = (raw: unknown) =>
  ['delivered', 'completed', 'cancelled', 'canceled'].includes(String(raw || '').toLowerCase());
const checklistScopeStorageKey = (scopeId: string) => `driver-checklist-scope-${scopeId}`;
const getInvoiceItems = (invoiceData: any) => {
  if (Array.isArray(invoiceData?.InvoiceItems)) return invoiceData.InvoiceItems;
  if (Array.isArray(invoiceData?.Items)) return invoiceData.Items;
  return [];
};

const normalizeQuickState = (expectedQty: number, actualQty: number): QuickState => {
  if (actualQty === expectedQty) return 'match';
  if (actualQty <= 0) return 'missing';
  return 'short';
};

const buildBaseRowsFromOrders = (orders: any[]): ChecklistRow[] => {
  const productMap = new Map<string, { key: string; productName: string; expectedQty: number; orderIds: Set<string> }>();
  orders.forEach((order: any) => {
    const currentOrderId = String(order?.id || '').trim();
    const items = Array.isArray(order?.OrderItems) ? order.OrderItems : [];
    items.forEach((item: any) => {
      const key = String(item?.product_id || item?.Product?.sku || item?.Product?.name || item?.id || '').trim();
      if (!key) return;
      const entry = productMap.get(key) || {
        key,
        productName: item?.Product?.name || 'Produk',
        expectedQty: 0,
        orderIds: new Set<string>(),
      };
      entry.expectedQty += Number(item?.qty || 0);
      if (currentOrderId) entry.orderIds.add(currentOrderId);
      productMap.set(key, entry);
    });
  });

  return Array.from(productMap.values())
    .map((entry) => ({
      key: entry.key,
      productName: entry.productName,
      expectedQty: entry.expectedQty,
      actualQty: entry.expectedQty,
      note: '',
      quickState: 'match' as QuickState,
      orderIds: Array.from(entry.orderIds),
    }))
    .sort((a, b) => b.expectedQty - a.expectedQty);
};

const buildBaseRowsFromInvoice = (invoiceData: any): ChecklistRow[] => {
  const invoiceItems = getInvoiceItems(invoiceData);
  const productMap = new Map<string, { key: string; productName: string; expectedQty: number; orderIds: Set<string> }>();
  invoiceItems.forEach((item: any) => {
    const orderItem = item?.OrderItem || {};
    const product = orderItem?.Product || {};
    const key = String(orderItem?.product_id || product?.sku || product?.name || item?.id || '').trim();
    if (!key) return;
    const entry = productMap.get(key) || {
      key,
      productName: product?.name || 'Produk',
      expectedQty: 0,
      orderIds: new Set<string>(),
    };
    entry.expectedQty += Number(item?.qty || item?.allocated_qty || 0);
    const currentOrderId = String(orderItem?.order_id || item?.order_id || '').trim();
    if (currentOrderId) entry.orderIds.add(currentOrderId);
    productMap.set(key, entry);
  });
  return Array.from(productMap.values())
    .map((entry) => ({
      key: entry.key,
      productName: entry.productName,
      expectedQty: entry.expectedQty,
      actualQty: entry.expectedQty,
      note: '',
      quickState: 'match' as QuickState,
      orderIds: Array.from(entry.orderIds),
    }))
    .sort((a, b) => b.expectedQty - a.expectedQty);
};

const hydrateRowsFromSaved = (baseRows: ChecklistRow[], savedRows: any[]): ChecklistRow[] => {
  const byKey = new Map<string, any>();
  const byName = new Map<string, any>();
  savedRows.forEach((row: any) => {
    const key = String(row?.key || '').trim();
    const name = String(row?.productName || '').trim().toLowerCase();
    if (key) byKey.set(key, row);
    if (name) byName.set(name, row);
  });

  return baseRows.map((row) => {
    const saved = byKey.get(row.key) || byName.get(String(row.productName || '').trim().toLowerCase());
    const actualQty = saved ? Number(saved?.actualQty || 0) : row.expectedQty;
    return {
      ...row,
      actualQty,
      note: saved ? String(saved?.note || '') : '',
      quickState: normalizeQuickState(row.expectedQty, actualQty),
    };
  });
};

export default function DriverOrderChecklistPage() {
  const allowed = useRequireRoles(['driver', 'super_admin', 'admin_gudang']);
  const params = useParams();
  const router = useRouter();
  const routeRef = String(params?.id || '');

  const [primaryOrder, setPrimaryOrder] = useState<any>(null);
  const [scopedOrders, setScopedOrders] = useState<any[]>([]);
  const [scopeId, setScopeId] = useState('');
  const [resolvedInvoiceId, setResolvedInvoiceId] = useState('');
  const [invoiceDetail, setInvoiceDetail] = useState<any>(null);
  const [rows, setRows] = useState<ChecklistRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [isChecklistDirty, setIsChecklistDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [reportNote, setReportNote] = useState('');
  const [reportPhoto, setReportPhoto] = useState<File | null>(null);
  const [submittingReport, setSubmittingReport] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const res = await api.driver.getOrders();
        const allRows = Array.isArray(res.data) ? res.data : [];

        const selectedByOrderId = allRows.find((x: any) => String(x?.id || '') === routeRef) || null;
        let invoiceScopedRows: any[] = [];
        let invoiceId = '';

        if (selectedByOrderId) {
          invoiceId = normalizeInvoiceRef(selectedByOrderId?.invoice_id || selectedByOrderId?.Invoice?.id);
          if (invoiceId) {
            invoiceScopedRows = allRows.filter((row: any) =>
              normalizeInvoiceRef(row?.invoice_id || row?.Invoice?.id) === invoiceId
            );
          } else {
            invoiceScopedRows = [selectedByOrderId];
          }
        } else {
          const matchedByInvoice = allRows.filter((row: any) =>
            normalizeInvoiceRef(row?.invoice_id || row?.Invoice?.id) === routeRef
          );
          if (matchedByInvoice.length > 0) {
            invoiceScopedRows = matchedByInvoice;
            invoiceId = routeRef;
          }
        }

        const sortedScopedRows = [...invoiceScopedRows].sort((a: any, b: any) => {
          const bTs = Date.parse(String(b?.updatedAt || b?.createdAt || ''));
          const aTs = Date.parse(String(a?.updatedAt || a?.createdAt || ''));
          const bVal = Number.isFinite(bTs) ? bTs : 0;
          const aVal = Number.isFinite(aTs) ? aTs : 0;
          return bVal - aVal;
        });

        const selected =
          sortedScopedRows.find((x: any) => !isOrderDoneStatus(x?.status))
          || sortedScopedRows[0]
          || null;
        const resolvedScope = (invoiceId || String(selected?.id || '').trim() || routeRef).trim();

        let invoiceSnapshot: any = null;
        if (invoiceId) {
          try {
            const invoiceRes = await api.invoices.getById(invoiceId);
            invoiceSnapshot = invoiceRes.data || null;
          } catch (error) {
            console.error('Load invoice snapshot for checklist failed:', error);
          }
        }
        const baseRowsFromInvoice = buildBaseRowsFromInvoice(invoiceSnapshot);
        const baseRows = baseRowsFromInvoice.length > 0
          ? baseRowsFromInvoice
          : buildBaseRowsFromOrders(sortedScopedRows);
        let hydratedRows = baseRows;
        if (typeof window !== 'undefined' && resolvedScope) {
          const raw = sessionStorage.getItem(checklistScopeStorageKey(resolvedScope));
          if (raw) {
            const parsed = JSON.parse(raw) as SavedChecklist;
            const savedRows = Array.isArray(parsed?.rows) ? parsed.rows : [];
            hydratedRows = hydrateRowsFromSaved(baseRows, savedRows);
            if (parsed?.savedAt) setSavedAt(parsed.savedAt);
            setIsChecklistDirty(false);
          } else {
            setSavedAt(null);
            setIsChecklistDirty(false);
          }
        }

        setPrimaryOrder(selected);
        setScopedOrders(sortedScopedRows);
        setScopeId(resolvedScope);
        setResolvedInvoiceId(invoiceId);
        setInvoiceDetail(invoiceSnapshot);
        setRows(hydratedRows);
      } catch (error) {
        console.error('Load checklist page failed:', error);
        setInvoiceDetail(null);
      } finally {
        setLoading(false);
      }
    };

    if (allowed && routeRef) {
      void load();
    }
  }, [allowed, routeRef]);

  const mismatchRows = useMemo(
    () => rows.filter((row) => row.actualQty !== row.expectedQty),
    [rows]
  );
  const isAllMatched = rows.length > 0 && mismatchRows.length === 0;
  const orderIds = useMemo(
    () => scopedOrders.map((row: any) => String(row?.id || '').trim()).filter(Boolean),
    [scopedOrders]
  );
  const activeOrderIds = useMemo(() => {
    const ids = scopedOrders
      .filter((row: any) => !isOrderDoneStatus(row?.status))
      .map((row: any) => String(row?.id || '').trim())
      .filter(Boolean);
    return ids.length > 0 ? ids : orderIds;
  }, [orderIds, scopedOrders]);

  if (!allowed) return null;

  const markChecklistDirty = () => {
    setIsChecklistDirty(true);
    if (savedAt) {
      setMessage('Perubahan checklist belum disimpan. Klik Simpan lagi.');
    }
  };

  const updateRow = (key: string, patch: Partial<ChecklistRow>) => {
    markChecklistDirty();
    setRows((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        const next = { ...row, ...patch };
        next.quickState = normalizeQuickState(next.expectedQty, next.actualQty);
        return next;
      })
    );
  };

  const applyQuickState = (key: string, nextState: QuickState) => {
    markChecklistDirty();
    setRows((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        let actualQty = row.actualQty;
        if (nextState === 'match') actualQty = row.expectedQty;
        if (nextState === 'missing') actualQty = 0;
        if (nextState === 'short' && actualQty >= row.expectedQty) {
          actualQty = Math.max(0, row.expectedQty - 1);
        }
        return { ...row, quickState: nextState, actualQty };
      })
    );
  };

  const saveChecklist = () => {
    if (!scopeId) return;
    try {
      const payload: SavedChecklist = {
        scopeId,
        invoiceId: resolvedInvoiceId || null,
        orderIds,
        savedAt: new Date().toISOString(),
        rows,
      };
      sessionStorage.setItem(checklistScopeStorageKey(scopeId), JSON.stringify(payload));
      setSavedAt(payload.savedAt);
      setIsChecklistDirty(false);
      setMessage('Checklist invoice berhasil disimpan.');
    } catch (error) {
      console.error('Save checklist failed:', error);
      setMessage('Gagal menyimpan checklist invoice.');
    }
  };

  const submitIssueReport = async () => {
    if (mismatchRows.length === 0) {
      setMessage('Tidak ada selisih untuk dilaporkan.');
      setReportOpen(false);
      return;
    }

    const note = reportNote.trim();
    if (note.length < 5) {
      setMessage('Catatan laporan minimal 5 karakter.');
      return;
    }

    if (activeOrderIds.length === 0) {
      setMessage('Order invoice tidak ditemukan.');
      return;
    }

    const checklistSnapshot = {
      order_id: activeOrderIds[0],
      invoice_id: resolvedInvoiceId || null,
      order_ids: activeOrderIds,
      mismatch_total: mismatchRows.length,
      rows: mismatchRows.map((row) => ({
        order_ids: row.orderIds,
        product_name: row.productName,
        expected_qty: row.expectedQty,
        actual_qty: row.actualQty,
        note: row.note || null,
      })),
    };

    try {
      setSubmittingReport(true);
      const results = await Promise.allSettled(
        activeOrderIds.map((id) => api.driver.reportIssue(id, {
          note,
          checklist_snapshot: JSON.stringify(checklistSnapshot),
          evidence: reportPhoto,
        }))
      );
      const failedIds = results
        .map((result, idx) => (result.status === 'rejected' ? String(activeOrderIds[idx]) : ''))
        .filter(Boolean);
      const successCount = activeOrderIds.length - failedIds.length;
      saveChecklist();

      if (successCount === 0) {
        setMessage('Semua laporan gagal dikirim. Periksa koneksi lalu coba lagi.');
        return;
      }

      if (failedIds.length > 0) {
        setReportOpen(false);
        setMessage(`Sebagian laporan berhasil (${successCount}/${activeOrderIds.length}). ${failedIds.length} order gagal diproses.`);
        return;
      }

      setMessage('Laporan berhasil dikirim. Menunggu follow-up tim gudang.');
      setReportOpen(false);
      setTimeout(() => router.push('/driver'), 900);
    } catch (error) {
      console.error('Submit issue report failed:', error);
      setMessage('Gagal mengirim laporan kekurangan.');
    } finally {
      setSubmittingReport(false);
    }
  };

  const detailRef = encodeURIComponent(scopeId || routeRef);
  const checklistSaved = !!savedAt && !isChecklistDirty;
  const invoiceNumber = normalizeInvoiceRef(invoiceDetail?.invoice_number);
  const headerLabel = resolvedInvoiceId
    ? `Cek Barang Invoice #${(invoiceNumber || resolvedInvoiceId).slice(-8).toUpperCase()}`
    : `Cek Barang Order #${routeRef.slice(-8).toUpperCase()}`;

  return (
    <div className="p-5 space-y-4 pb-40">
      <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
        <ArrowLeft size={16} /> Kembali
      </button>

      <div className="bg-white border border-slate-200 rounded-[28px] p-5 shadow-sm space-y-4">
        <div>
          <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1">Checklist Driver</p>
          <h1 className="text-xl font-black text-slate-900 leading-none">{headerLabel}</h1>
          <p className="text-xs text-slate-500 mt-2">Pastikan barang invoice sudah siap sebelum berangkat.</p>
        </div>

        <div className="bg-slate-50 rounded-2xl border border-slate-100 p-3 text-xs text-slate-600 space-y-1">
          <p><span className="font-bold">Customer:</span> {primaryOrder?.customer_name || primaryOrder?.Customer?.name || '-'}</p>
          <p><span className="font-bold">Jumlah SKU:</span> {rows.length}</p>
          <p><span className="font-bold">Jumlah Order:</span> {orderIds.length}</p>
          {resolvedInvoiceId && <p><span className="font-bold">Invoice ID:</span> {resolvedInvoiceId}</p>}
          <p>
            <span className="font-bold">Status Simpan:</span>{' '}
            {checklistSaved ? 'Sudah disimpan' : 'Belum disimpan'}
          </p>
          {savedAt && <p><span className="font-bold">Terakhir disimpan:</span> {new Date(savedAt).toLocaleString('id-ID')}</p>}
        </div>

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm font-semibold text-slate-500">Memuat data checklist...</div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm font-semibold text-slate-500">Tidak ada item pada invoice ini.</div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              const matched = row.actualQty === row.expectedQty;
              return (
                <div key={row.key} className={`rounded-2xl border p-4 ${matched ? 'border-emerald-200 bg-emerald-50/40' : 'border-rose-200 bg-rose-50/40'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-slate-900">{row.productName}</p>
                      <p className="text-[10px] text-slate-500 mt-1">Order: {row.orderIds.map((id) => `#${id.slice(-6)}`).join(', ')}</p>
                    </div>
                    <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-full ${matched ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                      {matched ? 'Sesuai' : 'Tidak Sesuai'}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => applyQuickState(row.key, 'match')}
                      className={`rounded-xl border px-2 py-2 text-[10px] font-black uppercase ${row.quickState === 'match' ? 'border-emerald-300 bg-emerald-100 text-emerald-700' : 'border-slate-200 bg-white text-slate-600'}`}
                    >
                      Sesuai
                    </button>
                    <button
                      type="button"
                      onClick={() => applyQuickState(row.key, 'short')}
                      className={`rounded-xl border px-2 py-2 text-[10px] font-black uppercase ${row.quickState === 'short' ? 'border-amber-300 bg-amber-100 text-amber-700' : 'border-slate-200 bg-white text-slate-600'}`}
                    >
                      Kurang
                    </button>
                    <button
                      type="button"
                      onClick={() => applyQuickState(row.key, 'missing')}
                      className={`rounded-xl border px-2 py-2 text-[10px] font-black uppercase ${row.quickState === 'missing' ? 'border-rose-300 bg-rose-100 text-rose-700' : 'border-slate-200 bg-white text-slate-600'}`}
                    >
                      Tidak Ada
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="text-xs font-bold text-slate-600">
                      Qty Order
                      <input
                        type="number"
                        value={row.expectedQty}
                        readOnly
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700"
                      />
                    </label>
                    <label className="text-xs font-bold text-slate-600">
                      Qty Dibawa
                      <input
                        type="number"
                        min={0}
                        value={row.actualQty}
                        onChange={(e) => updateRow(row.key, { actualQty: Number(e.target.value || 0) })}
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                      />
                    </label>
                  </div>

                  <label className="block mt-3 text-xs font-bold text-slate-600">
                    Catatan item (opsional)
                    <input
                      type="text"
                      value={row.note}
                      onChange={(e) => updateRow(row.key, { note: e.target.value })}
                      placeholder="Contoh: Dus penyok"
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                    />
                  </label>
                </div>
              );
            })}
          </div>
        )}

        {message && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-700">{message}</div>
        )}
      </div>

      <div className="fixed bottom-24 left-0 right-0 px-4 z-40">
        <div className={`mx-auto max-w-3xl rounded-2xl border p-3 shadow-lg ${isAllMatched ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
          <div className="flex items-start gap-2">
            {isAllMatched ? <CheckCircle2 size={18} className="text-emerald-600 mt-0.5" /> : <AlertTriangle size={18} className="text-amber-600 mt-0.5" />}
            <div className="flex-1">
              <p className={`text-sm font-black ${isAllMatched ? 'text-emerald-700' : 'text-amber-700'}`}>
                {isAllMatched ? 'Semua barang invoice sudah sesuai.' : `Ditemukan ${mismatchRows.length} item tidak sesuai.`}
              </p>
              <p className="text-xs text-slate-600 mt-1">
                Simpan checklist dulu. Jika ada kekurangan, kirim laporan ke gudang.
              </p>
              <p className={`text-[11px] font-black mt-2 ${checklistSaved ? 'text-emerald-700' : 'text-amber-700'}`}>
                {checklistSaved
                  ? `Checklist tersimpan (${new Date(String(savedAt)).toLocaleTimeString('id-ID')}).`
                  : 'Checklist belum disimpan.'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
            <button
              onClick={saveChecklist}
              disabled={rows.length === 0 || checklistSaved}
              className={`w-full py-3 rounded-xl font-black text-[11px] uppercase inline-flex items-center justify-center gap-2 disabled:opacity-70 ${
                checklistSaved
                  ? 'bg-emerald-100 border border-emerald-300 text-emerald-700'
                  : 'bg-emerald-600 text-white'
              }`}
            >
              {checklistSaved ? <CheckCircle2 size={14} /> : <ClipboardCheck size={14} />}
              {checklistSaved ? 'Tersimpan' : 'Simpan'}
            </button>
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              disabled={mismatchRows.length === 0}
              className="w-full py-3 bg-white border-2 border-rose-200 text-rose-700 rounded-xl font-black text-[11px] uppercase disabled:opacity-50"
            >
              Lapor Kekurangan
            </button>
            <Link
              href={`/driver/orders/${detailRef}`}
              className="w-full py-3 bg-slate-900 text-white rounded-xl font-black text-[11px] uppercase text-center"
            >
              Ke Detail Invoice
            </Link>
          </div>
        </div>
      </div>

      {reportOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-5 space-y-4">
            <div>
              <h3 className="text-lg font-black text-slate-900">Laporan Kekurangan Barang</h3>
              <p className="text-xs text-slate-500 mt-1">Catatan wajib. Foto bukti opsional.</p>
            </div>

            <label className="block text-xs font-bold text-slate-600">
              Catatan masalah
              <textarea
                value={reportNote}
                onChange={(e) => setReportNote(e.target.value)}
                placeholder="Contoh: Busi NGK kurang 2 pcs, oli tidak ada."
                rows={4}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
              />
            </label>

            <label className="block text-xs font-bold text-slate-600">
              Foto bukti (opsional)
              <div className="mt-1 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => setReportPhoto(e.target.files?.[0] || null)}
                  className="hidden"
                  id="report-evidence-input"
                />
                <label htmlFor="report-evidence-input" className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                  <Camera size={14} /> {reportPhoto ? reportPhoto.name : 'Ambil / pilih foto'}
                </label>
              </div>
            </label>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setReportOpen(false)}
                disabled={submittingReport}
                className="py-3 rounded-xl border border-slate-300 text-xs font-black uppercase text-slate-700"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={submitIssueReport}
                disabled={submittingReport}
                className="py-3 rounded-xl bg-rose-600 text-white text-xs font-black uppercase inline-flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <Send size={13} /> {submittingReport ? 'Mengirim...' : 'Kirim Laporan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
