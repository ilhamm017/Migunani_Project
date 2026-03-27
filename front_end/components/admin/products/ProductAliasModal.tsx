'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import { notifyOpen } from '@/lib/notify';

type Props = {
  open: boolean;
  onClose: () => void;
  product: { id: string; name?: string; sku?: string } | null;
};

const parseAliasText = (text: string): string[] => {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
};

export default function ProductAliasModal({ open, onClose, product }: Props) {
  const productId = String(product?.id || '').trim();
  const title = useMemo(() => {
    const name = String(product?.name || '').trim();
    const sku = String(product?.sku || '').trim();
    if (sku && name) return `${sku} • ${name}`;
    return sku || name || 'Produk';
  }, [product?.name, product?.sku]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [aliasText, setAliasText] = useState('');

  const loadAliases = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.admin.inventory.getProductAliases(productId);
      const aliases = Array.isArray((res as any)?.data?.aliases) ? (res as any).data.aliases : [];
      setAliasText(aliases.map((v: unknown) => String(v || '').trim()).filter(Boolean).join('\n'));
    } catch (e: unknown) {
      const message = typeof e === 'object' && e && 'response' in e
        ? String((e as any).response?.data?.message || '')
        : '';
      setError(message || 'Gagal memuat alias produk.');
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    if (!open) return;
    if (!productId) return;
    void loadAliases();
  }, [open, productId, loadAliases]);

  const handleClose = () => {
    if (saving) return;
    setError('');
    onClose();
  };

  const handleSave = async () => {
    if (!productId) return;
    setSaving(true);
    setError('');
    try {
      const aliases = parseAliasText(aliasText);
      const res = await api.admin.inventory.updateProductAliases(productId, aliases);
      const nextAliases = Array.isArray((res as any)?.data?.aliases) ? (res as any).data.aliases : aliases;
      setAliasText(nextAliases.map((v: unknown) => String(v || '').trim()).filter(Boolean).join('\n'));
      notifyOpen({ variant: 'success', title: 'Berhasil', message: 'Alias tersimpan.', autoCloseMs: 1200 });
      onClose();
    } catch (e: unknown) {
      const message = typeof e === 'object' && e && 'response' in e
        ? String((e as any).response?.data?.message || '')
        : '';
      const text = message || 'Gagal menyimpan alias.';
      setError(text);
      notifyOpen({ variant: 'error', title: 'Gagal', message: text });
    } finally {
      setSaving(false);
    }
  };

  if (!open || !productId) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/40 p-4 pb-28 sm:p-6">
      <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 pb-4 pt-5">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">Alias Produk</p>
            <h3 className="mt-2 text-sm font-black text-slate-900">{title}</h3>
            <p className="mt-1 text-xs text-slate-500">Satu alias per baris. Kamu bisa edit atau hapus baris untuk koreksi.</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            aria-label="Tutup"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {loading ? (
            <p className="text-sm text-slate-500">Memuat alias...</p>
          ) : (
            <textarea
              value={aliasText}
              onChange={(e) => setAliasText(e.target.value)}
              disabled={saving}
              rows={8}
              placeholder="Contoh:\noli merah\npiston kid\n0,25"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-emerald-300 focus:bg-white disabled:opacity-60"
            />
          )}
          {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  );
}

