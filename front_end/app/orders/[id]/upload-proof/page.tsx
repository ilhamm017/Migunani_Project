'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { notifyOpen } from '@/lib/notify';
import axios from 'axios';

type InvoiceCandidate = {
  invoice_id: string;
  invoice_number: string;
  createdAt: string | null;
  shipment_status: string;
  payment_status: string;
};

export default function UploadProofPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = String(params?.id || '');

  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [invoiceCandidates, setInvoiceCandidates] = useState<InvoiceCandidate[] | null>(null);
  const [retrying, setRetrying] = useState(false);

  const submitWithOptionalInvoiceId = async (invoiceId?: string) => {
    if (!file) {
      notifyOpen({
        variant: 'warning',
        title: 'Pilih bukti transfer dulu',
        message: 'Silakan pilih foto bukti transfer (JPG/PNG) sebelum mengirim.',
      });
      return;
    }

    try {
      setLoading(true);
      const form = new FormData();
      form.append('proof', file);
      if (invoiceId) form.append('invoice_id', invoiceId);
      await api.orders.uploadPaymentProof(orderId, form);
      notifyOpen({
        variant: 'success',
        title: 'Bukti transfer berhasil dikirim',
        message: 'Menunggu verifikasi admin finance. Status invoice akan diperbarui setelah disetujui.',
        primaryLabel: 'Lihat Order',
        onPrimary: () => router.push(`/orders/${orderId}`),
      });
    } catch (error) {
      console.error('Upload failed:', error);
      if (axios.isAxiosError(error)) {
        const status = Number(error.response?.status || 0);
        const data: any = error.response?.data;
        const code = String(data?.data?.code || '').trim();
        const candidates = Array.isArray(data?.data?.candidates) ? (data.data.candidates as InvoiceCandidate[]) : null;
        if (status === 409 && code === 'INVOICE_ID_REQUIRED' && candidates && candidates.length > 0) {
          setInvoiceCandidates(candidates);
          notifyOpen({
            variant: 'warning',
            title: 'Pilih invoice dulu',
            message: 'Order ini punya lebih dari 1 invoice. Pilih invoice yang ingin kamu upload bukti transfer.',
          });
          return;
        }
      }
      notifyOpen({
        variant: 'error',
        title: 'Upload bukti transfer gagal',
        message: 'Coba ulang beberapa saat lagi. Jika masih gagal, pastikan ukuran file tidak terlalu besar.',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => submitWithOptionalInvoiceId(undefined);

  return (
    <div className="p-6 space-y-5">
      <button data-no-3d="true" onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
        <ArrowLeft size={16} /> Kembali
      </button>

      {invoiceCandidates && invoiceCandidates.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl space-y-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Order multi-invoice</p>
              <p className="text-lg font-black text-slate-900">Pilih Invoice untuk Bukti Transfer</p>
              <p className="mt-1 text-xs text-slate-600">
                Bukti transfer akan diunggah ke invoice yang kamu pilih.
              </p>
            </div>
            <div className="space-y-2">
              {invoiceCandidates.map((c) => (
                <button
                  key={c.invoice_id}
                  type="button"
                  disabled={retrying || loading}
                  onClick={async () => {
                    try {
                      setRetrying(true);
                      await submitWithOptionalInvoiceId(String(c.invoice_id));
                      setInvoiceCandidates(null);
                    } finally {
                      setRetrying(false);
                    }
                  }}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left hover:bg-slate-100 disabled:opacity-50"
                >
                  <p className="text-sm font-black text-slate-900">{c.invoice_number || `INV-${String(c.invoice_id).slice(-8).toUpperCase()}`}</p>
                  <p className="text-[11px] text-slate-600">
                    Status bayar: {c.payment_status || '-'} • Status kirim: {c.shipment_status || '-'}
                  </p>
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                disabled={retrying || loading}
                onClick={() => setInvoiceCandidates(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-[11px] font-black uppercase text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

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
