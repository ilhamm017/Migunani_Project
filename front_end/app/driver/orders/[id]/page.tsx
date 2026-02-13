'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Upload } from 'lucide-react';
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
      alert('Pengiriman selesai, COD dikonfirmasi.');
      router.push('/driver');
    } catch (error) {
      console.error('Complete delivery failed:', error);
      alert('Gagal konfirmasi pengiriman.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
        <ArrowLeft size={16} /> Kembali
      </button>

      <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm space-y-4">
        <h1 className="text-xl font-black text-slate-900">Detail Pengiriman #{orderId}</h1>
        <p className="text-sm text-slate-600">Status: {order?.status || '-'}</p>
        <p className="text-sm text-slate-600">Customer: {order?.customer_name || '-'}</p>

        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-900">Upload Foto Bukti Serah Terima</label>
          <input type="file" accept="image/*" onChange={(e) => setProof(e.target.files?.[0] || null)} className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-3 text-sm" />
        </div>

        <button onClick={complete} disabled={loading} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black text-sm uppercase shadow-lg shadow-emerald-200 disabled:opacity-50">
          <Upload size={14} className="inline mr-2" />
          {loading ? 'Mengirim...' : 'Konfirmasi COD & Selesai'}
        </button>
      </div>
    </div>
  );
}
