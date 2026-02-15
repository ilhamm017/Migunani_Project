'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Save, CheckCircle, AlertTriangle, ScanLine } from 'lucide-react';
import Link from 'next/link';

export default function AuditDetailPage() {
    const { id } = useParams();
    const router = useRouter();
    const [opname, setOpname] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    // Form State
    const [productId, setProductId] = useState('');
    const [physicalQty, setPhysicalQty] = useState('');
    const [products, setProducts] = useState<any[]>([]);
    const [search, setSearch] = useState('');

    useEffect(() => {
        if (id) loadData();
    }, [id]);

    const loadData = async () => {
        try {
            const [opRes, prodRes] = await Promise.all([
                api.admin.inventory.getAuditDetail(id as string),
                api.admin.inventory.getProducts({ limit: 1000, status: 'all' })
            ]);
            setOpname(opRes.data);
            if (prodRes.data && Array.isArray(prodRes.data.products)) {
                setProducts(prodRes.data.products);
            } else if (Array.isArray(prodRes.data)) {
                setProducts(prodRes.data);
            }
        } catch (error) {
            console.error('Failed to load audit detail', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmitItem = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!productId || !physicalQty) return;

        try {
            await api.admin.inventory.auditItem(id as string, {
                product_id: productId,
                physical_qty: parseInt(physicalQty)
            });

            // Reset form and reload
            setProductId('');
            setPhysicalQty('');
            setSearch(''); // Optional: clear search
            loadData(); // Refresh list
        } catch (error) {
            alert('Gagal menyimpan item audit');
        }
    };

    const handleFinish = async () => {
        if (!confirm('Selesaikan audit ini? Laporan akan difinalisasi.')) return;
        try {
            await api.admin.inventory.finishAudit(id as string);
            router.push('/admin/warehouse/audit');
        } catch (error) {
            alert('Gagal menyelesaikan audit');
        }
    };

    if (loading) return <div className="p-6">Loading...</div>;
    if (!opname) return <div className="p-6">Audit not found</div>;

    const filteredProducts = products.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.sku.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="warehouse-page">
            <div>
                <div className="warehouse-breadcrumb">
                    <Link href="/admin" className="hover:text-emerald-500 transition-colors">Warehouse</Link>
                    <span>/</span>
                    <Link href="/admin/warehouse/audit" className="hover:text-emerald-500 transition-colors">Stock Audit</Link>
                    <span>/</span>
                    <span className="text-slate-900">Detail</span>
                </div>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/admin/warehouse/audit" className="p-2 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors">
                            <ArrowLeft size={18} className="text-slate-700" />
                        </Link>
                        <div>
                            <h1 className="warehouse-title">Audit Detail</h1>
                            <p className="warehouse-subtitle">ID Audit: <span className="font-mono">{opname.id}</span> • Status: <span className="font-bold uppercase text-emerald-600">{opname.status}</span></p>
                        </div>
                    </div>
                    <div>
                        {opname.status === 'open' && (
                            <button
                                onClick={handleFinish}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 transition-colors shadow-lg shadow-emerald-500/10"
                            >
                                <CheckCircle size={18} />
                                Selesai & Finalisasi
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Input Form Section - Only if Open */}
                {opname.status === 'open' && (
                    <div className="lg:col-span-1 space-y-4">
                        <div className="warehouse-panel bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                            <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
                                <ScanLine size={20} className="text-blue-600" />
                                Input Stok Fisik
                            </h2>
                            <form onSubmit={handleSubmitItem} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">Cari Produk</label>
                                    <input
                                        type="text"
                                        placeholder="Ketik nama / SKU..."
                                        className="w-full px-4 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                        value={search}
                                        onChange={e => setSearch(e.target.value)}
                                    />
                                    {search && (
                                        <div className="mt-2 max-h-40 overflow-y-auto border border-slate-200 rounded-xl bg-slate-50">
                                            {filteredProducts.slice(0, 10).map(p => (
                                                <div
                                                    key={p.id}
                                                    onClick={() => { setProductId(p.id); setSearch(p.name); }}
                                                    className="p-2 hover:bg-emerald-50 cursor-pointer text-sm border-b border-slate-100 last:border-0"
                                                >
                                                    <div className="font-bold">{p.name}</div>
                                                    <div className="text-xs text-slate-500">{p.sku} | Stok Sys: {p.stock_quantity}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">ID Produk Terpilih</label>
                                    <input
                                        type="text"
                                        className="w-full px-4 py-2 bg-slate-100 border border-slate-200 rounded-xl text-slate-500"
                                        value={productId}
                                        readOnly
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">Jumlah Fisik (Real)</label>
                                    <input
                                        type="number"
                                        required
                                        className="w-full px-4 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-lg"
                                        value={physicalQty}
                                        onChange={e => setPhysicalQty(e.target.value)}
                                    />
                                </div>

                                <button
                                    type="submit"
                                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                                >
                                    <Save size={18} />
                                    Simpan Hasil Audit
                                </button>
                            </form>
                        </div>
                    </div>
                )}

                {/* Audit Items Table */}
                <div className={`space-y-4 ${opname.status === 'open' ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
                    <div className="warehouse-panel bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                        <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                            <h3 className="font-bold text-slate-700">Hasil Audit ({opname.Items?.length || 0} Item)</h3>
                            {opname.status === 'completed' && (
                                <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold">Laporan Final</span>
                            )}
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-slate-50 border-b border-slate-200">
                                    <tr>
                                        <th className="px-6 py-3 font-bold text-slate-600">Produk</th>
                                        <th className="px-6 py-3 font-bold text-slate-600 text-center">System Qty</th>
                                        <th className="px-6 py-3 font-bold text-slate-600 text-center">Fisik Qty</th>
                                        <th className="px-6 py-3 font-bold text-slate-600 text-center">Selisih</th>
                                        <th className="px-6 py-3 font-bold text-slate-600">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {opname.Items?.map((item: any) => (
                                        <tr key={item.id} className="hover:bg-slate-50">
                                            <td className="px-6 py-3">
                                                <div className="font-bold text-slate-900">{item.Product?.name}</div>
                                                <div className="text-xs text-slate-500">{item.Product?.sku}</div>
                                            </td>
                                            <td className="px-6 py-3 text-center font-mono">{item.system_qty}</td>
                                            <td className="px-6 py-3 text-center font-mono font-bold bg-amber-50 text-amber-900">{item.physical_qty}</td>
                                            <td className="px-6 py-3 text-center">
                                                <span className={`font-bold ${item.difference === 0 ? 'text-slate-400' : item.difference < 0 ? 'text-rose-600' : 'text-blue-600'}`}>
                                                    {item.difference > 0 ? `+${item.difference}` : item.difference}
                                                </span>
                                            </td>
                                            <td className="px-6 py-3">
                                                {item.difference === 0 ? (
                                                    <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-bold">
                                                        <CheckCircle size={12} /> Cocok
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-rose-600 text-xs font-bold">
                                                        <AlertTriangle size={12} /> Selisih
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {(!opname.Items || opname.Items.length === 0) && (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-8 text-center text-slate-500 italic">
                                                Belum ada item yang diaudit.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
