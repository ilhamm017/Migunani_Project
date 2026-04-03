'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, RefreshCw, Pencil, Trash2, ArrowLeftRight, ExternalLink } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { notifyConfirm, notifyPrompt } from '@/lib/notify';

type ApiErrorWithMessage = {
  response?: {
    status?: number;
    data?: { message?: string };
  };
};

export default function VehicleTypesPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang'], '/admin');
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');

  const [editingFrom, setEditingFrom] = useState<string | null>(null);
  const [editingTo, setEditingTo] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      setMessage(null);
      const res = await api.admin.inventory.getVehicleTypes();
      setOptions(Array.isArray(res.data?.options) ? res.data.options : []);
    } catch (error) {
      const err = error as ApiErrorWithMessage;
      setMessage({ type: 'error', text: err?.response?.data?.message || 'Gagal memuat master jenis kendaraan.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (allowed) load();
  }, [allowed]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => opt.toLowerCase().includes(q));
  }, [options, query]);

  if (!allowed) return null;

  const onCreate = async () => {
    const name = newName.trim().replace(/\s+/g, ' ');
    if (!name) {
      setMessage({ type: 'error', text: 'Nama jenis kendaraan wajib diisi.' });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const res = await api.admin.inventory.createVehicleType({ name });
      setOptions(Array.isArray(res.data?.options) ? res.data.options : []);
      setNewName('');
      setMessage({ type: 'success', text: 'Jenis kendaraan berhasil ditambahkan.' });
    } catch (error) {
      const err = error as ApiErrorWithMessage;
      setMessage({ type: 'error', text: err?.response?.data?.message || 'Gagal menambah jenis kendaraan.' });
    } finally {
      setSaving(false);
    }
  };

  const startRename = (from: string) => {
    setEditingFrom(from);
    setEditingTo(from);
    setMessage(null);
  };

  const cancelRename = () => {
    setEditingFrom(null);
    setEditingTo('');
  };

  const onRename = async () => {
    if (!editingFrom) return;
    const from = editingFrom;
    const to = editingTo.trim().replace(/\s+/g, ' ');
    if (!to) {
      setMessage({ type: 'error', text: 'Nama baru wajib diisi.' });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const res = await api.admin.inventory.renameVehicleType({ from, to });
      setOptions(Array.isArray(res.data?.options) ? res.data.options : []);
      cancelRename();
      setMessage({ type: 'success', text: 'Jenis kendaraan berhasil di-rename dan produk terkait dimigrasikan.' });
    } catch (error) {
      const err = error as ApiErrorWithMessage;
      setMessage({ type: 'error', text: err?.response?.data?.message || 'Gagal rename jenis kendaraan.' });
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (name: string) => {
    const ok = await notifyConfirm({
      title: 'Hapus Jenis Kendaraan',
      message: `Hapus jenis kendaraan "${name}"?`,
      confirmLabel: 'Hapus',
      cancelLabel: 'Batal',
      variant: 'warning',
    });
    if (!ok) return;

    setSaving(true);
    setMessage(null);
    try {
      const res = await api.admin.inventory.deleteVehicleType({ name });
      setOptions(Array.isArray(res.data?.options) ? res.data.options : []);
      setMessage({ type: 'success', text: 'Jenis kendaraan berhasil dihapus.' });
    } catch (error) {
      const err = error as ApiErrorWithMessage;
      const status = err?.response?.status;
      const serverMsg = err?.response?.data?.message || 'Gagal menghapus jenis kendaraan.';
      if (status === 409) {
        const replacement = await notifyPrompt({
          title: 'Butuh Replacement',
          message: (
            <span className="whitespace-pre-wrap">
              {`${serverMsg}\n\nIsi replacement untuk mengganti di semua produk (wajib jika sedang dipakai):`}
            </span>
          ),
          inputLabel: 'Replacement',
          placeholder: 'Contoh: MATIC 125',
          initialValue: '',
          confirmLabel: 'Hapus & Migrasi',
          cancelLabel: 'Batal',
          variant: 'warning',
        });
        if (replacement === null) {
          setSaving(false);
          return;
        }
        const rep = replacement.trim().replace(/\s+/g, ' ');
        if (!rep) {
          setMessage({ type: 'error', text: 'Replacement wajib diisi untuk menghapus item yang sedang dipakai.' });
          setSaving(false);
          return;
        }
        try {
          const res2 = await api.admin.inventory.deleteVehicleType({ name, replacement: rep });
          setOptions(Array.isArray(res2.data?.options) ? res2.data.options : []);
          setMessage({ type: 'success', text: 'Item berhasil dihapus dan produk terkait dimigrasikan.' });
        } catch (error2) {
          const err2 = error2 as ApiErrorWithMessage;
          setMessage({ type: 'error', text: err2?.response?.data?.message || 'Gagal menghapus (dengan replacement).' });
        } finally {
          setSaving(false);
        }
        return;
      }
      setMessage({ type: 'error', text: serverMsg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 pb-24 space-y-6 animate-in fade-in duration-500">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] mb-1">Master Data</p>
          <h1 className="text-2xl font-black text-slate-900 leading-none">Jenis Kendaraan</h1>
          <p className="text-xs text-slate-500 mt-2 max-w-xl">
            Daftar ini menjadi sumber kebenaran untuk field <span className="font-mono">vehicle_compatibility</span> pada produk.
            Produk hanya boleh memilih dari list ini.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading || saving}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 disabled:opacity-50 inline-flex items-center gap-2"
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <Link
            href="/admin/warehouse/stok"
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2"
          >
            <ExternalLink size={14} /> Ke Stok
          </Link>
        </div>
      </header>

      {message ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${message.type === 'success'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-rose-200 bg-rose-50 text-rose-700'
            }`}
        >
          {message.text}
        </div>
      ) : null}

      <section className="bg-white border border-slate-200 rounded-[24px] p-4 space-y-3 shadow-sm">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tambah Item</p>
        <div className="flex flex-col md:flex-row gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Contoh: Honda Beat, Yamaha NMAX"
            className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
          <button
            onClick={onCreate}
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            <Plus size={14} /> Tambah
          </button>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-[24px] p-4 space-y-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Daftar</p>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari..."
            className="w-48 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-emerald-500"
          />
        </div>

        {loading ? (
          <div className="py-10 text-center text-slate-400 text-sm">Memuat...</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-slate-400 text-sm">Belum ada data.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {filtered.map((opt) => (
              <div key={opt} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-900 truncate">{opt}</p>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Vehicle Type</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => startRename(opt)}
                    disabled={saving}
                    className="p-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    title="Rename"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => onDelete(opt)}
                    disabled={saving}
                    className="p-2 rounded-xl border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    title="Hapus"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {editingFrom ? (
        <section className="bg-white border border-slate-200 rounded-[24px] p-4 space-y-3 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Rename</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-800">
              {editingFrom}
            </div>
            <div className="flex items-center justify-center text-slate-400">
              <ArrowLeftRight size={18} />
            </div>
            <input
              value={editingTo}
              onChange={(e) => setEditingTo(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onRename}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest hover:bg-slate-800 disabled:opacity-50"
            >
              Simpan Rename
            </button>
            <button
              onClick={cancelRename}
              disabled={saving}
              className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Batal
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
