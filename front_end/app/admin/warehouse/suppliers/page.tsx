'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';

interface SupplierRow {
  id: number;
  name: string;
  contact: string | null;
  address: string | null;
}

export default function InventorySuppliersPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'kasir'], '/admin');
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierContact, setNewSupplierContact] = useState('');
  const [newSupplierAddress, setNewSupplierAddress] = useState('');
  const [editingSupplierId, setEditingSupplierId] = useState<number | null>(null);
  const [editingSupplierName, setEditingSupplierName] = useState('');
  const [editingSupplierContact, setEditingSupplierContact] = useState('');
  const [editingSupplierAddress, setEditingSupplierAddress] = useState('');

  const loadSuppliers = async () => {
    try {
      setLoading(true);
      const res = await api.admin.inventory.getSuppliers();
      setSuppliers(res.data?.suppliers || []);
    } catch (error) {
      setMessageType('error');
      const err = error as any;
      setMessage(err?.response?.data?.message || 'Gagal memuat supplier.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (allowed) {
      loadSuppliers();
    }
  }, [allowed]);

  if (!allowed) return null;

  const onCreateSupplier = async () => {
    const name = newSupplierName.trim();
    if (!name) {
      setMessageType('error');
      setMessage('Nama supplier wajib diisi.');
      return;
    }

    setIsSaving(true);
    setMessage('');
    try {
      await api.admin.inventory.createSupplier({
        name,
        contact: newSupplierContact.trim() || undefined,
        address: newSupplierAddress.trim() || undefined,
      });
      setNewSupplierName('');
      setNewSupplierContact('');
      setNewSupplierAddress('');
      await loadSuppliers();
      setMessageType('success');
      setMessage('Supplier berhasil ditambahkan.');
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Gagal menambah supplier.');
    } finally {
      setIsSaving(false);
    }
  };

  const startEditSupplier = (supplier: SupplierRow) => {
    setEditingSupplierId(supplier.id);
    setEditingSupplierName(supplier.name);
    setEditingSupplierContact(supplier.contact || '');
    setEditingSupplierAddress(supplier.address || '');
  };

  const cancelEditSupplier = () => {
    setEditingSupplierId(null);
    setEditingSupplierName('');
    setEditingSupplierContact('');
    setEditingSupplierAddress('');
  };

  const onUpdateSupplier = async () => {
    if (!editingSupplierId) return;
    const name = editingSupplierName.trim();
    if (!name) {
      setMessageType('error');
      setMessage('Nama supplier wajib diisi.');
      return;
    }

    setIsSaving(true);
    setMessage('');
    try {
      await api.admin.inventory.updateSupplier(editingSupplierId, {
        name,
        contact: editingSupplierContact.trim(),
        address: editingSupplierAddress.trim(),
      });
      await loadSuppliers();
      setMessageType('success');
      setMessage('Supplier berhasil diperbarui.');
      cancelEditSupplier();
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Gagal memperbarui supplier.');
    } finally {
      setIsSaving(false);
    }
  };

  const onDeleteSupplier = async (supplier: SupplierRow) => {
    const replacementInput = window.prompt(
      `Hapus supplier "${supplier.name}"?\nJika supplier masih dipakai PO, isi ID supplier pengganti.\nKosongkan jika tidak dipakai.`,
      ''
    );
    if (replacementInput === null) return;

    const replacementId = replacementInput.trim() === '' ? undefined : Number(replacementInput.trim());
    if (replacementInput.trim() !== '' && (!Number.isInteger(replacementId) || Number(replacementId) <= 0)) {
      setMessageType('error');
      setMessage('ID supplier pengganti tidak valid.');
      return;
    }

    setIsSaving(true);
    setMessage('');
    try {
      await api.admin.inventory.deleteSupplier(supplier.id, replacementId);
      await loadSuppliers();
      setMessageType('success');
      setMessage('Supplier berhasil dihapus.');
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Gagal menghapus supplier.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="warehouse-page">
      <div>
        <h1 className="warehouse-title">Manajemen Supplier</h1>
        <p className="warehouse-subtitle">Kelola data vendor pemasok barang untuk proses pengadaan dan inbound stok.</p>
      </div>

      {message && (
        <div className={`rounded-2xl border p-3 text-sm ${messageType === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
          {message}
        </div>
      )}

      <div className="warehouse-panel bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input
            value={newSupplierName}
            onChange={(e) => setNewSupplierName(e.target.value)}
            placeholder="Nama supplier"
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          <input
            value={newSupplierContact}
            onChange={(e) => setNewSupplierContact(e.target.value)}
            placeholder="Kontak (opsional)"
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          <button
            onClick={onCreateSupplier}
            disabled={isSaving}
            className="rounded-xl bg-emerald-600 text-white text-sm font-bold px-3 py-2 inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Plus size={14} />
            Tambah Supplier
          </button>
          <textarea
            value={newSupplierAddress}
            onChange={(e) => setNewSupplierAddress(e.target.value)}
            placeholder="Alamat supplier (opsional)"
            className="md:col-span-3 border border-slate-200 rounded-xl px-3 py-2 text-sm h-20"
          />
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Memuat supplier...</p>
        ) : suppliers.length === 0 ? (
          <p className="text-sm text-slate-500">Belum ada supplier.</p>
        ) : (
          <div className="space-y-2 max-h-[520px] overflow-auto pr-1">
            {suppliers.map((supplier) => (
              <div key={supplier.id} className="border border-slate-200 rounded-xl p-3 bg-slate-50">
                {editingSupplierId === supplier.id ? (
                  <div className="space-y-2">
                    <input
                      value={editingSupplierName}
                      onChange={(e) => setEditingSupplierName(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    />
                    <input
                      value={editingSupplierContact}
                      onChange={(e) => setEditingSupplierContact(e.target.value)}
                      placeholder="Kontak (opsional)"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    />
                    <textarea
                      value={editingSupplierAddress}
                      onChange={(e) => setEditingSupplierAddress(e.target.value)}
                      placeholder="Alamat (opsional)"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm h-20"
                    />
                    <div className="flex gap-2">
                      <button onClick={onUpdateSupplier} disabled={isSaving} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold">Simpan</button>
                      <button onClick={cancelEditSupplier} disabled={isSaving} className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold">Batal</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-slate-900">{supplier.name}</p>
                      <p className="text-xs text-slate-500">Kontak: {supplier.contact || '-'}</p>
                      <p className="text-xs text-slate-500">Alamat: {supplier.address || '-'}</p>
                      <p className="text-[11px] text-slate-400">ID: {supplier.id}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => startEditSupplier(supplier)} className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-bold">Edit</button>
                      <button onClick={() => onDeleteSupplier(supplier)} disabled={isSaving} className="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold inline-flex items-center gap-1">
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
