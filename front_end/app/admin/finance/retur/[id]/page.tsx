'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import {
    ArrowLeft,
    Package,
    Hash,
    DollarSign,
    Truck,
    User as UserIcon,
    Calendar,
    Receipt,
    ShoppingCart,
    CheckCircle,
    Clock,
    HandCoins,
    RotateCcw,
    Image as ImageIcon,
    MessageSquare,
    X,
    AlertCircle,
    MessageCircle
} from 'lucide-react';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import Link from 'next/link';

export default function FinanceReturDetailPage() {
    const allowed = useRequireRoles(['super_admin', 'admin_finance']);
    const params = useParams();
    const returId = params.id as string;

    const [retur, setRetur] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [zoomedImage, setZoomedImage] = useState<string | null>(null);

    useEffect(() => {
        if (allowed && returId) {
            loadData();
        }
    }, [allowed, returId]);

    const loadData = async () => {
        try {
            setLoading(true);
            const res = await api.retur.getAll();
            const found = (res.data || []).find((r: any) => String(r.id) === String(returId));
            setRetur(found || null);
        } catch (error) {
            console.error('Failed to load retur detail:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleDisburse = async () => {
        if (!confirm('Apakah Anda yakin ingin mencairkan dana refund ini? Pastikan Anda sudah melakukan transfer ke customer.')) return;

        try {
            setSubmitting(true);
            await api.retur.disburse(retur.id, 'Pencairan manual via admin finance');
            alert('Pencairan dana berhasil dicatat!');
            loadData(); // Refresh to see update
        } catch (error: any) {
            console.error('Disburse failed:', error);
            alert('Gagal mencairkan dana: ' + (error.response?.data?.message || 'Error unknown'));
        } finally {
            setSubmitting(false);
        }
    };

    if (!allowed) return null;

    if (loading) {
        return (
            <div className="p-6 max-w-3xl mx-auto space-y-4">
                <div className="h-10 w-48 bg-slate-100 rounded-xl animate-pulse" />
                <div className="h-64 bg-slate-100 rounded-[32px] animate-pulse" />
                <div className="h-48 bg-slate-100 rounded-[32px] animate-pulse" />
            </div>
        );
    }

    if (!retur) {
        return (
            <div className="p-6 max-w-3xl mx-auto text-center py-20">
                <p className="text-slate-400 font-bold text-lg">Data retur tidak ditemukan.</p>
                <Link href="/admin/finance/retur" className="text-emerald-600 text-sm font-bold mt-2 inline-block hover:underline">← Kembali ke Daftar</Link>
            </div>
        );
    }

    // Calculate refund info
    const orderItem = retur.Order?.OrderItems?.find((oi: any) => String(oi.product_id) === String(retur.product_id));
    const priceAtPurchase = Number(orderItem?.price_at_purchase || 0);
    const qtyPurchased = Number(orderItem?.qty || 0);
    const calculatedRefund = priceAtPurchase * retur.qty;
    const actualRefund = Number(retur.refund_amount || 0);

    const getStatusInfo = (status: string) => {
        switch (status) {
            case 'pending': return { label: 'Menunggu Persetujuan', color: 'bg-amber-100 text-amber-700 border-amber-200', icon: Clock };
            case 'approved': return { label: 'Disetujui', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle };
            case 'pickup_assigned': return { label: 'Kurir Ditugaskan', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: Truck };
            case 'picked_up': return { label: 'Sudah Dipickup Kurir', color: 'bg-amber-100 text-amber-700 border-amber-200', icon: Truck };
            case 'handed_to_warehouse': return { label: 'Menunggu ACC Gudang', color: 'bg-violet-100 text-violet-700 border-violet-200', icon: RotateCcw };
            case 'received': return { label: 'Barang Diterima Gudang', color: 'bg-indigo-100 text-indigo-700 border-indigo-200', icon: RotateCcw };
            case 'completed': return { label: 'Selesai', color: 'bg-slate-100 text-slate-600 border-slate-200', icon: CheckCircle };
            case 'rejected': return { label: 'Ditolak', color: 'bg-rose-100 text-rose-700 border-rose-200', icon: Clock };
            default: return { label: status, color: 'bg-slate-100 text-slate-500 border-slate-200', icon: Clock };
        }
    };

    const statusInfo = getStatusInfo(retur.status);
    const StatusIcon = statusInfo.icon;

    return (
        <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Link href="/admin/finance/retur" className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-900 transition-colors">
                    <ArrowLeft size={20} />
                </Link>
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-full border ${statusInfo.color}`}>
                            {statusInfo.label}
                        </span>
                    </div>
                    <h1 className="text-xl font-black text-slate-900">{retur.Product?.name}</h1>
                    <p className="text-xs text-slate-400 font-mono">SKU: {retur.Product?.sku || '-'}</p>
                </div>
            </div>

            {/* Urgent Banner */}
            {['pickup_assigned', 'picked_up', 'handed_to_warehouse'].includes(retur.status) && (
                <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-5 flex items-center gap-4 animate-pulse">
                    <div className="w-12 h-12 bg-rose-100 rounded-full flex items-center justify-center shrink-0">
                        <HandCoins size={24} className="text-rose-600" />
                    </div>
                    <div>
                        <p className="text-sm font-black text-rose-700 uppercase">Perlu Pencairan Dana</p>
                        <p className="text-xs text-rose-600 mt-0.5">Retur sedang dalam proses penjemputan. Pastikan dana refund siap.</p>
                    </div>
                </div>
            )}

            {/* Customer Info */}
            <div className="bg-white border border-slate-200 rounded-[28px] p-5 shadow-sm">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <UserIcon size={12} /> Informasi Pengaju
                </h3>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
                            <UserIcon size={20} />
                        </div>
                        <div>
                            <p className="text-sm font-black text-slate-900">{retur.Creator?.name || 'Customer'}</p>
                            <p className="text-xs text-slate-500">{retur.Creator?.whatsapp_number || '-'}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                        <Calendar size={14} />
                        <span>{formatDateTime(retur.createdAt)}</span>
                    </div>
                </div>
            </div>

            {/* Order Metadata */}
            <div className="bg-white border border-slate-200 rounded-[28px] p-5 shadow-sm">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <ShoppingCart size={12} /> Detail Pesanan Asal
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 text-center">
                        <Hash size={16} className="mx-auto text-slate-400 mb-2" />
                        <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Order ID</p>
                        <p className="text-xs font-mono font-bold text-slate-700 break-all">{retur.order_id.slice(0, 8)}</p>
                    </div>
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 text-center">
                        <Receipt size={16} className="mx-auto text-slate-400 mb-2" />
                        <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Status Order</p>
                        <p className="text-xs font-bold text-slate-700 capitalize">{retur.Order?.status || '-'}</p>
                    </div>
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 text-center">
                        <DollarSign size={16} className="mx-auto text-slate-400 mb-2" />
                        <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Total Order</p>
                        <p className="text-xs font-bold text-slate-700">{formatCurrency(retur.Order?.total_amount || 0)}</p>
                    </div>
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 text-center">
                        <Package size={16} className="mx-auto text-slate-400 mb-2" />
                        <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Produk</p>
                        <p className="text-xs font-mono font-bold text-slate-700">{retur.Product?.sku || '-'}</p>
                    </div>
                </div>
            </div>

            {/* Refund Detail */}
            <div className="bg-white border border-emerald-200 rounded-[28px] p-5 shadow-sm">
                <h3 className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <DollarSign size={12} /> Rincian Refund
                </h3>
                <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-100 text-center">
                        <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Harga Beli / Unit</p>
                        <p className="text-sm font-black text-slate-800">{priceAtPurchase > 0 ? formatCurrency(priceAtPurchase) : '-'}</p>
                    </div>
                    <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-100 text-center">
                        <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Qty Retur</p>
                        <p className="text-sm font-black text-slate-800">{retur.qty} unit</p>
                    </div>
                    <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-100 text-center">
                        <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Qty Beli Asal</p>
                        <p className="text-sm font-black text-slate-800">{qtyPurchased > 0 ? `${qtyPurchased} unit` : '-'}</p>
                    </div>
                </div>

                <div className="bg-emerald-600 rounded-2xl p-5 flex items-center justify-between text-white">
                    <div>
                        <p className="text-[10px] font-black uppercase opacity-70">Nominal Refund</p>
                        {priceAtPurchase > 0 && (
                            <p className="text-xs opacity-80 mt-0.5">
                                {formatCurrency(priceAtPurchase)} × {retur.qty} = {formatCurrency(calculatedRefund)}
                            </p>
                        )}
                    </div>
                    <p className="text-3xl font-black">{formatCurrency(actualRefund)}</p>
                </div>

                {/* Disbursement Action */}
                <div className="mt-4">
                    {retur.refund_disbursed_at ? (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3">
                            <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 shrink-0">
                                <CheckCircle size={20} />
                            </div>
                            <div>
                                <p className="text-sm font-black text-emerald-700">Dana Sudah Dicairkan</p>
                                <p className="text-[10px] text-emerald-600">
                                    Pada: {formatDateTime(retur.refund_disbursed_at)}
                                    {retur.refund_note && ` • Catatan: ${retur.refund_note}`}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                            <div className="flex items-start gap-3 mb-4">
                                <AlertCircle size={18} className="text-slate-400 mt-0.5" />
                                <p className="text-xs text-slate-500 leading-relaxed">
                                    Pastikan Anda sudah mentransfer uang ke customer (manual). Klik tombol di bawah ini untuk <b>mencatat pengeluaran</b> di sistem.
                                </p>
                            </div>
                            <button
                                onClick={handleDisburse}
                                disabled={submitting || actualRefund <= 0}
                                className="w-full py-3 bg-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {submitting ? 'Memproses...' : 'Konfirmasi Pencairan Dana'}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Reason & Evidence */}
            <div className="bg-white border border-slate-200 rounded-[28px] p-5 shadow-sm">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <MessageSquare size={12} /> Alasan Retur & Bukti
                </h3>
                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 mb-4">
                    <p className="text-sm text-slate-700 leading-relaxed italic">&quot;{retur.reason}&quot;</p>
                </div>
                {retur.evidence_img && (
                    <button
                        onClick={() => setZoomedImage(`/${retur.evidence_img}`)}
                        className="block w-full relative rounded-2xl overflow-hidden border border-slate-200 group cursor-zoom-in"
                    >
                        <img src={`/${retur.evidence_img}`} alt="Bukti" className="w-full h-48 object-cover group-hover:scale-105 transition-transform" />
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <span className="text-white text-xs font-black uppercase tracking-widest">Klik untuk Zoom</span>
                        </div>
                    </button>
                )}

                {retur.admin_response && (
                    <div className="bg-blue-50 rounded-2xl p-4 border border-blue-100 mt-4">
                        <p className="text-[10px] font-black text-blue-400 uppercase mb-1">Catatan Gudang:</p>
                        <p className="text-xs text-blue-700 italic">&quot;{retur.admin_response}&quot;</p>
                    </div>
                )}
            </div>

            {/* Courier Info */}
            {retur.Courier && (
                <div className="bg-white border border-blue-200 rounded-[28px] p-5 shadow-sm">
                    <h3 className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <Truck size={12} /> Kurir Penjemput
                    </h3>
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
                            <Truck size={22} />
                        </div>
                        <div>
                            <p className="text-base font-black text-slate-900">{retur.Courier?.name}</p>
                            <p className="text-xs text-slate-500">{retur.Courier?.whatsapp_number || '-'}</p>
                        </div>
                    </div>
                    <Link
                        href={`/admin/chat?userId=${retur.courier_id}`}
                        className="mt-4 w-full py-2.5 flex items-center justify-center gap-2 bg-blue-100 text-blue-700 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-blue-200 transition-colors"
                    >
                        <MessageCircle size={16} /> Chat Driver
                    </Link>
                </div>
            )}

            {/* Action Button */}
            <div className="flex gap-3">
                <Link
                    href={`/admin/chat?userId=${retur.created_by}`}
                    className="flex-1 text-center py-4 bg-slate-900 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-colors flex items-center justify-center gap-2"
                >
                    <MessageCircle size={16} /> Hubungi Customer (Chat App)
                </Link>
                <Link
                    href="/admin/finance/retur"
                    className="px-6 py-4 bg-white border border-slate-200 text-slate-600 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-50 transition-colors"
                >
                    Kembali
                </Link>
            </div>

            {/* Image Zoom Modal */}
            {zoomedImage && (
                <div
                    className="fixed inset-0 z-[120] bg-black/80 p-4 sm:p-8 flex items-center justify-center backdrop-blur-sm cursor-zoom-out"
                    onClick={() => setZoomedImage(null)}
                >
                    <button
                        type="button"
                        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/90 text-slate-800 flex items-center justify-center hover:bg-white transition-colors z-10"
                        onClick={() => setZoomedImage(null)}
                    >
                        <X size={18} />
                    </button>
                    <img
                        src={zoomedImage}
                        alt="Preview Bukti"
                        className="max-w-full max-h-[90vh] object-contain rounded-xl bg-white shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}
        </div>
    );
}
