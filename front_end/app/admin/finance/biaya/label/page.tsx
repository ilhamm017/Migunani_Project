'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';

type ExpenseLabel = {
  id: number;
  name: string;
  description: string | null;
};

export default function ExpenseLabelConfigPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_finance']);
  const [labels, setLabels] = useState<ExpenseLabel[]>([]);
  const [createForm, setCreateForm] = useState({ name: '', description: '' });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '' });

  const loadLabels = async () => {
    try {
      const res = await api.admin.finance.getExpenseLabels();
      setLabels((res.data?.labels || []) as ExpenseLabel[]);
    } catch (error) {
      console.error('Failed to load expense labels:', error);
    }
  };

  useEffect(() => {
    if (!allowed) return;
    loadLabels();
  }, [allowed]);

  if (!allowed) return null;

  const createLabel = async () => {
    const name = createForm.name.trim();
    if (!name) return;

    try {
      await api.admin.finance.createExpenseLabel({
        name,
        description: createForm.description.trim() || undefined,
      });
      setCreateForm({ name: '', description: '' });
      await loadLabels();
    } catch (error) {
      console.error('Create label failed:', error);
      alert('Gagal menambah label.');
    }
  };

  const startEdit = (label: ExpenseLabel) => {
    setEditingId(label.id);
    setEditForm({
      name: label.name,
      description: label.description || '',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ name: '', description: '' });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const name = editForm.name.trim();
    if (!name) return;

    try {
      await api.admin.finance.updateExpenseLabel(editingId, {
        name,
        description: editForm.description.trim() || undefined,
      });
      cancelEdit();
      await loadLabels();
    } catch (error) {
      console.error('Update label failed:', error);
      alert('Gagal mengubah label.');
    }
  };

  const deleteLabel = async (label: ExpenseLabel) => {
    const confirmed = confirm(`Hapus label "${label.name}"?`);
    if (!confirmed) return;

    try {
      await api.admin.finance.deleteExpenseLabel(label.id);
      await loadLabels();
    } catch (error) {
      console.error('Delete label failed:', error);
      alert('Gagal menghapus label.');
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900">Konfigurasi Label Biaya</h1>
          <p className="text-xs text-slate-500 mt-1">Kelola label biaya operasional seperti listrik, gaji, ongkir, dan lainnya.</p>
        </div>
        <Link
          href="/admin/finance/biaya"
          className="px-3 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:border-emerald-400 hover:text-emerald-700"
        >
          Kembali ke Input Biaya
        </Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-2">
        <input
          className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          placeholder="Nama label (contoh: Listrik)"
          value={createForm.name}
          onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))}
        />
        <input
          className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          placeholder="Deskripsi (opsional)"
          value={createForm.description}
          onChange={(e) => setCreateForm((p) => ({ ...p, description: e.target.value }))}
        />
        <button onClick={createLabel} className="bg-emerald-600 text-white rounded-xl text-sm font-bold">Tambah Label</button>
      </div>

      <div className="space-y-2">
        {labels.map((label) => {
          const isEditing = editingId === label.id;
          return (
            <div key={label.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row md:items-center gap-2">
              {isEditing ? (
                <>
                  <input
                    className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm md:flex-1"
                    value={editForm.name}
                    onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                  />
                  <input
                    className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm md:flex-1"
                    value={editForm.description}
                    onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <button onClick={saveEdit} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold">Simpan</button>
                    <button onClick={cancelEdit} className="px-3 py-2 rounded-lg bg-slate-200 text-slate-700 text-xs font-bold">Batal</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="md:flex-1">
                    <p className="text-sm font-bold text-slate-900">{label.name}</p>
                    {label.description && <p className="text-xs text-slate-500">{label.description}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => startEdit(label)} className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-xs font-bold">Edit</button>
                    <button onClick={() => deleteLabel(label)} className="px-3 py-2 rounded-lg bg-rose-600 text-white text-xs font-bold">Hapus</button>
                  </div>
                </>
              )}
            </div>
          );
        })}

        {labels.length === 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <p className="text-xs text-slate-500">Belum ada label biaya. Tambahkan label baru terlebih dahulu.</p>
          </div>
        )}
      </div>
    </div>
  );
}
