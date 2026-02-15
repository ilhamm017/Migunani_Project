'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Upload, Check } from 'lucide-react';
import Link from 'next/link';
import { formatCurrency } from '@/lib/utils';

export default function ReturnRequestPage() {
    const { id } = useParams();
    const router = useRouter();
    const [order, setOrder] = useState<any>(null);
    const [selectedItem, setSelectedItem] = useState<string | null>(null);
    const [qty, setQty] = useState(1);
    const [reason, setReason] = useState('');
    const [evidence, setEvidence] = useState<File | null>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (id) loadOrder();
    }, [id]);

    const loadOrder = async () => {
        try {
            const res = await api.orders.getOrderById(id as string);
            setOrder(res.data);
        } catch (error) {
            console.error('Failed to load order', error);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedItem || !reason || !qty) return;

        try {
            setSubmitting(true);
            const formData = new FormData();
            formData.append('order_id', id as string);
            formData.append('product_id', selectedItem);
            formData.append('qty', String(qty));
            formData.append('reason', reason);
            if (evidence) {
                formData.append('evidence_img', evidence);
            }

            await api.retur.request(formData);
            alert('Permintaan retur berhasil dikirim!');
            router.push(`/orders/${id}`);
        } catch (error: any) {
            alert(error.response?.data?.message || 'Gagal mengirim permintaan retur');
        } finally {
            setSubmitting(false);
        }
    };

    if (!order) return <div className="p-6">Loading...</div>;

    const selectedProduct = order.OrderItems?.find((i: any) => i.product_id === selectedItem);

    return (
        <div className="p-6">
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
                        {order.OrderItems?.map((item: any) => (
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
