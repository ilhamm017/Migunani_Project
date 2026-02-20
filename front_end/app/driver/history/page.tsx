'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { MapPin, FileText, Camera, CreditCard, X } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

const paymentMethodLabel = (method?: string) => {
  if (method === 'transfer_manual') return 'Transfer Manual';
  if (method === 'cod') return 'COD';
  if (method === 'cash_store') return 'Tunai Toko';
  return method || '-';
};

const paymentStatusLabel = (status?: string) => {
  if (status === 'unpaid') return 'Belum Lunas';
  if (status === 'cod_pending') return 'COD Pending';
  if (status === 'paid') return 'Lunas';
  return status || '-';
};

const normalizeProofImageUrl = (raw?: string | null) => {
  if (!raw) return null;
  const val = String(raw).trim();
  if (!val) return null;
  if (val.startsWith('http://') || val.startsWith('https://')) return val;
  if (val.startsWith('/uploads/')) return val;
  if (val.startsWith('uploads/')) return `/${val}`;
  const normalizedSlash = val.replace(/\\/g, '/');
  if (normalizedSlash.startsWith('uploads/')) return `/${normalizedSlash}`;
  const uploadsIndex = normalizedSlash.indexOf('/uploads/');
  if (uploadsIndex >= 0) return normalizedSlash.slice(uploadsIndex);
  return val;
};

