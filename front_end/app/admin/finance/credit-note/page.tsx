'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';

export default function CreditNotePage() {
    const allowed = useRequireRoles(['super_admin', 'admin_finance']);
    const [invoiceId, setInvoiceId] = useState('');
    const [reason, setReason] = useState('');
    const [amount, setAmount] = useState<number>(0);
    const [taxAmount, setTaxAmount] = useState<number>(0);
    const [mode, setMode] = useState<'receivable' | 'cash_refund'>('receivable');
    const [createdId, setCreatedId] = useState<number | null>(null);
    const [postingId, setPostingId] = useState<number | ''>('');
    const [payNow, setPayNow] = useState(false);
    const [loading, setLoading] = useState(false);

    if (!allowed) return null;

    const createDraft = async () => {
        try {
            setLoading(true);
            const res = await api.admin.finance.createCreditNote({
                invoice_id: invoiceId.trim(),
                reason,
                mode,
                amount: Number(amount || 0),
                tax_amount: Number(taxAmount || 0)
            });
            const id = Number(res?.data?.credit_note?.id || 0);
            setCreatedId(id || null);
            alert('Credit note draft berhasil dibuat');
        } catch (error: any) {
            alert(error?.response?.data?.message || 'Gagal membuat credit note');
        } finally {
            setLoading(false);
        }
    };

    const post = async () => {
        try {
            setLoading(true);
            const id = Number(postingId || createdId || 0);
            if (!id) {
                alert('ID credit note wajib diisi');
                return;
            }
            await api.admin.finance.postCreditNote(id, { pay_now: payNow });
            alert('Credit note berhasil diposting');
        } catch (error: any) {
            alert(error?.response?.data?.message || 'Gagal posting credit note');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-5 md:p-8 space-y-4 bg-slate-50 min-h-screen">
            <div className="flex items-center gap-2">
                <Link href="/admin/finance/retur" className="p-2 -ml-2 rounded-full hover:bg-slate-100">
                    <ArrowLeft size={20} />
                </Link>
                <h1 className="text-xl font-black text-slate-900">Credit Note</h1>
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3">
                <h2 className="text-sm font-black text-slate-900">Buat Draft</h2>
                <input value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} placeholder="Invoice ID" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" />
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Alasan" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" />
                <div className="grid md:grid-cols-3 gap-3">
                    <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value || 0))} placeholder="Amount" className="border border-slate-200 rounded-xl px-3 py-2 text-sm" />
                    <input type="number" value={taxAmount} onChange={(e) => setTaxAmount(Number(e.target.value || 0))} placeholder="Tax Amount" className="border border-slate-200 rounded-xl px-3 py-2 text-sm" />
                    <select value={mode} onChange={(e) => setMode((e.target.value as 'receivable' | 'cash_refund'))} className="border border-slate-200 rounded-xl px-3 py-2 text-sm">
                        <option value="receivable">Receivable</option>
                        <option value="cash_refund">Cash Refund</option>
                    </select>
                </div>
                <button onClick={createDraft} disabled={loading || !invoiceId.trim() || Number(amount) <= 0} className="bg-slate-900 text-white rounded-xl px-4 py-2.5 text-sm font-bold disabled:opacity-50">
                    {loading ? 'Memproses...' : 'Buat Draft'}
                </button>
                {createdId ? <p className="text-xs text-emerald-700 font-bold">Draft dibuat dengan ID #{createdId}</p> : null}
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3">
                <h2 className="text-sm font-black text-slate-900">Posting Credit Note</h2>
                <input type="number" value={postingId} onChange={(e) => setPostingId(Number(e.target.value || 0))} placeholder="Credit Note ID (kosongkan untuk pakai ID draft terbaru)" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" />
                <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} />
                    Bayar sekarang (refund payout)
                </label>
                <button onClick={post} disabled={loading} className="bg-emerald-600 text-white rounded-xl px-4 py-2.5 text-sm font-bold disabled:opacity-50">
                    {loading ? 'Memproses...' : 'Posting'}
                </button>
            </div>
        </div>
    );
}
