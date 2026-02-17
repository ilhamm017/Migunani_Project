'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import FinanceHeader from '@/components/admin/finance/FinanceHeader';
import FinanceBottomNav from '@/components/admin/finance/FinanceBottomNav';
import { Plus } from 'lucide-react';

type ExpenseLabel = {
  id: number;
  name: string;
  description: string | null;
};

type ExpenseDetail = {
  key: string;
  value: string;
};

type ExpenseItem = {
  id: string;
  category: string;
  amount: number | string;
  date: string;
  note: string;
  details?: ExpenseDetail[];
  status: 'requested' | 'approved' | 'paid';
};

export default function FinanceExpensePage() {
  const allowed = useRequireRoles(['super_admin', 'admin_finance']);
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  // const [labels, setLabels] = useState<ExpenseLabel[]>([]); // Keep loading labels if we want to show filter or quick add? 
  // Let's simplify and make a FAB (Floating Action Button) for adding expense in a modal/bottom sheet?
  // For now maintain the inline form or move it to a modal. 
  // Design reference shows list with cards. Input might be separate.
  // I will keep the input form but style it as a Collapsible or distinct section, or just putting it above for now but cleaner.

  // Actually, keeping the input simple at top is fine for now.

  const [labels, setLabels] = useState<ExpenseLabel[]>([]);
  const [form, setForm] = useState({
    category: '',
    amount: '',
    date: '',
    note: '',
    details: [{ key: '', value: '' }] as ExpenseDetail[],
  });

  const loadLabels = async () => {
    try {
      const res = await api.admin.finance.getExpenseLabels();
      const nextLabels = (res.data?.labels || []) as ExpenseLabel[];
      setLabels(nextLabels);
      setForm((prev) => {
        const stillExists = nextLabels.some((item) => item.name === prev.category);
        if (stillExists) return prev;
        return {
          ...prev,
          category: nextLabels[0]?.name || '',
        };
      });
    } catch (error) {
      console.error('Failed to load expense labels:', error);
    }
  };

  const load = async () => {
    try {
      const res = await api.admin.finance.getExpenses({ page: 1, limit: 20 });
      setExpenses((res.data?.expenses || []) as ExpenseItem[]);
    } catch (error) {
      console.error('Failed to load expenses:', error);
    }
  };

  useEffect(() => {
    if (!allowed) return;
    loadLabels();
    load();
  }, [allowed]);

  if (!allowed) return null;

  const addDetailRow = () => {
    setForm((prev) => ({ ...prev, details: [...prev.details, { key: '', value: '' }] }));
  };

  const removeDetailRow = (index: number) => {
    setForm((prev) => {
      const next = prev.details.filter((_, i) => i !== index);
      return { ...prev, details: next.length > 0 ? next : [{ key: '', value: '' }] };
    });
  };

  const updateDetailRow = (index: number, field: 'key' | 'value', value: string) => {
    setForm((prev) => {
      const next = [...prev.details];
      next[index] = { ...next[index], [field]: value };
      return { ...prev, details: next };
    });
  };

  const submit = async () => {
    if (!form.amount || !form.category.trim()) return;
    try {
      const cleanedDetails = form.details
        .map((item) => ({ key: item.key.trim(), value: item.value.trim() }))
        .filter((item) => item.key || item.value);

      await api.admin.finance.createExpense({
        category: form.category.trim(),
        amount: Number(form.amount),
        date: form.date || undefined,
        note: form.note || undefined,
        details: cleanedDetails,
      });
      setForm((prev) => ({
        category: prev.category,
        amount: '',
        date: '',
        note: '',
        details: [{ key: '', value: '' }],
      }));
      await load();
      alert('Biaya berhasil disimpan');
    } catch (error) {
      console.error('Create expense failed:', error);
      alert('Gagal menyimpan biaya.');
    }
  };

  return (
    <div className="bg-slate-50 min-h-screen pb-24">
      <div className="bg-white px-6 pb-4 pt-2 shadow-sm sticky top-0 z-40 mb-4">
        <FinanceHeader title="Biaya Operasional" />
        <Link
          href="/admin/finance/biaya/label"
          className="text-xs font-bold text-emerald-600 hover:underline"
        >
          Konfigurasi Label
        </Link>
      </div>

      <div className="px-5 space-y-4">
        {/* Input Card */}
        <div className="bg-white rounded-[24px] p-5 shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
              <Plus size={16} className="text-slate-600" />
            </div>
            <h3 className="font-bold text-slate-900 text-sm">Input Biaya Baru</h3>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {labels.length > 0 ? (
                <select
                  className="bg-slate-50 border-0 rounded-xl px-3 py-3 text-sm font-semibold text-slate-700 w-full"
                  value={form.category}
                  onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                >
                  {labels.map((label) => (
                    <option key={label.id} value={label.name}>{label.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="bg-slate-50 border-0 rounded-xl px-3 py-3 text-sm font-semibold w-full"
                  placeholder="Kategori"
                  value={form.category}
                  onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                />
              )}
              <input
                className="bg-slate-50 border-0 rounded-xl px-3 py-3 text-sm font-bold w-full"
                placeholder="Rp 0"
                type="number"
                value={form.amount}
                onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
              />
            </div>

            <input
              className="bg-slate-50 border-0 rounded-xl px-3 py-3 text-sm w-full font-medium"
              placeholder="Catatan..."
              value={form.note}
              onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
            />

            <button onClick={submit} className="w-full bg-slate-900 text-white py-3 rounded-xl text-sm font-bold shadow-lg shadow-slate-200 active:scale-95 transition-all">
              Simpan Biaya
            </button>
          </div>
        </div>

        {/* List Expenses */}
        <div className="space-y-3">
          <h3 className="font-bold text-slate-900 text-sm px-1">Riwayat Pengeluaran</h3>
          {expenses.map((e) => (
            <div key={e.id} className="bg-white rounded-[20px] p-4 shadow-sm border border-slate-100 flex flex-col gap-3">
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${e.status === 'paid' ? 'bg-emerald-100 text-emerald-700' :
                        e.status === 'approved' ? 'bg-blue-100 text-blue-700' :
                          'bg-amber-100 text-amber-700'
                      }`}>
                      {e.status}
                    </span>
                    <span className="text-xs text-slate-400">{String(e.date || '').slice(0, 10)}</span>
                  </div>
                  <h4 className="font-bold text-slate-900">{e.category}</h4>
                  {e.note && <p className="text-xs text-slate-500 mt-1 italic">"{e.note}"</p>}
                </div>
                <span className="font-black text-slate-900 text-sm">
                  Rp {Number(e.amount || 0).toLocaleString('id-ID')}
                </span>
              </div>

              {/* Details expansion if needed, for now hidden or simple */}

              <div className="flex gap-2 border-t border-slate-50 pt-3">
                {e.status === 'requested' && (
                  <button
                    onClick={async () => {
                      if (!confirm('Approve biaya ini?')) return;
                      try {
                        await api.admin.finance.approveExpense(e.id);
                        load();
                      } catch (err) {
                        console.error(err);
                        alert('Gagal approve');
                      }
                    }}
                    className="flex-1 bg-blue-600 text-white text-xs font-bold py-2 rounded-xl"
                  >
                    Approve
                  </button>
                )}
                {e.status === 'approved' && (
                  <button
                    onClick={async () => {
                      const accId = prompt('Masukkan ID Akun Sumber Dana (cth: 1 untuk Kas, 2 untuk Bank):', '1');
                      if (!accId) return;
                      try {
                        await api.admin.finance.payExpense(e.id, accId);
                        load();
                      } catch (err) {
                        console.error(err);
                        alert('Gagal bayar');
                      }
                    }}
                    className="flex-1 bg-emerald-600 text-white text-xs font-bold py-2 rounded-xl shadow-lg shadow-emerald-100"
                  >
                    Bayar (Pay)
                  </button>
                )}
                {e.status === 'paid' && (
                  <div className="flex-1 text-center text-xs font-bold text-emerald-600 py-2 bg-emerald-50 rounded-xl">
                    Selesai
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <FinanceBottomNav />
    </div>
  );
}
