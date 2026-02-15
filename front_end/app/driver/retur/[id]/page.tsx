'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    ArrowLeft,
    CheckCircle2,
    Clock3,
    MessageCircle,
    MapPin,
    Package,
    Phone,
    RotateCcw,
    User
} from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { useAuthStore } from '@/store/authStore';

export default function DriverReturDetailPage() {
    const allowed = useRequireRoles(['driver', 'super_admin', 'admin_gudang']);
    const { user } = useAuthStore();
    const params = useParams();
    const router = useRouter();
    const returId = String(params?.id || '');

    const [retur, setRetur] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    const loadRetur = async () => {
        try {
            setLoading(true);
            const res = await api.driver.getReturById(returId);
            setRetur(res.data || null);
        } catch (error) {
            console.error('Failed to load retur detail:', error);
            setRetur(null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (allowed && returId) {
            void loadRetur();
        }
    }, [allowed, returId]);

    const statusLabel = useMemo(() => {
        switch (retur?.status) {
            case 'pickup_assigned':
                return 'Menunggu Pickup';
            case 'picked_up':
                return 'Sudah Dipickup';
            case 'handed_to_warehouse':
                return 'Sudah Diserahkan ke Gudang';
            case 'received':
                return 'Sudah Di-ACC Gudang';
            case 'completed':
                return 'Retur Selesai';
            default:
                return retur?.status || '-';
        }
    }, [retur?.status]);

    const statusClass = useMemo(() => {
        switch (retur?.status) {
            case 'pickup_assigned':
                return 'bg-blue-50 text-blue-700 border-blue-200';
            case 'picked_up':
                return 'bg-amber-50 text-amber-700 border-amber-200';
            case 'handed_to_warehouse':
                return 'bg-violet-50 text-violet-700 border-violet-200';
            case 'received':
                return 'bg-emerald-50 text-emerald-700 border-emerald-200';
            case 'completed':
                return 'bg-slate-100 text-slate-700 border-slate-200';
            default:
                return 'bg-slate-100 text-slate-700 border-slate-200';
        }
    }, [retur?.status]);

    const isDriver = user?.role === 'driver';

    const handleUpdateStatus = async (nextStatus: 'picked_up' | 'handed_to_warehouse') => {
        const confirmationText = nextStatus === 'picked_up'
            ? 'Konfirmasi: barang retur sudah Anda pickup dari customer?'
            : 'Konfirmasi: barang retur sudah Anda serahkan ke gudang?';

        if (!confirm(confirmationText)) return;

        try {
            setSubmitting(true);
            await api.driver.updateReturStatus(returId, nextStatus);
            alert(nextStatus === 'picked_up'
                ? 'Pickup retur berhasil dikonfirmasi.'
                : 'Penyerahan ke gudang berhasil dikonfirmasi.');
            await loadRetur();
        } catch (error: any) {
            console.error('Failed to update retur status:', error);
            alert(error?.response?.data?.message || 'Gagal memperbarui status tugas retur.');
        } finally {
            setSubmitting(false);
        }
    };

    if (!allowed) return null;

    if (loading) {
        return (
            <div className="p-6 space-y-4">
                <div className="h-8 w-40 bg-slate-100 rounded-xl animate-pulse" />
                <div className="h-40 bg-slate-100 rounded-[28px] animate-pulse" />
                <div className="h-52 bg-slate-100 rounded-[28px] animate-pulse" />
            </div>
        );
    }

    if (!retur) {
        return (
            <div className="p-6 space-y-4">
                <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <ArrowLeft size={16} /> Kembali
                </button>
                <div className="bg-white border border-slate-200 rounded-[28px] p-8 text-center">
                    <p className="text-sm font-bold text-slate-500">Tugas retur tidak ditemukan.</p>
                </div>
            </div>
        );
    }

    const customer = retur.Creator || {};
    const profile = customer.CustomerProfile || {};
    const addresses = Array.isArray(profile.saved_addresses) ? profile.saved_addresses : [];
    const addressObj = addresses.find((a: any) => a.isPrimary) || addresses[0];
    const address = addressObj ? (addressObj.fullAddress || addressObj.address || 'Alamat tersimpan') : 'Alamat tidak tersedia';

    return (
        <div className="p-6 space-y-5 pb-24">
            <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                <ArrowLeft size={16} /> Kembali
            </button>

            <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm space-y-6">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1">Tugas Penjemputan Retur</p>
                        <h1 className="text-2xl font-black text-slate-900 leading-none">Retur #{retur.order_id?.slice(-8)?.toUpperCase()}</h1>
                    </div>
                    <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-full border ${statusClass}`}>
                        {statusLabel}
                    </span>
                </div>

                <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 space-y-3">
                    <div className="flex items-center gap-2 text-slate-700">
                        <Package size={14} className="opacity-50" />
                        <span className="text-xs font-bold">{retur.qty}x {retur.Product?.name || 'Produk'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-slate-700">
                        <User size={14} className="opacity-50" />
                        <span className="text-xs font-bold">{customer.name || 'Customer'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-slate-700">
                        <Phone size={14} className="opacity-50" />
                        <span className="text-xs">{customer.whatsapp_number || '-'}</span>
                    </div>
                    <div className="flex items-start gap-2 text-slate-700">
                        <MapPin size={14} className="opacity-50 mt-0.5" />
                        <span className="text-xs leading-relaxed">{address}</span>
                    </div>
                </div>

                <div className="space-y-3">
                    {retur.status === 'pickup_assigned' && (
                        <button
                            onClick={() => handleUpdateStatus('picked_up')}
                            disabled={!isDriver || submitting}
                            className="w-full py-4 bg-amber-500 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-amber-600 transition-colors disabled:opacity-50"
                        >
                            {submitting ? 'Memproses...' : 'Konfirmasi Barang Sudah Dipickup'}
                        </button>
                    )}

                    {retur.status === 'picked_up' && (
                        <button
                            onClick={() => handleUpdateStatus('handed_to_warehouse')}
                            disabled={!isDriver || submitting}
                            className="w-full py-4 bg-violet-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-violet-700 transition-colors disabled:opacity-50"
                        >
                            {submitting ? 'Memproses...' : 'Konfirmasi Diserahkan ke Gudang'}
                        </button>
                    )}

                    {retur.status === 'handed_to_warehouse' && (
                        <div className="p-4 bg-violet-50 border border-violet-100 rounded-2xl flex items-start gap-3">
                            <Clock3 size={18} className="text-violet-600 shrink-0 mt-0.5" />
                            <p className="text-xs text-violet-800 leading-relaxed">
                                Barang sudah Anda serahkan ke gudang. Menunggu <b>ACC Admin Gudang</b>.
                            </p>
                        </div>
                    )}

                    {retur.status === 'received' && (
                        <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-start gap-3">
                            <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-0.5" />
                            <p className="text-xs text-emerald-800 leading-relaxed">
                                Gudang sudah melakukan ACC penerimaan barang retur.
                            </p>
                        </div>
                    )}

                    {retur.status === 'completed' && (
                        <div className="p-4 bg-slate-100 border border-slate-200 rounded-2xl flex items-start gap-3">
                            <RotateCcw size={18} className="text-slate-600 shrink-0 mt-0.5" />
                            <p className="text-xs text-slate-700 leading-relaxed">
                                Proses retur sudah selesai.
                            </p>
                        </div>
                    )}
                </div>

                {customer.id ? (
                    <div className="pt-2">
                        <Link
                            href={`/driver/chat?userId=${encodeURIComponent(String(customer.id))}&phone=${encodeURIComponent(String(customer.whatsapp_number || ''))}`}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-[11px] font-black uppercase tracking-wide"
                        >
                            <MessageCircle size={14} />
                            Hubungi Customer (Chat App)
                        </Link>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
