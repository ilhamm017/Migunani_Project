'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AlertTriangle, Boxes, ChevronDown, ClipboardList, DollarSign, FileSpreadsheet, Layers, MessageSquare, ShoppingCart, Users, Settings, Shield, LayoutDashboard, Megaphone, ScanBarcode, UserCheck, Warehouse, Plus, Wallet, Truck, RotateCcw, Percent, CheckCircle, Clock, TrendingUp, FileText } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { useAdminActionBadges } from '@/lib/useAdminActionBadges';
import { useOrderStatusNotifications } from '@/lib/useOrderStatusNotifications';
import { formatOrderStatusLabel } from '@/lib/orderStatusMeta';
import FinanceHeader from '@/components/admin/finance/FinanceHeader';
import BalanceCard from '@/components/admin/finance/BalanceCard';
import FinanceBottomNav from '@/components/admin/finance/FinanceBottomNav';

type DashboardArRow = { amount_due?: number | string | null };
type DashboardCodRow = { total_pending?: number | string | null };
type DashboardProductRow = { stock_quantity?: number | string | null };
type DashboardAuditRow = { status?: string | null };
type DashboardReturRow = { status?: string | null; admin_response?: string | null };

export default function AdminOverviewPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'admin_finance', 'kasir', 'driver']);
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuthStore();
  const canUseOrderNotifications = ['super_admin', 'admin_gudang', 'admin_finance', 'kasir'].includes(String(user?.role || ''));

  // General Summary State
  const [summary, setSummary] = useState({ pendingOrders: 0, unpaid: 0, unpaidTotal: 0, chats: 0, outOfStock: 0 });

  // Warehouse Badges State
  const [warehouseCardBadges, setWarehouseCardBadges] = useState<Record<string, number>>({});

  // Finance Badges & Stats State
  const { orderBadgeCount, financeCardBadges } = useAdminActionBadges({
    enabled: !!allowed && canUseOrderNotifications,
    role: user?.role
  });

  const [financeStats, setFinanceStats] = useState({
    pendingVerify: 0,
    pendingCod: 0,
    pendingExpense: 0,
    cashBalance: 0
  });
  const [collapsedFeatureSections, setCollapsedFeatureSections] = useState<Record<string, boolean>>({
    'Logistics & Inventory': true,
    'Sales & Customer': true,
    'Finance & Accounts': true,
    'System & Security': true,
  });
  const {
    newTaskCount: incomingTaskCount,
    latestEvents: latestOrderEvents,
    priorityCards,
    markSeen: markNotificationsSeen,
    activeToast,
    dismissToast,
  } = useOrderStatusNotifications({
    enabled: !!allowed && canUseOrderNotifications,
    role: user?.role,
    userId: user?.id,
  });

  useEffect(() => {
    const load = async () => {
      try {
        const canReadAR = ['super_admin', 'admin_finance'].includes(String(user?.role || ''));
        const [statsRes, arData, chatRes] = await Promise.all([
          api.admin.orderManagement.getStats(),
          canReadAR
            ? api.admin.finance
              .getAR()
              .then((res) => (Array.isArray(res.data) ? (res.data as DashboardArRow[]) : []))
              .catch((): DashboardArRow[] => [])
            : Promise.resolve<DashboardArRow[]>([]),
          api.chat.getSessions(),
        ]);

        const stats = statsRes.data || {};
        const pendingAllocCount = Number(stats.pending || 0);

        let actionableCount = 0;
        if (user?.role === 'admin_finance') {
          // Finance tasks: verify transfer, verify COD settlement
          actionableCount = Number(stats.waiting_admin_verification || 0) + Number(stats.delivered || 0);

          // --- Fetch Additional Finance Specific Stats ---
          // 1. Pending Verification (waiting_admin_verification)
          // 2. Pending COD
          const resCod = await api.admin.finance.getDriverCodList();
          let codCount = 0;
          if (Array.isArray(resCod.data)) {
            codCount = (resCod.data as DashboardCodRow[]).filter((d) => Number(d.total_pending || 0) > 0).length;
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
          // Warehouse tasks: ship ready_to_ship + follow-up shortage (hold)
          actionableCount = Number(stats.ready_to_ship || 0) + Number(stats.hold || 0);
        } else if (user?.role === 'kasir') {
          // Kasir tasks: allocate pending orders + issue invoice
          actionableCount = pendingAllocCount + Number(stats.waiting_invoice || 0);
        } else {
          // Super admin / Others: actionable admin tasks only (exclude customer-action statuses).
          actionableCount =
            pendingAllocCount +
            Number(stats.waiting_invoice || 0) +
            Number(stats.ready_to_ship || 0) +
            Number(stats.waiting_admin_verification || 0) +
            Number(stats.delivered || 0) +
            Number(stats.allocated || 0) +
            Number(stats.partially_fulfilled || 0) +
            Number(stats.shipped || 0) +
            Number(stats.hold || 0);
        }

        let outOfStockCount = 0;
        const newWarehouseBadges: Record<string, number> = {};

        // Badges for Kasir (Allocation)
        if (user?.role === 'kasir' || user?.role === 'super_admin') {
          newWarehouseBadges['/admin/warehouse/allocation'] = pendingAllocCount;
        }

        if (user?.role === 'admin_gudang' || user?.role === 'super_admin') {
          const [processingRes, allocatedRes, productsRes, auditsRes] = await Promise.all([
            api.admin.orderManagement.getAll({ status: 'waiting_admin_verification', limit: 1 }).catch(() => ({ data: { total: 0 } })),
            api.admin.orderManagement.getAll({ status: 'allocated', limit: 1 }).catch(() => ({ data: { total: 0 } })),
            api.admin.inventory.getProducts({ limit: 100 }).catch(() => ({ data: { products: [] } })),
            api.admin.inventory.getAudits().catch(() => ({ data: [] })),
          ]);

          const processingOrders = Number(processingRes.data?.total || 0);
          const allocatedOrders = Number(allocatedRes.data?.total || 0);
          const readyToShipOrders = Number(stats.ready_to_ship || 0);

          const products = Array.isArray(productsRes.data?.products) ? (productsRes.data.products as DashboardProductRow[]) : [];
          outOfStockCount = products.filter((p) => Number(p.stock_quantity || 0) <= 0).length;

          const audits = Array.isArray(auditsRes.data) ? (auditsRes.data as DashboardAuditRow[]) : [];
          const openAuditCount = audits.filter((audit) => String(audit?.status || '').toLowerCase() === 'open').length;

          // Merge updates
          Object.assign(newWarehouseBadges, {
            '/admin/warehouse/allocation': pendingAllocCount, // Explicitly set again to be sure
            '/admin/warehouse/pesanan': processingOrders + allocatedOrders + readyToShipOrders,
            '/admin/warehouse/helper': processingOrders,
            '/admin/warehouse/audit': openAuditCount,
            '/admin/warehouse/driver-issues': Number(stats.hold || 0),
          });
        }

        if (user?.role === 'kasir' || user?.role === 'super_admin') {
          const retursRes = await api.retur.getAll().catch(() => ({ data: [] }));
          const returs = Array.isArray(retursRes.data) ? (retursRes.data as DashboardReturRow[]) : [];
          const pendingReturActions = returs.filter((r) => {
            const status = String(r?.status || '').toLowerCase();
            const hasAdminResponse = String(r?.admin_response || '').trim().length > 0;
            return status === 'pending' && !hasAdminResponse;
          }).length;
          newWarehouseBadges['/admin/warehouse/retur'] = pendingReturActions;
        }

        setWarehouseCardBadges(newWarehouseBadges);

        setSummary({
          pendingOrders: actionableCount,
          unpaid: arData.length,
          unpaidTotal: arData.reduce((sum: number, row) => sum + Number(row.amount_due || 0), 0),
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

  const latestOrderStatusLabel = latestOrderEvents[0] ? formatOrderStatusLabel(latestOrderEvents[0].to_status) : '-';
  const displayOrderNotificationCount = Math.max(0, Math.max(incomingTaskCount, orderBadgeCount));
  const priorityStatusMessage = priorityCards[0]?.description || (latestOrderStatusLabel !== '-' ? `Status terbaru: ${latestOrderStatusLabel}` : '');
  const priorityNotificationMessage = displayOrderNotificationCount > 0
    ? incomingTaskCount > 0
      ? [`${displayOrderNotificationCount} tugas perlu ditindak.`, priorityStatusMessage].filter(Boolean).join(' ')
      : `${displayOrderNotificationCount} tugas perlu ditindak saat ini.`
    : 'Belum ada tugas baru.';



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
        href: '/admin/warehouse/retur',
        title: 'Kelola Retur Barang',
        desc: 'Validasi retur, tugaskan pickup, dan lanjutkan proses barang kembali.',
        icon: RotateCcw,
        tone: 'bg-violet-100 text-violet-700 group-hover:bg-violet-700 group-hover:text-white',
        badge: warehouseCardBadges['/admin/warehouse/retur'] || 0
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
        href: '/admin/invoices',
        title: 'Invoice Customer',
        desc: 'Pantau invoice aktif dan sisa tagihan customer.',
        icon: FileText,
        tone: 'bg-rose-100 text-rose-700 group-hover:bg-rose-700 group-hover:text-white',
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
      {
        href: '/admin/finance/laporan/backorder',
        title: 'Laporan Backorder / Preorder',
        desc: 'Pantau stok yang kurang untuk segera di-restock.',
        icon: ClipboardList,
        tone: 'bg-orange-100 text-orange-700 group-hover:bg-orange-700 group-hover:text-white',
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

        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Notifikasi Prioritas</p>
              <p className="text-xs font-semibold text-blue-700 mt-1">
                {priorityNotificationMessage}
              </p>
            </div>
            <button
              type="button"
              onClick={markNotificationsSeen}
              className="px-3 py-2 rounded-xl text-[10px] font-black uppercase border border-blue-300 text-blue-700 bg-white hover:bg-blue-100"
            >
              Tandai Dilihat
            </button>
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
                  className="group relative rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 transition-all h-full hover:bg-white hover:border-emerald-300 hover:shadow-md"
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

        {activeToast && (
          <button
            type="button"
            onClick={dismissToast}
            className="fixed right-4 bottom-24 z-50 max-w-[320px] rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-left shadow-lg"
          >
            <p className="text-[11px] font-black uppercase tracking-widest text-emerald-700">Update Pesanan</p>
            <p className="text-xs font-semibold text-emerald-700 mt-1">{activeToast}</p>
          </button>
        )}
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
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Notifikasi Prioritas</p>
                <p className="text-xs font-semibold text-blue-700 mt-1">
                  {priorityNotificationMessage}
                </p>
              </div>
              <button
                type="button"
                onClick={markNotificationsSeen}
                className="px-3 py-2 rounded-xl text-[10px] font-black uppercase border border-blue-300 text-blue-700 bg-white hover:bg-blue-100"
              >
                Tandai Dilihat
              </button>
            </div>
          </div>

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
                    <p className="text-xs text-slate-500 mt-0.5">{financeCardBadges.verifyPayment} pesanan menunggu</p>
                  </div>
                  <div className="bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-full">
                    Review
                  </div>
                </div>
              </Link>

              {/* Task 2: Terima Setoran COD */}
              <Link href="/admin/finance/cod" className="block relative bg-white border border-slate-100 rounded-2xl p-4 shadow-sm active:scale-95 transition-transform overflow-hidden group hover:border-emerald-300">
                {financeCardBadges.codSettlement > 0 && (
                  <span className="absolute top-3 right-3 bg-rose-600 text-white text-[9px] font-black rounded-full min-w-[18px] h-[18px] px-1.5 flex items-center justify-center leading-none shadow-sm z-10 animate-bounce">
                    {financeCardBadges.codSettlement}
                  </span>
                )}
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center group-hover:bg-amber-100 transition-colors">
                    <Wallet size={24} />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-slate-900 text-sm">Terima Setoran COD</h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {financeCardBadges.codSettlement > 0
                        ? `${financeCardBadges.codSettlement} order menunggu settlement`
                        : 'Semua setoran beres'}
                    </p>
                  </div>
                  <div className="bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-sm group-hover:bg-emerald-700 transition-colors">
                    Settle
                  </div>
                </div>
              </Link>

              <Link href="/admin/finance/retur" className="block bg-white border border-slate-100 rounded-2xl p-4 shadow-sm active:scale-95 transition-transform">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <RotateCcw size={24} />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-slate-900 text-sm">Refund Retur</h4>
                    <p className="text-xs text-slate-500 mt-0.5">{financeCardBadges.refundRetur} retur menunggu tindak lanjut</p>
                  </div>
                  <div className="bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-full">
                    Proses
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
        {activeToast && (
          <button
            type="button"
            onClick={dismissToast}
            className="fixed right-4 bottom-24 z-50 max-w-[320px] rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-left shadow-lg"
          >
            <p className="text-[11px] font-black uppercase tracking-widest text-emerald-700">Update Pesanan</p>
            <p className="text-xs font-semibold text-emerald-700 mt-1">{activeToast}</p>
          </button>
        )}
      </div>
    );
  }

  // 3. Warehouse Admin
  if (user?.role === 'admin_gudang') {
    const warehouseMenus = [
      { href: '/admin/warehouse/stok', title: 'Data Inventori', desc: 'Kelola stok produk', icon: Boxes, tone: 'bg-emerald-100 text-emerald-700 group-hover:bg-emerald-700 group-hover:text-white' },
      // Allocation moved to Sales

      { href: '/admin/warehouse/pesanan', title: 'Kanban Pesanan', desc: 'Pantau alur order', icon: ClipboardList, tone: 'bg-blue-100 text-blue-700 group-hover:bg-blue-700 group-hover:text-white', badge: warehouseCardBadges['/admin/warehouse/pesanan'] || 0 },
      { href: '/admin/warehouse/driver-issues', title: 'Laporan Driver', desc: 'Follow-up barang kurang', icon: AlertTriangle, tone: 'bg-violet-100 text-violet-700 group-hover:bg-violet-700 group-hover:text-white', badge: warehouseCardBadges['/admin/warehouse/driver-issues'] || 0 },
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

        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Notifikasi Prioritas</p>
              <p className="text-xs font-semibold text-blue-700 mt-1">
                {priorityNotificationMessage}
              </p>
            </div>
            <button
              type="button"
              onClick={markNotificationsSeen}
              className="px-3 py-2 rounded-xl text-[10px] font-black uppercase border border-blue-300 text-blue-700 bg-white hover:bg-blue-100"
            >
              Tandai Dilihat
            </button>
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
            <p className="text-[10px] font-bold text-slate-400">{warehouseMenus.length} modul</p>
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

        {activeToast && (
          <button
            type="button"
            onClick={dismissToast}
            className="fixed right-4 bottom-24 z-50 max-w-[320px] rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-left shadow-lg"
          >
            <p className="text-[11px] font-black uppercase tracking-widest text-emerald-700">Update Pesanan</p>
            <p className="text-xs font-semibold text-emerald-700 mt-1">{activeToast}</p>
          </button>
        )}
      </div>
    );
  }


  const compactCurrency = new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 });
  const quickActionCards = [
    { href: '/admin/finance/verifikasi', title: 'Verifikasi Transfer', desc: 'Validasi transfer customer.', icon: CheckCircle, badge: financeCardBadges.verifyPayment, tone: 'bg-emerald-100 text-emerald-700 group-hover:bg-emerald-700 group-hover:text-white' },
    { href: '/admin/finance/cod', title: 'Settlement COD', desc: 'Setoran driver menunggu proses.', icon: Wallet, badge: financeCardBadges.codSettlement, tone: 'bg-amber-100 text-amber-700 group-hover:bg-amber-700 group-hover:text-white' },
    { href: '/admin/finance/retur', title: 'Refund Retur', desc: 'Pengembalian dana retur.', icon: RotateCcw, badge: financeCardBadges.refundRetur, tone: 'bg-indigo-100 text-indigo-700 group-hover:bg-indigo-700 group-hover:text-white' },
    { href: '/admin/finance/biaya', title: 'Cairkan Expense', desc: 'Pengajuan biaya operasional.', icon: DollarSign, badge: financeStats.pendingExpense, tone: 'bg-blue-100 text-blue-700 group-hover:bg-blue-700 group-hover:text-white' },
    { href: '/admin/warehouse/pesanan', title: 'Kanban Pesanan', desc: 'Pantau alur pesanan gudang.', icon: ClipboardList, badge: warehouseCardBadges['/admin/warehouse/pesanan'] || 0, tone: 'bg-sky-100 text-sky-700 group-hover:bg-sky-700 group-hover:text-white' },
    { href: '/admin/warehouse/helper', title: 'Picker Helper', desc: 'Bantu proses picking barang.', icon: UserCheck, badge: warehouseCardBadges['/admin/warehouse/helper'] || 0, tone: 'bg-violet-100 text-violet-700 group-hover:bg-violet-700 group-hover:text-white' },
    { href: '/admin/warehouse/driver-issues', title: 'Laporan Driver', desc: 'Follow-up barang kurang.', icon: AlertTriangle, badge: warehouseCardBadges['/admin/warehouse/driver-issues'] || 0, tone: 'bg-rose-100 text-rose-700 group-hover:bg-rose-700 group-hover:text-white' },
    { href: '/admin/chat', title: 'Customer Chat', desc: 'Inbox customer lintas channel.', icon: MessageSquare, badge: summary.chats, tone: 'bg-cyan-100 text-cyan-700 group-hover:bg-cyan-700 group-hover:text-white' },
    { href: '/admin/warehouse/retur', title: 'Retur Barang', desc: 'Verifikasi retur produk.', icon: RotateCcw, badge: warehouseCardBadges['/admin/warehouse/retur'] || 0, tone: 'bg-fuchsia-100 text-fuchsia-700 group-hover:bg-fuchsia-700 group-hover:text-white' },
  ];
  const featureCategories = [
    {
      group: 'Logistics & Inventory',
      tone: 'text-blue-600 bg-blue-50 border-blue-100',
      menus: [
        { href: '/admin/warehouse', title: 'Dashboard Gudang', desc: 'Kanban, picker, alokasi.', icon: Warehouse },
        { href: '/admin/warehouse/stok', title: 'Data Inventori', desc: 'Stok dan produk.', icon: Boxes },
        { href: '/admin/warehouse/pesanan', title: 'Kanban Pesanan', desc: 'Pantau alur order.', icon: ClipboardList, badge: warehouseCardBadges['/admin/warehouse/pesanan'] || 0 },
        { href: '/admin/warehouse/helper', title: 'Picker Helper', desc: 'Picking list gudang.', icon: UserCheck, badge: warehouseCardBadges['/admin/warehouse/helper'] || 0 },
        { href: '/admin/warehouse/driver-issues', title: 'Laporan Driver', desc: 'Follow-up barang kurang.', icon: AlertTriangle, badge: warehouseCardBadges['/admin/warehouse/driver-issues'] || 0 },
        { href: '/admin/warehouse/retur', title: 'Retur Barang', desc: 'Proses barang retur.', icon: RotateCcw, badge: warehouseCardBadges['/admin/warehouse/retur'] || 0 },
        { href: '/admin/warehouse/audit', title: 'Stock Opname', desc: 'Audit stok fisik.', icon: Shield, badge: warehouseCardBadges['/admin/warehouse/audit'] || 0 },
        { href: '/admin/warehouse/scanner', title: 'Scanner SKU', desc: 'Scan barcode cepat.', icon: ScanBarcode },
        { href: '/admin/warehouse/categories', title: 'Kategori Produk', desc: 'Kelola grouping produk.', icon: Layers },
        { href: '/admin/warehouse/suppliers', title: 'Data Supplier', desc: 'Vendor dan mitra.', icon: Truck },
        { href: '/admin/warehouse/inbound', title: 'Inbound / PO', desc: 'Input stok masuk.', icon: ShoppingCart },
        { href: '/admin/warehouse/inbound/history', title: 'Riwayat PO', desc: 'Monitor pengadaan.', icon: Clock },
        { href: '/admin/warehouse/import', title: 'Import CSV', desc: 'Update massal data.', icon: FileSpreadsheet },
      ]
    },
    {
      group: 'Sales & Customer',
      tone: 'text-emerald-600 bg-emerald-50 border-emerald-100',
      menus: [
        { href: '/admin/sales', title: 'Daftar Customer', desc: 'Tier, blokir, poin.', icon: Users },
        { href: '/admin/sales/member-baru', title: 'Register Member', desc: 'Onboarding WA OTP.', icon: UserCheck },
        { href: '/admin/orders/create', title: 'Input Order', desc: 'Manual order entry.', icon: Plus },
        { href: '/admin/orders', title: 'Monitor Order', desc: 'Kontrol order aktif.', icon: ClipboardList },
        { href: '/admin/invoices', title: 'Invoice Customer', desc: 'Daftar invoice customer aktif.', icon: FileText },
        { href: '/admin/orders/issues', title: 'Issue Pesanan', desc: 'Kendala order di lapangan.', icon: AlertTriangle },
        { href: '/admin/chat', title: 'Customer Chat', desc: 'Inbox customer support.', icon: MessageSquare, badge: summary.chats },
        { href: '/admin/chat/broadcast', title: 'Broadcast Chat', desc: 'Kirim pesan massal.', icon: Megaphone },
        { href: '/admin/chat/whatsapp', title: 'WA Engine', desc: 'Status bot dan OTP.', icon: MessageSquare },
        { href: '/admin/sales/tier-pricing', title: 'Pricing Master', desc: 'Atur harga tier.', icon: DollarSign },
        { href: '/admin/sales/discount-vouchers', title: 'Promosi & Voucher', desc: 'Kupon diskon sistem.', icon: Percent },
        { href: '/admin/sales/shipping-methods', title: 'Metode Kirim', desc: 'Pilihan dan biaya kirim.', icon: Truck },
        { href: '/admin/sales/karyawan', title: 'Regis Karyawan', desc: 'Pendaftaran user internal.', icon: Shield },
        { href: '/admin/finance/laporan/backorder', title: 'Laporan Backorder', desc: 'Pantau stok kurang.', icon: ClipboardList },
      ]
    },
    {
      group: 'Finance & Accounts',
      tone: 'text-amber-600 bg-amber-50 border-amber-100',
      menus: [
        { href: '/admin/finance', title: 'FinanceHub', desc: 'Verifikasi dan pengeluaran.', icon: DollarSign },
        { href: '/admin/finance/verifikasi', title: 'Verifikasi Transfer', desc: 'Validasi pembayaran transfer.', icon: CheckCircle, badge: financeCardBadges.verifyPayment },
        { href: '/admin/finance/cod', title: 'Settlement COD', desc: 'Terima setoran driver.', icon: Wallet, badge: financeCardBadges.codSettlement },
        { href: '/admin/finance/retur', title: 'Refund Retur', desc: 'Klaim balik dan refund.', icon: RotateCcw, badge: financeCardBadges.refundRetur },
        { href: '/admin/finance/biaya', title: 'Biaya Operasional', desc: 'Pengajuan dan pencairan.', icon: Clock, badge: financeStats.pendingExpense },
        { href: '/admin/finance/piutang', title: 'Piutang (AR)', desc: 'Monitor tagihan aktif.', icon: Wallet },
        { href: '/admin/finance/credit-note', title: 'Credit Note', desc: 'Koreksi nota kredit.', icon: FileText },
        { href: '/admin/finance/laporan', title: 'Laporan Keuangan', desc: 'PnL, neraca, cashflow.', icon: TrendingUp },
        { href: '/admin/finance/pnl', title: 'Quick PnL', desc: 'Ringkasan laba rugi.', icon: TrendingUp },
        { href: '/admin/finance/jurnal/adjustment', title: 'Jurnal Manual', desc: 'Koreksi data akuntansi.', icon: FileText },
      ]
    },
    {
      group: 'System & Security',
      tone: 'text-indigo-600 bg-indigo-50 border-indigo-100',
      menus: [
        { href: '/admin/staff/daftar', title: 'Akun Staf', desc: 'CRUD admin dan driver.', icon: Users },
        { href: '/admin/staff/tambah', title: 'Tambah Staf', desc: 'Buat akun operasional.', icon: UserCheck },
        { href: '/admin/settings', title: 'System Settings', desc: 'WhatsApp, API, loyalty.', icon: Settings },
        { href: '/admin/audit-log', title: 'Security Audit', desc: 'Log aktivitas detail.', icon: Shield },
        { href: '/admin/profile', title: 'Profil Saya', desc: 'Data akun personal.', icon: Users },
      ]
    }
  ];
  const toggleFeatureSection = (group: string) => {
    setCollapsedFeatureSections((prev) => ({
      ...prev,
      [group]: !prev[group],
    }));
  };

  // 4. Super Admin (Enhanced + Mobile Friendly Dashboard)
  return (
    <div className="p-4 max-[360px]:p-3 sm:p-6 pb-20 space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Quick Tabs & Navigation */}
      <div className="bg-white/80 backdrop-blur-md border border-slate-200 sticky top-[calc(var(--admin-header-height,72px)+1px)] z-20 rounded-xl sm:rounded-2xl p-1.5 sm:p-2 shadow-sm">
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-1">
          {[
            { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
            { href: '/admin/staff/daftar', label: 'Manajemen Staf', icon: Users },
            { href: '/admin/settings', label: 'Pengaturan', icon: Settings },
            { href: '/admin/audit-log', label: 'Audit Log', icon: Shield },
            { href: '/admin/chat/broadcast', label: 'Broadcast', icon: Megaphone },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex-1 min-w-[115px] max-[360px]:min-w-[48%] inline-flex items-center justify-center gap-1.5 sm:gap-2 px-2.5 max-[360px]:px-2 sm:px-3 py-2 max-[360px]:py-1.5 sm:py-2.5 rounded-lg sm:rounded-xl text-[11px] max-[360px]:text-[10px] sm:text-xs font-black transition-all ${active
                  ? 'bg-slate-900 text-white shadow-lg shadow-slate-200 scale-[1.02]'
                  : 'text-slate-500 hover:bg-slate-100'
                  }`}
              >
                <Icon size={13} />
                {tab.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Header Welcome Card */}
      <div className="relative overflow-hidden bg-slate-900 rounded-[24px] sm:rounded-[32px] p-5 max-[360px]:p-4 sm:p-8 text-white shadow-2xl shadow-slate-200">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-2.5 sm:px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 mb-3 sm:mb-4">
            <Shield size={11} fill="currentColor" />
            <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest">Super Admin Mode</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-black tracking-tight leading-tight">
            Selamat Datang, <span className="text-emerald-400">{user?.name?.split(' ')[0]}</span>.
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-2.5 sm:mt-3 leading-relaxed font-medium">
            Akses penuh ke seluruh ekosistem Migunani. Pantau operasional, kelola keuangan, dan kendalikan inventori dari satu pusat kendali.
          </p>
        </div>
        <div className="absolute top-0 right-0 w-44 h-44 sm:w-64 sm:h-64 bg-emerald-500/10 blur-[100px] -mr-24 sm:-mr-32 -mt-24 sm:-mt-32 rounded-full" />
        <div className="absolute bottom-0 left-0 w-32 h-32 sm:w-48 sm:h-48 bg-blue-500/10 blur-[80px] -ml-14 sm:-ml-24 -mb-14 sm:-mb-24 rounded-full" />
      </div>

      {/* Mobile Metrics */}
      <div className="grid grid-cols-3 gap-2 max-[360px]:gap-1.5 sm:hidden">
        <Link href="/admin/orders" className="rounded-2xl border border-slate-200 bg-white p-3 max-[360px]:p-2.5 shadow-sm">
          <p className="text-[9px] font-black uppercase tracking-wide text-slate-400">Tindakan</p>
          <p className="text-lg max-[360px]:text-base leading-none font-black text-slate-900 mt-1.5">{summary.pendingOrders}</p>
          <p className="text-[9px] text-amber-700 font-black uppercase mt-1">Order</p>
        </Link>
        <Link href="/admin/invoices" className="rounded-2xl border border-slate-200 bg-white p-3 max-[360px]:p-2.5 shadow-sm">
          <p className="text-[9px] font-black uppercase tracking-wide text-slate-400">Piutang</p>
          <p className="text-sm max-[360px]:text-[11px] leading-none font-black text-slate-900 mt-2">Rp {compactCurrency.format(summary.unpaidTotal)}</p>
          <p className="text-[9px] text-rose-700 font-black uppercase mt-1">{summary.unpaid} invoice</p>
        </Link>
        <Link href="/admin/chat" className="rounded-2xl border border-slate-200 bg-white p-3 max-[360px]:p-2.5 shadow-sm">
          <p className="text-[9px] font-black uppercase tracking-wide text-slate-400">Chat</p>
          <p className="text-lg max-[360px]:text-base leading-none font-black text-slate-900 mt-1.5">{summary.chats}</p>
          <p className="text-[9px] text-blue-700 font-black uppercase mt-1">Pending</p>
        </Link>
      </div>

      {/* Desktop Metrics */}
      <div className="hidden sm:grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link href="/admin/orders" className="group relative overflow-hidden bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm hover:border-amber-300 hover:shadow-xl hover:shadow-amber-100 transition-all">
          <div className="flex justify-between items-start">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center group-hover:scale-110 group-hover:rotate-3 transition-transform">
              <ClipboardList size={24} />
            </div>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest group-hover:text-amber-600 transition-colors">Pending Orders</span>
          </div>
          <div className="mt-4">
            <p className="text-4xl font-black text-slate-900">{summary.pendingOrders}</p>
            <p className="text-xs text-slate-500 mt-1 font-bold">Perlu Tindakan Admin</p>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-50 flex items-center justify-between">
            <span className="text-[10px] font-black text-amber-700 uppercase">Input & Alokasi</span>
            <span className="text-slate-300 group-hover:text-amber-600 translate-x-0 group-hover:translate-x-1 transition-all">→</span>
          </div>
        </Link>

        <Link href="/admin/invoices" className="group relative overflow-hidden bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm hover:border-rose-300 hover:shadow-xl hover:shadow-rose-100 transition-all">
          <div className="flex justify-between items-start">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center group-hover:scale-110 group-hover:-rotate-3 transition-transform">
              <Wallet size={24} />
            </div>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest group-hover:text-rose-600 transition-colors">Total Piutang</span>
          </div>
          <div className="mt-4">
            <p className="text-3xl font-black text-slate-900">Rp {summary.unpaidTotal.toLocaleString()}</p>
            <p className="text-xs text-slate-500 mt-1 font-bold">{summary.unpaid} Invoice Aktif</p>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-50 flex items-center justify-between">
            <span className="text-[10px] font-black text-rose-700 uppercase">Accounts Receivable</span>
            <span className="text-slate-300 group-hover:text-rose-600 translate-x-0 group-hover:translate-x-1 transition-all">→</span>
          </div>
        </Link>

        <Link href="/admin/chat" className="group relative overflow-hidden bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm hover:border-blue-300 hover:shadow-xl hover:shadow-blue-100 transition-all">
          <div className="flex justify-between items-start">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:scale-110 group-hover:rotate-6 transition-transform">
              <MessageSquare size={24} />
            </div>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest group-hover:text-blue-600 transition-colors">Chat Pending</span>
          </div>
          <div className="mt-4">
            <p className="text-4xl font-black text-slate-900">{summary.chats}</p>
            <p className="text-xs text-slate-500 mt-1 font-bold">Butuh Balasan Segera</p>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-50 flex items-center justify-between">
            <span className="text-[10px] font-black text-blue-700 uppercase">Customer Support</span>
            <span className="text-slate-300 group-hover:text-blue-600 translate-x-0 group-hover:translate-x-1 transition-all">→</span>
          </div>
        </Link>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Notifikasi Prioritas</p>
            <p className="text-xs font-semibold text-blue-700 mt-1">
              {priorityNotificationMessage}
            </p>
          </div>
          <button
            type="button"
            onClick={markNotificationsSeen}
            className="px-3 py-2 rounded-xl text-[10px] font-black uppercase border border-blue-300 text-blue-700 bg-white hover:bg-blue-100 w-full sm:w-auto"
          >
            Tandai Dilihat
          </button>
        </div>
      </div>

      {/* All Admin Cards in One Place */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] sm:text-xs font-black text-slate-500 uppercase tracking-[0.16em]">Aksi Cepat Lintas Admin</h3>
          <p className="text-[10px] font-bold text-slate-400">{quickActionCards.length} modul</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 sm:gap-3">
          {quickActionCards.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={`${item.href}-${item.title}`}
                href={item.href}
                className="group relative rounded-2xl border border-slate-200 bg-white p-3 max-[360px]:p-2.5 sm:p-4 shadow-sm hover:border-emerald-300 hover:shadow-md transition-all min-h-[130px] max-[360px]:min-h-[120px] sm:min-h-[150px]"
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
                <h3 className="font-black text-[11px] sm:text-xs text-slate-900 leading-snug mt-2.5">{item.title}</h3>
                <p className="text-[10px] text-slate-500 mt-1 leading-snug max-[360px]:hidden">{item.desc}</p>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Main Feature Categories */}
      <div className="space-y-6 sm:space-y-8">
        {featureCategories.map((category) => (
          <div key={category.group} className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className={`inline-flex items-center gap-2 px-3 sm:px-4 py-1.5 rounded-2xl border ${category.tone}`}>
                <span className="text-[10px] sm:text-xs font-black uppercase tracking-widest">{category.group}</span>
              </div>
              <button
                type="button"
                onClick={() => toggleFeatureSection(category.group)}
                className="sm:hidden inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-[10px] font-black uppercase tracking-wide text-slate-600"
              >
                {collapsedFeatureSections[category.group] ? 'Buka' : 'Tutup'}
                <ChevronDown
                  size={13}
                  className={`transition-transform ${collapsedFeatureSections[category.group] ? 'rotate-0' : 'rotate-180'}`}
                />
              </button>
            </div>
            <div
              className={`${collapsedFeatureSections[category.group] ? 'hidden sm:grid' : 'grid'} grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-2.5 max-[360px]:gap-1.5 sm:gap-3`}
            >
              {category.menus.map((m) => {
                const Icon = m.icon;
                return (
                  <Link
                    key={`${category.group}-${m.href}-${m.title}`}
                    href={m.href}
                    className="group relative p-3 max-[360px]:p-2.5 sm:p-4 bg-white border border-slate-200 rounded-2xl shadow-sm hover:border-emerald-300 hover:shadow-lg transition-all"
                  >
                    {Number(m.badge || 0) > 0 && (
                      <span className="absolute top-2 right-2 bg-emerald-600 text-white text-[9px] font-black rounded-full min-w-[18px] h-[18px] px-1.5 inline-flex items-center justify-center leading-none">
                        {Number(m.badge) > 99 ? '99+' : Number(m.badge)}
                      </span>
                    )}
                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-slate-50 text-slate-600 flex items-center justify-center mb-2.5 group-hover:bg-emerald-600 group-hover:text-white transition-all">
                      <Icon size={17} />
                    </div>
                    <h3 className="text-[11px] sm:text-xs font-black text-slate-900 leading-tight">{m.title}</h3>
                    <p className="text-[10px] text-slate-500 mt-1 leading-tight hidden sm:block">{m.desc}</p>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer Disclaimer */}
      <div className="text-center pt-4 sm:pt-8 pb-4 sm:pb-6">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Migunani Advanced Admin v2.1 • Owner Control Mode</p>
      </div>
    </div>
  );
}
