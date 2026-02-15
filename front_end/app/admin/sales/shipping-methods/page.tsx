'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Plus, RefreshCw, Save, Trash2, Truck } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

type ShippingMethod = {
  code: string;
  name: string;
  fee: number;
  is_active: boolean;
  sort_order: number;
};

type ShippingMethodDraft = {
  name: string;
  fee: string;
  is_active: boolean;
  sort_order: string;
};

const toCode = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

export default function ShippingMethodsPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir'], '/admin');
  const [methods, setMethods] = useState<ShippingMethod[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ShippingMethodDraft>>({});
  const [loading, setLoading] = useState(false);
  const [processingCode, setProcessingCode] = useState('');
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newFee, setNewFee] = useState('0');
  const [newSortOrder, setNewSortOrder] = useState('100');
  const [newActive, setNewActive] = useState(true);
  const [creating, setCreating] = useState(false);

  const loadMethods = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.admin.shippingMethods.getAll();
      const rows = Array.isArray(res.data?.shipping_methods)
        ? (res.data.shipping_methods as ShippingMethod[])
        : [];
      setMethods(rows);

      const nextDrafts: Record<string, ShippingMethodDraft> = {};
      rows.forEach((row) => {
        nextDrafts[row.code] = {
          name: row.name,
          fee: String(Number(row.fee || 0)),
          is_active: row.is_active !== false,
          sort_order: String(Number(row.sort_order || 0)),
        };
      });
      setDrafts(nextDrafts);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Gagal memuat metode pengiriman');
      setMethods([]);
      setDrafts({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void loadMethods();
  }, [allowed, loadMethods]);

  const activeCount = useMemo(
    () => methods.filter((item) => item.is_active).length,
    [methods]
  );

  const handleCreate = async () => {
    const name = newName.trim();
    const code = toCode(newCode || name);
    const fee = Number(newFee);
    const sortOrder = Number(newSortOrder);

    if (!name) return setError('Nama metode pengiriman wajib diisi.');
    if (!code) return setError('Kode metode tidak valid.');
    if (!Number.isFinite(fee) || fee < 0) return setError('Biaya pengiriman harus angka >= 0.');

    try {
      setCreating(true);
      setError('');
      setActionMessage('');
      const res = await api.admin.shippingMethods.create({
        code,
        name,
        fee,
        is_active: newActive,
        sort_order: Number.isFinite(sortOrder) ? Math.max(0, Math.trunc(sortOrder)) : 100,
      });
      setActionMessage(res.data?.message || 'Metode pengiriman berhasil ditambahkan.');
      setNewName('');
      setNewCode('');
      setNewFee('0');
      setNewSortOrder('100');
      setNewActive(true);
      await loadMethods();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Gagal menambahkan metode pengiriman.');
    } finally {
      setCreating(false);
    }
  };

  const handleSaveRow = async (code: string) => {
    const draft = drafts[code];
    if (!draft) return;

    const fee = Number(draft.fee);
    const sortOrder = Number(draft.sort_order);
    if (!draft.name.trim()) {
      setError('Nama metode pengiriman tidak boleh kosong.');
      return;
    }
    if (!Number.isFinite(fee) || fee < 0) {
      setError('Biaya pengiriman harus angka >= 0.');
      return;
    }

    try {
      setProcessingCode(code);
      setError('');
      setActionMessage('');
      const res = await api.admin.shippingMethods.update(code, {
        name: draft.name.trim(),
        fee,
        is_active: draft.is_active,
        sort_order: Number.isFinite(sortOrder) ? Math.max(0, Math.trunc(sortOrder)) : 0,
      });
      setActionMessage(res.data?.message || `Metode ${code} berhasil diperbarui.`);
      await loadMethods();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Gagal menyimpan perubahan.');
    } finally {
      setProcessingCode('');
    }
  };

  const handleDeleteRow = async (code: string) => {
    if (!confirm(`Hapus metode pengiriman "${code}"?`)) return;
    try {
      setProcessingCode(code);
      setError('');
      setActionMessage('');
      const res = await api.admin.shippingMethods.remove(code);
      setActionMessage(res.data?.message || `Metode ${code} berhasil dihapus.`);
      await loadMethods();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Gagal menghapus metode pengiriman.');
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
          <h1 className="text-2xl font-black text-slate-900 mt-2">Manajemen Jenis Pengiriman</h1>
          <p className="text-sm text-slate-500 mt-1">Atur metode pengiriman yang muncul di form pembuatan order manual.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadMethods()}
          disabled={loading}
          className="inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-slate-100 text-slate-700 disabled:opacity-50"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-3">
        <h2 className="text-sm font-black text-slate-900">Tambah Metode Baru</h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nama metode (contoh: Instant)"
            className="md:col-span-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          <input
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder="Kode opsional (auto jika kosong)"
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          <input
            type="number"
            value={newFee}
            onChange={(e) => setNewFee(e.target.value)}
            placeholder="Biaya"
            min={0}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          <input
            type="number"
            value={newSortOrder}
            onChange={(e) => setNewSortOrder(e.target.value)}
            placeholder="Urutan"
            min={0}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="inline-flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={newActive}
              onChange={(e) => setNewActive(e.target.checked)}
            />
            Aktifkan metode ini
          </label>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating}
            className="inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-emerald-600 text-white disabled:opacity-50"
          >
            <Plus size={12} />
            {creating ? 'Menyimpan...' : 'Tambah Metode'}
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-black text-slate-900">Daftar Metode Pengiriman</h2>
          <p className="text-[11px] font-semibold text-slate-500">
            {activeCount} aktif dari {methods.length} metode
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Memuat metode pengiriman...</p>
        ) : methods.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
            Belum ada metode pengiriman.
          </div>
        ) : (
          <div className="space-y-2">
            {methods.map((method) => {
              const draft = drafts[method.code] || {
                name: method.name,
                fee: String(method.fee),
                is_active: method.is_active,
                sort_order: String(method.sort_order),
              };
              const processing = processingCode === method.code;
              return (
                <div key={method.code} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-2 text-sm font-black text-slate-900">
                      <Truck size={14} />
                      {method.code}
                    </div>
                    <span className={`text-[10px] font-black px-2 py-1 rounded-full ${draft.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                      {draft.is_active ? 'ACTIVE' : 'NONAKTIF'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                    <input
                      value={draft.name}
                      onChange={(e) => setDrafts((prev) => ({
                        ...prev,
                        [method.code]: { ...draft, name: e.target.value }
                      }))}
                      className="md:col-span-2 bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm"
                    />
                    <input
                      type="number"
                      value={draft.fee}
                      min={0}
                      onChange={(e) => setDrafts((prev) => ({
                        ...prev,
                        [method.code]: { ...draft, fee: e.target.value }
                      }))}
                      className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm"
                    />
                    <input
                      type="number"
                      value={draft.sort_order}
                      min={0}
                      onChange={(e) => setDrafts((prev) => ({
                        ...prev,
                        [method.code]: { ...draft, sort_order: e.target.value }
                      }))}
                      className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm"
                    />
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 bg-white border border-slate-200 rounded-xl px-3 py-2">
                      <input
                        type="checkbox"
                        checked={draft.is_active}
                        onChange={(e) => setDrafts((prev) => ({
                          ...prev,
                          [method.code]: { ...draft, is_active: e.target.checked }
                        }))}
                      />
                      Aktif
                    </label>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-500">
                      Biaya saat ini: <span className="font-bold text-slate-700">{formatCurrency(Number(draft.fee || 0))}</span>
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={processing}
                        onClick={() => void handleSaveRow(method.code)}
                        className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50"
                      >
                        <Save size={12} /> Simpan
                      </button>
                      <button
                        type="button"
                        disabled={processing}
                        onClick={() => void handleDeleteRow(method.code)}
                        className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 disabled:opacity-50"
                      >
                        <Trash2 size={12} /> Hapus
                      </button>
                    </div>
                  </div>
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

