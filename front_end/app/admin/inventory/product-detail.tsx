'use client';

import { ProductRow } from './types';
import { api } from '@/lib/api';
import { useEffect, useState } from 'react';
import { Camera, History, Truck, X } from 'lucide-react';

interface ProductDetailViewProps {
    product: ProductRow | null;
    onClose: () => void;
}

export default function ProductDetailView({ product, onClose }: ProductDetailViewProps) {
    const [mutations, setMutations] = useState<any[]>([]);
    const [loadingMutations, setLoadingMutations] = useState(false);

    useEffect(() => {
        if (product?.id) {
            setLoadingMutations(true);
            api.admin.inventory.getMutations(product.id)
                .then((res: any) => setMutations(res.data.mutations || []))
                .catch((err: any) => console.error(err))
                .finally(() => setLoadingMutations(false));
        } else {
            setMutations([]);
        }
    }, [product?.id]);

    if (!product) {
        return (
            <div className="h-full flex items-center justify-center text-slate-400 p-8 text-center bg-slate-50 border-l border-slate-200">
                <div>
                    <p className="font-bold text-lg mb-2">Pilih Produk</p>
                    <p className="text-sm">Klik baris pada tabel untuk melihat detail.</p>
                </div>
            </div>
        );
    }

    const vehicleCompatibility = product.vehicle_compatibility
        ? (typeof product.vehicle_compatibility === 'string' && product.vehicle_compatibility.startsWith('[')
            ? JSON.parse(product.vehicle_compatibility).join(', ')
            : product.vehicle_compatibility)
        : '-';

    return (
        <div className="h-full flex flex-col bg-white border-l border-slate-200 shadow-lg w-full">
            <div className="p-4 border-b border-slate-200 flex items-start justify-between bg-slate-50">
                <div>
                    <h2 className="text-xl font-black text-slate-900 leading-tight">{product.name}</h2>
                    <p className="text-emerald-700 font-mono font-bold text-sm mt-1">{product.sku}</p>
                </div>
                <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1">
                    <X size={20} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {/* Image Section */}
                <div className="aspect-video w-full bg-slate-100 rounded-xl border border-slate-200 overflow-hidden relative group">
                    {product.image_url ? (
                        <img src={product.image_url} alt={product.name} className="w-full h-full object-contain" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-300">
                            <Camera size={48} />
                        </div>
                    )}
                </div>

                {/* Key Details Grid */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                        <span className="text-xs text-slate-500 block uppercase font-bold tracking-wider mb-1">Stok Fisik</span>
                        <span className="text-2xl font-black text-slate-900">{product.stock_quantity} <span className="text-sm font-normal text-slate-500">{product.unit}</span></span>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                        <span className="text-xs text-slate-500 block uppercase font-bold tracking-wider mb-1">Lokasi Rak</span>
                        <span className="text-2xl font-black text-emerald-700">{product.bin_location || '-'}</span>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                        <span className="text-xs text-slate-500 block uppercase font-bold tracking-wider mb-1">Harga Jual</span>
                        <span className="text-lg font-bold text-slate-900">
                            {Number(product.price).toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })}
                        </span>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                        <span className="text-xs text-slate-500 block uppercase font-bold tracking-wider mb-1">Status</span>
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-bold uppercase ${product.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                            {product.status}
                        </span>
                    </div>
                </div>

                {/* Vehicle Compatibility */}
                <div className="space-y-2">
                    <h3 className="font-bold text-slate-900 flex items-center gap-2">
                        <Truck size={16} />
                        Aplikasi Kendaraan
                    </h3>
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-sm text-slate-700 leading-relaxed">
                        {vehicleCompatibility}
                    </div>
                </div>

                {/* Mutation History */}
                <div className="space-y-2">
                    <h3 className="font-bold text-slate-900 flex items-center gap-2">
                        <History size={16} />
                        Riwayat Mutasi (10 Terakhir)
                    </h3>
                    <div className="border border-slate-200 rounded-xl overflow-hidden text-sm">
                        {loadingMutations ? (
                            <div className="p-4 text-center text-slate-500">Memuat riwayat...</div>
                        ) : mutations.length === 0 ? (
                            <div className="p-4 text-center text-slate-500">Belum ada riwayat mutasi.</div>
                        ) : (
                            <table className="w-full text-left">
                                <thead className="bg-slate-50 text-slate-600 font-bold text-xs uppercase">
                                    <tr>
                                        <th className="px-3 py-2">Waktu</th>
                                        <th className="px-3 py-2">Tipe</th>
                                        <th className="px-3 py-2 text-right">Qty</th>
                                        <th className="px-3 py-2">Ket</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {mutations.map((mut) => (
                                        <tr key={mut.id}>
                                            <td className="px-3 py-2 text-xs text-slate-500">
                                                {new Date(mut.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                                            </td>
                                            <td className="px-3 py-2 text-xs font-bold capitalize">
                                                {mut.type}
                                            </td>
                                            <td className={`px-3 py-2 text-right font-mono font-bold ${mut.qty > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                {mut.qty > 0 ? '+' : ''}{mut.qty}
                                            </td>
                                            <td className="px-3 py-2 text-[10px] text-slate-600 truncate max-w-[100px]" title={mut.note}>
                                                {mut.reference_id || ''}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
