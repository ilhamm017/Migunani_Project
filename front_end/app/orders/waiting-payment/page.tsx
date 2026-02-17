'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CreditCard, ArrowRight, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import PaymentCountdown from '@/components/orders/PaymentCountdown';
import { useRouter } from 'next/navigation';

export default function WaitingPaymentPage() {
    const router = useRouter();
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const loadOrders = async () => {
        try {
            setLoading(true);
            const res = await api.orders.getMyOrders({ status: 'waiting_payment', page: 1, limit: 50 });
            setOrders(res.data?.orders || []);
        } catch (error) {
            console.error('Failed to load waiting payment orders:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadOrders();
    }, []);

    if (loading) {
        return (
            <div className="p-6">
                <p className="text-sm text-slate-500">Memuat tagihan...</p>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6 pb-20">
            <header className="flex items-center gap-4">
                <button onClick={() => router.back()} className="w-10 h-10 bg-white border border-slate-100 rounded-2xl flex items-center justify-center shadow-sm">
                    <ArrowLeft size={18} className="text-slate-600" />
                </button>
                <div>
                    <h1 className="text-lg font-black text-slate-900">Pembayaran Segera</h1>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Wajib Bayar dlm 1x24 Jam</p>
                </div>
            </header>

            {orders.length === 0 ? (
                <div className="bg-emerald-50 border border-emerald-100 rounded-[32px] p-8 flex flex-col items-center text-center">
                    <div className="w-16 h-16 bg-white rounded-3xl flex items-center justify-center mb-4 shadow-sm">
                        <CreditCard size={28} className="text-emerald-500" />
                    </div>
                    <h2 className="text-base font-black text-slate-900 mb-2">Semua Tagihan Lunas!</h2>
                    <p className="text-xs text-slate-500 mb-6">Anda tidak memiliki pesanan yang menunggu pembayaran saat ini.</p>
                    <Link href="/orders" className="text-xs font-black text-emerald-600 uppercase tracking-widest">Lihat Riwayat</Link>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3">
                        <AlertCircle className="text-amber-600 shrink-0" size={20} />
                        <p className="text-xs text-amber-800 leading-relaxed font-medium">
                            Pesanan di bawah ini akan <strong>dibatalkan otomatis</strong> jika pembayaran tidak diverifikasi sebelum waktu habis.
                        </p>
                    </div>

                    <div className="space-y-3">
                        {orders.map((order) => (
                            <Link
                                key={order.id}
                                href={`/orders/${order.id}`}
                                className="block bg-white border border-slate-100 rounded-[32px] p-5 shadow-sm active:scale-[0.98] transition-all"
                            >
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter mb-1">Order #{order.id.slice(0, 8)}</p>
                                        <h3 className="text-sm font-black text-slate-900">{formatCurrency(Number(order.total_amount))}</h3>
                                    </div>
                                    <PaymentCountdown expiryDate={order.expiry_date} />
                                </div>

                                <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                                    <span className="text-[10px] font-bold text-slate-500 uppercase">Metode: {order.Invoice?.payment_method === 'transfer_manual' ? 'Transfer Bank' : order.Invoice?.payment_method}</span>
                                    <div className="flex items-center gap-1 text-emerald-600">
                                        <span className="text-[10px] font-black uppercase">Bayar Sekarang</span>
                                        <ArrowRight size={14} />
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
