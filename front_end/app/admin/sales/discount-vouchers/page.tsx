'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Percent, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';

type DiscountVoucher = {
  code: string;
  discount_pct: number;
  max_discount_rupiah: number;
  starts_at: string;
  expires_at: string;
  usage_limit: number;
  usage_count: number;
  is_active: boolean;
};

type DiscountVoucherDraft = {
  discount_pct: string;
  max_discount_rupiah: string;
  starts_at: string;
  expires_at: string;
  usage_limit: string;
  is_active: boolean;
};

const normalizeCode = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9_-]+/g, '');

const toDateTimeInputValue = (iso: string | undefined) => {
  if (!iso) return '';
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) return '';
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

const toIsoFromDateTimeInput = (value: string) => {
  const raw = value.trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString();
};

const getVoucherStatus = (voucher: DiscountVoucher) => {
  if (!voucher.is_active) {
    return {
      label: 'NONAKTIF',
      className: 'bg-slate-200 text-slate-600',
    };
  }

  const now = Date.now();
  const startsAt = new Date(voucher.starts_at).getTime();
  const expiresAt = new Date(voucher.expires_at).getTime();
  const remaining = Math.max(0, Number(voucher.usage_limit || 0) - Number(voucher.usage_count || 0));

  if (now < startsAt) {
    return {
      label: 'TERJADWAL',
      className: 'bg-blue-100 text-blue-700',
    };
  }

  if (now > expiresAt || remaining <= 0) {
    return {
      label: 'SELESAI',
      className: 'bg-amber-100 text-amber-700',
    };
  }

  return {
    label: 'AKTIF',
    className: 'bg-emerald-100 text-emerald-700',
  };
};

const getDurationDays = (startsAtIso: string, expiresAtIso: string) => {
  const startsAt = new Date(startsAtIso).getTime();
  const expiresAt = new Date(expiresAtIso).getTime();
  if (!Number.isFinite(startsAt) || !Number.isFinite(expiresAt) || expiresAt <= startsAt) return 0;
  return Math.ceil((expiresAt - startsAt) / (24 * 60 * 60 * 1000));
};

