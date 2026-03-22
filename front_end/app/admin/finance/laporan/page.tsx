'use client';

import Link from 'next/link';
import { useRequireRoles } from '@/lib/guards';
import FinanceHeader from '@/components/admin/finance/FinanceHeader';
import FinanceBottomNav from '@/components/admin/finance/FinanceBottomNav';
import {
    AlarmClock,
    BadgeCheck,
    BarChart3,
    Calendar,
    Boxes,
    ClipboardList,
    DollarSign,
    FileText,
    HandCoins,
    Landmark,
    LineChart,
    Package,
    PieChart,
    Receipt,
    ReceiptText,
    RefreshCw,
    ShoppingCart,
    SlidersHorizontal,
    TrendingUp,
    Layers,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

export default function FinanceReportsPage() {
    const allowed = useRequireRoles(['super_admin']);
    const { user } = useAuthStore();

    if (!allowed) return null;

    const allReports = [
        {
            title: 'Laba Rugi (P&L)',
            desc: 'Pendapatan, HPP, dan Biaya Operasional',
            icon: <TrendingUp size={24} className="text-emerald-600" />,
            href: '/admin/finance/laporan/pnl',
            color: 'bg-emerald-50',
            roles: ['super_admin', 'admin_finance']
        },
        {
            title: 'Neraca (Balance Sheet)',
            desc: 'Aset, Kewajiban, dan Modal',
            icon: <PieChart size={24} className="text-blue-600" />,
            href: '/admin/finance/laporan/balance-sheet',
            color: 'bg-blue-50',
            roles: ['super_admin', 'admin_finance']
        },
        {
            title: 'Arus Kas (Cash Flow)',
            desc: 'Pergerakan uang masuk dan keluar',
            icon: <DollarSign size={24} className="text-amber-600" />,
            href: '/admin/finance/laporan/cash-flow',
            color: 'bg-amber-50',
            roles: ['super_admin', 'admin_finance']
        },
        {
            title: 'Nilai Inventaris',
            desc: 'Total nilai aset stok gudang',
            icon: <BarChart3 size={24} className="text-purple-600" />,
            href: '/admin/finance/laporan/inventory-value',
            color: 'bg-purple-50',
            roles: ['super_admin', 'admin_finance']
        },
        {
            title: 'Aging Piutang (AR)',
            desc: 'Tagihan customer yang belum dibayar',
            icon: <FileText size={24} className="text-rose-600" />,
            href: '/admin/finance/laporan/aging-ar',
            color: 'bg-rose-50',
            roles: ['super_admin', 'admin_finance']
        },
        {
            title: 'Aging Hutang (AP)',
            desc: 'Tagihan supplier yang harus dibayar',
            icon: <Calendar size={24} className="text-slate-600" />,
            href: '/admin/finance/laporan/aging-ap',
            color: 'bg-slate-50',
            roles: ['super_admin', 'admin_finance']
        },
        {
            title: 'Backorder / Preorder',
            desc: 'Monitoring stok kurang & pesanan tertunda',
            icon: <ClipboardList size={24} className="text-orange-600" />,
            href: '/admin/finance/laporan/backorder',
            color: 'bg-orange-50',
            roles: ['super_admin', 'kasir']
        },
        {
            title: 'Tax Summary',
            desc: 'Ringkasan PPN dan PPh Final per periode',
            icon: <ReceiptText size={24} className="text-teal-600" />,
            href: '/admin/finance/laporan/tax-summary',
            color: 'bg-teal-50',
            roles: ['super_admin', 'admin_finance']
        },
        {
            title: 'PPN Bulanan',
            desc: 'Rekap PPN Keluaran vs Masukan per bulan',
            icon: <Landmark size={24} className="text-indigo-600" />,
            href: '/admin/finance/laporan/vat-monthly',
            color: 'bg-indigo-50',
            roles: ['super_admin', 'admin_finance']
        },
        {
            title: 'Setting Pajak',
            desc: 'Konfigurasi mode PKP/non-PKP dan nilai persentase pajak',
            icon: <SlidersHorizontal size={24} className="text-cyan-600" />,
            href: '/admin/finance/settings/tax',
            color: 'bg-cyan-50',
            roles: ['super_admin', 'admin_finance']
        },
        {
            title: 'Pembelian',
            desc: 'Rekap PO & pembelian supplier per periode',
            icon: <ShoppingCart size={24} className="text-teal-600" />,
            href: '/admin/finance/laporan/pembelian',
            color: 'bg-teal-50',
            roles: ['super_admin', 'admin_finance', 'kasir']
        },
        {
            title: 'Penjualan',
            desc: 'Rekap order & omzet per periode',
            icon: <LineChart size={24} className="text-emerald-600" />,
            href: '/admin/finance/laporan/penjualan',
            color: 'bg-emerald-50',
            roles: ['super_admin', 'admin_finance', 'kasir']
        },
        {
            title: 'Pembayaran Pelanggan',
            desc: 'Pantau verifikasi pembayaran & COD',
            icon: <BadgeCheck size={24} className="text-blue-600" />,
            href: '/admin/finance/laporan/pembayaran-pelanggan',
            color: 'bg-blue-50',
            roles: ['super_admin', 'admin_finance', 'kasir']
        },
        {
            title: 'Produk Terjual',
            desc: 'Top produk terjual (invoice paid) per periode',
            icon: <Package size={24} className="text-purple-600" />,
            href: '/admin/finance/laporan/produk-terjual',
            color: 'bg-purple-50',
            roles: ['super_admin', 'admin_finance', 'kasir']
        },
        {
            title: 'Invoice Pelanggan',
            desc: 'Ringkasan invoice customer & piutang berjalan',
            icon: <FileText size={24} className="text-rose-600" />,
            href: '/admin/finance/laporan/invoice-pelanggan',
            color: 'bg-rose-50',
            roles: ['super_admin', 'admin_finance', 'kasir']
        },
        {
            title: 'Piutang Pelanggan',
            desc: 'Daftar invoice belum lunas + aging',
            icon: <AlarmClock size={24} className="text-orange-600" />,
            href: '/admin/finance/laporan/piutang-pelanggan',
            color: 'bg-orange-50',
            roles: ['super_admin', 'admin_finance']
        },
        {
            title: 'Invoice Supplier',
            desc: 'Daftar tagihan supplier & status pembayaran',
            icon: <Receipt size={24} className="text-slate-700" />,
            href: '/admin/finance/laporan/invoice-supplier',
            color: 'bg-slate-50',
            roles: ['super_admin', 'admin_finance']
        },
        {
            title: 'Bayar Supplier',
            desc: 'Bayar tagihan supplier & cek sisa hutang',
            icon: <HandCoins size={24} className="text-amber-600" />,
            href: '/admin/finance/laporan/bayar-supplier',
            color: 'bg-amber-50',
            roles: ['super_admin', 'admin_finance']
        },
        {
            title: 'Jatuh Tempo',
            desc: 'Invoice customer & supplier yang mendekati jatuh tempo',
            icon: <AlarmClock size={24} className="text-fuchsia-600" />,
            href: '/admin/finance/laporan/jatuh-tempo',
            color: 'bg-fuchsia-50',
            roles: ['super_admin', 'admin_finance']
        },
        {
            title: 'Omset Sales',
            desc: 'Ranking omzet per customer (order) per periode',
            icon: <TrendingUp size={24} className="text-emerald-600" />,
            href: '/admin/finance/laporan/omset-sales',
            color: 'bg-emerald-50',
            roles: ['super_admin', 'admin_finance', 'kasir']
        },
        {
            title: 'Persediaan',
            desc: 'Nilai persediaan & akses cepat inventory',
            icon: <Boxes size={24} className="text-indigo-600" />,
            href: '/admin/finance/laporan/persediaan',
            color: 'bg-indigo-50',
            roles: ['super_admin', 'admin_finance', 'kasir']
        },
        {
            title: 'Koreksi Stok',
            desc: 'Pengurangan stok + export IPO (stock reduction)',
            icon: <RefreshCw size={24} className="text-cyan-600" />,
            href: '/admin/finance/laporan/koreksi-stok',
            color: 'bg-cyan-50',
            roles: ['super_admin', 'kasir']
        },
        {
            title: 'Biaya / Pendapatan Lain-lain',
            desc: 'Rekap biaya operasional & jurnal penyesuaian',
            icon: <DollarSign size={24} className="text-slate-700" />,
            href: '/admin/finance/laporan/biaya-pendapatan-lain',
            color: 'bg-slate-50',
            roles: ['super_admin', 'admin_finance']
        },
        {
            title: 'Gabungan Invoice Belum Lunas',
            desc: 'Customer (AR) + supplier (AP) yang masih outstanding',
            icon: <Layers size={24} className="text-slate-700" />,
            href: '/admin/finance/laporan/invoice-belum-lunas',
            color: 'bg-slate-50',
            roles: ['super_admin', 'admin_finance']
        },
    ];

    const reports = allReports.filter(report => {
        if (!report.roles) return true; // Default to all if not specified
        return report.roles.includes(String(user?.role));
    });

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
