'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Upload, Check } from 'lucide-react';
import Link from 'next/link';
import { formatCurrency } from '@/lib/utils';
import { notifyAlert } from '@/lib/notify';

type OrderItemRow = {
    id: string;
    product_id: string;
    qty: number;
    price_at_purchase: number;
    Product?: { name?: string };
};

type OrderDetail = {
    id: string;
    OrderItems?: OrderItemRow[];
};

type ApiErrorWithMessage = {
    response?: { data?: { message?: string } };
};

export default function ReturnRequestPage() {
    const { id } = useParams();
    const router = useRouter();
    const [order, setOrder] = useState<OrderDetail | null>(null);
    const [selectedItem, setSelectedItem] = useState<string | null>(null);
    const [qty, setQty] = useState(1);
    const [reason, setReason] = useState('');
    const [evidence, setEvidence] = useState<File | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [invoicePicker, setInvoicePicker] = useState<null | Array<{
        invoice_id: string;
        invoice_number?: string;
        createdAt?: string | null;
        shipment_status?: string;
        payment_status?: string;
    }>>(null);

    const loadOrder = useCallback(async () => {
        if (!id) return;
        try {
            const res = await api.orders.getOrderById(id as string);
            setOrder(res.data as OrderDetail);
        } catch (error) {
            console.error('Failed to load order', error);
        }
    }, [id]);

    useEffect(() => {
        if (id) void loadOrder();
    }, [id, loadOrder]);

    const submitRetur = async (opts?: { invoice_id?: string }) => {
        if (!selectedItem || !reason || !qty) return;
        const formData = new FormData();
        formData.append('order_id', id as string);
        formData.append('product_id', selectedItem);
        formData.append('qty', String(qty));
        formData.append('reason', reason);
        if (opts?.invoice_id) {
            formData.append('invoice_id', String(opts.invoice_id));
        }
        if (evidence) {
            formData.append('evidence_img', evidence);
        }

        await api.retur.request(formData);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedItem || !reason || !qty) return;

        try {
            setSubmitting(true);
            setInvoicePicker(null);
            await submitRetur();
            notifyAlert('Permintaan retur berhasil dikirim!');
            router.push(`/orders/${id}`);
        } catch (error: unknown) {
            const status = Number((error as any)?.response?.status || 0);
            const data = (error as any)?.response?.data as any;
            const code = String(data?.data?.code || '');
            const candidates = Array.isArray(data?.data?.candidates) ? data.data.candidates : [];
            if (status === 409 && code === 'INVOICE_ID_REQUIRED' && candidates.length > 0) {
                setInvoicePicker(candidates);
                return;
            }
            const err = error as ApiErrorWithMessage;
            notifyAlert((err as any)?.response?.data?.message || 'Gagal mengirim permintaan retur');
        } finally {
            setSubmitting(false);
        }
    };

    if (!order) return <div className="p-6">Loading...</div>;

    const selectedProduct = order.OrderItems?.find((i) => i.product_id === selectedItem);

    return (
        <div className="p-6">
            {invoicePicker && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
                    <div className="w-full max-w-lg rounded-3xl bg-white shadow-xl border border-slate-200 overflow-hidden">
                        <div className="p-5 border-b border-slate-100">
                            <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-500">Pilih Invoice</p>
                            <p className="mt-1 text-sm font-bold text-slate-900">
                                Order ini punya lebih dari satu invoice. Pilih invoice yang terkait retur ini.
                            </p>
                        </div>
                        <div className="p-4 space-y-2 max-h-[60vh] overflow-auto">
                            {invoicePicker.map((c) => (
                                <button
                                    key={String(c.invoice_id)}
                                    onClick={async () => {
                                        const candidateId = String(c.invoice_id || '').trim();
                                        if (!candidateId) return;
                                        try {
                                            setSubmitting(true);
                                            await submitRetur({ invoice_id: candidateId });
                                            setInvoicePicker(null);
                                            notifyAlert('Permintaan retur berhasil dikirim!');
                                            router.push(`/orders/${id}`);
                                        } catch (err) {
                                            notifyAlert(String((err as any)?.response?.data?.message || 'Gagal mengirim permintaan retur'));
                                        } finally {
                                            setSubmitting(false);
                                        }
                                    }}
                                    disabled={submitting}
                                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50 disabled:opacity-60"
                                >
                                    <p className="text-sm font-black text-slate-900 truncate">
                                        {String(c.invoice_number || c.invoice_id)}
                                    </p>
                                    <p className="mt-0.5 text-xs text-slate-500">
                                        {String(c.payment_status || '-')}{' • '}{String(c.shipment_status || '-')}{c.createdAt ? ` • ${String(c.createdAt)}` : ''}
                                    </p>
                                </button>
                            ))}
                        </div>
                        <div className="p-4 border-t border-slate-100">
                            <button
                                onClick={() => setInvoicePicker(null)}
                                disabled={submitting}
                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                            >
                                Batal
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <div className="mb-6">
                <Link href={`/orders/${id}`} className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 font-bold mb-4">
                    <ArrowLeft size={20} /> Kembali ke Order
                </Link>
                <h1 className="text-2xl font-black text-slate-900">Ajukan Pengembalian Barang</h1>
                <p className="text-slate-500 text-sm">Order #{order.id.substring(0, 8)}</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6 max-w-lg">
                <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                    <label className="block text-sm font-bold text-slate-700 mb-2">Pilih Barang</label>
                    <div className="space-y-2">
                        {order.OrderItems?.map((item) => (
                            <div
                                key={item.id}
                                onClick={() => {
                                    setSelectedItem(item.product_id);
                                    setQty(1);
                                }}
                                className={`p-3 rounded-xl border cursor-pointer transition-all ${selectedItem === item.product_id
                                        ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                                        : 'border-slate-200 hover:border-blue-300'
                                    }`}
                            >
                                <div className="flex justify-between items-center">
                                    <div>
                                        <p className="font-bold text-slate-900">{item.Product?.name}</p>
                                        <p className="text-xs text-slate-500">{formatCurrency(item.price_at_purchase)} x {item.qty}</p>
                                    </div>
                                    {selectedItem === item.product_id && <Check size={16} className="text-blue-600" />}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {selectedItem && selectedProduct && (
                    <>
                        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                            <label className="block text-sm font-bold text-slate-700 mb-2">Jumlah Retur</label>
                            <input
                                type="number"
                                min="1"
                                max={selectedProduct.qty}
                                value={qty}
                                onChange={(e) => setQty(Number(e.target.value))}
                                className="w-full px-4 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                            />
                            <p className="text-xs text-slate-500 mt-1">Maksimal: {selectedProduct.qty}</p>
                        </div>

                        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                            <label className="block text-sm font-bold text-slate-700 mb-2">Alasan Pengembalian</label>
                            <textarea
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                className="w-full px-4 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                                rows={3}
                                placeholder="Contoh: Barang rusak, salah kirim, dll."
                                required
                            />
                        </div>

                        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                            <label className="block text-sm font-bold text-slate-700 mb-2">Bukti Foto / Video</label>
                            <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center hover:bg-slate-50 transition-colors relative">
                                <input
                                    type="file"
                                    accept="image/*,video/*"
                                    onChange={(e) => setEvidence(e.target.files ? e.target.files[0] : null)}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                />
                                <Upload size={24} className="mx-auto text-slate-400 mb-2" />
                                <p className="text-sm text-slate-600 font-bold">
                                    {evidence ? evidence.name : 'Klik untuk upload bukti'}
                                </p>
                                <p className="text-xs text-slate-400">Gambar atau Video (Max 5MB)</p>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={submitting}
                            className="w-full py-4 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-lg shadow-lg shadow-rose-200 transition-all disabled:opacity-50"
                        >
                            {submitting ? 'Mengirim...' : 'Kirim Permintaan Retur'}
                        </button>
                    </>
                )}
            </form>
        </div>
    );
}