const toTimestamp = (value: unknown): number => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const summarizeNames = (names: string[]): string => {
  if (names.length === 0) return 'Customer';
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1} lainnya`;
};

type HistoryFilter = 'all' | 'today' | 'week';
const FILTER_OPTIONS: HistoryFilter[] = ['all', 'today', 'week'];

type DriverHistoryOrder = {
  id?: string;
  status?: string;
  updatedAt?: string;
  createdAt?: string;
  customer_name?: string;
  shipping_address?: string;
  customer_note?: string;
  delivery_proof_url?: string | null;
  total_amount?: number | string;
  payment_method?: string;
  invoice_id?: string;
  invoice_number?: string;
  Invoice?: {
    id?: string;
    invoice_number?: string;
    payment_method?: string;
    payment_status?: string;
    total?: number | string;
  };
  Customer?: {
    name?: string;
  };
  OrderItems?: Array<{
    Product?: {
      name?: string;
    };
  }>;
};

export default function DriverHistoryPage() {
  const allowed = useRequireRoles(['driver', 'super_admin', 'admin_gudang']);
  const [rows, setRows] = useState<DriverHistoryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<HistoryFilter>('today');
  const [zoomImageUrl, setZoomImageUrl] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const params: { status: string; startDate?: string; endDate?: string } = { status: 'delivered,completed' };

        const now = new Date();
        if (filter === 'today') {
          params.startDate = now.toISOString();
          params.endDate = now.toISOString();
        } else if (filter === 'week') {
          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 7);
          params.startDate = weekAgo.toISOString();
          params.endDate = now.toISOString();
        }

        const res = await api.driver.getOrders(params);
        setRows(Array.isArray(res.data) ? res.data : []);
      } catch (error) {
        console.error('Failed to load driver history:', error);
      } finally {
        setLoading(false);
      }
    };
    if (allowed) load();
  }, [allowed, filter]);

  const invoiceGroups = useMemo(() => {
    const grouped = new Map<string, {
      key: string;
      invoiceId: string;
      invoiceNumber: string;
      paymentMethod: string;
      paymentStatus: string;
      invoiceTotal: number;
      latestAt: number;
      orders: DriverHistoryOrder[];
    }>();

    rows.forEach((row) => {
      const invoiceId = String(row?.Invoice?.id || row?.invoice_id || '').trim();
      const invoiceNumber = String(row?.Invoice?.invoice_number || row?.invoice_number || '').trim();
      const key = invoiceId || invoiceNumber || `order-${String(row?.id || '').trim()}`;
      const latestAt = toTimestamp(row?.updatedAt || row?.createdAt);

      const bucket = grouped.get(key) || {
        key,
        invoiceId: '',
        invoiceNumber: '',
        paymentMethod: '',
        paymentStatus: '',
        invoiceTotal: 0,
        latestAt: 0,
        orders: [],
      };

      bucket.orders.push(row);
      bucket.latestAt = Math.max(bucket.latestAt, latestAt);
      if (!bucket.invoiceId && invoiceId) bucket.invoiceId = invoiceId;
      if (!bucket.invoiceNumber && invoiceNumber) bucket.invoiceNumber = invoiceNumber;

      const paymentMethod = String(row?.Invoice?.payment_method || row?.payment_method || '').trim();
      const paymentStatus = String(row?.Invoice?.payment_status || '').trim();
      if (!bucket.paymentMethod && paymentMethod) bucket.paymentMethod = paymentMethod;
      if (!bucket.paymentStatus && paymentStatus) bucket.paymentStatus = paymentStatus;

      const invoiceTotal = Number(row?.Invoice?.total || 0);
      if (invoiceTotal > 0) bucket.invoiceTotal = invoiceTotal;

      grouped.set(key, bucket);
    });

    return Array.from(grouped.values())
      .map((bucket) => {
        const orders = [...bucket.orders].sort((a, b) => {
          return toTimestamp(b?.updatedAt || b?.createdAt) - toTimestamp(a?.updatedAt || a?.createdAt);
        });

        const customerNames = Array.from(new Set(
          orders
            .map((order) => String(order?.Customer?.name || order?.customer_name || '').trim())
            .filter(Boolean)
        ));
        const addresses = Array.from(new Set(
          orders
            .map((order) => String(order?.shipping_address || '').trim())
            .filter(Boolean)
        ));
        const notes = Array.from(new Set(
          orders
            .map((order) => String(order?.customer_note || '').trim())
            .filter(Boolean)
        ));
        const proofs = Array.from(new Set(
          orders
            .map((order) => normalizeProofImageUrl(order?.delivery_proof_url))
            .filter(Boolean)
        )) as string[];

        const itemNames: string[] = [];
        orders.forEach((order) => {
          const items = Array.isArray(order?.OrderItems) ? order.OrderItems : [];
          items.forEach((item) => {
            const name = String(item?.Product?.name || '').trim();
            if (name) itemNames.push(name);
          });
        });
        const uniqueItemNames = Array.from(new Set(itemNames));
        const orderIds = orders
          .map((order) => String(order?.id || '').trim())
          .filter(Boolean);
        const orderRefs = orderIds.map((id) => `#${id.slice(-6).toUpperCase()}`);
        const totalAmount = Number.isFinite(Number(bucket.invoiceTotal))
          ? Number(bucket.invoiceTotal)
          : 0;
        const allCompleted = orders.every((order) => String(order?.status || '').toLowerCase() === 'completed');

        return {
          ...bucket,
          orders,
          customerLabel: summarizeNames(customerNames),
          address: addresses[0] || '',
          customerNote: notes[0] || '',
          deliveryProofUrl: proofs[0] || null,
          proofCount: proofs.length,
          itemNames: uniqueItemNames,
          itemCount: uniqueItemNames.length,
          orderRefs,
          orderCount: orderRefs.length,
          totalAmount,
          allCompleted,
        };
      })
      .sort((a, b) => b.latestAt - a.latestAt);
  }, [rows]);

  const totalOrdersInGroups = useMemo(
    () => invoiceGroups.reduce((acc, group) => acc + group.orderCount, 0),
    [invoiceGroups]
  );

  if (!allowed) return null;

  return (
    <div className="p-6 pb-24 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black text-slate-900">Riwayat Pengiriman</h1>
        <div className="flex gap-2">
          {FILTER_OPTIONS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase transition-colors ${filter === f
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
            >
              {f === 'all' ? 'Semua' : f === 'today' ? 'Hari Ini' : 'Minggu Ini'}
            </button>
          ))}
        </div>
      </div>

      {/* Mini Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl">
          <p className="text-[10px] uppercase font-bold text-emerald-600 mb-1">Total Invoice</p>
          <p className="text-2xl font-black text-emerald-800">{invoiceGroups.length}</p>
        </div>
        <div className="bg-white border border-slate-200 p-4 rounded-2xl">
          <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Total Order</p>
          <p className="text-2xl font-black text-slate-800">
            {totalOrdersInGroups}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {loading ? (
          <p className="text-center text-xs text-slate-400 py-10">Memuat data...</p>
        ) : invoiceGroups.length === 0 ? (
          <div className="text-center py-10 opacity-50">
            <p className="text-sm font-bold text-slate-500">Belum ada riwayat.</p>
            <p className="text-xs text-slate-400">Coba ubah filter waktu.</p>
          </div>
        ) : (
          invoiceGroups.map((group) => {
            const date = new Date(group.latestAt || Date.now());
            const dateStr = date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
            const timeStr = date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
            const paymentMethod = String(group.paymentMethod || '').trim();
            const paymentStatus = String(group.paymentStatus || '').trim();
            const invoiceNumber = String(group.invoiceNumber || '').trim();
            const totalAmount = Number(group.totalAmount || 0);
            const address = String(group.address || '').trim();
            const customerNote = String(group.customerNote || '').trim();
            const deliveryProofUrl = normalizeProofImageUrl(group.deliveryProofUrl);
            const labelRef = invoiceNumber || group.invoiceId || group.orderRefs[0] || '';

            return (
              <div key={group.key} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full uppercase tracking-wider">
                      {labelRef || 'INVOICE'}
                    </span>
                    <h3 className="text-sm font-bold text-slate-900 mt-1.5">{group.customerLabel}</h3>
                    <p className="text-[10px] text-slate-500 mt-1">
                      {group.orderCount} order: {group.orderRefs.join(', ')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-slate-900">{dateStr}</p>
                    <p className="text-[10px] text-slate-400">{timeStr}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-slate-600 mb-3">
                  <div className="flex items-center gap-2">
                    <CreditCard size={12} className="text-slate-400" />
                    <span className="font-bold text-slate-700">Metode:</span>
                    <span>{paymentMethodLabel(paymentMethod)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-700">Status:</span>
                    <span>{paymentStatusLabel(paymentStatus)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-700">Total:</span>
                    <span>{formatCurrency(totalAmount)}</span>
                  </div>
                  {invoiceNumber && (
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-700">Invoice:</span>
                      <span>{invoiceNumber}</span>
                    </div>
                  )}
                  {address && (
                    <div className="md:col-span-2 flex items-start gap-2">
                      <MapPin size={12} className="text-slate-400 mt-0.5" />
                      <span className="font-bold text-slate-700">Alamat:</span>
                      <span className="line-clamp-2">{address}</span>
                    </div>
                  )}
                  {customerNote && (
                    <div className="md:col-span-2 flex items-start gap-2">
                      <FileText size={12} className="text-slate-400 mt-0.5" />
                      <span className="font-bold text-slate-700">Catatan:</span>
                      <span className="line-clamp-2">{customerNote}</span>
                    </div>
                  )}
                  {deliveryProofUrl && (
                    <div className="md:col-span-2 flex items-center gap-2">
                      <Camera size={12} className="text-slate-400" />
                      <span className="font-bold text-slate-700">Bukti:</span>
                      <button
                        type="button"
                        onClick={() => setZoomImageUrl(deliveryProofUrl)}
                        className="inline-flex items-center gap-2 text-emerald-700 font-bold"
                      >
                        Lihat foto
                      </button>
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-50 pt-3 flex justify-between items-center">
                  <div className="flex -space-x-2">
                    {group.itemNames.slice(0, 3).map((name, idx) => (
                      <div key={`${group.key}-${idx}`} className="w-6 h-6 rounded-full bg-slate-200 border border-white flex items-center justify-center text-[8px] font-bold text-slate-500 overflow-hidden" title={name}>
                        {name.charAt(0) || '?'}
                      </div>
                    ))}
                    {group.itemCount > 3 && (
                      <div className="w-6 h-6 rounded-full bg-slate-100 border border-white flex items-center justify-center text-[8px] font-bold text-slate-400">
                        +{group.itemCount - 3}
                      </div>
                    )}
                  </div>
                  <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-lg ${group.allCompleted
                    ? 'bg-slate-100 text-slate-600'
                    : 'bg-emerald-100 text-emerald-700'
                    }`}>
                    {group.allCompleted ? 'Selesai (Final)' : 'Terkirim'}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {zoomImageUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-4 flex items-center justify-center"
          onClick={() => setZoomImageUrl('')}
          role="presentation"
        >
          <button
            type="button"
            onClick={() => setZoomImageUrl('')}
            className="absolute top-4 right-4 text-white bg-black/40 rounded-full p-2"
            aria-label="Tutup preview bukti"
          >
            <X size={18} />
          </button>
          <img
            src={zoomImageUrl}
            alt="Preview bukti pengiriman"
            className="max-w-[95vw] max-h-[90vh] object-contain rounded-2xl"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
