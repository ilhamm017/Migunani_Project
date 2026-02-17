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
};

type SavedChecklist = {
  orderId: string;
  savedAt: string;
  rows: ChecklistRow[];
};

const storageKey = (orderId: string) => `driver-checklist-${orderId}`;

const normalizeQuickState = (expectedQty: number, actualQty: number): QuickState => {
  if (actualQty === expectedQty) return 'match';
  if (actualQty <= 0) return 'missing';
  return 'short';
};

export default function DriverOrderChecklistPage() {
  const allowed = useRequireRoles(['driver', 'super_admin', 'admin_gudang']);
  const params = useParams();
  const router = useRouter();
  const orderId = String(params?.id || '');

  const [order, setOrder] = useState<any>(null);
  const [rows, setRows] = useState<ChecklistRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
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
        const data = Array.isArray(res.data) ? res.data : [];
        const selectedOrder = data.find((x: any) => String(x.id) === orderId) || null;
        setOrder(selectedOrder);

        const baseRows: ChecklistRow[] = (selectedOrder?.OrderItems || []).map((item: any, idx: number) => {
          const expectedQty = Number(item?.qty || 0);
          return {
            key: String(item?.id || idx),
            productName: item?.Product?.name || 'Produk',
            expectedQty,
            actualQty: expectedQty,
            note: '',
            quickState: 'match',
          };
        });

        let hydratedRows = baseRows;
        if (typeof window !== 'undefined' && orderId) {
          const raw = sessionStorage.getItem(storageKey(orderId));
          if (raw) {
            const parsed = JSON.parse(raw) as SavedChecklist;
            if (Array.isArray(parsed?.rows) && parsed.rows.length > 0) {
              hydratedRows = parsed.rows.map((row, idx) => {
                const expectedQty = Number(row?.expectedQty || baseRows[idx]?.expectedQty || 0);
                const actualQty = Number(row?.actualQty || 0);
                return {
                  key: String(row?.key || idx),
                  productName: row?.productName || baseRows[idx]?.productName || 'Produk',
                  expectedQty,
                  actualQty,
                  note: String(row?.note || ''),
                  quickState: normalizeQuickState(expectedQty, actualQty),
                };
              });
            }
            if (parsed?.savedAt) setSavedAt(parsed.savedAt);
          }
        }

        setRows(hydratedRows);
      } catch (error) {
        console.error('Load checklist page failed:', error);
      } finally {
        setLoading(false);
      }
    };

    if (allowed && orderId) {
      void load();
    }
  }, [allowed, orderId]);

  const mismatchRows = useMemo(
    () => rows.filter((row) => row.actualQty !== row.expectedQty),
    [rows]
  );
  const isAllMatched = rows.length > 0 && mismatchRows.length === 0;

  if (!allowed) return null;

  const updateRow = (key: string, patch: Partial<ChecklistRow>) => {
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
    if (!orderId) return;
    try {
      const payload: SavedChecklist = {
        orderId,
        savedAt: new Date().toISOString(),
        rows,
      };
      sessionStorage.setItem(storageKey(orderId), JSON.stringify(payload));
      setSavedAt(payload.savedAt);
      setMessage('Checklist berhasil disimpan.');
    } catch (error) {
      console.error('Save checklist failed:', error);
      setMessage('Gagal menyimpan checklist.');
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

    const checklistSnapshot = {
      order_id: orderId,
      mismatch_total: mismatchRows.length,
      rows: mismatchRows.map((row) => ({
        product_name: row.productName,
        expected_qty: row.expectedQty,
        actual_qty: row.actualQty,
        note: row.note || null,
      })),
    };

    try {
      setSubmittingReport(true);
      await api.driver.reportIssue(orderId, {
        note,
        checklist_snapshot: JSON.stringify(checklistSnapshot),
        evidence: reportPhoto,
      });
      saveChecklist();
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

  return (
    <div className="p-5 space-y-4 pb-40">
      <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
        <ArrowLeft size={16} /> Kembali
      </button>

      <div className="bg-white border border-slate-200 rounded-[28px] p-5 shadow-sm space-y-4">
        <div>
          <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1">Checklist Driver</p>
          <h1 className="text-xl font-black text-slate-900 leading-none">Cek Barang Order #{orderId.slice(-8).toUpperCase()}</h1>
          <p className="text-xs text-slate-500 mt-2">Pastikan barang sesuai sebelum berangkat.</p>
        </div>

        <div className="bg-slate-50 rounded-2xl border border-slate-100 p-3 text-xs text-slate-600 space-y-1">
          <p><span className="font-bold">Customer:</span> {order?.customer_name || order?.Customer?.name || '-'}</p>
          <p><span className="font-bold">Jumlah Item:</span> {rows.length}</p>
          {savedAt && <p><span className="font-bold">Terakhir disimpan:</span> {new Date(savedAt).toLocaleString('id-ID')}</p>}
        </div>

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm font-semibold text-slate-500">Memuat data checklist...</div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm font-semibold text-slate-500">Tidak ada item pada order ini.</div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              const matched = row.actualQty === row.expectedQty;
              return (
                <div key={row.key} className={`rounded-2xl border p-4 ${matched ? 'border-emerald-200 bg-emerald-50/40' : 'border-rose-200 bg-rose-50/40'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-black text-slate-900">{row.productName}</p>
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
                {isAllMatched ? 'Semua barang sudah sesuai.' : `Ditemukan ${mismatchRows.length} item tidak sesuai.`}
              </p>
              <p className="text-xs text-slate-600 mt-1">
                Simpan checklist dulu. Jika ada kekurangan, kirim laporan ke gudang.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
            <button
              onClick={saveChecklist}
              className="w-full py-3 bg-emerald-600 text-white rounded-xl font-black text-[11px] uppercase inline-flex items-center justify-center gap-2"
            >
              <ClipboardCheck size={14} /> Simpan
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
              href={`/driver/orders/${orderId}`}
              className="w-full py-3 bg-slate-900 text-white rounded-xl font-black text-[11px] uppercase text-center"
            >
              Ke Detail
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
