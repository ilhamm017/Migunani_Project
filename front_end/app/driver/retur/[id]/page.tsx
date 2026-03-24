'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';

type AddressRow = {
    isPrimary?: boolean;
    fullAddress?: string | null;
    address?: string | null;
};

type CreatorProfile = {
    saved_addresses?: AddressRow[] | null;
};

type ReturCreator = {
    id?: string;
    name?: string | null;
    whatsapp_number?: string | null;
    CustomerProfile?: CreatorProfile | null;
};

type ReturTask = {
    id: string;
    status: string;
    qty: number;
    order_id?: string | null;
    Product?: { name?: string | null } | null;
    Creator?: ReturCreator | null;
};

const getErrorMessage = (error: unknown, fallback: string) => {
    if (typeof error === 'object' && error !== null) {
        const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
        if (typeof responseMessage === 'string' && responseMessage.trim()) return responseMessage;
        const message = (error as { message?: unknown }).message;
        if (typeof message === 'string' && message.trim()) return message;
    }
    return fallback;
};

export default function DriverReturDetailPage() {
    const allowed = useRequireRoles(['driver', 'super_admin']);
    const { user } = useAuthStore();
    const params = useParams();
    const router = useRouter();
    const returId = String(params?.id || '');

    const [retur, setRetur] = useState<ReturTask | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    const loadRetur = useCallback(async (opts?: { silent?: boolean }) => {
        const silent = Boolean(opts?.silent);
        if (!returId) return;
        try {
            if (!silent) setLoading(true);
            const res = await api.driver.getReturById(returId);
            const row = res.data as Record<string, unknown> | null;
            if (!row || typeof row !== 'object') {
                setRetur(null);
                return;
            }
            setRetur({
                id: String(row.id ?? ''),
                status: String(row.status ?? ''),
                qty: Number(row.qty ?? 0),
                order_id: row.order_id ? String(row.order_id) : null,
                Product: row.Product && typeof row.Product === 'object'
                    ? { name: String((row.Product as Record<string, unknown>).name ?? '') }
                    : null,
                Creator: row.Creator && typeof row.Creator === 'object'
                    ? {
                        id: (row.Creator as Record<string, unknown>).id ? String((row.Creator as Record<string, unknown>).id) : undefined,
                        name: (row.Creator as Record<string, unknown>).name ? String((row.Creator as Record<string, unknown>).name) : null,
                        whatsapp_number: (row.Creator as Record<string, unknown>).whatsapp_number ? String((row.Creator as Record<string, unknown>).whatsapp_number) : null,
                        CustomerProfile: (() => {
                            const profileRaw = (row.Creator as Record<string, unknown>).CustomerProfile;
                            if (!profileRaw || typeof profileRaw !== 'object') return null;
                            const addressesRaw = (profileRaw as Record<string, unknown>).saved_addresses;
                            const savedAddresses: AddressRow[] = Array.isArray(addressesRaw)
                                ? addressesRaw.map((address) => {
                                    const addressObj = address as Record<string, unknown>;
                                    return {
                                        isPrimary: Boolean(addressObj.isPrimary),
                                        fullAddress: addressObj.fullAddress ? String(addressObj.fullAddress) : null,
                                        address: addressObj.address ? String(addressObj.address) : null,
                                    };
                                })
                                : [];
                            return { saved_addresses: savedAddresses };
                        })(),
                    }
                    : null,
            });
        } catch (error) {
            console.error('Failed to load retur detail:', error);
            setRetur(null);
        } finally {
            if (!silent) setLoading(false);
        }
    }, [returId]);

    useEffect(() => {
        if (allowed && returId) {
            void loadRetur({ silent: false });
        }
    }, [allowed, loadRetur, returId]);

    useRealtimeRefresh({
        enabled: allowed && Boolean(returId),
        onRefresh: () => loadRetur({ silent: true }),
        domains: ['retur', 'admin'],
        pollIntervalMs: 12000,
        filterReturIds: returId ? [returId] : [],
        filterDriverIds: user?.id ? [String(user.id)] : [],
    });

    const statusLabel = useMemo(() => {
        switch (retur?.status) {
            case 'pickup_assigned':
                return 'Menunggu Pickup';
            case 'picked_up':
                return 'Sudah Dipickup';
            case 'handed_to_warehouse':
                return 'Sudah Diserahkan ke Kasir';
            case 'received':
                return 'Sudah Di-ACC Kasir';
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
            : 'Konfirmasi: barang retur sudah Anda serahkan ke kasir?';

        if (!confirm(confirmationText)) return;

        try {
            setSubmitting(true);
            await api.driver.updateReturStatus(returId, nextStatus);
            alert(nextStatus === 'picked_up'
                ? 'Pickup retur berhasil dikonfirmasi.'
                : 'Penyerahan ke kasir berhasil dikonfirmasi.');
            await loadRetur();
        } catch (error: unknown) {
            console.error('Failed to update retur status:', error);
            alert(getErrorMessage(error, 'Gagal memperbarui status tugas retur.'));
        } finally {
            setSubmitting(false);
        }
    };

    if (!allowed) return null;

    if (loading && !retur) {
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

    const customer: ReturCreator = retur.Creator || {};
    const profile: CreatorProfile = customer.CustomerProfile || {};
    const addresses = Array.isArray(profile.saved_addresses) ? profile.saved_addresses : [];
    const addressObj = addresses.find((addressRow) => addressRow.isPrimary) || addresses[0];
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
                            {submitting ? 'Memproses...' : 'Konfirmasi Diserahkan ke Kasir'}
                        </button>
                    )}

                    {retur.status === 'handed_to_warehouse' && (
                        <div className="p-4 bg-violet-50 border border-violet-100 rounded-2xl flex items-start gap-3">
                            <Clock3 size={18} className="text-violet-600 shrink-0 mt-0.5" />
                            <p className="text-xs text-violet-800 leading-relaxed">
                                Barang sudah Anda serahkan ke kasir. Menunggu <b>ACC Kasir</b>.
                            </p>
                        </div>
                    )}

                    {retur.status === 'received' && (
                        <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-start gap-3">
                            <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-0.5" />
                            <p className="text-xs text-emerald-800 leading-relaxed">
                                Kasir sudah melakukan ACC penerimaan barang retur.
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