export default function DiscountVouchersPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir'], '/admin');
  const [vouchers, setVouchers] = useState<DiscountVoucher[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DiscountVoucherDraft>>({});
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [processingCode, setProcessingCode] = useState('');
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  const [newCode, setNewCode] = useState('');
  const [newDiscountPct, setNewDiscountPct] = useState('10');
  const [newMaxDiscount, setNewMaxDiscount] = useState('50000');
  const [newStartsAt, setNewStartsAt] = useState('');
  const [newExpiresAt, setNewExpiresAt] = useState('');
  const [newUsageLimit, setNewUsageLimit] = useState('100');
  const [newIsActive, setNewIsActive] = useState(true);

  const loadVouchers = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.admin.discountVouchers.getAll();
      const rows = Array.isArray(res.data?.discount_vouchers)
        ? (res.data.discount_vouchers as DiscountVoucher[])
        : [];
      setVouchers(rows);

      const nextDrafts: Record<string, DiscountVoucherDraft> = {};
      rows.forEach((row) => {
        nextDrafts[row.code] = {
          discount_pct: String(Number(row.discount_pct || 0)),
          max_discount_rupiah: String(Number(row.max_discount_rupiah || 0)),
          starts_at: toDateTimeInputValue(row.starts_at),
          expires_at: toDateTimeInputValue(row.expires_at),
          usage_limit: String(Number(row.usage_limit || 1)),
          is_active: row.is_active !== false,
        };
      });
      setDrafts(nextDrafts);
    } catch (e: any) {
      setVouchers([]);
      setDrafts({});
      setError(e?.response?.data?.message || 'Gagal memuat voucher diskon');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void loadVouchers();
  }, [allowed, loadVouchers]);

  const handleCreate = async () => {
    const code = normalizeCode(newCode);
    const discountPct = Number(newDiscountPct);
    const maxDiscount = Number(newMaxDiscount);
    const usageLimit = Number(newUsageLimit);
    const startsAtIso = toIsoFromDateTimeInput(newStartsAt);
    const expiresAtIso = toIsoFromDateTimeInput(newExpiresAt);

    if (!code || code.length < 3 || code.length > 40) {
      setError('Kode voucher wajib 3-40 karakter (A-Z, 0-9, _, -).');
      return;
    }
    if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) {
      setError('Persen diskon harus angka 0-100.');
      return;
    }
    if (!Number.isFinite(maxDiscount) || maxDiscount < 0) {
      setError('Maksimal potongan rupiah harus angka >= 0.');
      return;
    }
    if (!Number.isFinite(usageLimit) || usageLimit < 1) {
      setError('Kuota pemakaian wajib angka bulat >= 1.');
      return;
    }
    if (!newExpiresAt.trim() || !expiresAtIso) {
      setError('Tanggal berakhir voucher wajib diisi.');
      return;
    }
    if (startsAtIso && new Date(expiresAtIso).getTime() <= new Date(startsAtIso).getTime()) {
      setError('Tanggal berakhir harus lebih besar dari tanggal mulai.');
      return;
    }

    try {
      setCreating(true);
      setError('');
      setActionMessage('');
      const res = await api.admin.discountVouchers.create({
        code,
        discount_pct: discountPct,
        max_discount_rupiah: maxDiscount,
        starts_at: startsAtIso || undefined,
        expires_at: expiresAtIso,
        usage_limit: Math.floor(usageLimit),
        is_active: newIsActive,
      });
      setActionMessage(res.data?.message || 'Voucher diskon berhasil ditambahkan.');
      setNewCode('');
      setNewDiscountPct('10');
      setNewMaxDiscount('50000');
      setNewStartsAt('');
      setNewExpiresAt('');
      setNewUsageLimit('100');
      setNewIsActive(true);
      await loadVouchers();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Gagal menambahkan voucher diskon.');
    } finally {
      setCreating(false);
    }
  };

  const handleSaveRow = async (code: string) => {
    const draft = drafts[code];
    if (!draft) return;

    const discountPct = Number(draft.discount_pct);
    const maxDiscount = Number(draft.max_discount_rupiah);
    const usageLimit = Number(draft.usage_limit);
    const startsAtIso = toIsoFromDateTimeInput(draft.starts_at);
    const expiresAtIso = toIsoFromDateTimeInput(draft.expires_at);

    if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) {
      setError(`Persen diskon voucher ${code} harus angka 0-100.`);
      return;
    }
    if (!Number.isFinite(maxDiscount) || maxDiscount < 0) {
      setError(`Maksimal potongan voucher ${code} harus angka >= 0.`);
      return;
    }
    if (!Number.isFinite(usageLimit) || usageLimit < 1) {
      setError(`Kuota pemakaian voucher ${code} harus angka bulat >= 1.`);
      return;
    }
    if (!expiresAtIso) {
      setError(`Tanggal berakhir voucher ${code} wajib diisi.`);
      return;
    }
    if (startsAtIso && new Date(expiresAtIso).getTime() <= new Date(startsAtIso).getTime()) {
      setError(`Tanggal berakhir voucher ${code} harus lebih besar dari tanggal mulai.`);
      return;
    }

    try {
      setProcessingCode(code);
      setError('');
      setActionMessage('');
      const res = await api.admin.discountVouchers.update(code, {
        discount_pct: discountPct,
        max_discount_rupiah: maxDiscount,
        starts_at: startsAtIso || undefined,
        expires_at: expiresAtIso,
        usage_limit: Math.floor(usageLimit),
        is_active: draft.is_active,
      });
      setActionMessage(res.data?.message || `Voucher ${code} berhasil diperbarui.`);
      await loadVouchers();
    } catch (e: any) {
      setError(e?.response?.data?.message || `Gagal memperbarui voucher ${code}.`);
    } finally {
      setProcessingCode('');
    }
  };

  const handleDeleteRow = async (code: string) => {
    if (!confirm(`Hapus voucher "${code}"?`)) return;
    try {
      setProcessingCode(code);
      setError('');
      setActionMessage('');
      const res = await api.admin.discountVouchers.remove(code);
      setActionMessage(res.data?.message || `Voucher ${code} berhasil dihapus.`);
      await loadVouchers();
    } catch (e: any) {
      setError(e?.response?.data?.message || `Gagal menghapus voucher ${code}.`);
    } finally {
      setProcessingCode('');
    }
  };

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link href="/admin/sales" className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700">
            <ArrowLeft size={14} /> Kembali ke Manajemen Customer
          </Link>
          <h1 className="text-2xl font-black text-slate-900 mt-2">Manajemen Voucher Diskon</h1>
          <p className="text-sm text-slate-500 mt-1">
            Atur persen diskon, batas potongan rupiah, umur voucher, dan kuota pemakaian.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadVouchers()}
          disabled={loading}
          className="inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-slate-100 text-slate-700 disabled:opacity-50"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-3">
        <h2 className="text-sm font-black text-slate-900">Tambah Voucher Baru</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-7 gap-2">
          <input
            value={newCode}
            onChange={(event) => setNewCode(event.target.value)}
            placeholder="Kode voucher (contoh: HEMAT10)"
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          <input
            type="number"
            value={newDiscountPct}
            onChange={(event) => setNewDiscountPct(event.target.value)}
            min={0}
            max={100}
            step="0.01"
            placeholder="% Diskon"
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          <input
            type="number"
            value={newMaxDiscount}
            onChange={(event) => setNewMaxDiscount(event.target.value)}
            min={0}
            placeholder="Maks. Potongan (Rp)"
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          <input
            type="datetime-local"
            value={newStartsAt}
            onChange={(event) => setNewStartsAt(event.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          <input
            type="datetime-local"
            value={newExpiresAt}
            onChange={(event) => setNewExpiresAt(event.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          <input
            type="number"
            value={newUsageLimit}
            onChange={(event) => setNewUsageLimit(event.target.value)}
            min={1}
            placeholder="Kuota Pemakaian"
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <input
              type="checkbox"
              checked={newIsActive}
              onChange={(event) => setNewIsActive(event.target.checked)}
            />
            Aktif
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">Jika tanggal mulai kosong, voucher akan aktif mulai saat dibuat.</p>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating}
            className="inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-emerald-600 text-white disabled:opacity-50"
          >
            <Plus size={12} />
            {creating ? 'Menyimpan...' : 'Tambah Voucher'}
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-black text-slate-900">Daftar Voucher</h2>
          <p className="text-[11px] font-semibold text-slate-500">{vouchers.length} voucher</p>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Memuat voucher diskon...</p>
        ) : vouchers.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
            Belum ada voucher diskon.
          </div>
        ) : (
          <div className="space-y-2">
            {vouchers.map((voucher) => {
              const draft = drafts[voucher.code] || {
                discount_pct: String(Number(voucher.discount_pct || 0)),
                max_discount_rupiah: String(Number(voucher.max_discount_rupiah || 0)),
                starts_at: toDateTimeInputValue(voucher.starts_at),
                expires_at: toDateTimeInputValue(voucher.expires_at),
                usage_limit: String(Number(voucher.usage_limit || 1)),
                is_active: voucher.is_active !== false,
              };
              const status = getVoucherStatus({
                ...voucher,
                is_active: draft.is_active,
                starts_at: toIsoFromDateTimeInput(draft.starts_at) || voucher.starts_at,
                expires_at: toIsoFromDateTimeInput(draft.expires_at) || voucher.expires_at,
              });
              const effectiveStartsAt = toIsoFromDateTimeInput(draft.starts_at) || voucher.starts_at;
              const effectiveExpiresAt = toIsoFromDateTimeInput(draft.expires_at) || voucher.expires_at;
              const processing = processingCode === voucher.code;
              const remainingQuota = Math.max(0, Number(voucher.usage_limit || 0) - Number(voucher.usage_count || 0));
              const durationDays = getDurationDays(effectiveStartsAt, effectiveExpiresAt);

              return (
                <div key={voucher.code} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-2 text-sm font-black text-slate-900">
                      <Percent size={14} />
                      {voucher.code}
                    </div>
                    <span className={`text-[10px] font-black px-2 py-1 rounded-full ${status.className}`}>
                      {status.label}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-2">
                    <input
                      type="number"
                      value={draft.discount_pct}
                      min={0}
                      max={100}
                      step="0.01"
                      onChange={(event) => setDrafts((prev) => ({
                        ...prev,
                        [voucher.code]: { ...draft, discount_pct: event.target.value }
                      }))}
                      className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm"
                    />
                    <input
                      type="number"
                      value={draft.max_discount_rupiah}
                      min={0}
                      onChange={(event) => setDrafts((prev) => ({
                        ...prev,
                        [voucher.code]: { ...draft, max_discount_rupiah: event.target.value }
                      }))}
                      className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm"
                    />
                    <input
                      type="datetime-local"
                      value={draft.starts_at}
                      onChange={(event) => setDrafts((prev) => ({
                        ...prev,
                        [voucher.code]: { ...draft, starts_at: event.target.value }
                      }))}
                      className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm"
                    />
                    <input
                      type="datetime-local"
                      value={draft.expires_at}
                      onChange={(event) => setDrafts((prev) => ({
                        ...prev,
                        [voucher.code]: { ...draft, expires_at: event.target.value }
                      }))}
                      className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm"
                    />
                    <input
                      type="number"
                      value={draft.usage_limit}
                      min={1}
                      onChange={(event) => setDrafts((prev) => ({
                        ...prev,
                        [voucher.code]: { ...draft, usage_limit: event.target.value }
                      }))}
                      className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm"
                    />
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 bg-white border border-slate-200 rounded-xl px-3 py-2">
                      <input
                        type="checkbox"
                        checked={draft.is_active}
                        onChange={(event) => setDrafts((prev) => ({
                          ...prev,
                          [voucher.code]: { ...draft, is_active: event.target.checked }
                        }))}
                      />
                      Aktif
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-slate-500">
                      Diskon: <span className="font-bold text-slate-700">{Number(draft.discount_pct || 0)}%</span> •
                      Maks Potongan: <span className="font-bold text-slate-700"> {formatCurrency(Number(draft.max_discount_rupiah || 0))}</span> •
                      Umur: <span className="font-bold text-slate-700"> {durationDays} hari</span> •
                      Dipakai: <span className="font-bold text-slate-700"> {Number(voucher.usage_count || 0)}</span> •
                      Sisa: <span className="font-bold text-slate-700"> {remainingQuota}</span>
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={processing}
                        onClick={() => void handleSaveRow(voucher.code)}
                        className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50"
                      >
                        <Save size={12} /> Simpan
                      </button>
                      <button
                        type="button"
                        disabled={processing}
                        onClick={() => void handleDeleteRow(voucher.code)}
                        className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 disabled:opacity-50"
                      >
                        <Trash2 size={12} /> Hapus
                      </button>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-500">
                    Berlaku: {formatDateTime(effectiveStartsAt)} sampai {formatDateTime(effectiveExpiresAt)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {(error || actionMessage) && (
        <div className="space-y-2">
          {error && <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700">{error}</div>}
          {actionMessage && <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-700">{actionMessage}</div>}
        </div>
      )}
    </div>
  );
}
