'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';

interface CategoryRow {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
}

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
  const allowed = useRequireRoles(['super_admin', 'admin_gudang']);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
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
    } catch (error) {
      setMessageType('error');
      const err = error as any;
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
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Gagal menambah kategori.');
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
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Gagal memperbarui kategori.');
    } finally {
      setIsSaving(false);
    }
  };

  const onDeleteCategory = async (category: CategoryRow) => {
    const replacementInput = window.prompt(
      `Hapus kategori "${category.name}"?\nJika kategori dipakai produk, isi ID kategori pengganti.\nKosongkan jika kategori tidak dipakai.`,
      ''
    );
    if (replacementInput === null) return;

    const replacementId = replacementInput.trim() === '' ? undefined : Number(replacementInput.trim());
    if (replacementInput.trim() !== '' && (!Number.isInteger(replacementId) || Number(replacementId) <= 0)) {
      setMessageType('error');
      setMessage('ID kategori pengganti tidak valid.');
      return;
    }

    setIsSaving(true);
    setMessage('');
    try {
      await api.admin.inventory.deleteCategory(category.id, replacementId);
      await loadCategories();
      setMessageType('success');
      setMessage('Kategori berhasil dihapus.');
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Gagal menghapus kategori.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm">
        <h1 className="text-xl font-black text-slate-900">Manajemen Kategori</h1>
        <p className="text-sm text-slate-600 mt-1">Tambah, edit, atau hapus kategori produk gudang.</p>
      </div>

      {message && (
        <div className={`rounded-2xl border p-3 text-sm ${messageType === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Link href="/admin/inventory" className="bg-white border border-slate-200 rounded-2xl p-4 text-sm font-bold text-slate-800">Daftar Produk</Link>
        <Link href="/admin/inventory/categories" className="bg-slate-900 border border-slate-900 rounded-2xl p-4 text-sm font-bold text-white">Manajemen Kategori</Link>
        <Link href="/admin/inventory/suppliers" className="bg-white border border-slate-200 rounded-2xl p-4 text-sm font-bold text-slate-800">Manajemen Supplier</Link>
        <Link href="/admin/inventory/import" className="bg-white border border-slate-200 rounded-2xl p-4 text-sm font-bold text-slate-800">Import Excel/CSV</Link>
        <Link href="/admin/inventory/scanner" className="bg-white border border-slate-200 rounded-2xl p-4 text-sm font-bold text-slate-800">Scanner SKU</Link>
        <Link href="/admin/inventory/purchase-order" className="bg-white border border-slate-200 rounded-2xl p-4 text-sm font-bold text-slate-800">Purchase Order</Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-4">
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
            {categories.map((category) => (
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
                      <p className="text-sm font-bold text-slate-900">{category.name}</p>
                      <p className="text-xs text-slate-500">{category.description || '-'}</p>
                      <p className="text-xs text-slate-500">Icon: {category.icon || '-'}</p>
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
