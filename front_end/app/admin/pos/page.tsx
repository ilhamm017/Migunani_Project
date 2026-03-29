'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Minus, Plus, Printer, Search, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency } from '@/lib/utils';

type CartLine = {
  product_id: string;
  sku: string;
  name: string;
  unit: string;
  stock_quantity: number;
  base_price: number;
  price: number;
  category_id?: number | string;
  Category?: { id: number; name?: string } | null;
  varian_harga?: unknown;
  qty: number;
  unit_price_override?: number;
  discount_pct_input?: string;
  unit_price_override_input?: string;
  line_total_override_input?: string;
};

type CustomerPick = {
  id: string;
  name: string;
  whatsapp_number?: string | null;
  email?: string | null;
  tier?: string | null;
};

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (v: number) => Math.round(v * 100) / 100;

type CategoryTierDiscountRow = {
  id: number;
  name?: string;
  discount_regular_pct: number | null;
  discount_gold_pct: number | null;
  discount_premium_pct: number | null;
};

const toObjectOrEmpty = (value: unknown): Record<string, unknown> => {
  if (!value) return {};
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
};

const toFiniteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const clampPercentage = (value: number): number => {
  return Math.min(100, Math.max(0, value));
};

const formatIdrNumber = (value: unknown): string => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '';
  const normalized = Math.max(0, Math.trunc(parsed));
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(normalized);
};

const parseIdrInput = (raw: string): number | null => {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  if (!digits) return null;
  const parsed = Number(digits);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.trunc(parsed));
};

