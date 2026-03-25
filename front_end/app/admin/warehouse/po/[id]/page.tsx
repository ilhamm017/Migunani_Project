'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, Download, Save, Search, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  stock_quantity: number;
  min_stock: number;
}

interface PreorderItem {
  id: number;
  product_id: string;
  qty: number;
  note?: string | null;
  Product?: ProductRow;
}

interface Preorder {
  id: string;
  supplier_id: number;
  status: 'draft' | 'finalized' | 'canceled';
  notes?: string | null;
  createdAt: string;
  finalized_at?: string | null;
  Supplier?: { id: number; name: string };
  Creator?: { id: string; name: string; role: string };
  Items?: PreorderItem[];
}

type ApiErrorWithMessage = {
  response?: { data?: { message?: string } };
};

export default function PreorderDetailPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir'], '/admin');
  const { id } = useParams();

  const [preorder, setPreorder] = useState<Preorder | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');

  const [draftNotes, setDraftNotes] = useState('');
  const [draftItems, setDraftItems] = useState<Array<{ product: ProductRow; qty: number; note: string }>>([]);

  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState<ProductRow[]>([]);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const res = await api.admin.procurement.getPreorderById(String(id));
      const data = res.data as Preorder;
      setPreorder(data);

      setDraftNotes(String(data?.notes || ''));
      const items = Array.isArray(data?.Items) ? data.Items : [];
      setDraftItems(items.map((it) => ({
        product: (it.Product || { id: it.product_id, sku: '-', name: '-', stock_quantity: 0, min_stock: 0 }) as ProductRow,
        qty: Number(it.qty || 1),
        note: String(it.note || ''),
      })));
    } catch (error) {
      console.error('Failed to load preorder', error);
      setMessage('Gagal memuat detail PO.');
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!allowed) return;
    void load();
  }, [allowed, load]);

  const canEdit = preorder?.status === 'draft';
  const canExport = preorder?.status === 'finalized';

  const itemsPayload = useMemo(() => {
    return draftItems.map((it) => ({
      product_id: it.product.id,
      qty: Math.max(1, Number(it.qty || 1)),
      ...(it.note.trim() ? { note: it.note.trim() } : {}),
    }));
  }, [draftItems]);

  const onSave = async () => {
    if (!preorder) return;
    if (!canEdit) return;
    if (itemsPayload.length <= 0) {
      setMessage('Minimal 1 item.');
      setMessageType('error');
      return;
    }

    setIsSaving(true);
    setMessage('');
    try {
      await api.admin.procurement.updatePreorder(preorder.id, {
        notes: draftNotes.trim() || null,
        items: itemsPayload,
      });
      setMessageType('success');
      setMessage('Draft PO tersimpan.');
      await load();
    } catch (error: unknown) {
      const err = error as ApiErrorWithMessage;
      setMessageType('error');
      setMessage(err?.response?.data?.message || 'Gagal menyimpan draft.');
    } finally {
      setIsSaving(false);
    }
  };

  const onFinalize = async () => {
    if (!preorder) return;
    if (!canEdit) return;
    setIsSaving(true);
    setMessage('');
    try {
      await api.admin.procurement.finalizePreorder(preorder.id);
      setMessageType('success');
      setMessage('PO berhasil difinalisasi.');
      await load();
    } catch (error: unknown) {
      const err = error as ApiErrorWithMessage;
      setMessageType('error');
      setMessage(err?.response?.data?.message || 'Gagal finalize PO.');
    } finally {
      setIsSaving(false);
    }
  };

  const onExportXlsx = async () => {
    if (!preorder) return;
    setIsExporting(true);
    setMessage('');
    try {
      const res = await api.admin.procurement.exportPreorderXlsx(preorder.id);
      const contentDisposition = String(res.headers?.['content-disposition'] || '');
      const filenameMatch = /filename=\"?([^\";]+)\"?/i.exec(contentDisposition);
      const fallbackName = `po-${preorder.id.split('-')[0]?.toUpperCase() || 'PO'}.xlsx`;
      const filename = filenameMatch?.[1] || fallbackName;

      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      setMessageType('success');
      setMessage('File XLSX berhasil diunduh.');
    } catch (error: unknown) {
      console.error('Failed to export XLSX', error);
      setMessageType('error');
      setMessage('Gagal ekstrak XLSX.');
    } finally {
      setIsExporting(false);
    }
  };

  const doProductSearch = useCallback(async (q: string) => {
    const query = q.trim();
    if (!query || query.length < 2) {
      setProductResults([]);
      return;
    }
    try {
      setSearching(true);
      const res = await api.admin.inventory.getProducts({ limit: 15, search: query, status: 'active' });
      setProductResults((res.data?.products || []) as ProductRow[]);
    } catch {
      setProductResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void doProductSearch(productSearch), 400);
    return () => clearTimeout(timer);
  }, [productSearch, doProductSearch]);

  const addProduct = (product: ProductRow) => {
    setDraftItems((prev) => {
      const idx = prev.findIndex((p) => p.product.id === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { product, qty: 1, note: '' }];
    });
  };

  const removeProduct = (productId: string) => setDraftItems((prev) => prev.filter((p) => p.product.id !== productId));

  if (!allowed) return null;

  if (loading && !preorder) {
    return (
      <div className="flex items-center justify-center p-20 text-slate-400">
        <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!preorder) {
    return (
      <div className="p-10 text-center">
        <AlertCircle className="mx-auto text-rose-500 mb-4" size={48} />
        <h2 className="text-xl font-bold">PO Tidak Ditemukan</h2>
        <Link href="/admin/warehouse/po/history" className="text-emerald-600 font-bold mt-4 inline-block">Kembali ke Riwayat</Link>
      </div>
    );
  }

  return (
    <div className="warehouse-page w-full max-w-none lg:h-full lg:overflow-hidden overflow-y-auto">
      <div className="flex items-center justify-between gap-4 mb-4 shrink-0">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/warehouse/po/history"
            className="p-2 hover:bg-slate-100 rounded-xl transition-all border border-slate-200 bg-white shadow-sm"
          >
            <ArrowLeft size={20} className="text-slate-600" />
          </Link>
          <div>
            <h1 className="warehouse-title !mb-0 flex items-center gap-2">
              <ShieldCheck className="text-emerald-600" />
              PO (PreOrder Supplier)
            </h1>
            <p className="warehouse-subtitle !mb-0 font-mono text-xs uppercase tracking-widest text-slate-400">
              PO #{preorder.id.split('-')[0].toUpperCase()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onExportXlsx}
            disabled={!canExport || isExporting}
            className="rounded-2xl bg-white border border-slate-200 text-slate-900 text-sm font-black px-5 py-3.5 inline-flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-slate-50 transition-all shadow-sm active:scale-95"
            title={canExport ? 'Ekstrak preorder ke XLSX' : 'Finalize dulu sebelum export'}
          >
            {isExporting ? (
              <div className="w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <Download size={18} />
            )}
            Ekstrak XLSX
          </button>
          {canEdit && (
            <>
              <button
                onClick={onSave}
                disabled={isSaving}
                className="rounded-2xl bg-slate-900 text-white text-sm font-black px-6 py-3.5 inline-flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-slate-800 transition-all shadow-lg active:scale-95"
              >
                {isSaving ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <Save size={18} />
                )}
                Simpan Draft
              </button>
              <button
                onClick={onFinalize}
                disabled={isSaving}
                className="rounded-2xl bg-emerald-600 text-white text-sm font-black px-6 py-3.5 inline-flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-emerald-700 transition-all shadow-lg active:scale-95"
              >
                Finalize
              </button>
            </>
          )}
        </div>
      </div>

      {message && (
        <div className={`rounded-2xl border px-4 py-3 text-sm font-medium shrink-0 ${messageType === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
          {message}
        </div>
      )}

      <div className="flex flex-col lg:grid lg:grid-cols-3 gap-4 flex-1 min-h-0">
        <div className="lg:col-span-1 min-h-0 order-2 lg:order-1">
          <div className="warehouse-panel bg-white border border-slate-200 rounded-3xl p-5 shadow-sm h-full flex flex-col">
            <h3 className="font-bold text-slate-900 mb-3">Header</h3>
            <div className="text-sm text-slate-700">
              <div className="font-black">{preorder.Supplier?.name || 'Unknown Supplier'}</div>
              <div className="text-xs text-slate-500 mt-1">Status: <span className="font-black uppercase">{preorder.status}</span></div>
              <div className="text-xs text-slate-500 mt-1">Dibuat: <span className="font-black">{new Date(preorder.createdAt).toLocaleString('id-ID')}</span> oleh <span className="font-black">{preorder.Creator?.name || '-'}</span></div>
            </div>

            <label className="text-xs font-black text-slate-500 uppercase tracking-wider mt-4 mb-1">Catatan</label>
            <textarea
              value={draftNotes}
              disabled={!canEdit}
              onChange={(e) => setDraftNotes(e.target.value)}
              rows={3}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all outline-none resize-none disabled:opacity-60"
              placeholder="Catatan untuk supplier"
            />

            <div className="mt-6 flex-1 min-h-0 overflow-y-auto pr-1 space-y-2">
              {draftItems.length === 0 ? (
                <div className="text-sm text-slate-400">Tidak ada item.</div>
              ) : (
                draftItems.map((it) => (
                  <div key={it.product.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-mono">{it.product.sku}</div>
                        <div className="font-black text-slate-900 truncate">{it.product.name}</div>
                      </div>
                      {canEdit && (
                        <button onClick={() => removeProduct(it.product.id)} className="text-rose-500 hover:underline text-xs font-bold">
                          Hapus
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Qty</label>
                        <input
                          type="number"
                          min={1}
                          disabled={!canEdit}
                          value={it.qty}
                          onChange={(e) => {
                            const nextQty = Math.max(1, Number(e.target.value || 1));
                            setDraftItems((prev) => prev.map((p) => p.product.id === it.product.id ? { ...p, qty: nextQty } : p));
                          }}
                          className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2 text-sm font-black focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Note</label>
                        <input
                          disabled={!canEdit}
                          value={it.note}
                          onChange={(e) => setDraftItems((prev) => prev.map((p) => p.product.id === it.product.id ? { ...p, note: e.target.value } : p))}
                          className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                          placeholder="opsional"
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 min-h-0 order-1 lg:order-2 flex flex-col gap-4">
          <div className="warehouse-panel bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
            <h3 className="font-bold text-slate-900 mb-3">Tambah Produk</h3>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                value={productSearch}
                disabled={!canEdit}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Cari SKU / nama produk (min 2 huruf)..."
                className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm font-medium disabled:opacity-60"
              />
            </div>
            <div className="mt-3 max-h-[520px] overflow-y-auto pr-1 space-y-2">
              {!canEdit ? (
                <div className="text-sm text-slate-400">PO sudah finalized, tidak bisa menambah item.</div>
              ) : searching ? (
                <div className="text-sm text-slate-500">Mencari...</div>
              ) : productResults.length === 0 ? (
                <div className="text-sm text-slate-400">Hasil akan muncul di sini.</div>
              ) : (
                productResults.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => addProduct(p)}
                    className="w-full text-left rounded-2xl border border-slate-200 bg-white p-3 hover:border-emerald-500 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-mono">{p.sku}</div>
                        <div className="font-black text-slate-900 truncate">{p.name}</div>
                      </div>
                      <span className="text-xs font-black text-emerald-700">Tambah</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
