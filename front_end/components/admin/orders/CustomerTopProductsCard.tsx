'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, ShoppingBag } from 'lucide-react';
import Image from 'next/image';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

type ProductOption = {
  id: string;
  sku?: string;
  name?: string;
  image_url?: string;
  stock_quantity?: number | string;
  price?: number | string;
  base_price?: number | string;
  varian_harga?: unknown;
  unit?: string;
  status?: string;
};

type TopProductRow = {
  product?: ProductOption;
  stats?: {
    order_count?: number;
    qty_total?: number;
    last_bought_at?: string | null;
  };
};

const toNumber = (value: unknown) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export default function CustomerTopProductsCard({
  customerId,
  onPick,
  limit = 10,
}: {
  customerId: string;
  onPick: (product: ProductOption) => void;
  limit?: number;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<TopProductRow[]>([]);

  const hasRows = rows.some((row) => row?.product?.id);

  const load = useCallback(async () => {
    if (!customerId) {
      setRows([]);
      setError('');
      return;
    }
    try {
      setLoading(true);
      setError('');
      const res = await api.admin.customers.getTopProducts(customerId, { limit });
      const nextRows = Array.isArray(res.data?.rows) ? (res.data.rows as TopProductRow[]) : [];
      setRows(nextRows);
    } catch (e: unknown) {
      console.error(e);
      const message = typeof e === 'object' && e && 'response' in e
        ? String((e as { response?: { data?: { message?: string } } }).response?.data?.message || '')
        : '';
      setRows([]);
      setError(message || 'Gagal memuat produk langganan customer.');
    } finally {
      setLoading(false);
    }
  }, [customerId, limit]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!active) return;
      await load();
    })();
    return () => {
      active = false;
    };
  }, [load]);

  const visible = useMemo(() => {
    return rows
      .map((row) => ({
        product: row?.product,
        stats: row?.stats,
      }))
      .filter((row) => row.product?.id);
  }, [rows]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="rounded-xl bg-slate-100 p-2 text-slate-600">
            <ShoppingBag size={16} />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Bantuan Cepat</p>
            <h3 className="text-sm font-black text-slate-900">Sering dibeli customer ini</h3>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-60"
          aria-label="Muat ulang"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {loading && (
        <p className="mt-3 text-xs text-slate-500">Memuat...</p>
      )}
      {!loading && error && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {error}
        </div>
      )}
      {!loading && !error && !hasRows && (
        <p className="mt-3 text-xs text-slate-500">Belum ada histori pembelian pada periode default (1 tahun terakhir).</p>
      )}

      {!loading && !error && hasRows && (
        <div className="mt-3 space-y-2 max-h-72 overflow-y-auto pr-1">
          {visible.map((row) => {
            const product = row.product as ProductOption;
            const stats = row.stats || {};
            const stock = toNumber(product.stock_quantity);
            const isOut = Number.isFinite(stock) && stock <= 0;
            const lastAt = stats.last_bought_at ? formatDateTime(stats.last_bought_at) : '-';
            return (
              <div
                key={product.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/40 p-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {product.image_url ? (
                    <Image
                      src={product.image_url}
                      alt={product.name || 'Produk'}
                      width={36}
                      height={36}
                      className="h-9 w-9 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="h-9 w-9 rounded-lg bg-slate-100" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-xs font-black text-slate-900">{product.name || 'Produk'}</p>
                    <p className="text-[10px] text-slate-500">
                      SKU: <span className="font-mono font-bold text-slate-700">{product.sku || '-'}</span>
                      {' '}• Transaksi: <span className="font-black text-slate-700">{toNumber(stats.order_count)}</span>
                      {' '}• Qty: <span className="font-black text-slate-700">{toNumber(stats.qty_total)}</span>
                    </p>
                    <p className="text-[10px] text-slate-500">
                      Terakhir: <span className="font-semibold text-slate-700">{lastAt}</span>
                      {' '}• <span className={`font-black ${isOut ? 'text-rose-700' : 'text-slate-700'}`}>Stok {toNumber(product.stock_quantity)}</span>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onPick(product)}
                  className="btn-3d inline-flex shrink-0 items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white hover:bg-emerald-700"
                >
                  <Plus size={14} />
                  Tambah
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

