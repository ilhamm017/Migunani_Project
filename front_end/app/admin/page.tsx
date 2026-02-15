'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AlertTriangle, Boxes, ClipboardList, DollarSign, FileSpreadsheet, Layers, MessageSquare, ShoppingCart, Users, ClipboardCheck, Settings, Shield, LayoutDashboard, Megaphone, ScanBarcode, UserCheck, Warehouse, Plus, Wallet, Truck, RotateCcw, Percent } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { useAdminActionBadges } from '@/lib/useAdminActionBadges';

export default function AdminOverviewPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'admin_finance', 'kasir', 'driver']);
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuthStore();
  const [summary, setSummary] = useState({ pendingOrders: 0, unpaid: 0, unpaidTotal: 0, chats: 0, outOfStock: 0 });
  const [warehouseCardBadges, setWarehouseCardBadges] = useState<Record<string, number>>({});
  const { financeCardBadges } = useAdminActionBadges({
    enabled: !!allowed && user?.role === 'admin_finance',
    role: user?.role
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

        let actionableCount = 0;
        if (user?.role === 'admin_finance') {
          // Finance tasks: issue invoice, verify transfer, verify COD settlement
          actionableCount = Number(stats.waiting_invoice || 0) + Number(stats.waiting_payment || 0) + Number(stats.delivered || 0);
        } else if (user?.role === 'admin_gudang') {
          // Warehouse tasks: allocate pending, ship ready_to_ship
          actionableCount = Number(stats.pending || 0) + Number(stats.ready_to_ship || 0);
        } else {
          // Super admin / Others: any order that isn't finished or canceled
          actionableCount = Number(stats.pending || 0) + Number(stats.waiting_invoice || 0) + Number(stats.waiting_payment || 0) + Number(stats.delivered || 0);
        }

        let outOfStockCount = 0;
        if (user?.role === 'admin_gudang') {
          const [pendingRes, processingRes, allocatedRes, productsRes, retursRes, auditsRes] = await Promise.all([
            api.admin.orderManagement.getAll({ status: 'pending', limit: 1 }).catch(() => ({ data: { total: 0 } })),
            api.admin.orderManagement.getAll({ status: 'processing', limit: 1 }).catch(() => ({ data: { total: 0 } })),
            api.admin.orderManagement.getAll({ status: 'allocated', limit: 1 }).catch(() => ({ data: { total: 0 } })),
            api.admin.inventory.getProducts({ limit: 100 }).catch(() => ({ data: { products: [] } })),
            api.retur.getAll().catch(() => ({ data: [] })),
            api.admin.inventory.getAudits().catch(() => ({ data: [] })),
          ]);

          const pendingAllocation = Number(pendingRes.data?.total || 0);
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

          setWarehouseCardBadges({
            '/admin/warehouse/allocation': pendingAllocation,
            '/admin/warehouse/pesanan': processingOrders + allocatedOrders + readyToShipOrders,
            '/admin/warehouse/helper': processingOrders,
            '/admin/warehouse/retur': pendingReturActions,
            '/admin/warehouse/audit': openAuditCount,
          });
        } else {
          setWarehouseCardBadges({});
        }

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

  // 2. Finance Admin
  if (user?.role === 'admin_finance') {
    const financeMenus = [
      { href: '/admin/finance/verifikasi', title: 'Verifikasi Bayar', desc: 'Approve/reject bukti transfer.', icon: Shield, tone: 'bg-emerald-100 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white', badge: financeCardBadges.verifyPayment },
      { href: '/admin/finance/biaya', title: 'Biaya Operasional', desc: 'Input dan review pengeluaran.', icon: Plus, tone: 'bg-rose-100 text-rose-600 group-hover:bg-rose-600 group-hover:text-white' },
      { href: '/admin/finance/cod', title: 'Setoran COD', desc: 'Konfirmasi setoran kurir.', icon: Truck, tone: 'bg-blue-100 text-blue-600 group-hover:bg-blue-600 group-hover:text-white', badge: financeCardBadges.codSettlement },
      { href: '/admin/finance/piutang', title: 'Laporan Piutang', desc: 'Aging report invoice aktif.', icon: Wallet, tone: 'bg-amber-100 text-amber-600 group-hover:bg-amber-600 group-hover:text-white' },
      { href: '/admin/finance/retur', title: 'Refund Retur', desc: 'Proses pengembalian dana.', icon: RotateCcw, tone: 'bg-indigo-100 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white', badge: financeCardBadges.refundRetur },
      { href: '/admin/finance/pnl', title: 'Laba Rugi (P&L)', desc: 'Monitor omzet dan profit.', icon: DollarSign, tone: 'bg-slate-100 text-slate-900 group-hover:bg-slate-900 group-hover:text-white' },
      { href: '/admin/finance/biaya/label', title: 'Label Biaya', desc: 'Kelola kategori biaya.', icon: Settings, tone: 'bg-cyan-100 text-cyan-700 group-hover:bg-cyan-700 group-hover:text-white' },
    ];

    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black text-rose-600 uppercase tracking-[0.2em] mb-1">Financial Operations</p>
            <h1 className="text-2xl font-black text-slate-900">Halo, {user?.name}</h1>
          </div>

        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="col-span-2 lg:col-span-1 bg-rose-600 rounded-[28px] p-5 text-white shadow-lg shadow-rose-200 relative overflow-hidden">
            <div className="relative z-10">
              <p className="text-xs font-bold opacity-80 uppercase tracking-wider mb-1">Piutang Belum Lunas</p>
              <h3 className="text-xl md:text-2xl font-black">Rp {summary.unpaidTotal.toLocaleString()}</h3>
              <p className="text-[10px] mt-2 opacity-60">{summary.unpaid} item piutang perlu dikelola.</p>
            </div>
            <Wallet size={80} className="absolute -right-4 -bottom-4 opacity-10" />
          </div>

          <div className="bg-slate-900 rounded-[28px] p-5 text-white shadow-lg shadow-slate-200 relative overflow-hidden">
            <div className="relative z-10">
              <p className="text-xs font-bold opacity-80 uppercase tracking-wider mb-1">Verifikasi Tertunda</p>
              <h3 className="text-2xl md:text-3xl font-black">{summary.pendingOrders}</h3>
              <p className="text-[10px] mt-2 opacity-60">Proses konfirmasi bukti transfer masuk.</p>
            </div>
            <ClipboardCheck size={80} className="absolute -right-4 -bottom-4 opacity-10" />
          </div>

          <div className="bg-white border border-slate-200 rounded-[28px] p-5 shadow-sm flex flex-col justify-center">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 text-center">Profitability</p>
            <Link href="/admin/finance/pnl" className="text-center py-2 px-4 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-black uppercase hover:bg-emerald-100 transition-colors">
              Lihat Laporan P&L
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
          {financeMenus.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="relative bg-white border border-slate-100 rounded-2xl p-4 hover:shadow-lg transition-all group flex items-start gap-3 shadow-sm h-full"
              >
                {Number(item.badge || 0) > 0 && (
                  <span className="absolute top-2 right-2 bg-emerald-600 text-white text-[9px] font-black rounded-full min-w-[18px] h-[18px] px-1.5 inline-flex items-center justify-center leading-none">
                    {Number(item.badge) > 99 ? '99+' : Number(item.badge)}
                  </span>
                )}
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all ${item.tone}`}>
                  <Icon size={20} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-black text-[13px] text-slate-900 leading-snug">{item.title}</h3>
                  <p className="hidden sm:block text-[11px] text-slate-500 mt-1 leading-snug">{item.desc}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  // 3. Warehouse Admin
  if (user?.role === 'admin_gudang') {
    const warehouseMenus = [
      { href: '/admin/warehouse/stok', title: 'Data Inventori', desc: 'Kelola stok produk', icon: Boxes, tone: 'bg-emerald-100 text-emerald-700 group-hover:bg-emerald-700 group-hover:text-white' },
      { href: '/admin/warehouse/allocation', title: 'Alokasi Order', desc: 'Alokasi stok pesanan', icon: ClipboardCheck, tone: 'bg-orange-100 text-orange-700 group-hover:bg-orange-700 group-hover:text-white', badge: warehouseCardBadges['/admin/warehouse/allocation'] || 0 },
      { href: '/admin/warehouse/pesanan', title: 'Kanban Pesanan', desc: 'Pantau alur order', icon: ClipboardList, tone: 'bg-blue-100 text-blue-700 group-hover:bg-blue-700 group-hover:text-white', badge: warehouseCardBadges['/admin/warehouse/pesanan'] || 0 },
      { href: '/admin/warehouse/retur', title: 'Retur Barang', desc: 'Validasi retur masuk', icon: RotateCcw, tone: 'bg-violet-100 text-violet-700 group-hover:bg-violet-700 group-hover:text-white', badge: warehouseCardBadges['/admin/warehouse/retur'] || 0 },
      { href: '/admin/warehouse/helper', title: 'Picker Helper', desc: 'Picking list gudang', icon: UserCheck, tone: 'bg-indigo-100 text-indigo-700 group-hover:bg-indigo-700 group-hover:text-white', badge: warehouseCardBadges['/admin/warehouse/helper'] || 0 },
      { href: '/admin/warehouse/inbound', title: 'Inbound / PO', desc: 'Stok masuk supplier', icon: ShoppingCart, tone: 'bg-teal-100 text-teal-700 group-hover:bg-teal-700 group-hover:text-white', badge: 0 },
      { href: '/admin/warehouse/audit', title: 'Stock Opname', desc: 'Audit stok fisik', icon: Shield, tone: 'bg-rose-100 text-rose-700 group-hover:bg-rose-700 group-hover:text-white', badge: warehouseCardBadges['/admin/warehouse/audit'] || 0 },
      { href: '/admin/warehouse/scanner', title: 'Scanner SKU', desc: 'Scan barcode cepat', icon: ScanBarcode, tone: 'bg-cyan-100 text-cyan-700 group-hover:bg-cyan-700 group-hover:text-white', badge: 0 },
      { href: '/admin/warehouse/categories', title: 'Kategori', desc: 'Kelola kategori', icon: Layers, tone: 'bg-sky-100 text-sky-700 group-hover:bg-sky-700 group-hover:text-white', badge: 0 },
      { href: '/admin/warehouse/suppliers', title: 'Supplier', desc: 'Data vendor', icon: Truck, tone: 'bg-fuchsia-100 text-fuchsia-700 group-hover:bg-fuchsia-700 group-hover:text-white', badge: 0 },
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

      <div className="grid grid-flow-col grid-rows-2 auto-cols-[minmax(240px,1fr)] gap-3 overflow-x-auto pb-1">
        {[
          { href: '/admin/warehouse', title: 'Admin Gudang (Advanced)', desc: 'Dashboard, Kanban, Picker Helper, Alokasi', icon: Warehouse },
          { href: '/admin/warehouse/stok', title: 'Data Grid Inventori', desc: 'Manajemen produk, stok, & update massal', icon: Boxes },
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
            <Link key={m.href} href={m.href} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:border-emerald-300 transition-colors">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                  <Icon size={18} />
                </div>
                <div>
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
