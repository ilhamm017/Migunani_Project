'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { Truck, CheckCircle, ChevronRight, Calculator, Wallet, AlertCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';

export default function AdminDriverCodPage() {
    const allowed = useRequireRoles(['admin_finance', 'super_admin']);
    const [drivers, setDrivers] = useState<any[]>([]);
    const [selectedDriver, setSelectedDriver] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    // Form State
    const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
    const [amountReceived, setAmountReceived] = useState<string>('');
    const [submitting, setSubmitting] = useState(false);

    const router = useRouter();

    const loadDrivers = useCallback(async () => {
        try {
            setLoading(true);
            const res = await api.admin.finance.getDriverCodList();
            const driverList = res.data || [];
            setDrivers(driverList);

            setSelectedDriver((prev: any) => {
                if (driverList.length === 1 && !prev) {
                    return driverList[0];
                }
                if (!prev) return prev;
                const updated = driverList.find((d: any) => d.driver.id === prev.driver.id);
                return updated || null;
            });
        } catch (error) {
            console.error('Failed to load drivers:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (allowed) void loadDrivers();
    }, [allowed, loadDrivers]);

    useRealtimeRefresh({
        enabled: allowed,
        onRefresh: loadDrivers,
        domains: ['cod', 'order', 'admin'],
        pollIntervalMs: 10000,
    });

    useEffect(() => {
        if (selectedDriver) {
            // Default select all orders
            setSelectedOrderIds(selectedDriver.orders.map((o: any) => o.id));
            // Default amount to total pending? No, let user input to force verification.
            setAmountReceived('');
        }
    }, [selectedDriver]);

    if (!allowed) return null;

    const handleSelectDriver = (driverData: any) => {
        setSelectedDriver(driverData);
    };

    const toggleOrder = (orderId: string) => {
        setSelectedOrderIds(prev =>
            prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]
        );
    };

    const getSelectedTotal = () => {
        if (!selectedDriver) return 0;
        return selectedDriver.orders
            .filter((o: any) => selectedOrderIds.includes(o.id))
            .reduce((sum: number, o: any) => sum + Number(o.total_amount), 0);
    };

    const handleVerify = async () => {
        const received = Number(amountReceived.replace(/\D/g, '')); // simple parse
        const total = getSelectedTotal();
        const diff = received - total;

        const confirmMsg = `
Konfirmasi Setoran COD:
Total Tagihan: Rp ${total.toLocaleString()}
Uang Diterima: Rp ${received.toLocaleString()}
Selisih: Rp ${diff.toLocaleString()} (${diff < 0 ? 'KURANG' : diff > 0 ? 'LEBIH' : 'PAS'})

Driver akan memiliki ${(diff < 0 ? 'TAMBAHAN UTANG' : diff > 0 ? 'PENGURANGAN UTANG' : 'buku seimbang')}.
Lanjutkan?
        `.trim();

        if (!confirm(confirmMsg)) return;

        try {
            setSubmitting(true);
            await api.admin.finance.verifyDriverCod({
                driver_id: selectedDriver.driver.id,
                order_ids: selectedOrderIds,
                amount_received: received
            });
            alert('Setoran berhasil dikonfirmasi!');
            setSelectedDriver(null);
            loadDrivers();
        } catch (error) {
            alert('Gagal memproses setoran: ' + (error as any).response?.data?.message || 'Error unknown');
        } finally {
            setSubmitting(false);
        }
    };

    const formatCurrency = (amount: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);

    return (
        <div className="p-6 space-y-6">
            <div>
                <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] mb-1">Finance Admin</p>
                <h1 className="text-2xl font-black text-slate-900">Setoran COD Kurir</h1>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* List Driver */}
                <div className="md:col-span-1 space-y-4">
                    <div className="bg-white border border-slate-200 rounded-[24px] p-4 shadow-sm">
                        <h2 className="text-sm font-black text-slate-900 mb-4 px-2">Daftar Penagihan</h2>
                        {drivers.length === 0 && !loading && (
                            <div className="text-center py-8 text-slate-400 text-xs italic">
                                Tidak ada tagihan COD pending.
                            </div>
                        )}
                        <div className="space-y-2">
                            {drivers.map((item) => {
                                const hasDebt = Number(item.driver.debt || 0) > 0;
                                const isSelected = selectedDriver?.driver.id === item.driver.id;

                                return (
                                    <button
                                        key={item.driver.id}
                                        onClick={() => handleSelectDriver(item)}
                                        className={`w-full flex items-center justify-between p-3 rounded-2xl border transition-all ${isSelected
                                            ? 'bg-emerald-50 border-emerald-200 shadow-sm'
                                            : hasDebt
                                                ? 'bg-rose-50/30 border-rose-100 hover:border-rose-200'
                                                : 'bg-white border-slate-100 hover:border-emerald-200'
                                            }`}
                                    >
                                        <div className="flex items-center gap-3 overflow-hidden">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isSelected ? 'bg-emerald-100 text-emerald-600' : hasDebt ? 'bg-rose-100 text-rose-600' : 'bg-slate-50 text-slate-400'}`}>
                                                {hasDebt ? <AlertCircle size={18} /> : <Truck size={18} />}
                                            </div>
                                            <div className="text-left overflow-hidden">
                                                <div className="flex items-center gap-2">
                                                    <p className="text-sm font-bold text-slate-900 truncate">{item.driver.name}</p>
                                                    {hasDebt && (
                                                        <span className="text-[8px] font-black bg-rose-600 text-white px-1.5 py-0.5 rounded-full uppercase tracking-tighter shrink-0">
                                                            Berutang
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-[10px] text-slate-500 font-medium">
                                                    {item.orders.length} Order Pending • {formatCurrency(item.total_pending)}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
                                            {hasDebt && (
                                                <p className="text-[9px] font-black text-rose-600">{formatCurrency(item.driver.debt)}</p>
                                            )}
                                            <ChevronRight size={14} className={isSelected ? 'text-emerald-500' : 'text-slate-300'} />
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Detail View */}
                <div className="md:col-span-2">
                    {selectedDriver ? (
                        <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm space-y-6">
                            <div className="flex items-start justify-between border-b border-slate-100 pb-6">
                                <div>
                                    <h2 className="text-xl font-black text-slate-900">{selectedDriver.driver.name}</h2>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="text-xs font-medium text-slate-500">Total Pending Setor:</span>
                                        <span className="text-sm font-black text-emerald-600">{formatCurrency(selectedDriver.total_pending)}</span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase">Posisi Utang (Debt)</p>
                                    <p className={`text-lg font-black ${selectedDriver.driver.debt > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                                        {formatCurrency(selectedDriver.driver.debt)}
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest sticky top-0 bg-white py-2 z-10">Rincian Order</h3>
                                {selectedDriver.orders.map((order: any) => (
                                    <div
                                        key={order.id}
                                        className={`flex items-center justify-between p-4 rounded-2xl border cursor-pointer select-none transition-colors ${selectedOrderIds.includes(order.id) ? 'bg-slate-50 border-emerald-200' : 'bg-white border-slate-100 opacity-60'}`}
                                        onClick={() => toggleOrder(order.id)}
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${selectedOrderIds.includes(order.id) ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300'}`}>
                                                {selectedOrderIds.includes(order.id) && <CheckCircle size={12} className="text-white" />}
                                            </div>
                                            <div>
                                                <p className="text-xs font-bold text-slate-900">#{order.order_number?.slice(-8) || order.id.slice(0, 8)}</p>
                                                <p className="text-[10px] text-slate-500">{order.customer_name} • {new Date(order.created_at).toLocaleDateString('id-ID')}</p>
                                            </div>
                                        </div>
                                        <p className="text-sm font-bold text-slate-900">{formatCurrency(order.total_amount)}</p>
                                    </div>
                                ))}
                            </div>

                            <div className="pt-6 border-t border-slate-100 space-y-4">
                                <div className="bg-slate-50 rounded-2xl p-5 space-y-4">
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="font-medium text-slate-600">Total Tagihan Terpilih</span>
                                        <span className="font-bold text-slate-900">{formatCurrency(getSelectedTotal())}</span>
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Uang Diterima dari Driver</label>
                                        <div className="relative">
                                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">Rp</span>
                                            <input
                                                type="number"
                                                value={amountReceived}
                                                onChange={(e) => setAmountReceived(e.target.value)}
                                                placeholder="0"
                                                className="w-full bg-white border border-slate-200 rounded-xl py-3 pl-10 pr-4 font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                                            />
                                        </div>
                                    </div>

                                    {amountReceived && (
                                        <div className={`p-3 rounded-xl flex items-center gap-3 ${(Number(amountReceived) - getSelectedTotal()) < 0
                                            ? 'bg-rose-50 text-rose-700'
                                            : (Number(amountReceived) - getSelectedTotal()) > 0
                                                ? 'bg-emerald-50 text-emerald-700'
                                                : 'bg-blue-50 text-blue-700'
                                            }`}>
                                            <div className="p-1.5 bg-white/50 rounded-lg">
                                                <Calculator size={16} />
                                            </div>
                                            <div className="text-xs font-medium">
                                                {(Number(amountReceived) - getSelectedTotal()) < 0 && (
                                                    <span>Kurang Bayar <span className="font-black">{formatCurrency(Math.abs(Number(amountReceived) - getSelectedTotal()))}</span>. Akan tercatat sebagai UTANG driver.</span>
                                                )}
                                                {(Number(amountReceived) - getSelectedTotal()) > 0 && (
                                                    <span>Lebih Bayar <span className="font-black">{formatCurrency(Number(amountReceived) - getSelectedTotal())}</span>. Akan mengurangi utang driver.</span>
                                                )}
                                                {(Number(amountReceived) - getSelectedTotal()) === 0 && (
                                                    <span>Pembayaran Pas. Lunas.</span>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <button
                                    onClick={handleVerify}
                                    disabled={submitting || !amountReceived || (selectedOrderIds.length === 0 && Number(amountReceived) <= 0)}
                                    className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-slate-200 hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
                                >
                                    {submitting ? 'Memproses...' : 'Konfirmasi Setoran'}
                                    {!submitting && <CheckCircle size={18} />}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center bg-slate-50 border border-dashed border-slate-200 rounded-[32px] p-10 text-center">
                            <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-4">
                                <Wallet size={32} className="text-slate-300" />
                            </div>
                            <h3 className="text-slate-900 font-bold mb-1">Pilih Driver untuk Memproses</h3>
                            <p className="text-sm text-slate-400 max-w-xs mx-auto">
                                Klik salah satu driver di daftar sebelah kiri untuk melihat rincian order COD yang belum disetor.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
