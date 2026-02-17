'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
    ArrowLeft,
    Save,
    CheckCircle2,
    AlertCircle,
    Truck,
    Package,
    Calendar,
    Plus,
    Minus,
    Clock
} from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';

interface POItem {
    id: number;
    purchase_order_id: string;
    product_id: string;
    qty: number;
    unit_cost: number;
    total_cost: number;
    received_qty: number;
    Product?: {
        id: string;
        sku: string;
        name: string;
        stock_quantity: number;
    };
}

interface PO {
    id: string;
    supplier_id: number;
    status: 'pending' | 'received' | 'partially_received' | 'canceled';
    total_cost: number;
    createdAt: string;
    Supplier?: {
        id: number;
        name: string;
    };
    Items?: POItem[];
}

export default function POReceivePage() {
    const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'kasir'], '/admin');
    const { id } = useParams();
    const router = useRouter();

    const [po, setPo] = useState<PO | null>(null);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [messageType, setMessageType] = useState<'success' | 'error'>('success');

    // State for inputting fresh received quantities
    const [receivedInputs, setReceivedInputs] = useState<Record<string, number>>({});
    const [itemNotes, setItemNotes] = useState<Record<string, string>>({});

    useEffect(() => {
        if (allowed && id) {
            loadPO();
        }
    }, [allowed, id]);

    const loadPO = async () => {
        try {
            setLoading(true);
            const res = await api.admin.inventory.getPOById(id as string);
            setPo(res.data);

            // Initialize inputs
            const initials: Record<string, number> = {};
            res.data.Items?.forEach((item: POItem) => {
                initials[item.product_id] = 0;
            });
            setReceivedInputs(initials);
        } catch (error) {
            console.error('Failed to load PO', error);
            setMessage('Gagal memuat detail Purchase Order.');
            setMessageType('error');
        } finally {
            setLoading(false);
        }
    };

    const handleInputChange = (productId: string, val: number) => {
        const item = po?.Items?.find(i => i.product_id === productId);
        if (!item) return;

        const remaining = item.qty - item.received_qty;
        const boundedVal = Math.max(0, val); // Allow over-receiving if needed, or cap it at remaining

        setReceivedInputs(prev => ({
            ...prev,
            [productId]: boundedVal
        }));
    };

    const handleNoteChange = (productId: string, note: string) => {
        setItemNotes(prev => ({
            ...prev,
            [productId]: note
        }));
    };

    const onSave = async () => {
        if (!po) return;

        const itemsToSubmit = Object.entries(receivedInputs)
            .filter(([_, qty]) => qty > 0)
            .map(([productId, qty]) => ({
                product_id: productId,
                received_qty: qty,
                note: itemNotes[productId]
            }));

        if (itemsToSubmit.length === 0) {
            setMessage('Masukkan setidaknya satu jumlah barang yang diterima.');
            setMessageType('error');
            return;
        }

        setIsSaving(true);
        setMessage('');
        try {
            await api.admin.inventory.receivePO(po.id, { items: itemsToSubmit });
            setMessageType('success');
            setMessage('Penerimaan stok berhasil dicatat.');
            await loadPO(); // Reload to update received_qty in list
        } catch (error: any) {
            setMessageType('error');
            setMessage(error?.response?.data?.message || 'Gagal menyimpan penerimaan barang.');
        } finally {
            setIsSaving(false);
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
                <h2 className="text-xl font-bold">PO Tidak Ditemukan</h2>
                <Link href="/admin/warehouse/inbound/history" className="text-emerald-600 font-bold mt-4 inline-block">Kembali ke Riwayat</Link>
            </div>
        );
    }

    const isPOClosed = po.status === 'received' || po.status === 'canceled';

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
                            Penerimaan Barang (Inbound)
                        </h1>
                        <p className="warehouse-subtitle !mb-0 font-mono text-xs uppercase tracking-widest text-slate-400">PO #{po.id.split('-')[0].toUpperCase()}</p>
                    </div>
                </div>

                {!isPOClosed && (
                    <button
                        onClick={onSave}
                        disabled={isSaving}
                        className="rounded-2xl bg-slate-900 text-white text-sm font-black px-6 py-3.5 inline-flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-emerald-600 transition-all shadow-lg active:scale-95"
                    >
                        {isSaving ? (
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                            <Save size={18} />
                        )}
                        Simpan Penerimaan
                    </button>
                )}
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
                            Informasi Pemasok
                        </h2>
                        <div className="space-y-4">
                            <div className="flex flex-col">
                                <span className="text-xs font-bold text-slate-400">Supplier</span>
                                <span className="text-lg font-black text-slate-900 leading-tight">{po.Supplier?.name}</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-xs font-bold text-slate-400">Tanggal PO</span>
                                <span className="text-sm font-bold text-slate-700">{new Date(po.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
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
                            {po.status === 'received' ? 'PO Selesai' :
                                po.status === 'partially_received' ? 'Diterima Sebagian' :
                                    'Menunggu Barang'}
                        </h3>
                        <p className="text-xs text-slate-500 mt-1 font-medium">Status saat ini untuk Purchase Order ini.</p>

                        <div className="mt-6 pt-6 border-t border-slate-50">
                            <div className="flex justify-between items-center text-xs font-bold mb-1">
                                <span className="text-slate-400">Progress Penerimaan</span>
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
                            Verifikasi Barang Datang
                        </h2>

                        {po.Items?.map((item) => (
                            <div key={item.id} className="warehouse-panel bg-white border border-slate-200 rounded-[32px] p-5 shadow-sm hover:border-emerald-500/30 transition-all flex flex-col md:flex-row gap-6">
                                <div className="flex-1 space-y-1">
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono mb-1">{item.Product?.sku}</p>
                                    <h4 className="text-base font-black text-slate-900 leading-tight">{item.Product?.name}</h4>

                                    <div className="flex items-center gap-4 mt-3">
                                        <div className="bg-slate-50 rounded-2xl px-3 py-1.5 flex flex-col items-center">
                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Total Pesan</span>
                                            <span className="text-sm font-black text-slate-700">{item.qty}</span>
                                        </div>
                                        <div className="bg-emerald-50 rounded-2xl px-3 py-1.5 flex flex-col items-center">
                                            <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-tighter">Terima Sejauh Ini</span>
                                            <span className="text-sm font-black text-emerald-700">{item.received_qty}</span>
                                        </div>
                                        <div className="bg-blue-50 rounded-2xl px-3 py-1.5 flex flex-col items-center">
                                            <span className="text-[9px] font-bold text-blue-400 uppercase tracking-tighter">Sisa Belum Datang</span>
                                            <span className="text-sm font-black text-blue-700">{Math.max(0, item.qty - item.received_qty)}</span>
                                        </div>
                                    </div>
                                </div>

                                {!isPOClosed && item.received_qty < item.qty && (
                                    <div className="w-full md:w-56 space-y-3">
                                        <div className="flex flex-col gap-1.5">
                                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Baru Diterima (Pcs)</label>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => handleInputChange(item.product_id, (receivedInputs[item.product_id] || 0) - 1)}
                                                    className="p-2.5 rounded-xl bg-slate-50 text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors border border-slate-200"
                                                >
                                                    <Minus size={18} />
                                                </button>
                                                <input
                                                    type="number"
                                                    value={receivedInputs[item.product_id] || ''}
                                                    onChange={(e) => handleInputChange(item.product_id, parseInt(e.target.value) || 0)}
                                                    className="flex-1 min-w-0 bg-slate-100/50 border-2 border-slate-200 rounded-xl px-2 py-2.5 text-center font-black text-slate-900 focus:outline-none focus:border-emerald-500 transition-all"
                                                />
                                                <button
                                                    onClick={() => handleInputChange(item.product_id, (receivedInputs[item.product_id] || 0) + 1)}
                                                    className="p-2.5 rounded-xl bg-slate-50 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 transition-colors border border-slate-200"
                                                >
                                                    <Plus size={18} />
                                                </button>
                                            </div>
                                        </div>
                                        <input
                                            placeholder="Catatan kecil (exp, reject, dll)..."
                                            value={itemNotes[item.product_id] || ''}
                                            onChange={(e) => handleNoteChange(item.product_id, e.target.value)}
                                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none focus:border-emerald-500"
                                        />
                                    </div>
                                )}

                                {isPOClosed && item.received_qty >= item.qty && (
                                    <div className="flex items-center gap-2 text-emerald-600 font-black text-xs uppercase bg-emerald-50 py-2 px-4 rounded-2xl h-fit self-center">
                                        <CheckCircle2 size={16} /> Fully Received
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
