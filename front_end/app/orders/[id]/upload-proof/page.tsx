'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import NotifyPopup, { NotifyPopupVariant } from '@/components/ui/NotifyPopup';

export default function UploadProofPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = String(params?.id || '');

  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [popup, setPopup] = useState<{ open: boolean; title: string; message?: string; variant: NotifyPopupVariant; onPrimary?: () => void }>({
    open: false,
    title: '',
    message: '',
    variant: 'info',
  });

  const handleSubmit = async () => {
    if (!file) {
      setPopup({
        open: true,
        title: 'Pilih bukti transfer dulu',
        message: 'Silakan pilih foto bukti transfer (JPG/PNG) sebelum mengirim.',
        variant: 'warning',
      });
      return;
    }

    try {
      setLoading(true);
      const form = new FormData();
      form.append('proof', file);
      await api.orders.uploadPaymentProof(orderId, form);
      setPopup({
        open: true,
        title: 'Bukti transfer berhasil dikirim',
        message: 'Menunggu verifikasi admin finance. Status invoice akan diperbarui setelah disetujui.',
        variant: 'success',
        onPrimary: () => router.push(`/orders/${orderId}`),
      });
    } catch (error) {
      console.error('Upload failed:', error);
      setPopup({
        open: true,
        title: 'Upload bukti transfer gagal',
        message: 'Coba ulang beberapa saat lagi. Jika masih gagal, pastikan ukuran file tidak terlalu besar.',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <NotifyPopup
        open={popup.open}
        title={popup.title}
        message={popup.message}
        variant={popup.variant}
        onPrimary={popup.onPrimary}
        onClose={() => setPopup((prev) => ({ ...prev, open: false }))}
      />
      <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
        <ArrowLeft size={16} /> Kembali
      </button>

      <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm space-y-5">
        <h1 className="text-xl font-black text-slate-900">Upload Bukti Transfer</h1>
        <p className="text-sm text-slate-600">Order ID: <span className="font-bold">{orderId}</span></p>

        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-900">Foto Bukti Transfer</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-3 text-sm"
          />
          <p className="text-xs text-slate-500">Format: JPG/PNG. Maksimal 5MB disarankan.</p>
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black text-sm uppercase shadow-lg shadow-emerald-200 disabled:opacity-50"
        >
          <Upload size={14} className="inline mr-2" />
          {loading ? 'Mengunggah...' : 'Kirim Bukti Transfer'}
        </button>
      </div>
    </div>
  );
}
