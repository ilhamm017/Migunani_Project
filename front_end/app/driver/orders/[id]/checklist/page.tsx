'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, AlertTriangle, CheckCircle2, ClipboardCheck } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';

type ChecklistRow = {
  key: string;
  productName: string;
  expectedQty: number;
  actualQty: number;
  note: string;
};

type SavedChecklist = {
  orderId: string;
  savedAt: string;
  rows: ChecklistRow[];
};

const storageKey = (orderId: string) => `driver-checklist-${orderId}`;

export default function DriverOrderChecklistPage() {
  const allowed = useRequireRoles(['driver', 'super_admin', 'admin_gudang']);
  const params = useParams();
  const router = useRouter();
  const orderId = String(params?.id || '');

  const [order, setOrder] = useState<any>(null);
  const [rows, setRows] = useState<ChecklistRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [message, setMessage] = useState('');

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
          };
        });

        let hydratedRows = baseRows;
        if (typeof window !== 'undefined' && orderId) {
          const raw = sessionStorage.getItem(storageKey(orderId));
          if (raw) {
            const parsed = JSON.parse(raw) as SavedChecklist;
            if (Array.isArray(parsed?.rows) && parsed.rows.length > 0) {
              hydratedRows = parsed.rows.map((row, idx) => ({
                key: String(row?.key || idx),
                productName: row?.productName || baseRows[idx]?.productName || 'Produk',
                expectedQty: Number(row?.expectedQty || 0),
                actualQty: Number(row?.actualQty || 0),
                note: String(row?.note || ''),
              }));
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

    if (allowed && orderId) load();
  }, [allowed, orderId]);

  const mismatchRows = useMemo(
    () => rows.filter((row) => row.actualQty !== row.expectedQty),
    [rows]
  );
  const isAllMatched = rows.length > 0 && mismatchRows.length === 0;

  if (!allowed) return null;

  const updateRow = (key: string, patch: Partial<ChecklistRow>) => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
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

  const reportMismatch = async () => {
    if (mismatchRows.length === 0) {
      setMessage('Tidak ada selisih barang untuk dilaporkan.');
      return;
    }

    const detail = mismatchRows
      .map((row) => `${row.productName}: expected ${row.expectedQty}, actual ${row.actualQty}${row.note ? ` (${row.note})` : ''}`)
      .join('; ');

    try {
      setSubmitting(true);
      await api.driver.reportIssue(orderId, `[Checklist Driver] Ketidaksesuaian barang. ${detail}`);
      setMessage('Ketidaksesuaian berhasil dilaporkan ke Admin Gudang.');
    } catch (error) {
      console.error('Report mismatch failed:', error);
      setMessage('Gagal melaporkan ketidaksesuaian.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 space-y-5 pb-24">
      <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
        <ArrowLeft size={16} /> Kembali
      </button>

      <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm space-y-5">
        <div>
          <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1">Checklist Driver</p>
          <h1 className="text-2xl font-black text-slate-900 leading-none">Cek Barang Order #{orderId.slice(-8).toUpperCase()}</h1>
          <p className="text-xs text-slate-500 mt-2">Cocokkan barang bawaan dengan daftar order sebelum berangkat kirim.</p>
        </div>

        <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 text-xs text-slate-600 space-y-2">
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
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-black text-slate-900">{row.productName}</p>
                    <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-full ${matched ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                      {matched ? 'Sesuai' : 'Tidak Sesuai'}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="text-xs font-bold text-slate-600">
                      Qty Seharusnya
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
                    Catatan (opsional)
                    <input
                      type="text"
                      value={row.note}
                      onChange={(e) => updateRow(row.key, { note: e.target.value })}
                      placeholder="Contoh: Kemasan penyok, minta re-pack"
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                    />
                  </label>
                </div>
              );
            })}
          </div>
        )}

        <div className={`rounded-2xl border p-4 ${isAllMatched ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
          <div className="flex items-start gap-2">
            {isAllMatched ? <CheckCircle2 size={18} className="text-emerald-600 mt-0.5" /> : <AlertTriangle size={18} className="text-amber-600 mt-0.5" />}
            <div>
              <p className={`text-sm font-black ${isAllMatched ? 'text-emerald-700' : 'text-amber-700'}`}>
                {isAllMatched ? 'Semua barang sudah sesuai.' : `Ditemukan ${mismatchRows.length} item tidak sesuai.`}
              </p>
              <p className="text-xs text-slate-600 mt-1">
                Simpan checklist dulu, lalu lanjut ke halaman detail order untuk proses pengiriman.
              </p>
            </div>
          </div>
        </div>

        {message && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-700">{message}</div>
        )}

        <div className="grid grid-cols-1 gap-3">
          <button
            onClick={saveChecklist}
            className="w-full py-4 bg-emerald-600 text-white rounded-[20px] font-black text-xs uppercase inline-flex items-center justify-center gap-2"
          >
            <ClipboardCheck size={15} /> Simpan Checklist
          </button>

          {mismatchRows.length > 0 && (
            <button
              onClick={reportMismatch}
              disabled={submitting}
              className="w-full py-4 bg-white border-2 border-rose-200 text-rose-700 rounded-[20px] font-black text-xs uppercase"
            >
              {submitting ? 'Memproses...' : 'Laporkan Ketidaksesuaian'}
            </button>
          )}

          <Link
            href={`/driver/orders/${orderId}`}
            className="w-full py-4 bg-slate-900 text-white rounded-[20px] font-black text-xs uppercase text-center"
          >
            Lanjut ke Detail Pengiriman
          </Link>
        </div>
      </div>
    </div>
  );
}
