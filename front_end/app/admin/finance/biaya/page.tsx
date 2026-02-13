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
};

export default function FinanceExpensePage() {
  const allowed = useRequireRoles(['super_admin', 'admin_finance']);
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
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
    } catch (error) {
      console.error('Create expense failed:', error);
      alert('Gagal menyimpan biaya.');
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900">Input Biaya Operasional</h1>
          <p className="text-xs text-slate-500 mt-1">Catat biaya harian dan detail tracking.</p>
        </div>
        <Link
          href="/admin/finance/biaya/label"
          className="px-3 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:border-emerald-400 hover:text-emerald-700"
        >
          Konfigurasi Label
        </Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-3">
        <h2 className="text-sm font-black text-slate-900">Input Biaya</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          {labels.length > 0 ? (
            <select
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
              value={form.category}
              onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
            >
              <option value="">Pilih label biaya</option>
              {labels.map((label) => (
                <option key={label.id} value={label.name}>{label.name}</option>
              ))}
            </select>
          ) : (
            <input
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
              placeholder="Kategori"
              value={form.category}
              onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
            />
          )}
          <input
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
            placeholder="Amount"
            type="number"
            value={form.amount}
            onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
          />
          <input
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
            type="date"
            value={form.date}
            onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
          />
          <button onClick={submit} className="bg-emerald-600 text-white rounded-xl text-sm font-bold">Simpan</button>
          <input
            className="md:col-span-4 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
            placeholder="Catatan umum (opsional)"
            value={form.note}
            onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-600">Detail Biaya (opsional)</p>
          {form.details.map((detail, index) => (
            <div key={`detail-${index}`} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2">
              <input
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                placeholder="Detail (contoh: Meteran bulan Feb)"
                value={detail.key}
                onChange={(e) => updateDetailRow(index, 'key', e.target.value)}
              />
              <input
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                placeholder="Nilai/Keterangan (contoh: 1.250 Kwh)"
                value={detail.value}
                onChange={(e) => updateDetailRow(index, 'value', e.target.value)}
              />
              <button
                type="button"
                onClick={() => removeDetailRow(index)}
                className="px-3 py-2 rounded-xl bg-slate-200 text-slate-700 text-xs font-bold"
              >
                Hapus
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addDetailRow}
            className="px-3 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold"
          >
            + Tambah Detail
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {expenses.map((e) => (
          <div key={e.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <p className="text-sm font-bold text-slate-900">{e.category}</p>
            <p className="text-xs text-slate-600 mt-1">Rp {Number(e.amount || 0).toLocaleString('id-ID')} • {String(e.date || '').slice(0, 10)}</p>
            {e.note && <p className="text-xs text-slate-500 mt-1">{e.note}</p>}
            {(e.details || []).length > 0 && (
              <div className="mt-2 border border-slate-200 rounded-xl p-2 bg-slate-50">
                {(e.details || []).map((item, idx) => (
                  <p key={`${e.id}-detail-${idx}`} className="text-xs text-slate-600">
                    <span className="font-semibold text-slate-700">{item.key || 'Detail'}:</span> {item.value || '-'}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
