'use client';

import Link from 'next/link';
import { useRequireRoles } from '@/lib/guards';
import FinanceHeader from '@/components/admin/finance/FinanceHeader';
import FinanceBottomNav from '@/components/admin/finance/FinanceBottomNav';
import { BarChart3, PieChart, TrendingUp, DollarSign, Calendar, FileText } from 'lucide-react';

export default function FinanceReportsPage() {
    const allowed = useRequireRoles(['super_admin', 'admin_finance']);

    if (!allowed) return null;

    const reports = [
        {
            title: 'Laba Rugi (P&L)',
            desc: 'Pendapatan, HPP, dan Biaya Operasional',
            icon: <TrendingUp size={24} className="text-emerald-600" />,
            href: '/admin/finance/laporan/pnl',
            color: 'bg-emerald-50'
        },
        {
            title: 'Neraca (Balance Sheet)',
            desc: 'Aset, Kewajiban, dan Modal',
            icon: <PieChart size={24} className="text-blue-600" />,
            href: '/admin/finance/laporan/balance-sheet',
            color: 'bg-blue-50'
        },
        {
            title: 'Arus Kas (Cash Flow)',
            desc: 'Pergerakan uang masuk dan keluar',
            icon: <DollarSign size={24} className="text-amber-600" />,
            href: '/admin/finance/laporan/cash-flow',
            color: 'bg-amber-50'
        },
        {
            title: 'Nilai Inventaris',
            desc: 'Total nilai aset stok gudang',
            icon: <BarChart3 size={24} className="text-purple-600" />,
            href: '/admin/finance/laporan/inventory-value',
            color: 'bg-purple-50'
        },
        {
            title: 'Aging Piutang (AR)',
            desc: 'Tagihan customer yang belum dibayar',
            icon: <FileText size={24} className="text-rose-600" />,
            href: '/admin/finance/laporan/aging-ar',
            color: 'bg-rose-50'
        },
        {
            title: 'Aging Hutang (AP)',
            desc: 'Tagihan supplier yang harus dibayar',
            icon: <Calendar size={24} className="text-slate-600" />,
            href: '/admin/finance/laporan/aging-ap',
            color: 'bg-slate-50'
        }
    ];

    return (
        <div className="bg-slate-50 min-h-screen pb-24">
            <div className="bg-white px-6 pb-4 pt-2 shadow-sm sticky top-0 z-40 mb-4">
                <FinanceHeader title="Laporan Keuangan" />
            </div>

            <div className="px-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {reports.map((report, idx) => (
                        <Link key={idx} href={report.href} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4 active:scale-95 transition-transform hover:shadow-md">
                            <div className={`w-12 h-12 rounded-full ${report.color} flex items-center justify-center`}>
                                {report.icon}
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-900 text-sm">{report.title}</h3>
                                <p className="text-xs text-slate-500 line-clamp-1">{report.desc}</p>
                            </div>
                        </Link>
                    ))}
                </div>
            </div>

            <FinanceBottomNav />
        </div>
    );
}
