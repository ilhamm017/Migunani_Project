'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, ClipboardCheck, MessageCircle, Send, Upload } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';

type StoredChecklistRow = {
  productName?: string;
  expectedQty?: number;
  actualQty?: number;
  note?: string;
};

export default function DriverOrderDetailPage() {
  const allowed = useRequireRoles(['driver', 'super_admin', 'admin_gudang']);
  const params = useParams();
  const router = useRouter();
  const orderId = String(params?.id || '');

  const [order, setOrder] = useState<any>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isIssueOpen, setIsIssueOpen] = useState(false);
  const [issueNote, setIssueNote] = useState('');
  const [issuePhoto, setIssuePhoto] = useState<File | null>(null);
  const [checklistRows, setChecklistRows] = useState<StoredChecklistRow[]>([]);
  const [issueSubmitted, setIssueSubmitted] = useState(false);
  const [checklistState, setChecklistState] = useState<{ exists: boolean; mismatchCount: number; savedAt?: string }>({
    exists: false,
    mismatchCount: 0,
  });

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.driver.getOrders();
        const rows = Array.isArray(res.data) ? res.data : [];
        setOrder(rows.find((x: any) => String(x.id) === orderId) || null);
      } catch (error) {
        console.error('Load driver order failed:', error);
      }
    };
    if (allowed && orderId) {
      void load();
    }
  }, [allowed, orderId]);

  useEffect(() => {
    if (!allowed || !orderId || typeof window === 'undefined') return;

    const raw = sessionStorage.getItem(`driver-checklist-${orderId}`);
    if (!raw) {
      setChecklistState({ exists: false, mismatchCount: 0 });
      setChecklistRows([]);
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
      const mismatchCount = rows.filter((row: any) => Number(row?.actualQty || 0) !== Number(row?.expectedQty || 0)).length;
      setChecklistState({
        exists: true,
        mismatchCount,
        savedAt: parsed?.savedAt,
      });
      setChecklistRows(rows);
    } catch (error) {
      console.error('Failed to parse checklist state:', error);
      setChecklistState({ exists: false, mismatchCount: 0 });
      setChecklistRows([]);
    }
  }, [allowed, orderId]);

  const mismatchRows = useMemo(
    () => checklistRows.filter((row) => Number(row?.actualQty || 0) !== Number(row?.expectedQty || 0)),
    [checklistRows]
  );

  if (!allowed) return null;

  const complete = async () => {
    try {
      setLoading(true);
      const form = new FormData();
      if (proof) form.append('proof', proof);
      await api.driver.completeOrder(orderId, form);
      alert('Pengiriman selesai.');
      router.push('/driver');
    } catch (error) {
      console.error('Complete delivery failed:', error);
      alert('Gagal konfirmasi pengiriman.');
    } finally {
      setLoading(false);
    }
  };

  const submitIssue = async () => {
    const note = issueNote.trim();
    if (note.length < 5) {
      alert('Catatan laporan minimal 5 karakter.');
      return;
    }

    const snapshot = {
      order_id: orderId,
      mismatch_total: mismatchRows.length,
      rows: mismatchRows.map((row) => ({
        product_name: row.productName || 'Produk',
        expected_qty: Number(row.expectedQty || 0),
        actual_qty: Number(row.actualQty || 0),
        note: String(row.note || '').trim() || null,
      })),
    };

    try {
      setLoading(true);
      await api.driver.reportIssue(orderId, {
        note,
        checklist_snapshot: JSON.stringify(snapshot),
        evidence: issuePhoto,
      });
      setIsIssueOpen(false);
      setIssueSubmitted(true);
      setTimeout(() => router.push('/driver'), 1300);
    } catch (error) {
      console.error('Report issue failed:', error);
      alert('Gagal melaporkan masalah.');
    } finally {
      setLoading(false);
    }
  };

  const canComplete = !!proof && checklistState.exists && checklistState.mismatchCount === 0 && !loading;
  const customer = order?.Customer || {};

  return (
    <div className="p-6 space-y-5">
      <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
        <ArrowLeft size={16} /> Kembali
      </button>

      <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm space-y-6">
        <div>
          <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1">Tugas Pengiriman</p>
          <h1 className="text-2xl font-black text-slate-900 leading-none">Order #{orderId}</h1>
        </div>

        {issueSubmitted && (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
            <p className="text-sm font-black text-blue-700">Laporan terkirim ke gudang.</p>
            <p className="text-xs text-blue-700 mt-1">Menunggu follow-up gudang. Anda akan diarahkan kembali ke daftar tugas.</p>
          </div>
        )}

        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500 font-bold uppercase">Status</span>
            <span className="text-xs font-black text-slate-900 uppercase bg-white px-2 py-1 rounded-lg border border-slate-200">
              {order?.status || 'SHIPPED'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500 font-bold uppercase">Customer</span>
            <span className="text-xs font-black text-slate-900 uppercase">
              {order?.customer_name || '-'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500 font-bold uppercase">Metode</span>
            <span className="text-xs font-black text-slate-900 uppercase">
              {order?.Invoice?.payment_method || 'COD'}
            </span>
          </div>
        </div>

        <div className={`rounded-2xl border p-4 ${checklistState.exists && checklistState.mismatchCount === 0 ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
          <div className="flex items-start gap-2">
            {checklistState.exists && checklistState.mismatchCount === 0 ? (
              <CheckCircle2 size={18} className="text-emerald-600 mt-0.5" />
            ) : (
              <AlertTriangle size={18} className="text-amber-600 mt-0.5" />
            )}
            <div>
              <p className={`text-sm font-black ${checklistState.exists && checklistState.mismatchCount === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                {checklistState.exists
                  ? checklistState.mismatchCount === 0
                    ? 'Checklist barang sudah sesuai.'
                    : `Checklist mendeteksi ${checklistState.mismatchCount} item tidak sesuai.`
                  : 'Checklist barang belum dilakukan.'}
              </p>
              <p className="text-xs text-slate-600 mt-1">
                Driver wajib cek barang sebelum konfirmasi pengiriman.
                {checklistState.savedAt ? ` (Disimpan: ${new Date(checklistState.savedAt).toLocaleString('id-ID')})` : ''}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">
            Bukti Foto (Wajib jika Selesai)
          </label>
          <div className="relative group">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setProof(e.target.files?.[0] || null)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 group-hover:border-emerald-300 rounded-3xl p-8 bg-slate-50 group-hover:bg-emerald-50/30 transition-all">
              <Upload size={24} className="text-slate-400 group-hover:text-emerald-500 mb-2" />
              <p className="text-xs font-bold text-slate-500 group-hover:text-emerald-700">
                {proof ? proof.name : 'Klik untuk Ambil Foto Bukti'}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 pt-2">
          <Link
            href={`/driver/orders/${orderId}/checklist`}
            className="w-full py-4 bg-white border-2 border-emerald-200 text-emerald-700 rounded-[24px] font-black text-xs uppercase inline-flex items-center justify-center gap-2"
          >
            <ClipboardCheck size={16} />
            Cek Barang Dulu
          </Link>

          {customer.id ? (
            <Link
              href={`/driver/chat?userId=${encodeURIComponent(String(customer.id))}&phone=${encodeURIComponent(String(customer.whatsapp_number || ''))}`}
              className="w-full py-4 bg-slate-900 text-white rounded-[24px] font-black text-xs uppercase inline-flex items-center justify-center gap-2"
            >
              <MessageCircle size={16} />
              Hubungi Customer (Chat App)
            </Link>
          ) : null}

          <button
            onClick={() => setIsConfirmOpen(true)}
            disabled={!canComplete}
            className="w-full py-5 bg-emerald-600 text-white rounded-[24px] font-black text-sm uppercase shadow-xl shadow-emerald-200 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100 disabled:shadow-none"
          >
            {loading ? 'Processing...' : 'Konfirmasi Selesai'}
          </button>

          <button
            onClick={() => setIsIssueOpen(true)}
            disabled={loading}
            className="w-full py-4 bg-white border-2 border-slate-200 text-rose-600 rounded-[24px] font-black text-xs uppercase hover:bg-rose-50 hover:border-rose-200 transition-all"
          >
            Lapor Barang Kurang / Bermasalah
          </button>
        </div>
      </div>

      {isConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-[32px] p-6 shadow-2xl animate-in zoom-in-95 duration-200 space-y-4">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Upload size={32} />
              </div>
              <h3 className="text-lg font-black text-slate-900">Konfirmasi Serah Terima</h3>
              <p className="text-sm text-slate-500 leading-relaxed">
                Pastikan barang sudah diterima dengan baik oleh customer dan foto bukti sudah sesuai.
              </p>
            </div>

            {order?.Invoice?.payment_method === 'cod' && (
              <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4 text-center space-y-1">
                <p className="text-xs font-bold text-orange-600 uppercase tracking-wide">Tagihan COD</p>
                <p className="text-2xl font-black text-slate-900">
                  Rp {Number(order.total_amount || 0).toLocaleString('id-ID')}
                </p>
                <p className="text-[10px] text-orange-700 font-medium">
                  Wajib terima uang tunai dari customer.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => setIsConfirmOpen(false)}
                className="py-3 px-4 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                disabled={loading}
              >
                Batal
              </button>
              <button
                onClick={complete}
                disabled={loading}
                className="py-3 px-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-200"
              >
                {loading ? 'Memproses...' : 'Ya, Selesai'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isIssueOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white w-full max-w-md rounded-[28px] p-5 shadow-2xl space-y-4">
            <div>
              <h3 className="text-lg font-black text-slate-900">Laporan Kekurangan Barang</h3>
              <p className="text-xs text-slate-500 mt-1">Catatan wajib, foto bukti opsional.</p>
            </div>

            <textarea
              value={issueNote}
              onChange={(e) => setIssueNote(e.target.value)}
              rows={4}
              placeholder="Contoh: Busi NGK kurang 2 pcs, oli tidak ada."
              className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm"
            />

            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-3">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => setIssuePhoto(e.target.files?.[0] || null)}
                className="hidden"
                id="driver-issue-evidence"
              />
              <label htmlFor="driver-issue-evidence" className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                <Camera size={14} /> {issuePhoto ? issuePhoto.name : 'Tambah foto bukti (opsional)'}
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsIssueOpen(false)}
                disabled={loading}
                className="py-3 rounded-xl border border-slate-300 text-xs font-black uppercase text-slate-700"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={submitIssue}
                disabled={loading}
                className="py-3 rounded-xl bg-rose-600 text-white text-xs font-black uppercase inline-flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <Send size={13} /> {loading ? 'Mengirim...' : 'Kirim Laporan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
