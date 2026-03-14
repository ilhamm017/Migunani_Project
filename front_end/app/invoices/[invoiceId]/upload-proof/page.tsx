'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Receipt, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import NotifyPopup, { NotifyPopupVariant } from '@/components/ui/NotifyPopup';

type InvoiceDetail = {
  id: string;
  invoice_number: string;
  payment_status: string;
  payment_method: string;
  payment_proof_url?: string | null;
  order_ids?: string[];
};

export default function InvoiceUploadProofPage() {
  const params = useParams();
  const router = useRouter();
  const invoiceId = String(params?.invoiceId || '');

  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingInvoice, setLoadingInvoice] = useState(true);
  const [submitError, setSubmitError] = useState('');
  const [popup, setPopup] = useState<{ open: boolean; title: string; message?: string; variant: NotifyPopupVariant; onPrimary?: () => void }>({
    open: false,
    title: '',
    message: '',
    variant: 'info',
  });

  const loadInvoice = useCallback(async () => {
    if (!invoiceId) {
      setDetail(null);
      setLoadingInvoice(false);
      return;
    }
    try {
      setLoadingInvoice(true);
      const res = await api.invoices.getById(invoiceId);
      const invoice = res.data || {};
      setDetail({
        id: String(invoice?.id || invoiceId),
        invoice_number: String(invoice?.invoice_number || invoiceId),
        payment_status: String(invoice?.payment_status || ''),
        payment_method: String(invoice?.payment_method || ''),
        payment_proof_url: invoice?.payment_proof_url ? String(invoice.payment_proof_url) : null,
        order_ids: Array.isArray(invoice?.order_ids) ? invoice.order_ids.map((row: unknown) => String(row || '')) : [],
      });
    } catch (error) {
      console.error('Failed to load invoice for transfer proof:', error);
      setDetail(null);
    } finally {
      setLoadingInvoice(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    void loadInvoice();
  }, [loadInvoice]);

  const proofAlreadyUploaded = Boolean(String(detail?.payment_proof_url || '').trim());
  const waitingFinanceVerification = proofAlreadyUploaded || String(detail?.payment_status || '') === 'waiting_admin_verification';
  const invoiceAlreadyPaid = String(detail?.payment_status || '') === 'paid';
  const wrongPaymentMethod = String(detail?.payment_method || '') !== 'transfer_manual';
  const fallbackOrderId = String(detail?.order_ids?.[0] || '').trim();
  const uploadLocked = waitingFinanceVerification || invoiceAlreadyPaid || wrongPaymentMethod;

  const handleSubmit = async () => {
    setSubmitError('');
    if (!file) {
      setPopup({
        open: true,
        title: 'Pilih bukti transfer dulu',
        message: 'Silakan pilih foto bukti transfer (JPG/PNG) sebelum mengirim.',
        variant: 'warning',
      });
      return;
    }
    if (uploadLocked) {
      return;
    }

    try {
      setLoading(true);
      const form = new FormData();
      form.append('proof', file);
      try {
        await api.invoices.uploadPaymentProof(invoiceId, form);
      } catch (error: unknown) {
        const statusCode = Number((error as { response?: { status?: number } })?.response?.status || 0);
        if (statusCode !== 404 || !fallbackOrderId) {
          throw error;
        }
        const fallbackForm = new FormData();
        fallbackForm.append('proof', file);
        fallbackForm.append('invoice_id', invoiceId);
        await api.orders.uploadPaymentProof(fallbackOrderId, fallbackForm);
      }
      setDetail((prev) => prev ? {
        ...prev,
        payment_proof_url: 'uploaded',
      } : prev);
      setFile(null);
      setPopup({
        open: true,
        title: 'Bukti transfer berhasil dikirim',
        message: 'Menunggu verifikasi admin finance. Kamu bisa cek status verifikasi di halaman invoice.',
        variant: 'success',
        onPrimary: () => router.push(`/invoices/${invoiceId}`),
      });
    } catch (error: unknown) {
      const message = String(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Upload bukti transfer gagal.'
      );
      setSubmitError(message);
      setPopup({
        open: true,
        title: 'Upload bukti transfer gagal',
        message,
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 pb-24">
      <NotifyPopup
        open={popup.open}
        title={popup.title}
        message={popup.message}
        variant={popup.variant}
        onPrimary={popup.onPrimary}
        onClose={() => setPopup((prev) => ({ ...prev, open: false }))}
      />
      <div className="p-6 space-y-5">
        <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
          <ArrowLeft size={16} /> Kembali
        </button>

        <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center">
              <Receipt size={18} />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900">Upload Bukti Transfer Invoice</h1>
              <p className="text-sm text-slate-600">
                Invoice: <span className="font-bold">{detail?.invoice_number || invoiceId}</span>
              </p>
            </div>
          </div>

          {loadingInvoice && <p className="text-sm text-slate-500">Memuat invoice...</p>}

          {!loadingInvoice && detail && (
            <>
              <div className={`rounded-2xl border p-4 ${waitingFinanceVerification ? 'bg-blue-50 border-blue-200' : 'bg-amber-50 border-amber-200'}`}>
                <p className={`text-[10px] font-black uppercase tracking-[0.24em] ${waitingFinanceVerification ? 'text-blue-700' : 'text-amber-700'}`}>
                  Pembayaran Berbasis Invoice
                </p>
                <p className="mt-2 text-sm font-bold text-slate-900">
                  {waitingFinanceVerification
                    ? 'Invoice ini sudah menunggu verifikasi admin finance.'
                    : invoiceAlreadyPaid
                      ? 'Invoice ini sudah lunas.'
                      : wrongPaymentMethod
                        ? 'Invoice ini tidak memakai metode transfer manual.'
                        : 'Bukti transfer untuk invoice ini akan dikirim dari halaman invoice.'}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {waitingFinanceVerification
                    ? 'Bukti transfer sudah tercatat. Tunggu admin finance memverifikasi pembayaran ini.'
                    : invoiceAlreadyPaid
                      ? 'Tidak perlu upload bukti lagi karena pembayaran invoice ini sudah diselesaikan.'
                      : wrongPaymentMethod
                        ? 'Halaman upload bukti hanya dipakai untuk invoice dengan metode bayar transfer manual.'
                        : 'Bukti transfer diunggah langsung ke invoice ini agar verifikasi finance tetap konsisten untuk seluruh order yang tergabung di dalamnya.'}
                </p>
                {fallbackOrderId && (
                  <p className="mt-2 text-[11px] text-slate-500">
                    Fallback kompatibilitas aktif untuk order sumber: <span className="font-bold text-slate-700">{fallbackOrderId}</span>
                  </p>
                )}
              </div>

              {submitError && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                  {submitError}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-900">Foto Bukti Transfer</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  disabled={uploadLocked}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-3 text-sm"
                />
                <p className="text-xs text-slate-500">Format: JPG/PNG. Gunakan bukti transfer yang menunjukkan nominal dan tujuan transfer.</p>
              </div>

              <button
                onClick={handleSubmit}
                disabled={loading || uploadLocked}
                className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black text-sm uppercase shadow-lg shadow-emerald-200 disabled:opacity-50 disabled:shadow-none"
              >
                <Upload size={14} className="inline mr-2" />
                {loading
                  ? 'Mengunggah...'
                  : waitingFinanceVerification
                    ? 'Menunggu Verifikasi Admin Finance'
                    : invoiceAlreadyPaid
                      ? 'Invoice Sudah Lunas'
                      : wrongPaymentMethod
                        ? 'Bukan Invoice Transfer Manual'
                        : 'Kirim Bukti Transfer Invoice'}
              </button>
            </>
          )}

          {!loadingInvoice && !detail && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Invoice tidak ditemukan. Kembali ke <Link href="/invoices" className="font-bold text-emerald-700">daftar invoice</Link>.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
