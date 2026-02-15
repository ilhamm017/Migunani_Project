'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api'; // Ensure this helper exists or use fetch
import Link from 'next/link';
import { Plus, Eye, Calendar, User } from 'lucide-react';

export default function AuditListPage() {
    const [opnames, setOpnames] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadOpnames();
    }, []);

    const loadOpnames = async () => {
        try {
            const res = await api.admin.inventory.getAudits();
            setOpnames(res.data);
        } catch (error) {
            console.error('Failed to load audits', error);
        } finally {
            setLoading(false);
        }
    };

    const handleStartNew = async () => {
        try {
            const note = prompt('Catatan untuk Audit ini?');
            if (note === null) return;

            await api.admin.inventory.startAudit({ notes: note });
            loadOpnames();
        } catch (error) {
            alert('Gagal membuat audit baru');
        }
    };

    return (
        <div className="warehouse-page">
            <div>
                <div className="warehouse-breadcrumb">
                    <Link href="/admin" className="hover:text-emerald-500 transition-colors">Warehouse</Link>
                    <span>/</span>
                    <span className="text-slate-900">Stock Audit</span>
                </div>
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="warehouse-title">Stock Opname (Audit)</h1>
                        <p className="warehouse-subtitle">Riwayat dan pelaksanaan audit stok fisik gudang secara berkala.</p>
                    </div>
                    <button
                        onClick={handleStartNew}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 transition-colors shadow-lg shadow-emerald-500/10"
                    >
                        <Plus size={18} />
                        Mulai Audit Baru
                    </button>
                </div>
            </div>

            <div className="warehouse-panel bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                            <th className="px-6 py-4 font-bold text-slate-700">Tanggal Mulai</th>
                            <th className="px-6 py-4 font-bold text-slate-700">Admin</th>
                            <th className="px-6 py-4 font-bold text-slate-700">Status</th>
                            <th className="px-6 py-4 font-bold text-slate-700">Catatan</th>
                            <th className="px-6 py-4 font-bold text-slate-700">Aksi</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {loading ? (
                            <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-500">Loading...</td></tr>
                        ) : opnames.length === 0 ? (
                            <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-500">Belum ada data audit.</td></tr>
                        ) : (
                            opnames.map((op: any) => (
                                <tr key={op.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-6 py-4 text-slate-900">
                                        <div className="flex items-center gap-2">
                                            <Calendar size={14} className="text-slate-400" />
                                            {new Date(op.started_at).toLocaleString('id-ID')}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-slate-600">
                                        <div className="flex items-center gap-2">
                                            <User size={14} className="text-slate-400" />
                                            {op.Creator?.name || 'Unknown'}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex px-2 py-1 rounded-md text-xs font-bold uppercase tracking-wide
                                    ${op.status === 'open' ? 'bg-blue-100 text-blue-700' :
                                                op.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}
                                `}>
                                            {op.status}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-slate-600 italic">
                                        {op.notes || '-'}
                                    </td>
                                    <td className="px-6 py-4">
                                        <Link
                                            href={`/admin/warehouse/audit/${op.id}`}
                                            className="inline-flex items-center gap-2 text-emerald-600 hover:text-emerald-700 font-bold"
                                        >
                                            <Eye size={16} />
                                            Detail
                                        </Link>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
