'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency } from '@/lib/utils';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notifyAlert } from '@/lib/notify';
import { getDefaultMonthRange, toNumber } from '../reportUtils';
import type { AxiosError } from 'axios';

type PnlSummary = {
    net_profit: number;
    revenue: number;
    cogs: number;
    gross_profit: number;
    expenses: number;
    invoices?: Array<{
        invoice_id: string;
        invoice_number: string;
        customer_name: string;
        subtotal: number;
        modal: number;
        laba: number;
    }>;
};

export default function PnLPage() {
    const allowed = useRequireRoles(['super_admin', 'admin_finance']);

    const defaults = useMemo(() => getDefaultMonthRange(), []);

    const [startDate, setStartDate] = useState(defaults.startDate);
    const [endDate, setEndDate] = useState(defaults.endDate);
    const [data, setData] = useState<PnlSummary | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        try {
            setLoading(true);
            setError('');
            const res = await api.admin.finance.getPnL({ startDate, endDate });
            const payload = res.data as Record<string, unknown>;
            setData({
                net_profit: toNumber(payload?.net_profit),
                revenue: toNumber(payload?.revenue),
                cogs: toNumber(payload?.cogs),
                gross_profit: toNumber(payload?.gross_profit),
                expenses: toNumber(payload?.expenses),
                invoices: Array.isArray(payload?.invoices)
                    ? (payload.invoices as Array<Record<string, unknown>>).map((row) => ({
                        invoice_id: String(row.invoice_id || ''),
                        invoice_number: String(row.invoice_number || ''),
                        customer_name: String(row.customer_name || '-'),
                        subtotal: toNumber(row.subtotal),
                        modal: toNumber(row.modal),
                        laba: toNumber(row.laba),
                    }))
                    : [],
            });
        } catch (e) {
            console.error(e);
            notifyAlert('Gagal memuat laporan');
            const err = e as AxiosError<unknown>;
            const status = err?.response?.status;
            const data = err?.response?.data;
            const message =
                data && typeof data === 'object' && 'message' in data
                    ? String((data as { message?: unknown }).message || '').trim()
                    : '';
            if (status === 403) {
                setError('Tidak punya akses P&L. Login sebagai super_admin / admin_finance.');
            } else {
                setError(message || 'Gagal memuat laporan P&L.');
            }
        } finally {
            setLoading(false);
        }
    }, [endDate, startDate]);

    useEffect(() => {
        if (allowed) void load();
    }, [allowed, load]);

    if (!allowed) return null;

    return (
        <div className="bg-slate-50 min-h-screen pb-10">
            <div className="bg-white px-6 py-4 shadow-sm sticky top-0 z-40">
                <div className="flex items-center gap-3 mb-4">
                    <Link href="/admin/finance/laporan" className="p-2 -ml-2 rounded-full hover:bg-slate-100">
                        <ArrowLeft size={20} className="text-slate-700" />
                    </Link>
                    <h1 className="font-bold text-lg text-slate-900">Laba Rugi (P&L)</h1>
                </div>

                <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
                    <input
                        type="date"
                        value={startDate}
                        onChange={e => setStartDate(e.target.value)}
                        className="flex-1 bg-white border-none rounded-lg text-xs font-bold px-2 py-2 text-center"
                    />
                    <span className="self-center text-slate-400 font-bold">-</span>
                    <input
                        type="date"
                        value={endDate}
                        onChange={e => setEndDate(e.target.value)}
                        className="flex-1 bg-white border-none rounded-lg text-xs font-bold px-2 py-2 text-center"
                    />
                    <button
                        onClick={load}
                        className="bg-slate-900 text-white px-4 rounded-lg text-xs font-bold"
                    >
                        Go
                    </button>
                </div>
            </div>

            <div className="p-5 space-y-4">
                {error ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 whitespace-pre-wrap">
                        {error}
                    </div>
                ) : null}
                {loading ? (
                    <div className="text-center py-10 text-slate-400">Loading...</div>
                ) : data ? (
                    <div className="space-y-4">
                        {/* Summary Card */}
                        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 text-center">
                            <p className="text-sm text-slate-500 mb-1">Net Profit (Bersih)</p>
                            <p className={`text-3xl font-black ${Number(data.net_profit) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {formatCurrency(data.net_profit)}
                            </p>
                        </div>

                        {/* Breakdown */}
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                            <div className="p-4 border-b border-slate-50 bg-slate-50/50">
                                <h3 className="font-bold text-slate-900">Rincian</h3>
                            </div>
                            <div className="divide-y divide-slate-50">
                                {/* Revenue */}
                                <div className="p-4 flex justify-between items-center hover:bg-slate-50">
                                    <div>
                                        <p className="text-sm font-bold text-slate-700">Pendapatan (Revenue)</p>
                                        <p className="text-[10px] text-slate-400">Total penjualan terbayar</p>
                                    </div>
                                    <span className="font-bold text-emerald-600">{formatCurrency(data.revenue)}</span>
                                </div>

                                {/* COGS */}
                                <div className="p-4 flex justify-between items-center hover:bg-slate-50">
                                    <div>
                                        <p className="text-sm font-bold text-slate-700">HPP (COGS)</p>
                                        <p className="text-[10px] text-slate-400">Modal barang terjual</p>
                                    </div>
                                    <span className="font-bold text-rose-600">({formatCurrency(data.cogs)})</span>
                                </div>

                                {/* Gross Profit */}
                                <div className="p-4 flex justify-between items-center bg-slate-50">
                                    <p className="text-sm font-black text-slate-800">Gross Profit (Kotor)</p>
                                    <span className="font-black text-slate-900">{formatCurrency(data.gross_profit)}</span>
                                </div>

                                {/* Expenses */}
                                <div className="p-4 flex justify-between items-center hover:bg-slate-50">
                                    <div>
                                        <p className="text-sm font-bold text-slate-700">Biaya Operasional</p>
                                        <p className="text-[10px] text-slate-400">Gaji, Listrik, Lain-lain</p>
                                    </div>
                                    <span className="font-bold text-rose-600">({formatCurrency(data.expenses)})</span>
                                </div>
                            </div>
                        </div>

                        {/* Invoice Table */}
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                            <div className="p-4 border-b border-slate-50 bg-slate-50/50 flex items-center justify-between gap-3">
                                <h3 className="font-bold text-slate-900">Detail Invoice</h3>
                                <p className="text-[11px] text-slate-500">
                                    {Array.isArray(data.invoices) ? `${data.invoices.length} invoice` : '0 invoice'}
                                </p>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="min-w-[760px] w-full text-sm">
                                    <thead className="bg-white">
                                        <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                                            <th className="px-4 py-3 font-bold">InvoiceId</th>
                                            <th className="px-4 py-3 font-bold">Customer</th>
                                            <th className="px-4 py-3 font-bold text-right">Subtotal</th>
                                            <th className="px-4 py-3 font-bold text-right">Modal</th>
                                            <th className="px-4 py-3 font-bold text-right">Laba</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {(data.invoices || []).length === 0 ? (
                                            <tr>
                                                <td className="px-4 py-6 text-slate-400" colSpan={5}>
                                                    Tidak ada invoice paid di periode ini.
                                                </td>
                                            </tr>
                                        ) : (
                                            (data.invoices || []).map((row) => (
                                                <tr key={row.invoice_id} className="hover:bg-slate-50">
                                                    <td className="px-4 py-3 font-mono text-[12px] text-slate-700">
                                                        {row.invoice_number || row.invoice_id}
                                                    </td>
                                                    <td className="px-4 py-3 text-slate-800">{row.customer_name || '-'}</td>
                                                    <td className="px-4 py-3 text-right font-bold text-slate-900">
                                                        {formatCurrency(row.subtotal)}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-bold text-slate-900">
                                                        {formatCurrency(row.modal)}
                                                    </td>
                                                    <td className={`px-4 py-3 text-right font-black ${row.laba >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                                        {formatCurrency(row.laba)}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
