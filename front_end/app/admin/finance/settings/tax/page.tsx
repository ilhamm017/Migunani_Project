'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';

type TaxMode = 'pkp' | 'non_pkp';

export default function FinanceTaxSettingsPage() {
    const allowed = useRequireRoles(['super_admin', 'admin_finance']);
    const [mode, setMode] = useState<TaxMode>('non_pkp');
    const [vatPercent, setVatPercent] = useState<number>(11);
    const [pphFinalPercent, setPphFinalPercent] = useState<number>(0.5);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const load = async () => {
        try {
            setLoading(true);
            const res = await api.admin.finance.getTaxSettings();
            const data = res.data || {};
            const taxMode = data.company_tax_mode === 'pkp' ? 'pkp' : 'non_pkp';
            setMode(taxMode);
            setVatPercent(Number(data.vat_percent ?? 11));
            setPphFinalPercent(Number(data.pph_final_percent ?? 0.5));
        } catch (error) {
            console.error('Failed to load tax settings', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (allowed) load();
    }, [allowed]); // eslint-disable-line react-hooks/exhaustive-deps

    const save = async () => {
        try {
            setSaving(true);
            await api.admin.finance.updateTaxSettings({
                company_tax_mode: mode,
                vat_percent: Number(vatPercent || 0),
                pph_final_percent: Number(pphFinalPercent || 0)
            });
            alert('Konfigurasi pajak berhasil disimpan');
            await load();
        } catch (error: any) {
            alert(error?.response?.data?.message || 'Gagal menyimpan konfigurasi pajak');
        } finally {
            setSaving(false);
        }
    };

    if (!allowed) return null;

    return (
        <div className="p-5 md:p-8 space-y-5 bg-slate-50 min-h-screen">
            <div className="flex items-center gap-2">
                <Link href="/admin/finance/laporan" className="p-2 -ml-2 rounded-full hover:bg-slate-100">
                    <ArrowLeft size={20} />
                </Link>
                <h1 className="text-xl font-black text-slate-900">Pengaturan Pajak Keuangan</h1>
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
                {loading ? (
                    <div className="h-20 bg-slate-100 animate-pulse rounded-xl" />
                ) : (
                    <>
                        <div className="space-y-2">
                            <label className="text-xs font-black text-slate-500 uppercase tracking-widest">Mode Pajak</label>
                            <div className="grid md:grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    onClick={() => setMode('pkp')}
                                    className={`rounded-xl px-4 py-3 text-sm font-bold border ${mode === 'pkp' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600'}`}
                                >
                                    PKP
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setMode('non_pkp')}
                                    className={`rounded-xl px-4 py-3 text-sm font-bold border ${mode === 'non_pkp' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600'}`}
                                >
                                    Non-PKP
                                </button>
                            </div>
                        </div>

                        <div className="grid md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-black text-slate-500 uppercase tracking-widest">PPN (%)</label>
                                <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    step="0.001"
                                    value={vatPercent}
                                    onChange={(e) => setVatPercent(Number(e.target.value || 0))}
                                    className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-black text-slate-500 uppercase tracking-widest">PPh Final (%)</label>
                                <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    step="0.001"
                                    value={pphFinalPercent}
                                    onChange={(e) => setPphFinalPercent(Number(e.target.value || 0))}
                                    className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                                />
                            </div>
                        </div>

                        <p className="text-xs text-slate-500">
                            Catatan: perubahan setting hanya berlaku untuk transaksi baru; snapshot pajak invoice lama tidak diubah.
                        </p>

                        <button
                            type="button"
                            onClick={save}
                            disabled={saving}
                            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 text-white px-4 py-2.5 text-sm font-bold disabled:opacity-50"
                        >
                            <Save size={16} />
                            {saving ? 'Menyimpan...' : 'Simpan Konfigurasi'}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
