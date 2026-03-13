'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { Truck, CheckCircle, ChevronRight, Calculator, Wallet, AlertCircle } from 'lucide-react';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';

export default function AdminDriverCodPage() {
    const allowed = useRequireRoles(['admin_finance', 'super_admin']);
    const [drivers, setDrivers] = useState<unknown[]>([]);
    const [selectedDriver, setSelectedDriver] = useState<unknown>(null);
    const [loading, setLoading] = useState(false);

    // Form State
    const [selectedInvoiceKeys, setSelectedInvoiceKeys] = useState<string[]>([]);
    const [amountReceived, setAmountReceived] = useState<string>('');
    const [submitting, setSubmitting] = useState(false);
    const [verifyStep, setVerifyStep] = useState<1 | 2>(1);
    const [showVerifyModal, setShowVerifyModal] = useState(false);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    const parseAmountInput = useCallback((value: string) => {
        const digits = String(value || '').replace(/\D/g, '');
        return digits ? Number(digits) : 0;
    }, []);

    const formatAmountInput = useCallback((value: string) => {
        const parsed = parseAmountInput(value);
        return parsed > 0 ? new Intl.NumberFormat('id-ID').format(parsed) : '';
    }, [parseAmountInput]);

    const loadDrivers = useCallback(async () => {
        try {
            setLoading(true);
            const res = await api.admin.finance.getDriverCodList();
            const driverList = res.data || [];
            setDrivers(driverList);

            setSelectedDriver((prev: unknown) => {
                if (driverList.length === 1 && !prev) {
                    return driverList[0];
                }
                if (!prev) return prev;
                const updated = driverList.find((d: unknown) => d.driver.id === prev.driver.id);
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
            const invoiceKeys: string[] = Array.from(new Set(
                selectedDriver.orders
                    .map((o: unknown) => String(o.invoice_id || o.invoice_number || o.id || '').trim())
                    .filter(Boolean)
            ));
            setSelectedInvoiceKeys(invoiceKeys);
            // Default amount to total pending? No, let user input to force verification.
            setAmountReceived('');
        }
    }, [selectedDriver]);

    const handleSelectDriver = (driverData: unknown) => {
        setSelectedDriver(driverData);
    };

    const invoiceRows = useMemo(() => {
        if (!selectedDriver) return [];
        const grouped = new Map<string, {
            key: string;
            invoice_number: string;
            invoice_total: number;
            created_at: string;
            order_ids: string[];
            customer_names: string[];
        }>();

        selectedDriver.orders.forEach((order: unknown) => {
            const key = String(order.invoice_id || order.invoice_number || order.id || '').trim();
            if (!key) return;

            const existing = grouped.get(key) || {
                key,
                invoice_number: String(order.invoice_number || '').trim(),
                invoice_total: 0,
                created_at: String(order.created_at || ''),
                order_ids: [],
                customer_names: []
            };

            const invoiceTotalRaw = Number(order.invoice_total ?? order.total_amount ?? 0);
            const invoiceTotal = Number.isFinite(invoiceTotalRaw) ? invoiceTotalRaw : 0;
            if (existing.invoice_total <= 0 && invoiceTotal > 0) {
                existing.invoice_total = invoiceTotal;
            }

            const createdAt = String(order.created_at || '');
            if (createdAt && (!existing.created_at || new Date(createdAt).getTime() > new Date(existing.created_at).getTime())) {
                existing.created_at = createdAt;
            }

            const orderId = String(order.id || '').trim();
            if (orderId && !existing.order_ids.includes(orderId)) {
                existing.order_ids.push(orderId);
            }

            const customerName = String(order.customer_name || '').trim();
            if (customerName && !existing.customer_names.includes(customerName)) {
                existing.customer_names.push(customerName);
            }

            grouped.set(key, existing);
        });

        return Array.from(grouped.values()).sort((a, b) => {
            return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
        });
    }, [selectedDriver]);

    const selectedOrderIds = useMemo(() => {
        if (!selectedDriver) return [];
        const selectedSet = new Set(selectedInvoiceKeys);
        return selectedDriver.orders
            .filter((order: unknown) => selectedSet.has(String(order.invoice_id || order.invoice_number || order.id || '').trim()))
            .map((order: unknown) => String(order.id || '').trim())
            .filter(Boolean);
    }, [selectedDriver, selectedInvoiceKeys]);

    const toggleInvoice = (invoiceKey: string) => {
        setSelectedInvoiceKeys(prev =>
            prev.includes(invoiceKey) ? prev.filter(key => key !== invoiceKey) : [...prev, invoiceKey]
        );
    };

    const getSelectedTotal = () => {
        if (!selectedDriver) return 0;
        const selectedSet = new Set(selectedInvoiceKeys);
        return invoiceRows
            .filter((row: unknown) => selectedSet.has(row.key))
            .reduce((sum: number, row: unknown) => sum + Number(row.invoice_total || 0), 0);
    };

    const closeVerifyModal = () => {
        if (submitting) return;
        setShowVerifyModal(false);
        setVerifyStep(1);
    };

    const openVerifyModal = () => {
        const received = parseAmountInput(amountReceived);
        if (!selectedDriver || selectedInvoiceKeys.length === 0) {
            setFeedback({ type: 'error', message: 'Pilih invoice COD yang akan disettle terlebih dahulu.' });
            return;
        }
        if (!Number.isFinite(received) || received < 0) {
            setFeedback({ type: 'error', message: 'Jumlah uang diterima tidak valid.' });
            return;
        }
        if (!amountReceived) {
            setFeedback({ type: 'error', message: 'Isi nominal uang yang diterima dari driver terlebih dahulu.' });
            return;
        }
        setFeedback(null);
        setVerifyStep(1);
        setShowVerifyModal(true);
    };

    const handleVerify = async () => {
        const received = parseAmountInput(amountReceived);
        try {
            setSubmitting(true);
            await api.admin.finance.verifyDriverCod({
                driver_id: selectedDriver.driver.id,
                order_ids: selectedOrderIds,
                amount_received: received
            });
            setFeedback({ type: 'success', message: 'Setoran COD berhasil dikonfirmasi.' });
            closeVerifyModal();
            setSelectedDriver(null);
            setSelectedInvoiceKeys([]);
            setAmountReceived('');
            await loadDrivers();
        } catch (error) {
            const message =
                (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
                'Gagal memproses setoran COD.';
            setFeedback({ type: 'error', message });
        } finally {
            setSubmitting(false);
        }
    };

    const formatCurrency = (amount: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
    const selectedTotal = getSelectedTotal();
    const receivedAmount = parseAmountInput(amountReceived);
    const settlementDiff = receivedAmount - selectedTotal;
    const settlementEffectLabel = settlementDiff < 0
        ? 'Tambahan utang driver'
        : settlementDiff > 0
            ? 'Pengurang utang driver'
            : 'Buku seimbang';

    if (!allowed) return null;

    return (
        <div className="p-6 space-y-6">
            <div>
                <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] mb-1">Finance Admin</p>
                <h1 className="text-2xl font-black text-slate-900">Setoran COD Kurir</h1>
                <p className="text-xs text-slate-500 mt-1">Invoice COD yang sudah `cod_pending` akan diselesaikan di sini saat finance menerima setoran driver.</p>
            </div>

            {feedback && (
                <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${feedback.type === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-rose-200 bg-rose-50 text-rose-700'
                    }`}>
                    {feedback.message}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* List Driver */}
                <div className="md:col-span-1 space-y-4">
                    <div className="bg-white border border-slate-200 rounded-[24px] p-4 shadow-sm">
                        <h2 className="text-sm font-black text-slate-900 mb-4 px-2">Daftar Settlement COD</h2>
                        {drivers.length === 0 && !loading && (
                            <div className="text-center py-8 text-slate-400 text-xs italic">
                                Tidak ada invoice COD yang menunggu settlement.
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
                                                {(() => {
                                                    const invoiceCount = new Set(
                                                        (item.orders || [])
                                                            .map((o: unknown) => String(o.invoice_id || o.invoice_number || o.id || '').trim())
                                                            .filter(Boolean)
                                                    ).size || item.orders.length;
                                                    return (
                                                        <p className="text-[10px] text-slate-500 font-medium">
                                                            {invoiceCount} Invoice Pending • {formatCurrency(item.total_pending)}
                                                        </p>
                                                    );
                                                })()}
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
                                        <span className="text-xs font-medium text-slate-500">Total Menunggu Settlement:</span>
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
                                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest sticky top-0 bg-white py-2 z-10">Rincian Invoice</h3>
                                {invoiceRows.map((row: unknown) => (
                                    <div
                                        key={row.key}
                                        className={`flex items-center justify-between p-4 rounded-2xl border cursor-pointer select-none transition-colors ${selectedInvoiceKeys.includes(row.key) ? 'bg-slate-50 border-emerald-200' : 'bg-white border-slate-100 opacity-60'}`}
                                        onClick={() => toggleInvoice(row.key)}
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${selectedInvoiceKeys.includes(row.key) ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300'}`}>
                                                {selectedInvoiceKeys.includes(row.key) && <CheckCircle size={12} className="text-white" />}
                                            </div>
                                            <div>
                                                <p className="text-xs font-bold text-slate-900">{row.invoice_number || row.key}</p>
                                                <p className="text-[10px] text-slate-500">
                                                    {row.order_ids.length} order • {new Date(row.created_at).toLocaleDateString('id-ID')}
                                                </p>
                                                <p className="text-[10px] text-slate-400 font-semibold">{row.customer_names.join(', ') || 'Customer'}</p>
                                            </div>
                                        </div>
                                        <p className="text-sm font-bold text-slate-900">{formatCurrency(Number(row.invoice_total || 0))}</p>
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
                                                type="text"
                                                inputMode="numeric"
                                                value={formatAmountInput(amountReceived)}
                                                onChange={(e) => setAmountReceived(String(e.target.value || '').replace(/\D/g, ''))}
                                                placeholder="0"
                                                className="w-full bg-white border border-slate-200 rounded-xl py-3 pl-10 pr-4 font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                                            />
                                        </div>
                                    </div>

                                    {amountReceived && (
                                        <div className={`p-3 rounded-xl flex items-center gap-3 ${(receivedAmount - getSelectedTotal()) < 0
                                            ? 'bg-rose-50 text-rose-700'
                                            : (receivedAmount - getSelectedTotal()) > 0
                                                ? 'bg-emerald-50 text-emerald-700'
                                                : 'bg-blue-50 text-blue-700'
                                            }`}>
                                            <div className="p-1.5 bg-white/50 rounded-lg">
                                                <Calculator size={16} />
                                            </div>
                                            <div className="text-xs font-medium">
                                                {(receivedAmount - getSelectedTotal()) < 0 && (
                                                <span>Kurang Bayar <span className="font-black">{formatCurrency(Math.abs(receivedAmount - getSelectedTotal()))}</span>. Akan tercatat sebagai UTANG driver.</span>
                                                )}
                                                {(receivedAmount - getSelectedTotal()) > 0 && (
                                                <span>Lebih Bayar <span className="font-black">{formatCurrency(receivedAmount - getSelectedTotal())}</span>. Akan mengurangi utang driver.</span>
                                                )}
                                                {(receivedAmount - getSelectedTotal()) === 0 && (
                                                    <span>Pembayaran Pas. Lunas.</span>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <button
                                    onClick={openVerifyModal}
                                    disabled={submitting || !amountReceived || (selectedInvoiceKeys.length === 0 && receivedAmount <= 0)}
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
                                Klik salah satu driver di daftar sebelah kiri untuk melihat invoice COD yang masih menunggu settlement finance.
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {showVerifyModal && selectedDriver && (
                <div className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-[2px] px-4 py-6 flex items-center justify-center">
                    <div className="w-full max-w-2xl max-h-[calc(100vh-3rem)] overflow-hidden rounded-[28px] bg-white shadow-2xl border border-slate-200 flex flex-col">
                        <div className="px-6 pt-6 pb-4 border-b border-slate-100">
                            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-600">Verifikasi Setoran COD</p>
                            <h2 className="mt-2 text-2xl font-black text-slate-900">
                                {verifyStep === 1 ? 'Periksa settlement sebelum disimpan' : 'Konfirmasi settlement COD'}
                            </h2>
                            <p className="mt-1 text-xs font-semibold text-slate-500">
                                Driver: {selectedDriver.driver.name}
                            </p>
                        </div>

                        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                            <div className="grid gap-3 sm:grid-cols-3">
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Invoice Dipilih</p>
                                    <p className="mt-1 text-xl font-black text-slate-900">{selectedInvoiceKeys.length}</p>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Total Tagihan</p>
                                    <p className="mt-1 text-xl font-black text-slate-900">{formatCurrency(selectedTotal)}</p>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Uang Diterima</p>
                                    <p className="mt-1 text-xl font-black text-slate-900">{formatCurrency(receivedAmount)}</p>
                                </div>
                            </div>

                            <div className={`rounded-2xl border px-4 py-4 ${settlementDiff < 0
                                ? 'border-rose-200 bg-rose-50'
                                : settlementDiff > 0
                                    ? 'border-emerald-200 bg-emerald-50'
                                    : 'border-blue-200 bg-blue-50'
                                }`}>
                                <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Selisih Settlement</p>
                                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <p className="text-2xl font-black text-slate-900">{formatCurrency(Math.abs(settlementDiff))}</p>
                                        <p className="text-xs font-semibold text-slate-600 mt-1">
                                            {settlementDiff < 0 ? 'Kurang dari total tagihan' : settlementDiff > 0 ? 'Lebih dari total tagihan' : 'Pas sesuai total tagihan'}
                                        </p>
                                    </div>
                                    <div className="rounded-xl bg-white/70 px-3 py-2 text-xs font-black text-slate-800">
                                        {settlementEffectLabel}
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Invoice yang akan disettle</p>
                                <div className="space-y-2">
                                    {invoiceRows.filter((row: unknown) => selectedInvoiceKeys.includes(row.key)).map((row: unknown) => (
                                        <div key={row.key} className="rounded-xl bg-white px-3 py-3 border border-slate-100">
                                            <div className="flex items-center justify-between gap-3">
                                                <div>
                                                    <p className="text-sm font-black text-slate-900">{row.invoice_number || row.key}</p>
                                                    <p className="text-[11px] font-semibold text-slate-500">
                                                        {row.order_ids.length} order • {row.customer_names.join(', ') || 'Customer'}
                                                    </p>
                                                </div>
                                                <p className="text-sm font-black text-slate-900">{formatCurrency(Number(row.invoice_total || 0))}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-xs font-semibold text-amber-800">
                                Finance akan menandai invoice terpilih sebagai settlement COD, dan posisi debt driver akan disesuaikan berdasarkan selisih uang diterima.
                            </div>
                        </div>

                        <div className="border-t border-slate-100 px-6 py-4 flex items-center justify-end gap-3">
                            <button
                                type="button"
                                onClick={verifyStep === 1 ? closeVerifyModal : () => setVerifyStep(1)}
                                disabled={submitting}
                                className="rounded-xl border border-slate-200 px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                            >
                                {verifyStep === 1 ? 'Batal' : 'Kembali'}
                            </button>
                            {verifyStep === 1 ? (
                                <button
                                    type="button"
                                    onClick={() => setVerifyStep(2)}
                                    className="rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black uppercase tracking-wide text-white hover:bg-emerald-700"
                                >
                                    Lanjut Verifikasi
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={handleVerify}
                                    disabled={submitting}
                                    className="rounded-xl bg-slate-900 px-4 py-3 text-xs font-black uppercase tracking-wide text-white hover:bg-slate-800 disabled:opacity-50"
                                >
                                    {submitting ? 'Memproses...' : 'Ya, Simpan Settlement'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
