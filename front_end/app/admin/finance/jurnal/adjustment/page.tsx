'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import FinanceHeader from '@/components/admin/finance/FinanceHeader';
import FinanceBottomNav from '@/components/admin/finance/FinanceBottomNav';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';

type JournalLine = {
    account_id: number | '';
    debit: number | '';
    credit: number | '';
};

export default function AdjustmentJournalPage() {
    const allowed = useRequireRoles(['super_admin', 'admin_finance']);
    const [accounts, setAccounts] = useState<any[]>([]);
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [description, setDescription] = useState('');
    const [lines, setLines] = useState<JournalLine[]>([
        { account_id: '', debit: '', credit: 0 },
        { account_id: '', debit: 0, credit: '' }
    ]);

    useEffect(() => {
        if (allowed) {
            api.admin.accounts.getAll().then(res => setAccounts(res.data)).catch(console.error);
        }
    }, [allowed]);

    const updateLine = (index: number, field: keyof JournalLine, value: any) => {
        setLines(prev => {
            const next = [...prev];
            next[index] = { ...next[index], [field]: value };

            // Auto-balance reset helper: if typing debit, reset credit to 0
            if (field === 'debit' && value) next[index].credit = 0;
            if (field === 'credit' && value) next[index].debit = 0;

            return next;
        });
    };

    const addLine = () => setLines(p => [...p, { account_id: '', debit: 0, credit: 0 }]);
    const removeLine = (idx: number) => setLines(p => p.filter((_, i) => i !== idx));

    const totalDebit = lines.reduce((sum, l) => sum + Number(l.debit || 0), 0);
    const totalCredit = lines.reduce((sum, l) => sum + Number(l.credit || 0), 0);
    const isBalanced = totalDebit === totalCredit && totalDebit > 0;

    const submit = async () => {
        if (!description.trim()) return alert('Deskripsi wajib diisi');
        if (!isBalanced) return alert('Debit dan Credit harus seimbang (Balance)');

        const validLines = lines.filter(l => l.account_id).map(l => ({
            account_id: Number(l.account_id),
            debit: Number(l.debit || 0),
            credit: Number(l.credit || 0)
        }));

        if (validLines.length < 2) return alert('Minimal 2 akun');

        try {
            await api.admin.finance.createAdjustmentJournal({
                date,
                description,
                lines: validLines
            });
            alert('Jurnal Penyesuaian berhasil disimpan');
            setDescription('');
            setLines([{ account_id: '', debit: '', credit: 0 }, { account_id: '', debit: 0, credit: '' }]);
        } catch (e: any) {
            console.error(e);
            alert('Gagal menyimpan: ' + (e.response?.data?.message || e.message));
        }
    };

    if (!allowed) return null;

    return (
        <div className="bg-slate-50 min-h-screen pb-24">
            <div className="bg-white px-6 py-4 shadow-sm sticky top-0 z-40 mb-4">
                <div className="flex items-center gap-3 mb-2">
                    <Link href="/admin/finance" className="p-2 -ml-2 rounded-full hover:bg-slate-100">
                        <ArrowLeft size={20} className="text-slate-700" />
                    </Link>
                    <h1 className="font-bold text-lg text-slate-900">Jurnal Penyesuaian</h1>
                </div>
            </div>

            <div className="px-5 space-y-4">
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 space-y-4">
                    <div>
                        <label className="text-xs font-bold text-slate-500 mb-1 block">Tanggal</label>
                        <input
                            type="date"
                            className="w-full bg-slate-50 border-0 rounded-xl px-4 py-3 font-bold text-slate-900"
                            value={date}
                            onChange={e => setDate(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-500 mb-1 block">Deskripsi / Keterangan</label>
                        <textarea
                            className="w-full bg-slate-50 border-0 rounded-xl px-4 py-3 text-sm font-medium"
                            rows={2}
                            placeholder="Contoh: Penyesuaian stok opname..."
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                        />
                    </div>
                </div>

                <div className="space-y-3">
                    {lines.map((line, idx) => (
                        <div key={idx} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 relative">
                            {lines.length > 2 && (
                                <button onClick={() => removeLine(idx)} className="absolute top-2 right-2 text-rose-400 hover:text-rose-600 p-2">
                                    <Trash2 size={16} />
                                </button>
                            )}

                            <div className="mb-3 pr-8">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Akun</label>
                                <select
                                    className="w-full bg-slate-50 border-0 rounded-lg px-3 py-2 text-sm font-bold text-slate-700"
                                    value={line.account_id}
                                    onChange={e => updateLine(idx, 'account_id', e.target.value)}
                                >
                                    <option value="">Pilih Akun...</option>
                                    {accounts.map(acc => (
                                        <option key={acc.id} value={acc.id}>
                                            {acc.code} - {acc.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Debit</label>
                                    <input
                                        type="number"
                                        className="w-full bg-slate-50 border-0 rounded-lg px-3 py-2 text-sm font-medium"
                                        placeholder="0"
                                        value={line.debit}
                                        onChange={e => updateLine(idx, 'debit', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Credit</label>
                                    <input
                                        type="number"
                                        className="w-full bg-slate-50 border-0 rounded-lg px-3 py-2 text-sm font-medium"
                                        placeholder="0"
                                        value={line.credit}
                                        onChange={e => updateLine(idx, 'credit', e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                    ))}

                    <button onClick={addLine} className="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 font-bold text-sm hover:border-slate-400 hover:text-slate-600 transition-colors flex items-center justify-center gap-2">
                        <Plus size={16} /> Tambah Baris
                    </button>
                </div>

                <div className="bg-slate-900 text-white p-5 rounded-2xl shadow-lg sticky bottom-24">
                    <div className="flex justify-between items-center mb-4">
                        <div className="text-right flex-1 pr-4 border-r border-slate-700">
                            <p className="text-[10px] text-slate-400 uppercase">Total Debit</p>
                            <p className="font-mono font-bold text-lg">{totalDebit.toLocaleString()}</p>
                        </div>
                        <div className="text-right flex-1 pl-4">
                            <p className="text-[10px] text-slate-400 uppercase">Total Credit</p>
                            <p className="font-mono font-bold text-lg">{totalCredit.toLocaleString()}</p>
                        </div>
                    </div>

                    <button
                        onClick={submit}
                        disabled={!isBalanced}
                        className={`w-full py-3 rounded-xl font-bold text-sm transition-all ${isBalanced ? 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg shadow-emerald-500/30' : 'bg-slate-700 text-slate-400 cursor-not-allowed'
                            }`}
                    >
                        {isBalanced ? 'Simpan Jurnal' : 'Balance Tidak Seimbang'}
                    </button>
                </div>
            </div>

            <FinanceBottomNav />
        </div>
    );
}
