'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, MessageCircle, Upload } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';

export default function DriverOrderDetailPage() {
  const allowed = useRequireRoles(['driver', 'super_admin', 'admin_gudang']);
  const params = useParams();
  const router = useRouter();
  const orderId = String(params?.id || '');

  const [order, setOrder] = useState<any>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

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
    if (allowed && orderId) load();
  }, [allowed, orderId]);

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

  const reportIncomplete = async () => {
    const note = prompt('Apa yang kurang/bermasalah? (Contoh: Busi kurang 2 pcs)');
    if (!note) return;

    try {
      setLoading(true);
      await api.driver.reportIssue(orderId, note);
      alert('Masalah telah dilaporkan ke Admin Gudang.');
      router.push('/driver');
    } catch (error) {
      console.error('Report issue failed:', error);
      alert('Gagal melaporkan masalah.');
    } finally {
      setLoading(false);
    }
  };

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
            disabled={loading || !proof}
            className="w-full py-5 bg-emerald-600 text-white rounded-[24px] font-black text-sm uppercase shadow-xl shadow-emerald-200 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100 disabled:shadow-none"
          >
            {loading ? 'Processing...' : 'Konfirmasi Selesai'}
          </button>

          <button
            onClick={reportIncomplete}
            disabled={loading}
            className="w-full py-4 bg-white border-2 border-slate-200 text-rose-600 rounded-[24px] font-black text-xs uppercase hover:bg-rose-50 hover:border-rose-200 transition-all"
          >
            Lapor Barang Kurang / Bermasalah
          </button>
        </div>
      </div>

      {/* Confirmation Modal */}
      {
        isConfirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-sm rounded-[32px] p-6 shadow-2xl animate-in zoom-in-95 duration-200 space-y-4">
              <div className="text-center space-y-2">
                <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Upload size={32} />
                </div>
                <h3 className="text-lg font-black text-slate-900">Konfirmasi Serah Terima</h3>
                <p className="text-sm text-slate-500 leading-relaxed">
                  Pastikan barang sudah diterima dengan baik oleh customer & foto bukti sudah sesuai.
                </p>
              </div>

              {order?.Invoice?.payment_method === 'cod' && (
                <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4 text-center space-y-1">
                  <p className="text-xs font-bold text-orange-600 uppercase tracking-wide">Tagihan COD</p>
                  <p className="text-2xl font-black text-slate-900">
                    Rp {Number(order.total_amount || 0).toLocaleString('id-ID')}
                  </p>
                  <p className="text-[10px] text-orange-700 font-medium">
                    Wajib terima uang tunai dari customer!
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
        )
      }
    </div>
  );
}
