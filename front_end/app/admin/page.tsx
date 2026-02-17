'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AlertTriangle, Boxes, ClipboardList, DollarSign, FileSpreadsheet, Layers, MessageSquare, ShoppingCart, Users, ClipboardCheck, Settings, Shield, LayoutDashboard, Megaphone, ScanBarcode, UserCheck, Warehouse, Plus, Wallet, Truck, RotateCcw, Percent, CheckCircle, Clock, TrendingUp, FileText } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { useAdminActionBadges } from '@/lib/useAdminActionBadges';
import FinanceHeader from '@/components/admin/finance/FinanceHeader';
import BalanceCard from '@/components/admin/finance/BalanceCard';
import FinanceBottomNav from '@/components/admin/finance/FinanceBottomNav';

export default function AdminOverviewPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'admin_finance', 'kasir', 'driver']);
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuthStore();

  // General Summary State
  const [summary, setSummary] = useState({ pendingOrders: 0, unpaid: 0, unpaidTotal: 0, chats: 0, outOfStock: 0 });

  // Warehouse Badges State
  const [warehouseCardBadges, setWarehouseCardBadges] = useState<Record<string, number>>({});

  // Finance Badges & Stats State
  const { financeCardBadges } = useAdminActionBadges({
    enabled: !!allowed && user?.role === 'admin_finance',
    role: user?.role
  });

  const [financeStats, setFinanceStats] = useState({
    pendingVerify: 0,
    pendingCod: 0,
    pendingExpense: 0,
    cashBalance: 0
  });

  useEffect(() => {
    const load = async () => {
      try {
        const canReadAR = ['super_admin', 'admin_finance'].includes(String(user?.role || ''));
        const [statsRes, arData, chatRes] = await Promise.all([
          api.admin.orderManagement.getStats(),
          canReadAR
            ? api.admin.finance.getAR().then((res) => (Array.isArray(res.data) ? res.data : [])).catch(() => [])
            : Promise.resolve([]),
          api.chat.getSessions(),
        ]);

        const stats = statsRes.data || {};
        const pendingAllocCount = Number(stats.pending || 0);

        let actionableCount = 0;
        if (user?.role === 'admin_finance') {
          // Finance tasks: issue invoice, verify transfer (processing), verify COD settlement
          actionableCount = Number(stats.waiting_invoice || 0) + Number(stats.waiting_admin_verification || 0) + Number(stats.delivered || 0);

          // --- Fetch Additional Finance Specific Stats ---
          // 1. Pending Verification (Waiting Payment) - already in stats.waiting_payment but let's be explicit if needed
          // 2. Pending COD
          const resCod = await api.admin.finance.getDriverCodList();
          let codCount = 0;
          if (Array.isArray(resCod.data)) {
            codCount = resCod.data.filter((d: any) => d.total_pending > 0).length;
          }

          // 3. Pending Expense
          const resExp = await api.admin.finance.getExpenses({ status: 'requested', limit: 1 });

          setFinanceStats({
            pendingVerify: Number(stats.waiting_admin_verification || 0),
            pendingCod: codCount,
            pendingExpense: resExp.data?.total || 0,
            cashBalance: 0 // Placeholder
          });

        } else if (user?.role === 'admin_gudang') {
          // Warehouse tasks: ship ready_to_ship (Allocation moved to sales)
          actionableCount = Number(stats.ready_to_ship || 0);
        } else if (user?.role === 'kasir') {
          // Kasir tasks: Allocate pending orders
          actionableCount = pendingAllocCount;
        } else {
          // Super admin / Others: any order that isn't finished or canceled
          actionableCount = pendingAllocCount + Number(stats.waiting_invoice || 0) + Number(stats.waiting_payment || 0) + Number(stats.delivered || 0);
        }

        let outOfStockCount = 0;
        const newWarehouseBadges: Record<string, number> = {};

        // Badges for Kasir (Allocation)
        if (user?.role === 'kasir' || user?.role === 'super_admin') {
          newWarehouseBadges['/admin/warehouse/allocation'] = pendingAllocCount;
        }

        if (user?.role === 'admin_gudang' || user?.role === 'super_admin') {
          const [processingRes, allocatedRes, productsRes, retursRes, auditsRes] = await Promise.all([
            api.admin.orderManagement.getAll({ status: 'waiting_admin_verification', limit: 1 }).catch(() => ({ data: { total: 0 } })),
            api.admin.orderManagement.getAll({ status: 'allocated', limit: 1 }).catch(() => ({ data: { total: 0 } })),
            api.admin.inventory.getProducts({ limit: 100 }).catch(() => ({ data: { products: [] } })),
            api.retur.getAll().catch(() => ({ data: [] })),
            api.admin.inventory.getAudits().catch(() => ({ data: [] })),
          ]);

          const processingOrders = Number(processingRes.data?.total || 0);
          const allocatedOrders = Number(allocatedRes.data?.total || 0);
          const readyToShipOrders = Number(stats.ready_to_ship || 0);

          const products = Array.isArray(productsRes.data?.products) ? productsRes.data.products : [];
          outOfStockCount = products.filter((p: any) => Number(p.stock_quantity || 0) <= 0).length;

          const returs = Array.isArray(retursRes.data) ? retursRes.data : [];
          const pendingReturActions = returs.filter((r: any) => {
            const status = String(r?.status || '').toLowerCase();
            const hasAdminResponse = String(r?.admin_response || '').trim().length > 0;
            return status === 'pending' && !hasAdminResponse;
          }).length;

          const audits = Array.isArray(auditsRes.data) ? auditsRes.data : [];
          const openAuditCount = audits.filter((audit: any) => String(audit?.status || '').toLowerCase() === 'open').length;

          // Merge updates
          Object.assign(newWarehouseBadges, {
            '/admin/warehouse/allocation': pendingAllocCount, // Explicitly set again to be sure
            '/admin/warehouse/pesanan': processingOrders + allocatedOrders + readyToShipOrders,
            '/admin/warehouse/helper': processingOrders,
            '/admin/warehouse/retur': pendingReturActions,
            '/admin/warehouse/audit': openAuditCount,
          });
        }

        setWarehouseCardBadges(newWarehouseBadges);

        setSummary({
          pendingOrders: actionableCount,
          unpaid: arData.length,
          unpaidTotal: arData.reduce((sum: number, row: any) => sum + Number(row.amount_due || 0), 0),
          chats: Number(chatRes.data?.pending_total || 0),
          outOfStock: outOfStockCount,
        });
      } catch (error) {
        console.error('Failed to load admin summary:', error);
      }
    };

    if (allowed && user?.role !== 'driver') load();
  }, [allowed, user]);

  useEffect(() => {
    if (user?.role === 'driver') {
      router.replace('/driver');
    }
  }, [user, router]);

  if (!allowed) return null;



  // --- Views ---

  // 1. Sales Admin (Kasir)
  if (user?.role === 'kasir') {
    const salesMenus = [
      {
        href: '/admin/sales',
        title: 'Daftar Customer',
        desc: 'List customer dengan pencarian dan filter status.',
        icon: Users,
        tone: 'bg-emerald-100 text-emerald-700 group-hover:bg-emerald-700 group-hover:text-white',
      },
      {
        href: '/admin/sales/member-baru',
        title: 'Daftarkan Member Baru',
        desc: 'Buka form registrasi member/customer baru dengan OTP WhatsApp.',
        icon: UserCheck,
        tone: 'bg-teal-100 text-teal-700 group-hover:bg-teal-700 group-hover:text-white',
      },
      {
        href: '/admin/sales/karyawan',
        title: 'Daftarkan Karyawan Baru',
        desc: 'Buka halaman khusus pendaftaran karyawan baru.',
        icon: Shield,
        tone: 'bg-violet-100 text-violet-700 group-hover:bg-violet-700 group-hover:text-white',
      },
      {
        href: '/admin/orders/allocation',
        title: 'Alokasi Order',
        desc: 'Alokasi stok pesanan masuk.',
        icon: ClipboardCheck,
        tone: 'bg-orange-100 text-orange-700 group-hover:bg-orange-700 group-hover:text-white',
        badge: warehouseCardBadges['/admin/warehouse/allocation'] || 0
      },
      {
        href: '/admin/chat',
        title: 'Customer Service Chat',
        desc: 'Balas chat Web dan WhatsApp dari satu inbox.',
        icon: MessageSquare,
        tone: 'bg-blue-100 text-blue-700 group-hover:bg-blue-700 group-hover:text-white',
      },
      {
        href: '/admin/orders/create',
        title: 'Buat Order Customer',
        desc: 'Input pesanan manual dari WhatsApp atau offline.',
        icon: Plus,
        tone: 'bg-slate-100 text-slate-900 group-hover:bg-slate-900 group-hover:text-white',
      },
      {
        href: '/admin/sales/tier-pricing',
        title: 'Modifikasi Harga Tier',
        desc: 'Atur diskon persen tier untuk semua produk aktif.',
        icon: DollarSign,
        tone: 'bg-amber-100 text-amber-700 group-hover:bg-amber-700 group-hover:text-white',
      },
      {
        href: '/admin/sales/shipping-methods',
        title: 'Jenis Pengiriman',
        desc: 'Atur pilihan pengiriman dan biaya ongkir.',
        icon: Truck,
        tone: 'bg-cyan-100 text-cyan-700 group-hover:bg-cyan-700 group-hover:text-white',
      },
      {
        href: '/admin/sales/discount-vouchers',
        title: 'Voucher Diskon',
        desc: 'Atur kode voucher, persen diskon, batas potongan, dan kuota.',
        icon: Percent,
        tone: 'bg-fuchsia-100 text-fuchsia-700 group-hover:bg-fuchsia-700 group-hover:text-white',
      },
      {
        href: '/admin/orders',
        title: 'Monitor & Cancel Order',
        desc: 'Pantau order aktif dan batalkan jika terjadi salah input.',
        icon: ClipboardList,
        tone: 'bg-amber-100 text-amber-700 group-hover:bg-amber-700 group-hover:text-white',
      },
      {
        href: '/admin/sales',
        title: 'Edit Tier & Blokir',
        desc: 'Ubah tier customer dan blokir customer saat diperlukan.',
        icon: Shield,
        tone: 'bg-rose-100 text-rose-700 group-hover:bg-rose-700 group-hover:text-white',
      },
      {
        href: '/admin/chat/whatsapp',
        title: 'WhatsApp Bot & OTP',
        desc: 'Cek koneksi bot dan validasi OTP nomor customer.',
        icon: UserCheck,
        tone: 'bg-cyan-100 text-cyan-700 group-hover:bg-cyan-700 group-hover:text-white',
      },
      {
        href: '/admin/warehouse/inbound',
        title: 'Inbound / PO',
        desc: 'Input stok masuk dari Supplier manual.',
        icon: ShoppingCart,
        tone: 'bg-teal-100 text-teal-700 group-hover:bg-teal-700 group-hover:text-white',
      },
      {
        href: '/admin/warehouse/inbound/history',
        title: 'Riwayat PO',
        desc: 'Daftar semua Purchase Order.',
        icon: Clock,
        tone: 'bg-amber-100 text-amber-700 group-hover:bg-amber-700 group-hover:text-white',
      },
    ];

    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] mb-1">Sales & Customer Support</p>
            <h1 className="text-2xl font-black text-slate-900">Halo, {user?.name}</h1>
          </div>

        </div>

        <div className="bg-white border border-slate-100 rounded-[32px] p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Aktivitas Hari Ini</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight mb-1">Pesan Belum Dibalas</p>
              <div className="flex items-baseline gap-2">
                <p className="text-3xl font-black text-blue-600">{summary.chats}</p>
                <span className="text-[10px] font-black text-blue-600 uppercase">Chat</span>
              </div>
            </div>
            <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight mb-1">Pesanan Terinput</p>
              <div className="flex items-baseline gap-2">
                <p className="text-3xl font-black text-emerald-600">{summary.pendingOrders}</p>
                <span className="text-[10px] font-black text-emerald-600 uppercase">Order</span>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-[28px] p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Fungsi Admin Sales</h3>
            <p className="text-[10px] font-bold text-slate-400">{salesMenus.length} modul</p>
          </div>
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
            {salesMenus.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={`${item.href}-${item.title}`}
                  href={item.href}
                  className="group rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 transition-all h-full hover:bg-white hover:border-emerald-300 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all ${item.tone}`}>
                      <Icon size={18} />
                    </div>
                    <span className="text-[9px] font-black uppercase tracking-wide text-slate-400 group-hover:text-emerald-700">Buka</span>
                  </div>
                  <h3 className="font-black text-[12px] text-slate-900 leading-snug mt-3">{item.title}</h3>
                  <p className="text-[10px] text-slate-500 mt-1 leading-snug">{item.desc}</p>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // 2. Finance Admin (CONSOLIDATED)
  if (user?.role === 'admin_finance') {
    return (
      <div className="bg-slate-50 min-h-screen pb-20">
        <div className="px-6 pb-6 bg-white rounded-b-[32px] shadow-sm">
          <FinanceHeader title={`Halo, ${user?.name?.split(' ')[0] || 'Admin'}`} />
          <BalanceCard title="Kas Operasional" amount={financeStats.cashBalance} />
        </div>

        <div className="px-6 py-6 space-y-6">
          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-900">Kerjakan Sekarang</h3>
            </div>

            <div className="space-y-3">
              {/* Task 1: Verifikasi Transfer */}
              <Link href="/admin/finance/verifikasi" className="block bg-white border border-slate-100 rounded-2xl p-4 shadow-sm active:scale-95 transition-transform">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <CheckCircle size={24} />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-slate-900 text-sm">Verifikasi Transfer</h4>
                    <p className="text-xs text-slate-500 mt-0.5">{financeStats.pendingVerify} pesanan menunggu</p>
                  </div>
                  <div className="bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-full">
                    Review
                  </div>
                </div>
              </Link>

              {/* Task 2: Terima Setoran COD */}
              <Link href="/admin/finance/cod" className="block relative bg-white border border-slate-100 rounded-2xl p-4 shadow-sm active:scale-95 transition-transform overflow-hidden group hover:border-emerald-300">
                {financeStats.pendingCod > 0 && (
                  <span className="absolute top-3 right-3 bg-rose-600 text-white text-[9px] font-black rounded-full min-w-[18px] h-[18px] px-1.5 flex items-center justify-center leading-none shadow-sm z-10 animate-bounce">
                    {financeStats.pendingCod}
                  </span>
                )}
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center group-hover:bg-amber-100 transition-colors">
                    <Wallet size={24} />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-slate-900 text-sm">Terima Setoran COD</h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {financeStats.pendingCod > 0
                        ? `${financeStats.pendingCod} driver perlu setor uang`
                        : 'Semua setoran beres'}
                    </p>
                  </div>
                  <div className="bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-sm group-hover:bg-emerald-700 transition-colors">
                    Settle
                  </div>
                </div>
              </Link>

              {/* Task 3: Cairkan Expense */}
              <Link href="/admin/finance/biaya" className="block bg-white border border-slate-100 rounded-2xl p-4 shadow-sm active:scale-95 transition-transform">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                    <Clock size={24} />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-slate-900 text-sm">Cairkan Expense</h4>
                    <p className="text-xs text-slate-500 mt-0.5">{financeStats.pendingExpense} pengajuan</p>
                  </div>
                  <div className="bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-full">
                    Pay
                  </div>
                </div>
              </Link>
            </div>
          </div>

          {/* Menu Lainnya */}
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-4">Menu Lainnya</h3>
            <div className="grid grid-cols-2 gap-3">
              <Link href="/admin/finance/laporan" className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 active:scale-95 transition-transform">
                <div className="w-10 h-10 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center mb-3">
                  <TrendingUp size={20} />
                </div>
                <h4 className="font-bold text-slate-900 text-sm">Laporan</h4>
                <p className="text-[10px] text-slate-500">PnL, Neraca, Arus Kas</p>
              </Link>

              <Link href="/admin/finance/jurnal/adjustment" className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 active:scale-95 transition-transform">
                <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center mb-3">
                  <FileText size={20} />
                </div>
                <h4 className="font-bold text-slate-900 text-sm">Jurnal</h4>
                <p className="text-[10px] text-slate-500">Manual Adjustment</p>
              </Link>

              <Link href="/admin/finance/piutang" className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 active:scale-95 transition-transform">
                <div className="w-10 h-10 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mb-3">
                  <Wallet size={20} />
                </div>
                <h4 className="font-bold text-slate-900 text-sm">Piutang</h4>
                <p className="text-[10px] text-slate-500">Monitor Tagihan</p>
              </Link>

              <Link href="/admin/finance/retur" className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 active:scale-95 transition-transform">
                <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3">
                  <RotateCcw size={20} />
                </div>
                <h4 className="font-bold text-slate-900 text-sm">Refund</h4>
                <p className="text-[10px] text-slate-500">Pengembalian Dana</p>
              </Link>
            </div>
          </div>
        </div>

        <FinanceBottomNav />
      </div>
    );
  }

  // 3. Warehouse Admin
  if (user?.role === 'admin_gudang') {
    const warehouseMenus = [
      { href: '/admin/warehouse/stok', title: 'Data Inventori', desc: 'Kelola stok produk', icon: Boxes, tone: 'bg-emerald-100 text-emerald-700 group-hover:bg-emerald-700 group-hover:text-white' },
      // Allocation moved to Sales

      { href: '/admin/warehouse/pesanan', title: 'Kanban Pesanan', desc: 'Pantau alur order', icon: ClipboardList, tone: 'bg-blue-100 text-blue-700 group-hover:bg-blue-700 group-hover:text-white', badge: warehouseCardBadges['/admin/warehouse/pesanan'] || 0 },
      { href: '/admin/warehouse/retur', title: 'Retur Barang', desc: 'Validasi retur masuk', icon: RotateCcw, tone: 'bg-violet-100 text-violet-700 group-hover:bg-violet-700 group-hover:text-white', badge: warehouseCardBadges['/admin/warehouse/retur'] || 0 },
      { href: '/admin/warehouse/helper', title: 'Picker Helper', desc: 'Picking list gudang', icon: UserCheck, tone: 'bg-indigo-100 text-indigo-700 group-hover:bg-indigo-700 group-hover:text-white', badge: warehouseCardBadges['/admin/warehouse/helper'] || 0 },
      { href: '/admin/warehouse/audit', title: 'Stock Opname', desc: 'Audit stok fisik', icon: Shield, tone: 'bg-rose-100 text-rose-700 group-hover:bg-rose-700 group-hover:text-white', badge: warehouseCardBadges['/admin/warehouse/audit'] || 0 },
      { href: '/admin/warehouse/scanner', title: 'Scanner SKU', desc: 'Scan barcode cepat', icon: ScanBarcode, tone: 'bg-cyan-100 text-cyan-700 group-hover:bg-cyan-700 group-hover:text-white', badge: 0 },
      { href: '/admin/warehouse/categories', title: 'Kategori', desc: 'Kelola kategori', icon: Layers, tone: 'bg-sky-100 text-sky-700 group-hover:bg-sky-700 group-hover:text-white', badge: 0 },
      { href: '/admin/warehouse/suppliers', title: 'Supplier', desc: 'Data vendor', icon: Truck, tone: 'bg-fuchsia-100 text-fuchsia-700 group-hover:bg-fuchsia-700 group-hover:text-white', badge: 0 },
      { href: '/admin/warehouse/inbound/history', title: 'Riwayat PO', desc: 'Monitor daftar PO', icon: Clock, tone: 'bg-amber-100 text-amber-700 group-hover:bg-amber-700 group-hover:text-white', badge: 0 },
      { href: '/admin/warehouse/import', title: 'Import CSV', desc: 'Update massal data', icon: FileSpreadsheet, tone: 'bg-lime-100 text-lime-700 group-hover:bg-lime-700 group-hover:text-white', badge: 0 },
    ];

    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] mb-1">Inventory & Logistics</p>
            <h1 className="text-2xl font-black text-slate-900">Halo, {user?.name}</h1>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Order Actionable</p>
            <p className="text-2xl font-black text-slate-900 mt-1">{summary.pendingOrders}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Chat Belum Dibalas</p>
            <p className="text-2xl font-black text-slate-900 mt-1">{summary.chats}</p>
          </div>
          <div className={`border rounded-2xl p-4 ${summary.outOfStock > 0 ? 'bg-rose-50 border-rose-200' : 'bg-white border-slate-200'}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className={`text-[10px] font-black uppercase tracking-widest ${summary.outOfStock > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                  Notifikasi Barang Habis
                </p>
                <p className={`text-2xl font-black mt-1 ${summary.outOfStock > 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                  {summary.outOfStock}
                </p>
                <p className={`text-[10px] font-bold mt-1 ${summary.outOfStock > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                  {summary.outOfStock > 0 ? 'Perlu restock segera' : 'Semua stok aman'}
                </p>
              </div>
              <AlertTriangle size={18} className={summary.outOfStock > 0 ? 'text-rose-500' : 'text-slate-300'} />
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-[24px] p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Menu Gudang</h3>
            <p className="text-[10px] font-bold text-slate-400">11 modul</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
            {warehouseMenus.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group relative rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 hover:bg-white hover:border-emerald-300 hover:shadow-md transition-all h-full"
                >
                  {Number(item.badge || 0) > 0 && (
                    <span className="absolute top-2 right-2 bg-emerald-600 text-white text-[9px] font-black rounded-full min-w-[18px] h-[18px] px-1.5 inline-flex items-center justify-center leading-none">
                      {Number(item.badge) > 99 ? '99+' : Number(item.badge)}
                    </span>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all ${item.tone}`}>
                      <Icon size={18} />
                    </div>
                    <span className="text-[9px] font-black uppercase tracking-wide text-slate-400 group-hover:text-emerald-700">Buka</span>
                  </div>
                  <h3 className="font-black text-[12px] text-slate-900 leading-snug mt-3">{item.title}</h3>
                  <p className="text-[10px] text-slate-500 mt-1 leading-snug">{item.desc}</p>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    );
  }


  // 4. Super Admin (Existing Palugada View)
  return (
    <div className="p-6 space-y-6">
      <div className="bg-white border border-slate-200 rounded-[24px] p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { href: '/admin', label: 'Overview', icon: LayoutDashboard },
            { href: '/admin/staff/daftar', label: 'Staf', icon: Users },
            { href: '/admin/settings', label: 'Pengaturan', icon: Settings },
            { href: '/admin/audit-log', label: 'Audit', icon: Shield },
            { href: '/admin/chat/broadcast', label: 'Broadcast', icon: Megaphone },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-colors ${active ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
              >
                <Icon size={14} />
                {tab.label}
              </Link>
            );
          })}


        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm">
        <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest">PALUGADA MODE</p>
        <h1 className="text-2xl font-black text-slate-900 mt-1">Owner Takeover Dashboard</h1>
        <p className="text-sm text-slate-600 mt-2">
          Mode Palugada dipakai saat owner perlu turun tangan menggantikan admin yang sedang berhalangan.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="relative h-[122px] md:h-[132px] overflow-hidden rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-3.5 md:p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-amber-700">Order Follow-up</p>
          <p className="text-[30px] leading-none font-black text-amber-800 mt-2">{summary.pendingOrders}</p>
          <p className="text-[10px] text-amber-700/90 mt-1">Butuh tindakan admin.</p>
          <ClipboardList size={48} className="absolute right-3 bottom-3 text-amber-700/15" />
        </div>

        <div className="relative h-[122px] md:h-[132px] overflow-hidden rounded-3xl border border-rose-200 bg-gradient-to-br from-rose-50 to-pink-50 p-3.5 md:p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-rose-700">Piutang Aktif</p>
          <p className="text-[24px] leading-tight font-black text-rose-700 mt-2">Rp {summary.unpaidTotal.toLocaleString()}</p>
          <span className="inline-flex items-center mt-1.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide">
            {summary.unpaid} Item
          </span>
          <Wallet size={48} className="absolute right-3 bottom-3 text-rose-700/15" />
        </div>

        <div className="relative col-span-2 md:col-span-1 h-[122px] md:h-[132px] overflow-hidden rounded-3xl border border-blue-200 bg-gradient-to-br from-blue-50 to-cyan-50 p-3.5 md:p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-blue-700">Chat Masuk</p>
          <p className="text-[30px] leading-none font-black text-blue-700 mt-2">{summary.chats}</p>
          <p className="text-[10px] text-blue-700/90 mt-1">Percakapan perlu dipantau.</p>
          <MessageSquare size={48} className="absolute right-3 bottom-3 text-blue-700/15" />
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex items-start gap-3">
        <AlertTriangle size={18} className="text-amber-600 mt-0.5" />
        <p className="text-sm text-amber-800">
          Saat satu fungsi admin kosong, owner bisa langsung buka modul terkait dari halaman ini tanpa menunggu handover personel.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
        {[
          { href: '/admin/warehouse', title: 'Admin Gudang (Advanced)', desc: 'Dashboard, Kanban, Picker Helper, Alokasi', icon: Warehouse },
          { href: '/admin/warehouse/stok', title: 'Data Grid Inventori', desc: 'Manajemen produk, stok, & update massal', icon: Boxes },
          { href: '/admin/warehouse/inbound/history', title: 'Riwayat Purchase Order', desc: 'Monitor semua daftar pesanan pengadaan', icon: Clock },
          { href: '/admin/finance', title: 'Admin FinanceHub', desc: 'Verifikasi transfer, biaya operasional, AR, Retur', icon: DollarSign },
          { href: '/admin/warehouse/retur', title: 'Manajemen Retur', desc: 'Approve retur, jemput barang, & refund', icon: RotateCcw },
          { href: '/admin/sales', title: 'Manajemen Customer', desc: 'Kelola customer, tier, status blokir, dan poin.', icon: Users },
          { href: '/admin/sales/member-baru', title: 'Daftarkan Member Baru', desc: 'Registrasi customer baru via OTP WhatsApp.', icon: UserCheck },
          { href: '/admin/sales/karyawan', title: 'Daftarkan Karyawan Baru', desc: 'Buat akun karyawan/admin operasional baru.', icon: Shield },
          { href: '/admin/sales/tier-pricing', title: 'Modifikasi Harga Tier', desc: 'Atur diskon tier produk berbasis persentase.', icon: DollarSign },
          { href: '/admin/sales/shipping-methods', title: 'Jenis Pengiriman', desc: 'Kelola opsi pengiriman dan biayanya.', icon: Truck },
          { href: '/admin/sales/discount-vouchers', title: 'Voucher Diskon', desc: 'Atur kode, persen, kuota, dan umur voucher.', icon: Percent },
          { href: '/admin/chat', title: 'Admin CS / Sales', desc: 'Omnichannel inbox & WhatsApp manual order', icon: MessageSquare },
          { href: '/admin/chat/whatsapp', title: 'WhatsApp Bot & OTP', desc: 'Monitor koneksi bot dan validasi OTP.', icon: MessageSquare },
          { href: '/admin/orders/create', title: 'Input Pesanan Manual', desc: 'Input order cepat dari WA/Offline', icon: ClipboardCheck },
          { href: '/admin/staff/daftar', title: 'Manajemen Staf', desc: 'CRUD akun admin/driver', icon: Users },
          { href: '/admin/settings', title: 'Pengaturan Sistem', desc: 'WA bot, poin loyalty, API', icon: Settings },
          { href: '/admin/audit-log', title: 'Audit Log', desc: 'Jejak aktivitas sensitif', icon: Shield },
        ].map((m) => {
          const Icon = m.icon;
          return (
            <Link key={m.href} href={m.href} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:border-emerald-300 transition-colors min-w-0">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                  <Icon size={18} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-black text-slate-900">{m.title}</h3>
                  <p className="text-xs text-slate-600 mt-1">{m.desc}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
