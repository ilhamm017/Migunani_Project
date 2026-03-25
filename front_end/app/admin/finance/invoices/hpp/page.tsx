'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useRequireRoles } from '@/lib/guards';

export default function InvoiceHppLookupPage() {
  const allowed = useRequireRoles(['super_admin']);
  const router = useRouter();
  const [invoiceId, setInvoiceId] = useState('');

  if (!allowed) return null;

  const go = () => {
    const id = invoiceId.trim();
    if (!id) return;
    router.push(`/admin/finance/invoices/hpp/${encodeURIComponent(id)}`);
  };

  return (
    <div className="p-6 space-y-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
        <h1 className="text-xl font-black text-slate-900">Override HPP (Harga Beli) Invoice</h1>
        <p className="text-xs text-slate-600">
          Masukkan Invoice ID untuk mengubah harga beli per invoice (tanpa mengubah data unit_cost asli).
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={invoiceId}
            onChange={(e) => setInvoiceId(e.target.value)}
            placeholder="Invoice ID (UUID)"
            className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"
          />
          <button
            type="button"
            onClick={go}
            className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm font-black"
          >
            Buka
          </button>
        </div>
      </div>
    </div>
  );
}