export default function AdminPosPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir']);
  const router = useRouter();

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [searchText, setSearchText] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);

  const [note, setNote] = useState('');
  const [discountPercent, setDiscountPercent] = useState<number>(0);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [amountReceived, setAmountReceived] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const customerInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerPick | null>(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const [customerSearchError, setCustomerSearchError] = useState('');
  const [customerResults, setCustomerResults] = useState<CustomerPick[]>([]);
  const [categoryDiscountById, setCategoryDiscountById] = useState<Map<number, CategoryTierDiscountRow>>(new Map());

  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickWhatsapp, setQuickWhatsapp] = useState('');
  const [quickSubmitting, setQuickSubmitting] = useState(false);
  const [quickError, setQuickError] = useState('');

  const btn3dBase = 'btn-3d disabled:opacity-60';
  const btn3dPrimary = `${btn3dBase} bg-emerald-600 hover:bg-emerald-700 text-white`;
  const btn3dNeutral = `${btn3dBase} bg-white border border-slate-200 text-slate-700 hover:bg-slate-50`;

  const selectedTier = useMemo(() => {
    const raw = String(selectedCustomer?.tier || 'regular').trim().toLowerCase();
    if (raw === 'premium') return 'platinum';
    if (raw === 'platinum' || raw === 'gold' || raw === 'regular') return raw;
    return 'regular';
  }, [selectedCustomer?.tier]);

  const getProductRegularUnitPrice = useCallback((line: Pick<CartLine, 'price' | 'varian_harga'>): number => {
    const variant = toObjectOrEmpty(line.varian_harga);
    const prices = toObjectOrEmpty(variant.prices);
    const candidates: unknown[] = [
      line.price,
      prices.regular,
      variant.regular,
      prices.base_price,
      variant.base_price,
    ];

    for (const candidate of candidates) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed) && parsed > 0) return Math.max(0, parsed);
    }

    const fallback = Number(line.price || 0);
    return Number.isFinite(fallback) ? Math.max(0, fallback) : 0;
  }, []);

  const getCategoryDiscountPct = useCallback((line: Pick<CartLine, 'Category' | 'category_id'>, tier: string): number | null => {
    const categoryIdRaw = (line.Category && typeof line.Category === 'object')
      ? (line.Category as { id?: unknown }).id
      : line.category_id;
    const categoryId = Number(categoryIdRaw);
    if (!Number.isInteger(categoryId) || categoryId <= 0) return null;
    const category = categoryDiscountById.get(categoryId);
    if (!category) return null;
    if (tier === 'platinum') return category.discount_premium_pct;
    if (tier === 'gold') return category.discount_gold_pct;
    if (tier === 'regular') return category.discount_regular_pct;
    return null;
  }, [categoryDiscountById]);

  const getProductPrice = useCallback((line: Pick<CartLine, 'price' | 'varian_harga' | 'Category' | 'category_id'>, tier: string): number => {
    const effectiveBasePrice = getProductRegularUnitPrice(line);
    const variant = toObjectOrEmpty(line.varian_harga);
    const prices = toObjectOrEmpty(variant.prices);

    if (tier === 'regular') {
      const discounts = toObjectOrEmpty(variant.discounts_pct);
      const discountCandidates: unknown[] = [
        discounts.regular,
        toObjectOrEmpty(variant.regular).discount_pct,
        variant.regular_discount_pct,
      ];
      for (const raw of discountCandidates) {
        const discountPct = toFiniteNumber(raw);
        if (discountPct === null || discountPct <= 0 || discountPct > 100) continue;
        return Math.max(0, Math.round((effectiveBasePrice * (1 - discountPct / 100)) * 100) / 100);
      }

      const categoryPct = getCategoryDiscountPct(line, tier);
      if (categoryPct !== null && categoryPct > 0) {
        return Math.max(0, Math.round((effectiveBasePrice * (1 - categoryPct / 100)) * 100) / 100);
      }
      return effectiveBasePrice;
    }

    const aliases = tier === 'platinum' ? ['premium'] : [];
    const directCandidates: unknown[] = [
      variant[tier],
      prices[tier],
      toObjectOrEmpty(variant[tier]).price
    ];
    for (const alias of aliases) {
      directCandidates.push(variant[alias], prices[alias], toObjectOrEmpty(variant[alias]).price);
    }
    for (const candidate of directCandidates) {
      const directPrice = toFiniteNumber(candidate);
      if (directPrice !== null && directPrice > 0) return Math.max(0, directPrice);
    }

    const discounts = toObjectOrEmpty(variant.discounts_pct);
    const discountCandidates: unknown[] = [
      discounts[tier],
      toObjectOrEmpty(variant[tier]).discount_pct,
      variant[`${tier}_discount_pct`]
    ];
    for (const alias of aliases) {
      discountCandidates.push(discounts[alias], toObjectOrEmpty(variant[alias]).discount_pct, variant[`${alias}_discount_pct`]);
    }
    for (const discountRaw of discountCandidates) {
      const discountPct = toFiniteNumber(discountRaw);
      if (discountPct === null || discountPct <= 0 || discountPct > 100) continue;
      return Math.max(0, Math.round((effectiveBasePrice * (1 - discountPct / 100)) * 100) / 100);
    }

    const categoryPct = getCategoryDiscountPct(line, tier);
    if (categoryPct !== null && categoryPct > 0) {
      return Math.max(0, Math.round((effectiveBasePrice * (1 - categoryPct / 100)) * 100) / 100);
    }

    return effectiveBasePrice;
  }, [getCategoryDiscountPct, getProductRegularUnitPrice]);

  const subtotal = useMemo(() => round2(cart.reduce((sum, line) => {
    const normalUnit = getProductPrice(line, selectedTier);
    const unitPrice = Number.isFinite(line.unit_price_override) ? Number(line.unit_price_override) : normalUnit;
    return sum + (unitPrice * line.qty);
  }, 0)), [cart, getProductPrice, selectedTier]);

  const discountAmountEst = useMemo(() => {
    const pct = Math.min(100, Math.max(0, Number(discountPercent || 0)));
    return round2(subtotal * (pct / 100));
  }, [discountPercent, subtotal]);

  const subtotalAfterDiscountEst = useMemo(() => round2(Math.max(0, subtotal - discountAmountEst)), [subtotal, discountAmountEst]);
  const underpayEst = useMemo(
    () => cart.length > 0 && Number(amountReceived || 0) < Number(subtotalAfterDiscountEst || 0),
    [amountReceived, cart.length, subtotalAfterDiscountEst]
  );

  const addToCart = useCallback((product: any) => {
    const productId = String(product?.id || '').trim();
    if (!productId) return;

    const nextLine: CartLine = {
      product_id: productId,
      sku: String(product?.sku || '').trim() || '-',
      name: String(product?.name || '').trim() || 'Produk',
      unit: String(product?.unit || 'Pcs'),
      stock_quantity: n(product?.stock_quantity),
      base_price: n(product?.base_price),
      price: n(product?.price),
      category_id: (product as any)?.category_id,
      Category: (product as any)?.Category ?? null,
      varian_harga: (product as any)?.varian_harga,
      qty: 1,
    };

    setCart((prev) => {
      const idx = prev.findIndex((p) => p.product_id === productId);
      if (idx < 0) return [...prev, nextLine];
      const existing = prev[idx]!;
      const nextQty = existing.qty + 1;
      return prev.map((row, i) => i === idx ? { ...row, qty: nextQty } : row);
    });
  }, []);

  const handleSelectSearchResult = useCallback((product: any) => {
    addToCart(product);
    setSearchText('');
    setSearchResults([]);
    setSearchError('');
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [addToCart]);

  useEffect(() => {
    if (!allowed) return;
    searchInputRef.current?.focus();
  }, [allowed]);

  useEffect(() => {
    if (!allowed) return;
    const q = searchText.trim();
    if (!q) {
      setSearchResults([]);
      setSearchError('');
      return;
    }

    const handle = window.setTimeout(async () => {
      try {
        setSearchLoading(true);
        setSearchError('');
        const res = await api.admin.inventory.getProducts({ search: q, page: 1, limit: 10, status: 'active', sort_by: 'stock_desc' });
        const payload = res.data || {};
        const rows = Array.isArray(payload.products) ? payload.products : [];
        const sorted = rows.slice().sort((a: any, b: any) => {
          const qtyA = Number(a?.stock_quantity || 0);
          const qtyB = Number(b?.stock_quantity || 0);
          const safeA = Number.isFinite(qtyA) ? qtyA : 0;
          const safeB = Number.isFinite(qtyB) ? qtyB : 0;
          if (safeA !== safeB) return safeB - safeA;
          return String(a?.name || '').localeCompare(String(b?.name || ''));
        });
        setSearchResults(sorted);
      } catch (e: unknown) {
        const message = typeof e === 'object' && e && 'response' in e
          ? String((e as any).response?.data?.message || '')
          : '';
        setSearchError(message || 'Gagal mencari produk.');
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => window.clearTimeout(handle);
  }, [allowed, searchText]);

  useEffect(() => {
    if (!allowed) return;
    const q = customerQuery.trim();
    if (!q) {
      setCustomerResults([]);
      setCustomerSearchError('');
      return;
    }

    const handle = window.setTimeout(async () => {
      try {
        setCustomerSearchLoading(true);
        setCustomerSearchError('');
        const res = await api.admin.customers.search(q, { status: 'active', limit: 10 });
        const payload = res.data || {};
        const rows = Array.isArray(payload.customers) ? payload.customers : [];
	      setCustomerResults(rows
	        .map((c: any) => ({
	          id: String(c?.id || ''),
	          name: String(c?.name || ''),
	          whatsapp_number: c?.whatsapp_number ?? null,
	          email: c?.email ?? null,
	          tier: (c as any)?.CustomerProfile?.tier ?? null,
	        }))
	        .filter((c: CustomerPick) => Boolean(c.id && c.name)));
      } catch (e: unknown) {
        const message = typeof e === 'object' && e && 'response' in e
          ? String((e as any).response?.data?.message || '')
          : '';
        setCustomerSearchError(message || 'Gagal mencari customer.');
      } finally {
        setCustomerSearchLoading(false);
      }
    }, 300);

    return () => window.clearTimeout(handle);
  }, [allowed, customerQuery]);

  useEffect(() => {
    const loadCategoryDiscounts = async () => {
      if (!allowed) return;
      try {
        const res = await api.admin.inventory.getCategories();
        const rows = Array.isArray(res.data?.categories) ? (res.data.categories as unknown[]) : [];
        const next = new Map<number, CategoryTierDiscountRow>();

        const toNullablePct = (value: unknown): number | null => {
          const parsed = Number(value);
          if (!Number.isFinite(parsed)) return null;
          if (parsed < 0 || parsed > 100) return null;
          return parsed;
        };

        for (const row of rows) {
          const record = (row && typeof row === 'object' && !Array.isArray(row)) ? (row as Record<string, unknown>) : null;
          if (!record) continue;
          const id = Number(record.id);
          if (!Number.isInteger(id) || id <= 0) continue;
          next.set(id, {
            id,
            name: typeof record.name === 'string' ? record.name : undefined,
            discount_regular_pct: toNullablePct(record.discount_regular_pct),
            discount_gold_pct: toNullablePct(record.discount_gold_pct),
            discount_premium_pct: toNullablePct(record.discount_premium_pct),
          });
        }

        setCategoryDiscountById(next);
      } catch {
        setCategoryDiscountById(new Map());
      }
    };

    void loadCategoryDiscounts();
  }, [allowed]);

  const handleSelectCustomer = useCallback((c: CustomerPick) => {
    setSelectedCustomer(c);
    setCustomerQuery('');
    setCustomerResults([]);
    setCustomerSearchError('');
    window.setTimeout(() => customerInputRef.current?.focus(), 0);
  }, []);

  const openQuickCreate = useCallback((prefillName?: string) => {
    setQuickError('');
    setQuickName(String(prefillName || '').trim());
    setQuickWhatsapp('');
    setQuickCreateOpen(true);
  }, []);

  const updateQty = (productId: string, delta: number) => {
    setCart((prev) => prev
      .map((row) => row.product_id === productId ? { ...row, qty: Math.max(1, row.qty + delta), line_total_override_input: undefined } : row)
      .filter((row) => row.qty > 0));
  };

  const removeLine = (productId: string) => {
    setCart((prev) => prev.filter((row) => row.product_id !== productId));
  };

  const updateDealUnitInput = (productId: string, raw: string, fallbackNormalUnit: number) => {
    const parsed = parseIdrInput(raw);
    setCart((prev) => prev.map((row) => {
      if (row.product_id !== productId) return row;
      if (raw.trim() === '') {
        const { unit_price_override, discount_pct_input, unit_price_override_input, line_total_override_input, ...rest } = row;
        return { ...rest, discount_pct_input: undefined, unit_price_override_input: undefined, line_total_override_input: undefined } as CartLine;
      }
      return {
        ...row,
        unit_price_override_input: raw,
        unit_price_override: parsed === null ? (Number.isFinite(row.unit_price_override) ? row.unit_price_override : fallbackNormalUnit) : parsed,
        discount_pct_input: '',
        line_total_override_input: undefined,
      };
    }));
  };

  const updateDiscountPctInput = (productId: string, raw: string, regularUnit: number) => {
    setCart((prev) => prev.map((row) => {
      if (row.product_id !== productId) return row;
      if (raw === '') return { ...row, discount_pct_input: '' };
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return { ...row, discount_pct_input: raw };
      const pct = clampPercentage(parsed);
      if (!(regularUnit > 0)) return { ...row, discount_pct_input: String(pct) };
      const nextUnit = Math.max(0, Math.round(regularUnit * (1 - pct / 100)));
      return {
        ...row,
        discount_pct_input: String(pct),
        unit_price_override: nextUnit > 0 ? nextUnit : row.unit_price_override,
        unit_price_override_input: undefined,
        line_total_override_input: undefined,
      };
    }));
  };

  const updateLineTotalInput = (productId: string, raw: string, qty: number, fallbackNormalUnit: number) => {
    const parsed = parseIdrInput(raw);
    const qtySafe = Math.max(1, Math.trunc(Number(qty || 1)));
    setCart((prev) => prev.map((row) => {
      if (row.product_id !== productId) return row;
      if (raw.trim() === '') {
        const { unit_price_override, discount_pct_input, unit_price_override_input, line_total_override_input, ...rest } = row;
        return { ...rest, discount_pct_input: undefined, unit_price_override_input: undefined, line_total_override_input: undefined } as CartLine;
      }
      const safeTotal = parsed === null ? 0 : parsed;
      const nextUnit = Math.max(0, Math.round(safeTotal / qtySafe));
      return {
        ...row,
        line_total_override_input: raw,
        unit_price_override: nextUnit > 0 ? nextUnit : (Number.isFinite(row.unit_price_override) ? row.unit_price_override : fallbackNormalUnit),
        discount_pct_input: '',
        unit_price_override_input: undefined,
      };
    }));
  };

  const handleSubmit = async (options?: { print: boolean }) => {
    const shouldPrint = !!options?.print;
    try {
      setSubmitting(true);
      setSubmitError('');
      setSearchError('');

      if (cart.length === 0) {
        setSubmitError('Keranjang kosong.');
        return;
      }

      if (Number(amountReceived || 0) < Number(subtotalAfterDiscountEst || 0) && !selectedCustomer?.id) {
        setSubmitError('Transaksi hutang: wajib pilih customer yang terdaftar.');
        return;
      }

      const payload = {
        customer_id: selectedCustomer?.id || undefined,
        note: note.trim() || undefined,
        discount_percent: Math.min(100, Math.max(0, Number(discountPercent || 0))) || undefined,
        amount_received: Number(amountReceived || 0),
        items: cart.map((row) => {
          const normalUnit = getProductPrice(row, selectedTier);
          const override = Number.isFinite(row.unit_price_override) ? Number(row.unit_price_override) : null;
          return {
            product_id: row.product_id,
            qty: row.qty,
            ...(override !== null && Math.abs(override - normalUnit) > 0.0001 ? { unit_price_override: override } : {}),
          };
        }),
      };

      const res = await api.admin.pos.createSale(payload);
      const id = String(res.data?.id || '').trim();
      if (!id) {
        setSubmitError('Transaksi tersimpan, tapi response id kosong.');
        return;
      }
      setCart([]);
      setAmountReceived(0);
      setSelectedCustomer(null);
      setCustomerQuery('');
      setCustomerResults([]);
      setNote('');
      setDiscountPercent(0);

      if (shouldPrint) {
        const printUrl = `/admin/pos/${encodeURIComponent(id)}/print?autoPrint=1`;
        router.push(printUrl);
        return;
      }

      router.push(`/admin/pos/${encodeURIComponent(id)}`);
    } catch (e: unknown) {
      const message = typeof e === 'object' && e && 'response' in e
        ? String((e as any).response?.data?.message || '')
        : '';
      setSubmitError(message || 'Gagal menyimpan transaksi POS.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin" className="p-2 hover:bg-slate-100 rounded-full text-slate-600">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-black text-slate-900">POS Kasir</h1>
          <p className="text-slate-500 text-sm">Transaksi eceran offline + keluar barang otomatis</p>
        </div>
        <div className="ml-auto">
          <div className="flex items-center gap-2">
            <Link
              href="/admin/pos/history"
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wide ${btn3dNeutral}`}
            >
              Riwayat
            </Link>
            <Link
              href="/admin/pos"
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wide ${btn3dNeutral}`}
              onClick={() => searchInputRef.current?.focus()}
            >
              <Printer size={14} />
              Fokus Cari
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white border border-slate-200 rounded-3xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500">
              <Search size={14} />
              Cari Produk
	            </div>
	            <div className="relative">
	              <input
	                ref={searchInputRef}
	                value={searchText}
	                onChange={(e) => setSearchText(e.target.value)}
	                placeholder="Ketik nama / SKU..."
	                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
	              />
	              {searchResults.length > 0 ? (
	                <div className="absolute z-20 mt-2 w-full divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden max-h-72 overflow-y-auto">
	                  {searchResults.map((p, idx) => (
	                    <button
	                      key={String(p?.id || p?.sku || idx)}
	                      type="button"
	                      onClick={() => handleSelectSearchResult(p)}
	                      className="w-full text-left px-4 py-3 hover:bg-slate-50"
	                    >
	                      <div className="flex items-center justify-between gap-3">
	                        <div>
	                          <p className="text-sm font-black text-slate-900">{String(p?.name || 'Produk')}</p>
	                          <p className="text-[11px] text-slate-500">SKU: {String(p?.sku || '-')} • Stok: {String(p?.stock_quantity ?? '-')}</p>
	                        </div>
	                        <div className="text-sm font-black text-slate-900">{formatCurrency(n(p?.price))}</div>
	                      </div>
	                    </button>
	                  ))}
	                </div>
	              ) : null}
	            </div>
	            {searchLoading ? <p className="text-xs text-slate-500">Mencari...</p> : null}
	            {searchError ? <p className="text-xs text-rose-600">{searchError}</p> : null}
	          </div>

          <div className="bg-white border border-slate-200 rounded-3xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-500">Keranjang</p>
                <p className="text-sm text-slate-500">Total item: {cart.reduce((sum, r) => sum + r.qty, 0)}</p>
              </div>
              <button
                type="button"
                onClick={() => setCart([])}
                disabled={cart.length === 0}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-700 disabled:opacity-60"
              >
                <Trash2 size={14} />
                Clear
              </button>
            </div>

            {cart.length === 0 ? (
              <p className="text-sm text-slate-500">Belum ada item.</p>
            ) : (
              <div className="space-y-3">
                {cart.map((row) => {
                  const normalUnit = getProductPrice(row, selectedTier);
                  const dealUnit = Number.isFinite(row.unit_price_override) ? Number(row.unit_price_override) : normalUnit;
                  const lineTotal = round2(dealUnit * row.qty);
                  const regularUnit = getProductRegularUnitPrice(row);
                  const autoDiscountPct = (() => {
                    const tier = selectedTier;
                    const variant = toObjectOrEmpty(row.varian_harga);
                    const discounts = toObjectOrEmpty(variant.discounts_pct);
                    const aliases = tier === 'platinum' ? ['premium'] : [];

                    const discountCandidates: unknown[] = [
                      discounts[tier],
                      toObjectOrEmpty(variant[tier]).discount_pct,
                      variant[`${tier}_discount_pct`]
                    ];
                    for (const alias of aliases) {
                      discountCandidates.push(discounts[alias], toObjectOrEmpty(variant[alias]).discount_pct, variant[`${alias}_discount_pct`]);
                    }
                    for (const raw of discountCandidates) {
                      const parsed = toFiniteNumber(raw);
                      if (parsed === null) continue;
                      if (parsed <= 0 || parsed > 100) continue;
                      return clampPercentage(parsed);
                    }

                    const categoryPct = getCategoryDiscountPct(row, tier);
                    if (categoryPct !== null && categoryPct > 0) return clampPercentage(categoryPct);

                    const inferredFromPrice = regularUnit > 0
                      ? clampPercentage(Math.round((((regularUnit - normalUnit) / regularUnit) * 100) * 100) / 100)
                      : 0;
                    return inferredFromPrice > 0 ? inferredFromPrice : 0;
                  })();
                  const discountInputValue = row.discount_pct_input === undefined
                    ? (autoDiscountPct > 0 ? String(autoDiscountPct) : '')
                    : String(row.discount_pct_input || '');
                  const overrideInvalid =
                    (Number.isFinite(row.unit_price_override) && (Number(row.unit_price_override) > normalUnit || Number(row.unit_price_override) < row.base_price));

                  return (
                    <div key={row.product_id} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-black text-slate-900">{row.name}</p>
                          <p className="text-[11px] text-slate-500">SKU: {row.sku} • Stok: {row.stock_quantity} • Modal: {formatCurrency(row.base_price)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeLine(row.product_id)}
                          className="text-slate-400 hover:text-rose-600"
                          aria-label="Remove"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>

                      <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase">Qty</label>
                          <div className="mt-1 flex items-center gap-2">
                            <button type="button" onClick={() => updateQty(row.product_id, -1)} className={`h-11 w-11 rounded-xl grid place-items-center ${btn3dNeutral}`}>
                              <Minus size={14} />
                            </button>
                            <div className="min-w-12 text-center text-sm font-black text-slate-900">{row.qty}</div>
                            <button type="button" onClick={() => updateQty(row.product_id, +1)} className={`h-11 w-11 rounded-xl grid place-items-center ${btn3dNeutral}`}>
                              <Plus size={14} />
                            </button>
                          </div>
                        </div>
		                        <div>
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:items-end">
                                <div>
                                  <label className="text-[10px] font-bold text-slate-500 uppercase">Harga deal</label>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="off"
                                    placeholder={`Normal: ${formatIdrNumber(normalUnit)}`}
                                    value={String(row.unit_price_override_input ?? formatIdrNumber(dealUnit))}
                                    onFocus={() => {
                                      setCart((prev) => prev.map((item) => item.product_id === row.product_id
                                        ? { ...item, unit_price_override_input: String(Math.max(0, Math.trunc(dealUnit))) }
                                        : item));
                                    }}
                                    onBlur={() => {
                                      setCart((prev) => prev.map((item) => item.product_id === row.product_id
                                        ? { ...item, unit_price_override_input: undefined }
                                        : item));
                                    }}
                                    onChange={(e) => updateDealUnitInput(row.product_id, e.target.value, normalUnit)}
                                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-right"
                                  />
                                </div>

                                <div>
                                  <label className="text-[10px] font-bold text-slate-500 uppercase">Diskon dipakai (%)</label>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    autoComplete="off"
                                    placeholder="-"
                                    value={discountInputValue}
                                    onChange={(e) => updateDiscountPctInput(row.product_id, e.target.value, regularUnit)}
                                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-right"
                                  />
                                </div>

                                <div className="sm:col-span-2">
                                  <label className="text-[10px] font-bold text-slate-500 uppercase">Dipakai (total)</label>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="off"
                                    placeholder="-"
                                    value={String(row.line_total_override_input ?? formatIdrNumber(lineTotal))}
                                    onFocus={() => {
                                      setCart((prev) => prev.map((item) => item.product_id === row.product_id
                                        ? { ...item, line_total_override_input: String(Math.max(0, Math.trunc(lineTotal))) }
                                        : item));
                                    }}
                                    onBlur={() => {
                                      setCart((prev) => prev.map((item) => item.product_id === row.product_id
                                        ? { ...item, line_total_override_input: undefined }
                                        : item));
                                    }}
                                    onChange={(e) => updateLineTotalInput(row.product_id, e.target.value, row.qty, normalUnit)}
                                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-right"
                                  />
                                </div>

                                {overrideInvalid ? (
                                  <p className="mt-1 text-[11px] text-rose-600">
                                    Override tidak valid (maks {formatCurrency(normalUnit)} / min modal {formatCurrency(row.base_price)}).
                                  </p>
                                ) : null}
                              </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase">Line Total</label>
                          <p className="mt-2 text-sm font-black text-slate-900">{formatCurrency(lineTotal)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className={`bg-white rounded-3xl p-5 space-y-4 shadow-sm border ${underpayEst ? 'border-rose-200' : 'border-slate-200'}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className={`text-xs font-black uppercase tracking-widest ${underpayEst ? 'text-rose-700' : 'text-slate-500'}`}>
                  Customer {underpayEst ? '(Wajib untuk Hutang)' : '(Opsional)'}
                </p>
                <p className={`text-[11px] ${underpayEst ? 'text-rose-700' : 'text-slate-500'}`}>
                  {underpayEst
                    ? 'Jika transaksi kurang bayar (hutang), wajib pilih customer yang terdaftar agar bisa dilacak.'
                    : 'Kosong tidak masalah. Isi jika ingin mencatat customer yang sedang dilayani.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCustomer(null);
                    setCustomerQuery('');
                    setCustomerResults([]);
                    setCustomerSearchError('');
                    window.setTimeout(() => customerInputRef.current?.focus(), 0);
                  }}
                  className={`rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-wide ${btn3dNeutral}`}
                  title="Clear customer"
                >
                  Clear
                </button>
              </div>
            </div>

            {selectedCustomer ? (
              <div className={`rounded-2xl p-3 border ${underpayEst ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
                <p className="text-sm font-black text-slate-900">{selectedCustomer.name}</p>
                <p className="text-[11px] text-slate-600">
                  {selectedCustomer.whatsapp_number ? `WA: ${selectedCustomer.whatsapp_number}` : 'WA: -'}
                  {selectedCustomer.email ? ` • ${selectedCustomer.email}` : ''}
                </p>
              </div>
            ) : (
              <div className={`rounded-2xl p-3 border ${underpayEst ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
                <p className="text-xs text-slate-700">Belum memilih customer.</p>
              </div>
            )}

            <div className="relative">
              <input
                ref={customerInputRef}
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                placeholder="Cari customer (nama / WhatsApp)..."
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {(customerResults.length > 0) ? (
                <div className="absolute z-20 mt-2 w-full divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden max-h-72 overflow-y-auto">
                  {customerResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleSelectCustomer(c)}
                      className="w-full text-left px-4 py-3 hover:bg-slate-50"
                    >
                      <p className="text-sm font-black text-slate-900">{c.name}</p>
                      <p className="text-[11px] text-slate-500">{c.whatsapp_number || '-'}</p>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {customerSearchLoading ? <p className="text-xs text-slate-500">Mencari customer...</p> : null}
            {customerSearchError ? <p className="text-xs text-rose-600">{customerSearchError}</p> : null}

            {customerQuery.trim() && !customerSearchLoading && customerResults.length === 0 ? (
              <button
                type="button"
                onClick={() => openQuickCreate(customerQuery)}
                className={`w-full rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-wide ${btn3dNeutral}`}
              >
                Tambah Customer Baru: &quot;{customerQuery.trim()}&quot;
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => openQuickCreate('')}
              className={`w-full rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-wide ${btn3dNeutral}`}
            >
              Daftarkan Customer (Shortcut)
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-3xl p-5 space-y-4 shadow-sm">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500">Pembayaran</p>
            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">Subtotal (estimasi)</span>
                <span className="text-sm font-black text-slate-900">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">Diskon</span>
                <span className="text-sm font-black text-slate-900">{formatCurrency(discountAmountEst)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">Subtotal setelah diskon</span>
                <span className="text-sm font-black text-slate-900">{formatCurrency(subtotalAfterDiscountEst)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">Uang dibayar</span>
                <span className="text-sm font-black text-slate-900">{formatCurrency(amountReceived)}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-2">
                Catatan: total final dihitung oleh backend (termasuk pajak jika aktif).
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Diskon (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={discountPercent}
                  onChange={(e) => setDiscountPercent(Number(e.target.value || 0))}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Uang dibayar</label>
                <input
                  type="number"
                  value={amountReceived}
                  onChange={(e) => setAmountReceived(Number(e.target.value || 0))}
                  placeholder="Nominal dibayar customer"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase">Catatan (Opsional)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Catatan transaksi (opsional)"
                className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm"
                rows={2}
              />
            </div>

            {submitError ? <p className="text-xs text-rose-600 whitespace-pre-wrap">{submitError}</p> : null}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void handleSubmit({ print: true })}
                disabled={submitting || cart.length === 0}
                className={`w-full inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-black ${btn3dPrimary}`}
                title="Simpan transaksi dan buka struk untuk print (pilih printer thermal bluetooth dari dialog print browser)."
              >
                <Printer size={16} />
                {submitting ? 'Menyimpan...' : 'Bayar & Print'}
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit({ print: false })}
                disabled={submitting || cart.length === 0}
                className={`w-full inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-black ${btn3dNeutral}`}
              >
                {submitting ? 'Menyimpan...' : 'Bayar & Simpan'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {quickCreateOpen ? (
        <div className="fixed inset-0 z-[100] bg-black/40 p-4 flex items-center justify-center">
          <div className="w-full max-w-lg rounded-3xl bg-white border border-slate-200 shadow-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-black text-slate-900">Daftarkan Customer (Shortcut)</h2>
              <button
                type="button"
                onClick={() => setQuickCreateOpen(false)}
                className="text-xs font-black uppercase tracking-wide text-slate-500 hover:text-slate-700"
              >
                Tutup
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">Nama</label>
                <input
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2 text-sm"
                  placeholder="Nama customer"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">WhatsApp (Opsional)</label>
                <input
                  value={quickWhatsapp}
                  onChange={(e) => setQuickWhatsapp(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2 text-sm"
                  placeholder="08xxxxxxxxxx (boleh kosong)"
                />
              </div>
            </div>

            {quickError ? <p className="text-xs text-rose-600 whitespace-pre-wrap">{quickError}</p> : null}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    setQuickSubmitting(true);
                    setQuickError('');
                    if (!quickName.trim()) {
                      setQuickError('Nama wajib diisi.');
                      return;
                    }
                    const res = await api.admin.customers.quickCreate({
                      name: quickName.trim(),
                      ...(quickWhatsapp.trim() ? { whatsapp_number: quickWhatsapp.trim() } : {}),
                    });
                    const c = (res.data || {}).customer || {};
                    const picked: CustomerPick = {
                      id: String(c.id || ''),
                      name: String(c.name || ''),
                      whatsapp_number: c.whatsapp_number ?? null,
                      email: c.email ?? null,
                    };
                    if (!picked.id || !picked.name) {
                      setQuickError('Customer tersimpan, tapi response tidak lengkap.');
                      return;
                    }
                    setSelectedCustomer(picked);
                    setQuickCreateOpen(false);
                    setCustomerQuery('');
                    setCustomerResults([]);
                    setCustomerSearchError('');
                  } catch (e: unknown) {
                    const message = typeof e === 'object' && e && 'response' in e
                      ? String((e as any).response?.data?.message || '')
                      : '';
                    setQuickError(message || 'Gagal membuat customer.');
                  } finally {
                    setQuickSubmitting(false);
                  }
                }}
                disabled={quickSubmitting}
                className={`flex-1 rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-wide ${btn3dPrimary}`}
              >
                {quickSubmitting ? 'Menyimpan...' : 'Simpan & Pilih'}
              </button>
              <button
                type="button"
                onClick={() => setQuickCreateOpen(false)}
                className={`rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-wide ${btn3dNeutral}`}
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
