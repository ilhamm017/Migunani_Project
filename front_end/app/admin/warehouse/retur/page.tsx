'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import {
    PackageSearch,
    CheckCircle,
    XCircle,
    Truck,
    ChevronRight,
    Image as ImageIcon,
    Clock,
    AlertCircle,
    User as UserIcon,
    DollarSign,
    Box
} from 'lucide-react';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import Link from 'next/link';

export default function WarehouseReturPage() {
    const allowed = useRequireRoles(['super_admin', 'admin_gudang'], '/admin');
    const [returs, setReturs] = useState<any[]>([]);
    const [couriers, setCouriers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedRetur, setSelectedRetur] = useState<any>(null);
    const [submitting, setSubmitting] = useState(false);

    // Form states for management
    const [courierId, setCourierId] = useState('');
    const [refundAmount, setRefundAmount] = useState<string>('');
    const [isBackToStock, setIsBackToStock] = useState<boolean>(true);
    const [adminResponse, setAdminResponse] = useState('');

    useEffect(() => {
        if (allowed) {
            loadData();
            loadCouriers();
        }
    }, [allowed]);

    // Debugging and Auto-Calculation Logic
    const [debugPriceInfo, setDebugPriceInfo] = useState<string>('');

    useEffect(() => {
        if (!selectedRetur) {
            setDebugPriceInfo('');
            return;
        }

        // Only auto-calc if refund_amount is not meaningfully set (null, 0, "0.00")
        const existingRefund = Number(selectedRetur.refund_amount || 0);
        if (existingRefund > 0) {
            setDebugPriceInfo(`Refund sudah ditetapkan: ${existingRefund}`);
            setRefundAmount(existingRefund.toString());
            return;
        }

        // Try to calculate from OrderItem price history
        const orderItems = selectedRetur.Order?.OrderItems;
        console.log('Auto-calc: product_id=', selectedRetur.product_id, 'OrderItems=', orderItems);

        if (orderItems && orderItems.length > 0) {
            const item = orderItems.find((oi: any) => String(oi.product_id) === String(selectedRetur.product_id));
            if (item) {
                const price = Number(item.price_at_purchase || 0);
                const total = price * Number(selectedRetur.qty);
                setDebugPriceInfo(`Hitung: Rp ${price.toLocaleString()} x ${selectedRetur.qty} = Rp ${total.toLocaleString()}`);
                setRefundAmount(total > 0 ? total.toString() : '');
                return;
            }
        }

        // Fallback: OrderItems not available, show message
        setDebugPriceInfo('Data harga item tidak tersedia dari riwayat pesanan.');
        setRefundAmount('');
    }, [selectedRetur]);

    const loadData = async () => {
        try {
            setLoading(true);
            const res = await api.retur.getAll();
            setReturs(res.data || []);
        } catch (error) {
            console.error('Failed to load returs:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadCouriers = async () => {
        try {
            const res = await api.admin.orderManagement.getCouriers();
            setCouriers(res.data.employees || []);
        } catch (error) {
            console.error('Failed to load couriers:', error);
        }
    };

    const handleUpdateStatus = async (id: string, nextStatus: string) => {
        try {
            setSubmitting(true);
            const payload: any = { status: nextStatus, admin_response: adminResponse };

            if (nextStatus === 'pickup_assigned') {
                payload.courier_id = courierId;
                payload.refund_amount = Number(refundAmount);
            }

            if (nextStatus === 'completed') {
                payload.is_back_to_stock = isBackToStock;
            }

            await api.retur.updateStatus(id, payload);
            alert('Status retur berhasil diperbarui');
            setSelectedRetur(null);
            setAdminResponse('');
            setCourierId('');
            setRefundAmount('');
            loadData();
        } catch (error: any) {
            alert('Gagal update: ' + (error.response?.data?.message || 'Error unknown'));
        } finally {
            setSubmitting(false);
        }
    };

    if (!allowed) return null;

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'pending': return 'bg-amber-100 text-amber-700 border-amber-200';
            case 'approved': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
            case 'pickup_assigned': return 'bg-blue-100 text-blue-700 border-blue-200';
            case 'picked_up': return 'bg-amber-100 text-amber-700 border-amber-200';
            case 'handed_to_warehouse': return 'bg-violet-100 text-violet-700 border-violet-200';
            case 'received': return 'bg-indigo-100 text-indigo-700 border-indigo-200';
            case 'completed': return 'bg-slate-100 text-slate-700 border-slate-200';
            case 'rejected': return 'bg-rose-100 text-rose-700 border-rose-200';
            default: return 'bg-slate-100 text-slate-500 border-slate-200';
        }
    };

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'pending': return 'Menunggu Persetujuan';
            case 'approved': return 'Disetujui (Belum Dijemput)';
            case 'pickup_assigned': return 'Kurir Ditugaskan';
            case 'picked_up': return 'Sudah Dipickup Kurir';
            case 'handed_to_warehouse': return 'Menunggu ACC Gudang';
            case 'received': return 'Barang Diterima Gudang';
            case 'completed': return 'Selesai';
            case 'rejected': return 'Ditolak';
            default: return status;
        }
    };

    return (
        <div className="warehouse-page">
            <div>
                <h1 className="warehouse-title">Kelola Pengembalian Barang</h1>
                <p className="warehouse-subtitle">Verifikasi pengajuan retur, tugaskan kurir, dan kelola stok kembali.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* List View */}
                <div className="lg:col-span-1 space-y-4">
                    <div className="warehouse-panel bg-white border border-slate-200 rounded-[28px] p-4 shadow-sm overflow-hidden">
                        <div className="flex items-center justify-between mb-4 px-2">
                            <h2 className="text-sm font-black text-slate-900">Daftar Retur</h2>
                            <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{returs.length} Total</span>
                        </div>

                        {loading ? (
                            <div className="space-y-3">
                                {[1, 2, 3].map(i => <div key={i} className="h-20 bg-slate-50 rounded-2xl animate-pulse" />)}
                            </div>
                        ) : returs.length === 0 ? (
                            <div className="text-center py-10">
                                <PackageSearch size={32} className="mx-auto text-slate-300 mb-2" />
                                <p className="text-xs text-slate-400 italic">Tidak ada pengajuan retur.</p>
                            </div>
                        ) : (
                            <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-300px)] lg:max-h-[700px] pr-1">
                                {returs.map((r) => (
                                    <button
                                        key={r.id}
                                        onClick={() => {
                                            setSelectedRetur(r);
                                            setAdminResponse(r.admin_response || '');
                                            setCourierId(r.courier_id || '');
                                            // Refund will be auto-calculated via useEffect
                                            setRefundAmount('');
                                            setIsBackToStock(r.is_back_to_stock ?? true);
                                        }}
                                        className={`w-full text-left p-4 rounded-2xl border transition-all ${selectedRetur?.id === r.id ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-100 hover:border-emerald-200'}`}
                                    >
                                        <div className="flex justify-between items-start gap-2 mb-2">
                                            <div className="min-w-0">
                                                <p className="text-xs font-black text-slate-900 truncate">{r.Product?.name || 'Produk dihapus'}</p>
                                                <p className="text-[10px] text-slate-400 font-mono mt-0.5">{r.Product?.sku || '-'}</p>
                                            </div>
                                            <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full border ${getStatusColor(r.status)}`}>
                                                {getStatusLabel(r.status)}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between text-[10px] text-slate-500">
                                            <span>Order #{r.order_id.slice(0, 8)}</span>
                                            <div className="flex items-center gap-1 font-bold text-slate-700">
                                                <ChevronRight size={12} className={selectedRetur?.id === r.id ? 'text-emerald-500' : 'text-slate-300'} />
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Detail & Action View */}
                <div className="lg:col-span-2">
                    {selectedRetur ? (
                        <div className="warehouse-panel bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm space-y-8 h-fit">
                            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 border-b border-slate-100 pb-6">
                                <div>
                                    <div className="flex items-center gap-3 mb-2">
                                        <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-full border ${getStatusColor(selectedRetur.status)}`}>
                                            {getStatusLabel(selectedRetur.status)}
                                        </span>
                                        <span className="text-[10px] font-bold text-slate-400">Dibuat: {formatDateTime(selectedRetur.createdAt)}</span>
                                    </div>
                                    <h2 className="text-2xl font-black text-slate-900">{selectedRetur.Product?.name}</h2>
                                    <p className="text-sm text-slate-500">SKU: <span className="font-mono">{selectedRetur.Product?.sku}</span> • Qty: <span className="font-bold text-slate-900">{selectedRetur.qty} unit</span></p>
                                </div>
                                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                    <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Pengaju / Customer</p>
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-500">
                                            <UserIcon size={14} />
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-slate-900">{selectedRetur.Creator?.name || 'Customer'}</p>
                                            <p className="text-[10px] text-slate-500">{selectedRetur.Creator?.whatsapp_number || '-'}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-6">
                                    <section>
                                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                                            <ImageIcon size={14} /> Alasan & Bukti
                                        </h3>
                                        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200">
                                            <p className="text-sm text-slate-700 leading-relaxed italic">"{selectedRetur.reason}"</p>
                                            {selectedRetur.evidence_img && (
                                                <Link
                                                    href={`/${selectedRetur.evidence_img}`}
                                                    target="_blank"
                                                    className="mt-4 block relative rounded-xl overflow-hidden border border-slate-200 group"
                                                >
                                                    <img
                                                        src={`/${selectedRetur.evidence_img}`}
                                                        alt="Evidence"
                                                        className="w-full h-40 object-cover group-hover:scale-105 transition-transform"
                                                    />
                                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                        <span className="text-white text-[10px] font-bold uppercase tracking-widest">Lihat Foto</span>
                                                    </div>
                                                </Link>
                                            )}
                                        </div>
                                    </section>
                                </div>

                                <div className="space-y-6">
                                    <section>
                                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                                            <Clock size={14} /> Kelola Alur Retur
                                        </h3>
                                        <div className="space-y-4">
                                            {selectedRetur.status === 'pending' && (
                                                <div className="space-y-4">
                                                    <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-start gap-3">
                                                        <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                                                        <p className="text-xs text-amber-800 leading-relaxed">
                                                            Tinjau keluhan di samping. Jika valid, klik **Setujui** untuk memproses penjemputan barang.
                                                        </p>
                                                    </div>
                                                    <textarea
                                                        placeholder="Catatan untuk customer (Opsional)..."
                                                        value={adminResponse}
                                                        onChange={(e) => setAdminResponse(e.target.value)}
                                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500/20 outline-none h-24"
                                                    />
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <button
                                                            onClick={() => handleUpdateStatus(selectedRetur.id, 'rejected')}
                                                            disabled={submitting}
                                                            className="py-3 bg-white border border-rose-200 text-rose-600 rounded-xl text-xs font-black uppercase hover:bg-rose-50 transition-colors"
                                                        >
                                                            Tolak Retur
                                                        </button>
                                                        <button
                                                            onClick={() => handleUpdateStatus(selectedRetur.id, 'approved')}
                                                            disabled={submitting}
                                                            className="py-3 bg-emerald-600 text-white rounded-xl text-xs font-black uppercase hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-600/20"
                                                        >
                                                            Setujui Retur
                                                        </button>
                                                    </div>
                                                </div>
                                            )}

                                            {selectedRetur.status === 'approved' && (
                                                <div className="space-y-4">
                                                    <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl flex items-start gap-3">
                                                        <Truck size={18} className="text-blue-600 shrink-0 mt-0.5" />
                                                        <p className="text-xs text-blue-800 leading-relaxed">
                                                            Retur disetujui. Sekarang tugaskan kurir untuk jemput barang dan tentukan jumlah uang refund (jika ada).
                                                        </p>
                                                    </div>
                                                    <div className="space-y-3">
                                                        <div className="space-y-1.5">
                                                            <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Pilih Kurir Penjemput</label>
                                                            <select
                                                                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
                                                                value={courierId}
                                                                onChange={(e) => setCourierId(e.target.value)}
                                                            >
                                                                <option value="">- Pilih Kurir -</option>
                                                                {couriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                                            </select>
                                                        </div>
                                                        <div className="space-y-1.5">
                                                            <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Nominal Refund (Oleh Finance)</label>
                                                            <div className="relative">
                                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold">Rp</span>
                                                                <input
                                                                    type="number"
                                                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 pl-10 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 font-bold"
                                                                    placeholder="0"
                                                                    value={refundAmount}
                                                                    onChange={(e) => setRefundAmount(e.target.value)}
                                                                />
                                                            </div>
                                                            <p className="text-[9px] text-slate-400 italic mt-1">* Instruksi uang akan diteruskan ke Admin Finance.</p>
                                                            {debugPriceInfo && <p className="text-[10px] text-emerald-600 font-mono mt-1 bg-emerald-50 p-1 rounded border border-emerald-100">{debugPriceInfo}</p>}
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => handleUpdateStatus(selectedRetur.id, 'pickup_assigned')}
                                                        disabled={submitting || !courierId}
                                                        className="w-full py-4 bg-blue-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20"
                                                    >
                                                        Tugaskan Kurir & Finance
                                                    </button>
                                                </div>
                                            )}

                                            {selectedRetur.status === 'pickup_assigned' && (
                                                <div className="space-y-4">
                                                    <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl space-y-3">
                                                        <div className="flex items-start gap-3">
                                                            <Clock size={18} className="text-indigo-600 shrink-0 mt-0.5" />
                                                            <p className="text-xs text-indigo-800 leading-relaxed font-bold">
                                                                Kurir sudah ditugaskan. Menunggu driver pickup barang retur dari customer.
                                                            </p>
                                                        </div>
                                                        <div className="pl-7 space-y-1">
                                                            <p className="text-[10px] text-indigo-600">Kurir: <span className="font-black underline">{selectedRetur.Courier?.name || 'Loading...'}</span></p>
                                                            <p className="text-[10px] text-indigo-600">Refund: <span className="font-black">{formatCurrency(selectedRetur.refund_amount || 0)}</span></p>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {selectedRetur.status === 'picked_up' && (
                                                <div className="space-y-4">
                                                    <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-start gap-3">
                                                        <Truck size={18} className="text-amber-600 shrink-0 mt-0.5" />
                                                        <p className="text-xs text-amber-800 leading-relaxed font-bold">
                                                            Driver sudah pickup barang. Menunggu driver menyerahkan fisik barang ke gudang.
                                                        </p>
                                                    </div>
                                                </div>
                                            )}

                                            {selectedRetur.status === 'handed_to_warehouse' && (
                                                <div className="space-y-4">
                                                    <div className="p-4 bg-violet-50 border border-violet-100 rounded-2xl flex items-start gap-3">
                                                        <CheckCircle size={18} className="text-violet-600 shrink-0 mt-0.5" />
                                                        <p className="text-xs text-violet-800 leading-relaxed font-bold">
                                                            Driver sudah konfirmasi barang diserahkan. Silakan ACC jika barang fisik benar-benar sudah diterima gudang.
                                                        </p>
                                                    </div>
                                                    <button
                                                        onClick={() => handleUpdateStatus(selectedRetur.id, 'received')}
                                                        disabled={submitting}
                                                        className="w-full py-4 bg-violet-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-violet-700 transition-colors"
                                                    >
                                                        ACC Barang Diterima Gudang
                                                    </button>
                                                </div>
                                            )}

                                            {selectedRetur.status === 'received' && (
                                                <div className="space-y-4">
                                                    <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl text-white space-y-4">
                                                        <div className="flex items-start gap-3">
                                                            <Box size={20} className="text-emerald-400 shrink-0" />
                                                            <div>
                                                                <p className="text-sm font-black">Barang sudah di Tangan Gudang</p>
                                                                <p className="text-[10px] opacity-60">Putuskan apakah barang ini layak jual kembali (masuk stok) atau tidak.</p>
                                                            </div>
                                                        </div>

                                                        <div className="bg-slate-800 p-3 rounded-xl flex items-center justify-between">
                                                            <span className="text-xs font-bold">Masukkan Kembali ke Stok?</span>
                                                            <div className="flex bg-slate-700 rounded-lg p-1">
                                                                <button
                                                                    onClick={() => setIsBackToStock(true)}
                                                                    className={`px-3 py-1 rounded-md text-[10px] font-black transition-colors ${isBackToStock ? 'bg-emerald-500 text-white' : 'text-slate-400 hover:text-white'}`}
                                                                >YA</button>
                                                                <button
                                                                    onClick={() => setIsBackToStock(false)}
                                                                    className={`px-3 py-1 rounded-md text-[10px] font-black transition-colors ${!isBackToStock ? 'bg-rose-500 text-white' : 'text-slate-400 hover:text-white'}`}
                                                                >TIDAK</button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => handleUpdateStatus(selectedRetur.id, 'completed')}
                                                        disabled={submitting}
                                                        className="w-full py-4 bg-emerald-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-600/20"
                                                    >
                                                        Selesaikan Retur & Update Stok
                                                    </button>
                                                </div>
                                            )}

                                            {['completed', 'rejected'].includes(selectedRetur.status) && (
                                                <div className="p-10 border-2 border-dashed border-slate-100 rounded-[32px] flex flex-col items-center justify-center text-center">
                                                    <CheckCircle size={40} className="text-slate-200 mb-4" />
                                                    <p className="text-sm font-bold text-slate-400">Proses Retur Selesai</p>
                                                    <p className="text-[10px] text-slate-400 mt-1 italic">Tidak ada tindakan manual lebih lanjut diperlukan.</p>
                                                </div>
                                            )}
                                        </div>
                                    </section>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center bg-slate-50 border border-dashed border-slate-200 rounded-[48px] p-20 text-center">
                            <div className="w-20 h-20 bg-white rounded-3xl shadow-sm flex items-center justify-center mb-6">
                                <PackageSearch size={40} className="text-slate-300" />
                            </div>
                            <h3 className="text-slate-900 font-bold text-lg mb-2">Pilih data untuk dikelola</h3>
                            <p className="text-sm text-slate-400 max-w-sm mx-auto leading-relaxed">
                                Klik salah satu pengajuan retur di daftar sebelah kiri untuk melihat detail bukti dan memproses persetujuan.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
