'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { notifyPrompt } from '@/lib/notify';

interface CategoryRow {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  primary_product_count?: number;
  tag_product_count?: number;
  is_primary?: boolean;
  is_tag?: boolean;
}

type ApiErrorWithMessage = {
  response?: { data?: { message?: string } };
};

const CATEGORY_ICON_OPTIONS = [
  { value: '', label: 'Tanpa Icon' },
  { value: 'droplets', label: 'Droplets (Oli/Pelumas)' },
  { value: 'settings', label: 'Settings (Mesin)' },
  { value: 'circle-dot', label: 'Circle Dot (Ban)' },
  { value: 'disc-3', label: 'Disc (Rem)' },
  { value: 'lightbulb', label: 'Lightbulb (Lampu)' },
  { value: 'battery-charging', label: 'Battery (Aki)' },
  { value: 'funnel', label: 'Funnel (Filter)' },
  { value: 'package', label: 'Package (Umum)' },
];

export default function InventoryCategoriesPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang'], '/admin');
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  const [query, setQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'primary' | 'tag' | 'unused'>('all');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryDescription, setNewCategoryDescription] = useState('');
  const [newCategoryIcon, setNewCategoryIcon] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [editingCategoryDescription, setEditingCategoryDescription] = useState('');
  const [editingCategoryIcon, setEditingCategoryIcon] = useState('');

  const loadCategories = async () => {
    try {
      setLoading(true);
      const res = await api.admin.inventory.getCategories();
      setCategories(res.data?.categories || []);
    } catch (error: unknown) {
      setMessageType('error');
      const err = error as ApiErrorWithMessage;
      setMessage(err?.response?.data?.message || 'Gagal memuat kategori.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (allowed) {
      loadCategories();
    }
  }, [allowed]);

  const normalizedCategories = useMemo(() => {
    return categories.map((category) => {
      const primary = Number(category.primary_product_count || 0);
      const tag = Number(category.tag_product_count || 0);
      const isPrimary = Boolean(category.is_primary) || primary > 0;
      const isTag = Boolean(category.is_tag) || tag > 0;
      const role: 'primary' | 'tag' | 'both' | 'unused' =
        isPrimary && isTag ? 'both' : isPrimary ? 'primary' : isTag ? 'tag' : 'unused';
      return {
        ...category,
        primary_product_count: primary,
        tag_product_count: tag,
        is_primary: isPrimary,
        is_tag: isTag,
        role,
      };
    });
  }, [categories]);

  const filteredCategories = useMemo(() => {
    const q = query.trim().toLowerCase();
    return normalizedCategories.filter((category) => {
      if (filterMode === 'primary' && category.role !== 'primary' && category.role !== 'both') return false;
      if (filterMode === 'tag' && category.role !== 'tag' && category.role !== 'both') return false;
      if (filterMode === 'unused' && category.role !== 'unused') return false;
      if (!q) return true;
      return (
        category.name.toLowerCase().includes(q) ||
        String(category.id).includes(q) ||
        String(category.icon || '').toLowerCase().includes(q)
      );
    });
  }, [normalizedCategories, query, filterMode]);

  const summary = useMemo(() => {
    const total = normalizedCategories.length;
    const primary = normalizedCategories.filter((item) => item.role === 'primary').length;
    const tag = normalizedCategories.filter((item) => item.role === 'tag').length;
    const both = normalizedCategories.filter((item) => item.role === 'both').length;
    const unused = normalizedCategories.filter((item) => item.role === 'unused').length;
    return { total, primary, tag, both, unused };
  }, [normalizedCategories]);

  if (!allowed) return null;

  const onCreateCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) {
      setMessageType('error');
      setMessage('Nama kategori baru wajib diisi.');
      return;
    }

    setIsSaving(true);
    setMessage('');
    try {
      await api.admin.inventory.createCategory({
        name,
        description: newCategoryDescription.trim() || undefined,
        icon: newCategoryIcon || undefined,
      });
      setNewCategoryName('');
      setNewCategoryDescription('');
      setNewCategoryIcon('');
      await loadCategories();
      setMessageType('success');
      setMessage('Kategori baru berhasil ditambahkan.');
    } catch (error: unknown) {
      const err = error as ApiErrorWithMessage;
      setMessageType('error');
      setMessage(err?.response?.data?.message || 'Gagal menambah kategori.');
    } finally {
      setIsSaving(false);
    }
  };

  const startEditCategory = (category: CategoryRow) => {
    setEditingCategoryId(category.id);
    setEditingCategoryName(category.name);
    setEditingCategoryDescription(category.description || '');
    setEditingCategoryIcon(category.icon || '');
  };

  const cancelEditCategory = () => {
    setEditingCategoryId(null);
    setEditingCategoryName('');
    setEditingCategoryDescription('');
    setEditingCategoryIcon('');
  };

  const onUpdateCategory = async () => {
    if (!editingCategoryId) return;
    const name = editingCategoryName.trim();
    if (!name) {
      setMessageType('error');
      setMessage('Nama kategori wajib diisi.');
      return;
    }

    setIsSaving(true);
    setMessage('');
    try {
      await api.admin.inventory.updateCategory(editingCategoryId, {
        name,
        description: editingCategoryDescription.trim() || '',
        icon: editingCategoryIcon || '',
      });
      await loadCategories();
      setMessageType('success');
      setMessage('Kategori berhasil diperbarui.');
      cancelEditCategory();
    } catch (error: unknown) {
      const err = error as ApiErrorWithMessage;
      setMessageType('error');
      setMessage(err?.response?.data?.message || 'Gagal memperbarui kategori.');
    } finally {
      setIsSaving(false);
    }
  };

  const onDeleteCategory = async (category: CategoryRow) => {
    const primaryCount = Number(category.primary_product_count || 0);
    const tagCount = Number(category.tag_product_count || 0);
    const usageDetail = primaryCount > 0 || tagCount > 0
      ? `Dipakai: ${primaryCount} produk (utama) + ${tagCount} produk (tag)`
      : 'Tidak dipakai produk.';

    const replacementInput = await notifyPrompt({
      title: 'Hapus Kategori',
      message: (
        <span className="whitespace-pre-wrap">
          {`Hapus kategori "${category.name}"?\n${usageDetail}\n\nJika kategori dipakai, wajib isi ID kategori pengganti.\nKosongkan hanya jika benar-benar tidak dipakai.`}
        </span>
      ),
      inputLabel: 'ID Kategori Pengganti',
      placeholder: 'Contoh: 12 (kosongkan jika tidak dipakai)',
      initialValue: '',
      confirmLabel: 'Lanjut',
      cancelLabel: 'Batal',
      variant: 'warning',
    });
    if (replacementInput === null) return;

    const replacementId = replacementInput.trim() === '' ? undefined : Number(replacementInput.trim());
    if (replacementInput.trim() !== '' && (!Number.isInteger(replacementId) || Number(replacementId) <= 0)) {
      setMessageType('error');
      setMessage('ID kategori pengganti tidak valid.');
      return;
    }

    if ((primaryCount > 0 || tagCount > 0) && replacementId === undefined) {
      setMessageType('error');
      setMessage('Kategori masih dipakai produk, replacement ID wajib diisi untuk menghapus.');
      return;
    }

    setIsSaving(true);
    setMessage('');
    try {
      await api.admin.inventory.deleteCategory(category.id, replacementId);
      await loadCategories();
      setMessageType('success');
      setMessage('Kategori berhasil dihapus.');
    } catch (error: unknown) {
      const err = error as ApiErrorWithMessage;
      setMessageType('error');
      setMessage(err?.response?.data?.message || 'Gagal menghapus kategori.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="warehouse-page">
      <div>
        <h1 className="warehouse-title">Manajemen Kategori</h1>
        <p className="warehouse-subtitle">
          Format import baru: <span className="font-bold">"BAN LUAR: IRC"</span> berarti <span className="font-bold">BAN LUAR</span> (kategori utama) + <span className="font-bold">IRC</span> (tag/multi-kategori).
        </p>
      </div>

      {message && (
        <div className={`rounded-2xl border p-3 text-sm ${messageType === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
          {message}
        </div>
      )}

      <div className="warehouse-panel bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari nama / ID / icon..."
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          <select
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value as any)}
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white"
          >
            <option value="all">Semua kategori ({summary.total})</option>
            <option value="primary">Kategori utama ({summary.primary + summary.both})</option>
            <option value="tag">Tag / multi-kategori ({summary.tag + summary.both})</option>
            <option value="unused">Tidak dipakai ({summary.unused})</option>
          </select>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span className="font-bold text-slate-700">Ringkas:</span> Utama {summary.primary} • Tag {summary.tag} • Keduanya {summary.both} • Tidak dipakai {summary.unused}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <input
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="Nama kategori baru"
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          <input
            value={newCategoryDescription}
            onChange={(e) => setNewCategoryDescription(e.target.value)}
            placeholder="Deskripsi (opsional)"
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          <select
            value={newCategoryIcon}
            onChange={(e) => setNewCategoryIcon(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white"
          >
            {CATEGORY_ICON_OPTIONS.map((option) => (
              <option key={option.value || 'none'} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button
            onClick={onCreateCategory}
            disabled={isSaving}
            className="rounded-xl bg-emerald-600 text-white text-sm font-bold px-3 py-2 inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Plus size={14} />
            Tambah Kategori
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Memuat kategori...</p>
        ) : categories.length === 0 ? (
          <p className="text-sm text-slate-500">Belum ada kategori.</p>
        ) : (
          <div className="space-y-2 max-h-[520px] overflow-auto pr-1">
            {filteredCategories.map((category) => (
              <div key={category.id} className="border border-slate-200 rounded-xl p-3 bg-slate-50">
                {editingCategoryId === category.id ? (
                  <div className="space-y-2">
                    <input
                      value={editingCategoryName}
                      onChange={(e) => setEditingCategoryName(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    />
                    <input
                      value={editingCategoryDescription}
                      onChange={(e) => setEditingCategoryDescription(e.target.value)}
                      placeholder="Deskripsi (opsional)"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    />
                    <select
                      value={editingCategoryIcon}
                      onChange={(e) => setEditingCategoryIcon(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                    >
                      {CATEGORY_ICON_OPTIONS.map((option) => (
                        <option key={option.value || 'none'} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <button onClick={onUpdateCategory} disabled={isSaving} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold">Simpan</button>
                      <button onClick={cancelEditCategory} disabled={isSaving} className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold">Batal</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-slate-900">{category.name}</p>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${category.role === 'primary'
                          ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                          : category.role === 'tag'
                            ? 'bg-blue-100 text-blue-700 border-blue-200'
                            : category.role === 'both'
                              ? 'bg-violet-100 text-violet-700 border-violet-200'
                              : 'bg-slate-200 text-slate-700 border-slate-300'
                          }`}>
                          {category.role === 'primary' ? 'UTAMA' : category.role === 'tag' ? 'TAG' : category.role === 'both' ? 'UTAMA+TAG' : 'UNUSED'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">{category.description || '-'}</p>
                      <p className="text-xs text-slate-500">Icon: {category.icon || '-'}</p>
                      <p className="text-xs text-slate-500">
                        Dipakai: <span className="font-bold">{Number(category.primary_product_count || 0)}</span> (utama) + <span className="font-bold">{Number(category.tag_product_count || 0)}</span> (tag)
                      </p>
                      <p className="text-[11px] text-slate-400">ID: {category.id}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => startEditCategory(category)} className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-bold">Edit</button>
                      <button onClick={() => onDeleteCategory(category)} disabled={isSaving} className="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold inline-flex items-center gap-1">
                        <Trash2 size={12} />
                        Hapus
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
