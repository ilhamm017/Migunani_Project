'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';

interface SupplierRow {
  id: number;
  name: string;
  contact: string | null;
}

export default function PurchaseOrderPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang']);
  const [supplierId, setSupplierId] = useState('');
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);
  const [totalCost, setTotalCost] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const loadSuppliers = async () => {
    try {
      setLoadingSuppliers(true);
      const res = await api.admin.inventory.getSuppliers();
      setSuppliers(res.data?.suppliers || []);
    } catch (error) {
      const err = error as any;
      setErrorMessage(err?.response?.data?.message || 'Gagal memuat daftar supplier.');
    } finally {
      setLoadingSuppliers(false);
    }
  };

  useEffect(() => {
    if (allowed) {
      loadSuppliers();
    }
  }, [allowed]);

  if (!allowed) return null;

  const createPO = async () => {
    if (!supplierId || !totalCost) {
      setErrorMessage('Supplier dan total biaya wajib diisi.');
      return;
    }
    try {
      setLoading(true);
      setErrorMessage('');
      const res = await api.admin.inventory.createPO({
        supplier_id: Number(supplierId),
        total_cost: Number(totalCost),
      });
      setResult(res.data);
      setSupplierId('');
      setTotalCost('');
    } catch (error) {
      console.error('Create PO failed:', error);
      const err = error as any;
      setErrorMessage(err?.response?.data?.message || 'Gagal membuat purchase order.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm">
        <h1 className="text-xl font-black text-slate-900">Purchase Order</h1>
        <p className="text-sm text-slate-600 mt-1">Input barang masuk dari supplier.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Link href="/admin/inventory" className="bg-white border border-slate-200 rounded-2xl p-4 text-sm font-bold text-slate-800">Daftar Produk</Link>
        <Link href="/admin/inventory/categories" className="bg-white border border-slate-200 rounded-2xl p-4 text-sm font-bold text-slate-800">Manajemen Kategori</Link>
        <Link href="/admin/inventory/suppliers" className="bg-white border border-slate-200 rounded-2xl p-4 text-sm font-bold text-slate-800">Manajemen Supplier</Link>
        <Link href="/admin/inventory/import" className="bg-white border border-slate-200 rounded-2xl p-4 text-sm font-bold text-slate-800">Import Excel/CSV</Link>
        <Link href="/admin/inventory/scanner" className="bg-white border border-slate-200 rounded-2xl p-4 text-sm font-bold text-slate-800">Scanner SKU</Link>
        <Link href="/admin/inventory/purchase-order" className="bg-slate-900 border border-slate-900 rounded-2xl p-4 text-sm font-bold text-white">Purchase Order</Link>
      </div>

      {errorMessage && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {errorMessage}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3">
        <select
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm"
          disabled={loadingSuppliers}
        >
          <option value="">{loadingSuppliers ? 'Memuat supplier...' : 'Pilih supplier'}</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.id} - {supplier.name}{supplier.contact ? ` (${supplier.contact})` : ''}
            </option>
          ))}
        </select>
        <input value={totalCost} onChange={(e) => setTotalCost(e.target.value)} placeholder="Total biaya" type="number" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm" />
        <button onClick={createPO} disabled={loading} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black text-sm uppercase shadow-lg shadow-emerald-200">
          {loading ? 'Menyimpan...' : 'Buat PO'}
        </button>
      </div>

      {result && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
          <p className="text-sm font-bold text-emerald-700">PO berhasil dibuat</p>
          <p className="text-xs text-emerald-700 mt-1">ID: {result.id} • Status: {result.status}</p>
        </div>
      )}
    </div>
  );
}
