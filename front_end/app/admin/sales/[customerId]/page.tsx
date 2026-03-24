'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { MessageSquare, RefreshCw, ShieldOff, ShieldCheck, Pencil, X, KeyRound, Mail } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency } from '@/lib/utils';

type TierType = 'regular' | 'gold' | 'platinum';
type CustomerDetail = {
  id: string;
  name?: string;
  email?: string | null;
  whatsapp_number?: string;
  status: 'active' | 'banned';
  debt?: string | number;
  CustomerProfile?: {
    tier?: string;
    points?: number;
    credit_limit?: string | number;
    saved_addresses?: Array<{
      address?: string | null;
      label?: string | null;
    }>;
  };
};
type CustomerSummary = {
  total_orders: number;
  open_orders: number;
  status_counts: Record<string, number>;
};
type ApiErrorWithMessage = {
  response?: { data?: { message?: string } };
};

const TIER_OPTIONS: Array<{ value: TierType; label: string }> = [
  { value: 'regular', label: 'Regular' },
  { value: 'gold', label: 'Gold' },
  { value: 'platinum', label: 'Platinum' },
];

export default function AdminCustomerDetailPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir']);
  const params = useParams();
  const searchParams = useSearchParams();
  const customerId = String(params?.customerId || '');

  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetail | null>(null);
  const [summary, setSummary] = useState<CustomerSummary | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [processingCustomer, setProcessingCustomer] = useState(false);
  const [updatingTier, setUpdatingTier] = useState(false);
  const [selectedTierDraft, setSelectedTierDraft] = useState<TierType>('regular');
  const [tierConfirmOpen, setTierConfirmOpen] = useState(false);
  const [tierConfirmStep, setTierConfirmStep] = useState<1 | 2>(1);
  const [editDataOpen, setEditDataOpen] = useState(false);
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [updatingEmail, setUpdatingEmail] = useState(false);
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  const loadCustomerDetail = useCallback(async () => {
    if (!customerId) return;
    try {
      setLoadingDetail(true);
      setError('');
      const detailRes = await api.admin.customers.getById(customerId);

      setSelectedCustomer((detailRes.data?.customer || null) as CustomerDetail | null);
      setSummary((detailRes.data?.summary || null) as CustomerSummary | null);
    } catch (e: unknown) {
      const err = e as ApiErrorWithMessage;
      setSelectedCustomer(null);
      setSummary(null);
      setError(err?.response?.data?.message || 'Gagal memuat detail customer');
    } finally {
      setLoadingDetail(false);
    }
  }, [customerId]);

  useEffect(() => {
    if (!allowed) return;
    void loadCustomerDetail();
  }, [allowed, loadCustomerDetail]);

  useEffect(() => {
    const currentTier = String(selectedCustomer?.CustomerProfile?.tier || 'regular').toLowerCase();
    if (currentTier === 'gold' || currentTier === 'platinum') {
      setSelectedTierDraft(currentTier);
      return;
    }
    setSelectedTierDraft('regular');
  }, [selectedCustomer?.CustomerProfile?.tier, selectedCustomer?.id]);

  useEffect(() => {
    if (!selectedCustomer?.id) return;
    setEditEmail(String(selectedCustomer.email || ''));
  }, [selectedCustomer?.id, selectedCustomer?.email]);

  useEffect(() => {
    if (!allowed) return;
    if (!searchParams) return;
    if (searchParams.get('edit') !== '1') return;
    setEditDataOpen(true);
  }, [allowed, searchParams]);

  const handleUpdateCustomerEmail = async () => {
    if (!selectedCustomer?.id) return;
    const nextEmail = editEmail.trim();
    if (!nextEmail) {
      setError('Email wajib diisi.');
      return;
    }
    try {
      setUpdatingEmail(true);
      setError('');
      setActionMessage('');
      await api.admin.customers.updateEmail(selectedCustomer.id, nextEmail);
      setActionMessage('Email customer berhasil diperbarui.');
      await loadCustomerDetail();
    } catch (e: unknown) {
      const err = e as ApiErrorWithMessage;
      setError(err?.response?.data?.message || 'Gagal update email customer');
    } finally {
      setUpdatingEmail(false);
    }
  };

  const handleUpdateCustomerPassword = async () => {
    if (!selectedCustomer?.id) return;
    const nextPassword = editPassword.trim();
    if (!nextPassword) {
      setError('Password wajib diisi.');
      return;
    }
    if (nextPassword.length < 6) {
      setError('Password minimal 6 karakter.');
      return;
    }
    if (!confirm('Reset password customer? Password lama akan diganti.')) return;

    try {
      setUpdatingPassword(true);
      setError('');
      setActionMessage('');
      await api.admin.customers.updatePassword(selectedCustomer.id, nextPassword);
      setEditPassword('');
      setActionMessage('Password customer berhasil diperbarui.');
      await loadCustomerDetail();
    } catch (e: unknown) {
      const err = e as ApiErrorWithMessage;
      setError(err?.response?.data?.message || 'Gagal update password customer');
    } finally {
      setUpdatingPassword(false);
    }
  };

  const handleToggleCustomerStatus = async () => {
    if (!selectedCustomer) return;
    const nextStatus = selectedCustomer.status === 'active' ? 'banned' : 'active';
    const message = nextStatus === 'banned'
      ? `Blokir customer ${selectedCustomer.name || selectedCustomer.whatsapp_number || selectedCustomer.id}?\n\nOrder aktif customer juga akan dibatalkan.`
      : `Aktifkan kembali customer ${selectedCustomer.name || selectedCustomer.whatsapp_number || selectedCustomer.id}?`;
    if (!confirm(message)) return;

    try {
      setProcessingCustomer(true);
      setActionMessage('');
      const res = await api.admin.customers.updateStatus(selectedCustomer.id, {
        status: nextStatus,
        halt_open_orders: true,
      });
      const haltedOrderCount = Number(res.data?.halted_order_count || 0);
      setActionMessage(
        nextStatus === 'banned'
          ? `Customer diblokir. ${haltedOrderCount} order aktif dihentikan.`
          : 'Customer diaktifkan kembali.'
      );
      await loadCustomerDetail();
    } catch (e: unknown) {
      const err = e as ApiErrorWithMessage;
      setError(err?.response?.data?.message || 'Gagal mengubah status customer');
    } finally {
      setProcessingCustomer(false);
    }
  };

  const handleUpdateTier = async () => {
    if (!selectedCustomer?.id) return;
    const currentTier = String(selectedCustomer?.CustomerProfile?.tier || 'regular').toLowerCase();
    if (currentTier === selectedTierDraft) {
      setActionMessage('Tier customer tidak berubah.');
      return;
    }
    try {
      setUpdatingTier(true);
      setError('');
      setActionMessage('');
      await api.admin.customers.updateTier(selectedCustomer.id, selectedTierDraft);
      setActionMessage('Tier customer berhasil diperbarui.');
      await loadCustomerDetail();
    } catch (e: unknown) {
      const err = e as ApiErrorWithMessage;
      setError(err?.response?.data?.message || 'Gagal memperbarui tier customer');
    } finally {
      setUpdatingTier(false);
    }
  };

  const openTierConfirm = () => {
    if (!selectedCustomer?.id) return;
    const currentTier = String(selectedCustomer?.CustomerProfile?.tier || 'regular').toLowerCase();
    if (currentTier === selectedTierDraft) {
      setActionMessage('Tier customer tidak berubah.');
      return;
    }
    setTierConfirmStep(1);
    setTierConfirmOpen(true);
  };

  if (!allowed) return null;

  const primaryAddress = Array.isArray(selectedCustomer?.CustomerProfile?.saved_addresses)
    ? String(
      selectedCustomer?.CustomerProfile?.saved_addresses.find((row) => String(row?.address || '').trim())?.address || ''
    ).trim()
    : '';

  return (
    <div className="p-6 space-y-5 pb-24">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] mb-1">Customer Detail</p>
          <h1 className="text-2xl font-black text-slate-900 leading-none">{selectedCustomer?.name || 'Detail Customer'}</h1>
          <p className="text-xs text-slate-500 mt-2">Semua fitur customer dipusatkan di halaman ini: profil, tier, order aktif, dan histori belanja.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadCustomerDetail()}
            disabled={loadingDetail}
            className="inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-slate-100 text-slate-700 disabled:opacity-50"
          >
            <RefreshCw size={12} /> Refresh
          </button>
          <Link href="/admin/sales" className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[11px] font-black uppercase tracking-wide text-slate-700">
            Kembali
          </Link>
        </div>
      </div>

      {loadingDetail ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">Memuat detail customer...</div>
      ) : !selectedCustomer ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">Detail customer tidak tersedia.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div id="profil-customer" className="xl:col-span-2 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-4 scroll-mt-24">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Profil Customer</p>
                  <h2 className="mt-2 text-2xl font-black text-slate-900">{selectedCustomer.name || '-'}</h2>
                  <p className="mt-2 text-xs text-slate-500">{selectedCustomer.whatsapp_number || '-'}{selectedCustomer.email ? ` • ${selectedCustomer.email}` : ''}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Alamat: <span className="font-semibold text-slate-700">{primaryAddress || 'Belum ada alamat tersimpan'}</span>
                  </p>
                </div>
                <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-full ${selectedCustomer.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                  {selectedCustomer.status}
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tier</p>
                  <p className="mt-2 text-lg font-black text-slate-900">{selectedCustomer.CustomerProfile?.tier || 'regular'}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Poin</p>
                  <p className="mt-2 text-lg font-black text-slate-900">{Number(selectedCustomer.CustomerProfile?.points || 0)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Debt</p>
                  <p className="mt-2 text-lg font-black text-slate-900">{formatCurrency(Number(selectedCustomer.debt || 0))}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Credit Limit</p>
                  <p className="mt-2 text-lg font-black text-slate-900">{formatCurrency(Number(selectedCustomer.CustomerProfile?.credit_limit || 0))}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Data Customer</p>
                  <p className="mt-1 text-xs text-slate-500">Informasi utama customer untuk kebutuhan komunikasi, pengecekan profil, dan tindak lanjut operasional.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Nama Customer</p>
                    <p className="mt-1 text-sm font-black text-slate-900">{selectedCustomer.name || '-'}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Nomor Telepon</p>
                    <p className="mt-1 text-sm font-black text-slate-900">{selectedCustomer.whatsapp_number || '-'}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Email</p>
                    <p className="mt-1 text-sm font-black text-slate-900 break-all">{selectedCustomer.email || '-'}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Status Akun</p>
                    <p className="mt-1 text-sm font-black text-slate-900 uppercase">{selectedCustomer.status || '-'}</p>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                  <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Alamat Utama</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 leading-relaxed">{primaryAddress || 'Belum ada alamat tersimpan'}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/admin/chat?userId=${selectedCustomer.id}`} className="btn-3d text-[11px] font-bold px-3 py-2 rounded-xl bg-blue-50 text-blue-700 border border-blue-200">
                  <span className="inline-flex items-center gap-1"><MessageSquare size={12} /> Chat Customer</span>
                </Link>
                <Link href={`/admin/orders/create?customerId=${selectedCustomer.id}`} className="btn-3d text-[11px] font-bold px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Buat Order
                </Link>
                <button
                  type="button"
                  onClick={() => setEditDataOpen(true)}
                  className="text-[11px] font-bold px-3 py-2 rounded-xl bg-amber-50 text-amber-700 border border-amber-200"
                >
                  <span className="inline-flex items-center gap-1"><Pencil size={12} /> Edit Data</span>
                </button>
                <button
                  type="button"
                  disabled={processingCustomer}
                  onClick={() => void handleToggleCustomerStatus()}
                  className={`text-[11px] font-bold px-3 py-2 rounded-xl border disabled:opacity-50 ${selectedCustomer.status === 'active' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}
                >
                  {selectedCustomer.status === 'active' ? (
                    <span className="inline-flex items-center gap-1"><ShieldOff size={12} /> Blokir</span>
                  ) : (
                    <span className="inline-flex items-center gap-1"><ShieldCheck size={12} /> Aktifkan</span>
                  )}
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Edit Tier Customer</p>
                <p className="mt-2 text-xs text-slate-500">Semua tool yang sebelumnya ada di halaman list dipindah ke detail customer ini.</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={selectedTierDraft}
                  onChange={(e) => setSelectedTierDraft(e.target.value as TierType)}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                  disabled={updatingTier}
                >
                  {TIER_OPTIONS.map((tier) => (
                    <option key={tier.value} value={tier.value}>{tier.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={openTierConfirm}
                  disabled={updatingTier}
                  className="px-3 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold disabled:opacity-50"
                >
                  {updatingTier ? 'Menyimpan...' : 'Update Tier'}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-amber-700 uppercase">Open Order</p>
                  <p className="text-lg font-black text-amber-800">{Number(summary?.open_orders || 0)}</p>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-blue-700 uppercase">Total Order</p>
                  <p className="text-lg font-black text-blue-800">{Number(summary?.total_orders || 0)}</p>
                </div>
              </div>
            </div>
          </div>

        </>
      )}

      {(error || actionMessage) && (
        <div className="space-y-2">
          {error && <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700">{error}</div>}
          {actionMessage && <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-700">{actionMessage}</div>}
        </div>
      )}

      {editDataOpen && selectedCustomer ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-4 md:items-center">
          <div className="w-full max-w-lg rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Edit Data Customer</p>
                <p className="mt-2 text-sm font-black text-slate-900">{selectedCustomer.name || 'Customer'}</p>
                <p className="mt-1 text-xs text-slate-500">{selectedCustomer.whatsapp_number || selectedCustomer.id}</p>
              </div>
              <button
                type="button"
                data-no-3d="true"
                onClick={() => setEditDataOpen(false)}
                className="p-2 rounded-full bg-slate-50 text-slate-500 hover:bg-slate-100"
                aria-label="Tutup"
              >
                <X size={16} />
              </button>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Update Email</p>
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-500">
                  <Mail size={16} />
                </div>
                <input
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="flex-1 h-10 rounded-2xl border border-slate-200 bg-white px-3 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={() => void handleUpdateCustomerEmail()}
                disabled={updatingEmail}
                className="w-full h-11 rounded-2xl bg-slate-900 text-white text-xs font-black uppercase disabled:opacity-60 inline-flex items-center justify-center gap-2"
              >
                {updatingEmail ? 'Menyimpan...' : 'Update Email'}
              </button>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Reset Password</p>
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-500">
                  <KeyRound size={16} />
                </div>
                <input
                  type="password"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="Password baru (min. 6 karakter)"
                  className="flex-1 h-10 rounded-2xl border border-slate-200 bg-white px-3 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={() => void handleUpdateCustomerPassword()}
                disabled={updatingPassword}
                className="w-full h-11 rounded-2xl bg-amber-600 text-white text-xs font-black uppercase disabled:opacity-60 inline-flex items-center justify-center gap-2"
              >
                {updatingPassword ? 'Menyimpan...' : 'Reset Password'}
              </button>
              <p className="text-[10px] text-slate-500">
                Gunakan ini jika customer lupa password. Beritahu customer password barunya.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {tierConfirmOpen && selectedCustomer && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4">
          <div className="w-full max-w-lg rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl space-y-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-600">Verifikasi Update Tier</p>
              <h2 className="mt-2 text-2xl font-black text-slate-900">
                {tierConfirmStep === 1 ? 'Review perubahan tier' : 'Konfirmasi akhir perubahan tier'}
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                {tierConfirmStep === 1
                  ? 'Periksa perubahan tier customer sebelum lanjut ke konfirmasi akhir.'
                  : 'Pastikan tier yang dipilih sudah benar. Perubahan ini akan langsung tersimpan.'}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-bold text-slate-500">Customer</span>
                <span className="text-sm font-black text-slate-900">{selectedCustomer.name || selectedCustomer.id}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                  <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Tier Saat Ini</p>
                  <p className="mt-1 text-sm font-black text-slate-900">{String(selectedCustomer.CustomerProfile?.tier || 'regular')}</p>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
                  <p className="text-[10px] font-black uppercase tracking-wide text-amber-700">Tier Baru</p>
                  <p className="mt-1 text-sm font-black text-amber-900">{selectedTierDraft}</p>
                </div>
              </div>
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-3">
                <p className="text-[11px] font-semibold text-blue-800">
                  Perubahan tier akan memengaruhi perlakuan customer pada transaksi berikutnya. Pastikan tier baru memang sudah disetujui.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setTierConfirmOpen(false);
                  setTierConfirmStep(1);
                }}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700"
              >
                Batal
              </button>
              {tierConfirmStep === 1 ? (
                <button
                  type="button"
                  onClick={() => setTierConfirmStep(2)}
                  className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white"
                >
                  Lanjut Verifikasi
                </button>
              ) : (
                <button
                  type="button"
                  disabled={updatingTier}
                  onClick={async () => {
                    await handleUpdateTier();
                    setTierConfirmOpen(false);
                    setTierConfirmStep(1);
                  }}
                  className="rounded-xl bg-amber-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                >
                  {updatingTier ? 'Menyimpan...' : 'Ya, Update Tier'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
