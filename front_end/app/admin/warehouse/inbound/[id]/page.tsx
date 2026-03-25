'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
    ArrowLeft,
    CheckCircle2,
    AlertCircle,
    Truck,
    Package,
    Clock,
    Save,
    Download
} from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';

interface POItem {
    id: number;
    purchase_order_id: string;
    product_id: string;
    qty: number;
    expected_unit_cost?: number | string | null;
    unit_cost: number;
    total_cost: number;
    received_qty: number;
    cost_note?: string | null;
    Product?: {
        id: string;
        sku: string;
        name: string;
        stock_quantity: number;
    };
}

interface PO {
    id: string;
    supplier_id: number | null;
    status: 'pending' | 'received' | 'partially_received' | 'canceled';
    total_cost: number;
    createdAt: string;
    verified1_by?: string | null;
    verified1_at?: string | null;
    verified2_by?: string | null;
    verified2_at?: string | null;
    Supplier?: {
        id: number;
        name: string;
    };
    User?: {
        id: string;
        name: string;
        role: string;
    };
    Items?: POItem[];
}

export default function POReceivePage() {
    const allowed = useRequireRoles(['super_admin'], '/admin');
    const { id } = useParams();

    const [po, setPo] = useState<PO | null>(null);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [message, setMessage] = useState('');
    const [messageType, setMessageType] = useState<'success' | 'error'>('success');
    const [confirm, setConfirm] = useState<{ open: boolean; action: 'verify1' | 'verify2' | null }>({ open: false, action: null });
    const [costEditor, setCostEditor] = useState<{ open: boolean }>({ open: false });
    const [costRows, setCostRows] = useState<Array<{ product_id: string; sku: string; name: string; expected: number; unit_cost: string; cost_note: string }>>([]);
    const [verifyChecklist, setVerifyChecklist] = useState({
        supplierOk: false,
        qtyOk: false,
        costOk: false,
        varianceReasonOk: false,
        irreversibleOk: false,
    });

    const loadPO = useCallback(async () => {
        if (!id) return;
        try {
            setLoading(true);
            const res = await api.admin.inventory.getInboundById(id as string);
            setPo(res.data);
            const items = (res.data?.Items || []) as POItem[];
            setCostRows(items.map((item) => ({
                product_id: String(item.product_id),
                sku: String(item.Product?.sku || item.product_id || '-'),
                name: String(item.Product?.name || '-'),
                expected: Number(item.expected_unit_cost ?? 0),
                unit_cost: String(item.unit_cost ?? ''),
                cost_note: String(item.cost_note || ''),
            })));
        } catch (error) {
            console.error('Failed to load PO', error);
            setMessage('Gagal memuat detail inbound.');
            setMessageType('error');
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        if (allowed && id) {
            void loadPO();
        }
    }, [allowed, id, loadPO]);

    const onVerify1 = async () => {
        if (!po) return;
        setIsSaving(true);
        setMessage('');
        try {
            await api.admin.inventory.verifyInboundStep1(po.id);
            setMessageType('success');
            setMessage('Verifikasi langkah 1 berhasil.');
            await loadPO();
        } catch (error: unknown) {
            const err = error as { response?: { data?: { message?: string } } };
            setMessageType('error');
            setMessage(err?.response?.data?.message || 'Gagal verifikasi langkah 1.');
        } finally {
            setIsSaving(false);
        }
    };

    const onVerify2AndPost = async () => {
        if (!po) return;
        setIsSaving(true);
        setMessage('');
        try {
            await api.admin.inventory.verifyInboundStep2(po.id);
            setMessageType('success');
            setMessage('Verifikasi langkah 2 OK. Stok langsung masuk gudang.');
            await loadPO();
        } catch (error: unknown) {
            const err = error as { response?: { data?: { message?: string } } };
            setMessageType('error');
            setMessage(err?.response?.data?.message || 'Gagal verifikasi langkah 2.');
        } finally {
            setIsSaving(false);
        }
    };

    const onExportXlsx = async () => {
        if (!po) return;
        setIsExporting(true);
        setMessage('');
        try {
            const res = await api.admin.inventory.exportInboundXlsx(po.id);
            const contentDisposition = String(res.headers?.['content-disposition'] || '');
            const filenameMatch = /filename="?([^";]+)"?/i.exec(contentDisposition);
            const fallbackName = `inbound-${po.id.split('-')[0]?.toUpperCase() || 'INB'}.xlsx`;
            const filename = filenameMatch?.[1] || fallbackName;

            const blob = new Blob([res.data], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);

            setMessageType('success');
            setMessage('File XLSX berhasil diunduh.');
        } catch (error: unknown) {
            console.error('Failed to export XLSX', error);
            setMessageType('error');
            setMessage('Gagal ekstrak XLSX.');
        } finally {
            setIsExporting(false);
        }
    };

    if (!allowed) return null;

    if (loading && !po) {
        return (
            <div className="flex items-center justify-center p-20 text-slate-400">
                <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    if (!po) {
        return (
            <div className="p-10 text-center">
                <AlertCircle className="mx-auto text-rose-500 mb-4" size={48} />
                <h2 className="text-xl font-bold">Inbound Tidak Ditemukan</h2>
                <Link href="/admin/warehouse/inbound/history" className="text-emerald-600 font-bold mt-4 inline-block">Kembali ke Riwayat</Link>
            </div>
        );
    }

    const isPOClosed = po.status === 'received' || po.status === 'canceled';
    const canVerify1 = po.status === 'pending' && !po.verified1_at;
    const canVerify2 = po.status === 'partially_received' && !po.verified2_at;
    const totalQty = po.Items?.reduce((acc, item) => acc + Number(item.qty || 0), 0) || 0;
    const canEditCost = po.status === 'pending' && !po.verified1_at;
    const itemsCount = Array.isArray(po.Items) ? po.Items.length : 0;
    const inboundTotalCost = Array.isArray(po.Items)
        ? po.Items.reduce((sum, item) => sum + (Number(item.qty || 0) * Number(item.unit_cost || 0)), 0)
        : 0;
    const varianceSummary = (() => {
        const items = Array.isArray(po.Items) ? po.Items : [];
        let varianceCount = 0;
        let missingReasonCount = 0;
        for (const item of items) {
            const expected = Number(item.expected_unit_cost ?? 0);
            const actual = Number(item.unit_cost ?? 0);
            const expected2 = Math.round(expected * 100) / 100;
            const actual2 = Math.round(actual * 100) / 100;
            if (expected2 !== actual2) {
                varianceCount += 1;
                const note = String(item.cost_note || '').trim();
                if (!note) missingReasonCount += 1;
            }
        }
        return { varianceCount, missingReasonCount };
    })();

    return (
        <div className="warehouse-page w-full max-w-none lg:h-full lg:overflow-hidden overflow-y-auto">
            <div className="flex items-center justify-between gap-4 mb-4 shrink-0">
                <div className="flex items-center gap-3">
                    <Link
                        href="/admin/warehouse/inbound/history"
                        className="p-2 hover:bg-slate-100 rounded-xl transition-all border border-slate-200 bg-white shadow-sm"
                    >
                        <ArrowLeft size={20} className="text-slate-600" />
                    </Link>
                    <div>
                        <h1 className="warehouse-title !mb-0 flex items-center gap-2">
                            <Truck className="text-emerald-600" />
                            Inbound (Verifikasi 2 Langkah)
                        </h1>
                        <p className="warehouse-subtitle !mb-0 font-mono text-xs uppercase tracking-widest text-slate-400">INB #{po.id.split('-')[0].toUpperCase()}</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={onExportXlsx}
                        disabled={isExporting}
                        className="rounded-2xl bg-white border border-slate-200 text-slate-900 text-sm font-black px-5 py-3.5 inline-flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-slate-50 transition-all shadow-sm active:scale-95"
                        title="Ekstrak data inbound ke XLSX"
                    >
                        {isExporting ? (
                            <div className="w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                            <Download size={18} />
                        )}
                        Ekstrak XLSX
                    </button>
                    {canEditCost && (
                        <button
                            onClick={() => setCostEditor({ open: true })}
                            disabled={isSaving}
                            className="rounded-2xl bg-white border border-slate-200 text-slate-900 text-sm font-black px-5 py-3.5 inline-flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-slate-50 transition-all shadow-sm active:scale-95"
                            title="Perbaiki modal/unit cost sebelum verifikasi"
                        >
                            <Save size={18} />
                            Edit Modal
                        </button>
                    )}
                    {canVerify1 && (
                        <button
                            onClick={() => {
                                setVerifyChecklist({
                                    supplierOk: false,
                                    qtyOk: false,
                                    costOk: false,
                                    varianceReasonOk: false,
                                    irreversibleOk: false,
                                });
                                setConfirm({ open: true, action: 'verify1' });
                            }}
                            disabled={isSaving}
                            className="rounded-2xl bg-slate-900 text-white text-sm font-black px-6 py-3.5 inline-flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-amber-600 transition-all shadow-lg active:scale-95"
                        >
                            {isSaving ? (
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            ) : (
                                <Save size={18} />
                            )}
                            Verifikasi 1
                        </button>
                    )}
                    {canVerify2 && (
                        <button
                            onClick={() => {
                                setVerifyChecklist({
                                    supplierOk: false,
                                    qtyOk: false,
                                    costOk: false,
                                    varianceReasonOk: false,
                                    irreversibleOk: false,
                                });
                                setConfirm({ open: true, action: 'verify2' });
                            }}
                            disabled={isSaving}
                            className="rounded-2xl bg-emerald-600 text-white text-sm font-black px-6 py-3.5 inline-flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-emerald-700 transition-all shadow-lg active:scale-95"
                        >
                            {isSaving ? (
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            ) : (
                                <CheckCircle2 size={18} />
                            )}
                            Verifikasi 2 + Posting
                        </button>
                    )}
                    {isPOClosed && (
                        <div className="text-xs font-black uppercase tracking-widest text-slate-500 bg-white border border-slate-200 rounded-2xl px-4 py-3">
                            {po.status === 'received' ? 'Posted' : 'Closed'}
                        </div>
                    )}
                </div>
            </div>

            {message && (
                <div className={`rounded-3xl border-2 p-4 text-sm font-bold flex items-center gap-3 mb-4 animate-in fade-in slide-in-from-top-2 shrink-0 ${messageType === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-rose-50 border-rose-100 text-rose-700'
                    }`}>
                    {messageType === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                    {message}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
                {/* Left Column: PO Info */}
                <div className="lg:col-span-1 space-y-6 overflow-y-auto pr-2">
                    <div className="warehouse-panel bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm">
                        <h2 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <Truck size={14} className="text-emerald-500" />
                            Informasi Inbound
                        </h2>
                        <div className="space-y-4">
                            <div className="flex flex-col">
                                <span className="text-xs font-bold text-slate-400">Supplier</span>
                                <span className="text-lg font-black text-slate-900 leading-tight">{po.Supplier?.name || '-'}</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-xs font-bold text-slate-400">Tanggal Input</span>
                                <span className="text-sm font-bold text-slate-700">{new Date(po.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-xs font-bold text-slate-400">Dibuat Oleh</span>
                                <span className="text-sm font-bold text-slate-700">{po.User?.name || '-'}</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-xs font-bold text-slate-400">Verifikasi 1</span>
                                <span className="text-sm font-bold text-slate-700">{po.verified1_at ? new Date(po.verified1_at).toLocaleString('id-ID') : '-'}</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-xs font-bold text-slate-400">Verifikasi 2 / Posting</span>
                                <span className="text-sm font-bold text-slate-700">{po.verified2_at ? new Date(po.verified2_at).toLocaleString('id-ID') : '-'}</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-xs font-bold text-slate-400">Total Modal Inbound</span>
                                <span className="text-lg font-black text-slate-900 leading-tight">Rp {Number(inboundTotalCost || 0).toLocaleString()}</span>
                            </div>
                        </div>
                    </div>

                    <div className="warehouse-panel bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm text-center">
                        <div className={`mx-auto w-16 h-16 rounded-3xl mb-3 flex items-center justify-center border-2 ${po.status === 'received' ? 'bg-emerald-50 border-emerald-100 text-emerald-600' :
                            po.status === 'partially_received' ? 'bg-amber-50 border-amber-100 text-amber-600' :
                                'bg-blue-50 border-blue-100 text-blue-600'
                            }`}>
                            {po.status === 'received' ? <CheckCircle2 size={32} /> :
                                po.status === 'partially_received' ? <Package size={32} /> :
                                    <Clock size={32} />}
                        </div>
                        <h3 className="text-lg font-black text-slate-900">
                            {po.status === 'received' ? 'Posted ke Gudang' :
                                po.status === 'partially_received' ? 'Verified 1 (Menunggu Posting)' :
                                    po.status === 'canceled' ? 'Dibatalkan' : 'Draft (Menunggu Verifikasi 1)'}
                        </h3>
                        <p className="text-xs text-slate-500 mt-1 font-medium">Stok hanya bertambah setelah Verifikasi 2.</p>

                        <div className="mt-6 pt-6 border-t border-slate-50">
                            <div className="flex justify-between items-center text-xs font-bold mb-1">
                                <span className="text-slate-400">Progress Posting</span>
                                <span className="text-emerald-600">
                                    {po.Items?.reduce((acc, item) => acc + item.received_qty, 0)} / {po.Items?.reduce((acc, item) => acc + item.qty, 0)} Pcs
                                </span>
                            </div>
                            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                                    style={{ width: `${(po.Items?.reduce((acc, item) => acc + item.received_qty, 0) || 0) / (po.Items?.reduce((acc, item) => acc + item.qty, 0) || 1) * 100}%` }}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column: Items Verification */}
                <div className="lg:col-span-2 flex flex-col min-h-0 bg-slate-900/5 rounded-[40px] p-2">
                    <div className="flex-1 overflow-y-auto space-y-4 p-4">
                        <h2 className="text-sm font-black text-slate-500 uppercase tracking-widest px-2 flex items-center gap-2">
                            <Package size={14} className="text-emerald-500" />
                            Daftar Barang
                        </h2>

                        {po.Items?.map((item) => (
                            <div key={item.id} className="warehouse-panel bg-white border border-slate-200 rounded-[32px] p-5 shadow-sm hover:border-emerald-500/30 transition-all flex flex-col md:flex-row gap-6">
                                <div className="flex-1 space-y-1">
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono mb-1">{item.Product?.sku}</p>
                                    <h4 className="text-base font-black text-slate-900 leading-tight">{item.Product?.name}</h4>

                                    <div className="flex items-center gap-4 mt-3">
                                        <div className="bg-slate-50 rounded-2xl px-3 py-1.5 flex flex-col items-center">
                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Qty Input</span>
                                            <span className="text-sm font-black text-slate-700">{item.qty}</span>
                                        </div>
                                        <div className="bg-emerald-50 rounded-2xl px-3 py-1.5 flex flex-col items-center">
                                            <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-tighter">Posted</span>
                                            <span className="text-sm font-black text-emerald-700">{item.received_qty}</span>
                                        </div>
                                        <div className="bg-blue-50 rounded-2xl px-3 py-1.5 flex flex-col items-center">
                                            <span className="text-[9px] font-bold text-blue-400 uppercase tracking-tighter">Sisa</span>
                                            <span className="text-sm font-black text-blue-700">{Math.max(0, item.qty - item.received_qty)}</span>
                                        </div>
                                        <div className="bg-slate-50 rounded-2xl px-3 py-1.5 flex flex-col items-center">
                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Modal</span>
                                            <span className="text-sm font-black text-slate-700">Rp {Number(item.unit_cost || 0).toLocaleString()}</span>
                                        </div>
                                        <div className="bg-slate-50 rounded-2xl px-3 py-1.5 flex flex-col items-center">
                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Total Modal</span>
                                            <span className="text-sm font-black text-slate-900">
                                                Rp {Number((Number(item.qty || 0) * Number(item.unit_cost || 0)) || 0).toLocaleString()}
                                            </span>
                                        </div>
                                    </div>

                                    {(() => {
                                        const expected = Number(item.expected_unit_cost ?? 0);
                                        const actual = Number(item.unit_cost ?? 0);
                                        const expected2 = Math.round(expected * 100) / 100;
                                        const actual2 = Math.round(actual * 100) / 100;
                                        const diff = Math.round((actual2 - expected2) * 100) / 100;
                                        const hasVariance = expected2 !== actual2;
                                        const note = String(item.cost_note || '').trim();
                                        if (!hasVariance && !note) return null;
                                        return (
                                            <div className="mt-3 rounded-2xl bg-slate-50 border border-slate-200 p-3">
                                                <div className="grid grid-cols-3 gap-2 text-xs">
                                                    <div>
                                                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Expected</div>
                                                        <div className="font-black text-slate-700">Rp {expected2.toLocaleString()}</div>
                                                    </div>
                                                    <div>
                                                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Actual</div>
                                                        <div className="font-black text-slate-700">Rp {actual2.toLocaleString()}</div>
                                                    </div>
                                                    <div>
                                                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Selisih</div>
                                                        <div className={`font-black ${diff < 0 ? 'text-emerald-700' : diff > 0 ? 'text-rose-700' : 'text-slate-700'}`}>
                                                            Rp {diff.toLocaleString()}
                                                        </div>
                                                    </div>
                                                </div>
                                                {note && (
                                                    <div className="mt-2 text-xs text-slate-600">
                                                        <span className="font-black text-slate-500 uppercase tracking-wider text-[10px] mr-2">Alasan</span>
                                                        <span className="font-semibold">{note}</span>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}
                                </div>

                                {isPOClosed && item.received_qty >= item.qty && (
                                    <div className="flex items-center gap-2 text-emerald-600 font-black text-xs uppercase bg-emerald-50 py-2 px-4 rounded-2xl h-fit self-center">
                                        <CheckCircle2 size={16} /> Posted
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {confirm.open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
                    <div className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 shadow-xl p-4 space-y-4">
                        <div>
                            <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                                {confirm.action === 'verify2' ? 'Posting Gudang' : 'Verifikasi Draft'}
                            </p>
                            <h3 className="text-base font-black text-slate-900 mt-1">
                                {confirm.action === 'verify2' ? 'Konfirmasi Verifikasi 2 + Posting' : 'Konfirmasi Verifikasi 1'}
                            </h3>
                            <p className="text-xs text-slate-500 mt-1">
                                {confirm.action === 'verify2'
                                    ? 'Stok akan diposting ke gudang untuk item yang belum diposting. Pastikan data sudah benar.'
                                    : 'Draft akan ditandai Verified 1. Stok belum bertambah sampai Verifikasi 2.'}
                            </p>
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
                            <div className="flex items-center justify-between">
                                <span className="font-bold text-slate-500">Inbound</span>
                                <span className="font-black font-mono">#{po.id.split('-')[0].toUpperCase()}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="font-bold text-slate-500">Supplier</span>
                                <span className="font-black">{po.Supplier?.name || '-'}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="font-bold text-slate-500">Item</span>
                                <span className="font-black">{itemsCount}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="font-bold text-slate-500">Total Qty</span>
                                <span className="font-black">{totalQty} Pcs</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="font-bold text-slate-500">Total Modal</span>
                                <span className="font-black">Rp {Number(inboundTotalCost || 0).toLocaleString()}</span>
                            </div>
                            {confirm.action === 'verify2' && (
                                <div className="flex items-center justify-between">
                                    <span className="font-bold text-slate-500">Selisih Modal</span>
                                    <span className={`font-black ${varianceSummary.varianceCount > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                                        {varianceSummary.varianceCount} item
                                    </span>
                                </div>
                            )}
                        </div>

                        {confirm.action === 'verify2' && (
                            <div className="rounded-xl border border-slate-200 bg-white p-3">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Checklist Verifikasi</p>
                                <div className="mt-2 space-y-2 text-xs text-slate-700">
                                    <label className="flex items-start gap-2">
                                        <input
                                            type="checkbox"
                                            checked={verifyChecklist.supplierOk}
                                            onChange={(e) => setVerifyChecklist((p) => ({ ...p, supplierOk: e.target.checked }))}
                                            className="mt-0.5"
                                        />
                                        <span><span className="font-black">Supplier</span> sudah benar.</span>
                                    </label>
                                    <label className="flex items-start gap-2">
                                        <input
                                            type="checkbox"
                                            checked={verifyChecklist.qtyOk}
                                            onChange={(e) => setVerifyChecklist((p) => ({ ...p, qtyOk: e.target.checked }))}
                                            className="mt-0.5"
                                        />
                                        <span><span className="font-black">Qty fisik</span> sudah dicek (total {totalQty} Pcs).</span>
                                    </label>
                                    <label className="flex items-start gap-2">
                                        <input
                                            type="checkbox"
                                            checked={verifyChecklist.costOk}
                                            onChange={(e) => setVerifyChecklist((p) => ({ ...p, costOk: e.target.checked }))}
                                            className="mt-0.5"
                                        />
                                        <span><span className="font-black">Modal/unit cost</span> sudah benar.</span>
                                    </label>
                                    <label className="flex items-start gap-2">
                                        <input
                                            type="checkbox"
                                            checked={verifyChecklist.varianceReasonOk}
                                            onChange={(e) => setVerifyChecklist((p) => ({ ...p, varianceReasonOk: e.target.checked }))}
                                            className="mt-0.5"
                                        />
                                        <span>
                                            Jika ada selisih modal, <span className="font-black">alasan selisih</span> sudah terisi.
                                            {varianceSummary.missingReasonCount > 0 && (
                                                <span className="font-black text-rose-700"> ({varianceSummary.missingReasonCount} item masih kosong)</span>
                                            )}
                                        </span>
                                    </label>
                                    <label className="flex items-start gap-2">
                                        <input
                                            type="checkbox"
                                            checked={verifyChecklist.irreversibleOk}
                                            onChange={(e) => setVerifyChecklist((p) => ({ ...p, irreversibleOk: e.target.checked }))}
                                            className="mt-0.5"
                                        />
                                        <span>Setelah posting, <span className="font-black">stok bertambah</span> dan tidak bisa dibatalkan dari layar ini.</span>
                                    </label>
                                </div>
                            </div>
                        )}

                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setConfirm({ open: false, action: null })}
                                disabled={isSaving}
                                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 disabled:opacity-50"
                            >
                                Batal
                            </button>
                            <button
                                type="button"
                                onClick={async () => {
                                    if (confirm.action === 'verify1') await onVerify1();
                                    if (confirm.action === 'verify2') await onVerify2AndPost();
                                    setConfirm({ open: false, action: null });
                                }}
                                disabled={
                                    isSaving ||
                                    (confirm.action === 'verify2' &&
                                        (!verifyChecklist.supplierOk ||
                                            !verifyChecklist.qtyOk ||
                                            !verifyChecklist.costOk ||
                                            !verifyChecklist.varianceReasonOk ||
                                            !verifyChecklist.irreversibleOk ||
                                            varianceSummary.missingReasonCount > 0))
                                }
                                className={`rounded-xl text-white px-4 py-2 text-xs font-bold disabled:opacity-50 ${confirm.action === 'verify2' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-900 hover:bg-amber-600'}`}
                            >
                                {isSaving ? 'Memproses...' : 'Konfirmasi'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {costEditor.open && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                    <button
                        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
                        onClick={() => !isSaving && setCostEditor({ open: false })}
                        aria-label="Tutup"
                    />
                    <div className="relative w-full max-w-3xl rounded-[28px] bg-white border border-slate-200 shadow-2xl overflow-hidden">
                        <div className="p-6 border-b border-slate-100">
                            <h3 className="text-lg font-black text-slate-900">Edit Modal / Unit Cost</h3>
                            <p className="text-sm text-slate-600 mt-1 font-medium">
                                Isi modal aktual. Jika berbeda dari expected, alasan wajib diisi.
                            </p>
                        </div>
                        <div className="p-6 max-h-[70vh] overflow-y-auto space-y-3">
                            {costRows.map((row) => {
                                const expected2 = Math.round(Number(row.expected || 0) * 100) / 100;
                                const unitCostNum = Number(row.unit_cost);
                                const actual2 = Number.isFinite(unitCostNum) ? Math.round(unitCostNum * 100) / 100 : 0;
                                const hasActual = row.unit_cost.trim().length > 0 && Number.isFinite(unitCostNum) && unitCostNum > 0;
                                const isDifferent = hasActual && expected2 !== actual2;
                                return (
                                    <div key={row.product_id} className="rounded-3xl border border-slate-200 bg-white p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-mono">{row.sku}</div>
                                                <div className="font-black text-slate-900 truncate">{row.name}</div>
                                            </div>
                                            <div className="text-xs text-slate-600 font-bold">
                                                Expected: Rp {expected2.toLocaleString()}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                            <div>
                                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Unit Cost Actual (Wajib &gt; 0)</label>
                                                <input
                                                    value={row.unit_cost}
                                                    onChange={(e) => setCostRows((prev) => prev.map((p) => p.product_id === row.product_id ? { ...p, unit_cost: e.target.value } : p))}
                                                    className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2 text-sm font-black focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                                    placeholder="contoh: 8000"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Alasan Selisih (Wajib jika beda)</label>
                                                <input
                                                    value={row.cost_note}
                                                    onChange={(e) => setCostRows((prev) => prev.map((p) => p.product_id === row.product_id ? { ...p, cost_note: e.target.value } : p))}
                                                    className={`w-full mt-1 bg-slate-50 border rounded-2xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 ${isDifferent && !row.cost_note.trim() ? 'border-rose-300' : 'border-slate-200'}`}
                                                    placeholder={isDifferent ? 'contoh: cuci gudang' : 'opsional'}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="px-6 pb-6 flex gap-2 justify-end">
                            <button
                                onClick={() => setCostEditor({ open: false })}
                                disabled={isSaving}
                                className="rounded-2xl bg-white border border-slate-200 text-slate-700 text-sm font-black px-5 py-3 hover:bg-slate-50 disabled:opacity-50 transition-all"
                            >
                                Batal
                            </button>
                            <button
                                onClick={async () => {
                                    const invalid = costRows.find((r) => {
                                        const unitCostNum = Number(r.unit_cost);
                                        if (!Number.isFinite(unitCostNum) || unitCostNum <= 0) return true;
                                        const expected2 = Math.round(Number(r.expected || 0) * 100) / 100;
                                        const actual2 = Math.round(unitCostNum * 100) / 100;
                                        const isDifferent = expected2 !== actual2;
                                        return isDifferent && !r.cost_note.trim();
                                    });
                                    if (invalid) {
                                        setMessageType('error');
                                        setMessage(`Alasan selisih wajib diisi untuk SKU ${invalid.sku}.`);
                                        return;
                                    }

                                    setIsSaving(true);
                                    setMessage('');
                                    try {
                                        await api.admin.inventory.updateInboundItemCosts(po.id, {
                                            items: costRows.map((r) => ({
                                                product_id: r.product_id,
                                                unit_cost: Number(r.unit_cost),
                                                ...(r.cost_note.trim() ? { cost_note: r.cost_note.trim() } : {}),
                                            })),
                                        });
                                        setMessageType('success');
                                        setMessage('Modal inbound berhasil diperbarui.');
                                        setCostEditor({ open: false });
                                        await loadPO();
                                    } catch (error: unknown) {
                                        const err = error as { response?: { data?: { message?: string } } };
                                        setMessageType('error');
                                        setMessage(err?.response?.data?.message || 'Gagal update modal inbound.');
                                    } finally {
                                        setIsSaving(false);
                                    }
                                }}
                                disabled={isSaving}
                                className="rounded-2xl bg-slate-900 text-white text-sm font-black px-6 py-3 inline-flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-slate-800 transition-all"
                            >
                                {isSaving ? (
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                ) : (
                                    <Save size={18} />
                                )}
                                Simpan Perubahan
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
