'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw, Search } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

type ProductTierRow = {
  id: string;
  sku?: string;
  name?: string;
  price?: string | number;
  status?: string;
  varian_harga?: unknown;
};

type TierPrice = {
  regular: number;
  gold: number;
  premium: number;
};

type TierDiscount = {
  gold: number;
  premium: number;
};

type CategoryTierDiscount = {
  id: number;
  name: string;
  discount_regular_pct: number | null;
  discount_gold_pct: number | null;
  discount_premium_pct: number | null;
};

const toNullableNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const clampPercentage = (value: number): number => {
  return Math.min(100, Math.max(0, value));
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

const resolveRegularPrice = (product: ProductTierRow): number => {
  return Math.max(0, Number(product.price || 0));
};

const resolveStoredDiscounts = (product: ProductTierRow): TierDiscount => {
  const regular = resolveRegularPrice(product);
  const source = toObjectOrEmpty(product.varian_harga);
  const discountsBlock = toObjectOrEmpty(source.discounts_pct);
  const pricesBlock = toObjectOrEmpty(source.prices);

  const inferDiscountFromPrice = (tierPriceRaw: unknown): number | null => {
    const tierPrice = toNullableNumber(tierPriceRaw);
    if (tierPrice === null || regular <= 0) return null;
    return clampPercentage(((regular - tierPrice) / regular) * 100);
  };

  const resolveTierDiscount = (tier: 'gold' | 'platinum', aliases: string[] = []): number => {
    const tierObject = toObjectOrEmpty(source[tier]);
    const directFromTierObject = toNullableNumber(tierObject.discount_pct);
    if (directFromTierObject !== null) return clampPercentage(directFromTierObject);

    const directFromDiscounts = toNullableNumber(discountsBlock[tier]);
    if (directFromDiscounts !== null) return clampPercentage(directFromDiscounts);

    for (const alias of aliases) {
      const aliasObject = toObjectOrEmpty(source[alias]);
      const aliasPct = toNullableNumber(aliasObject.discount_pct) ?? toNullableNumber(discountsBlock[alias]);
      if (aliasPct !== null) return clampPercentage(aliasPct);
    }

    const tierPriceCandidates: unknown[] = [
      source[tier],
      pricesBlock[tier],
      tierObject.price,
      source[`${tier}_price`],
    ];

    for (const alias of aliases) {
      const aliasObject = toObjectOrEmpty(source[alias]);
      tierPriceCandidates.push(source[alias], pricesBlock[alias], aliasObject.price, source[`${alias}_price`]);
    }

    for (const candidate of tierPriceCandidates) {
      const inferred = inferDiscountFromPrice(candidate);
      if (inferred !== null) return inferred;
    }

    return 0;
  };

  return {
    gold: resolveTierDiscount('gold'),
    premium: resolveTierDiscount('platinum', ['premium']),
  };
};

const calculateTierPrice = (product: ProductTierRow, discounts: TierDiscount): TierPrice => {
  const regular = resolveRegularPrice(product);
  const gold = Math.max(0, Math.round((regular * (1 - clampPercentage(discounts.gold) / 100)) * 100) / 100);
  const premium = Math.max(0, Math.round((regular * (1 - clampPercentage(discounts.premium) / 100)) * 100) / 100);

  return { regular, gold, premium };
};

export default function SalesTierPricingPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir']);

  const [search, setSearch] = useState('');
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [applyingDiscount, setApplyingDiscount] = useState(false);
  const [products, setProducts] = useState<ProductTierRow[]>([]);
  const [goldDiscount, setGoldDiscount] = useState('');
  const [premiumDiscount, setPremiumDiscount] = useState('');
  const [discountsInitialized, setDiscountsInitialized] = useState(false);
  const [categories, setCategories] = useState<CategoryTierDiscount[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [categoryRegularInput, setCategoryRegularInput] = useState('');
  const [categoryGoldInput, setCategoryGoldInput] = useState('');
  const [categoryPremiumInput, setCategoryPremiumInput] = useState('');
  const [savingCategoryDiscount, setSavingCategoryDiscount] = useState(false);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  const parsedDiscounts = useMemo<TierDiscount>(() => {
    const gold = toNullableNumber(goldDiscount);
    const premium = toNullableNumber(premiumDiscount);

    return {
      gold: clampPercentage(gold === null ? 0 : gold),
      premium: clampPercentage(premium === null ? 0 : premium),
    };
  }, [goldDiscount, premiumDiscount]);

  const loadProducts = useCallback(async () => {
    try {
      setLoadingProducts(true);
      setError('');
      const res = await api.admin.inventory.getProducts({
        page: 1,
        limit: 100,
        status: 'active',
        search: search.trim() || undefined,
      });
      const rows = Array.isArray(res.data?.products) ? (res.data.products as ProductTierRow[]) : [];
      setProducts(rows);

      if (!discountsInitialized && rows.length > 0) {
        const fallback = resolveStoredDiscounts(rows[0]);
        setGoldDiscount(String(Math.round(fallback.gold * 100) / 100));
        setPremiumDiscount(String(Math.round(fallback.premium * 100) / 100));
        setDiscountsInitialized(true);
      }
    } catch (e: any) {
      setProducts([]);
      setError(e?.response?.data?.message || 'Gagal memuat produk');
    } finally {
      setLoadingProducts(false);
    }
  }, [search, discountsInitialized]);

  const loadCategories = useCallback(async () => {
    try {
      setLoadingCategories(true);
      const res = await api.admin.inventory.getCategories();
      const rows = Array.isArray(res.data?.categories) ? (res.data.categories as CategoryTierDiscount[]) : [];
      setCategories(rows);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Gagal memuat kategori');
      setCategories([]);
    } finally {
      setLoadingCategories(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    const timer = setTimeout(() => {
      void loadProducts();
    }, 250);
    return () => clearTimeout(timer);
  }, [allowed, loadProducts]);

  useEffect(() => {
    if (!allowed) return;
    void loadCategories();
  }, [allowed, loadCategories]);

  const sampleRows = useMemo(() => {
    return products.slice(0, 8).map((item) => {
      const currentDiscount = resolveStoredDiscounts(item);
      const currentPrice = calculateTierPrice(item, currentDiscount);
      const previewPrice = calculateTierPrice(item, parsedDiscounts);

      return {
        id: item.id,
        sku: item.sku || '-',
        name: item.name || '-',
        currentRegular: currentPrice.regular,
        currentGold: currentPrice.gold,
        currentPremium: currentPrice.premium,
        previewRegular: previewPrice.regular,
        previewGold: previewPrice.gold,
        previewPremium: previewPrice.premium,
      };
    });
  }, [products, parsedDiscounts]);

  const handleApplyBulkDiscount = async () => {
    const gold = Number(goldDiscount);
    const premium = Number(premiumDiscount);

    if (!Number.isFinite(gold) || gold < 0 || gold > 100) {
      setError('Diskon Gold harus angka valid antara 0 sampai 100.');
      return;
    }
    if (!Number.isFinite(premium) || premium < 0 || premium > 100) {
      setError('Diskon Premium harus angka valid antara 0 sampai 100.');
      return;
    }

    try {
      setApplyingDiscount(true);
      setError('');
      setActionMessage('');

      const res = await api.admin.inventory.updateTierDiscountBulk({
        gold_discount_pct: gold,
        premium_discount_pct: premium,
        status: 'active',
      });

      setActionMessage(res.data?.message || 'Diskon tier berhasil diterapkan.');
      await loadProducts();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Gagal menerapkan diskon tier');
    } finally {
      setApplyingDiscount(false);
    }
  };

  const openCategoryEditor = (category: CategoryTierDiscount) => {
    setEditingCategoryId(category.id);
    setCategoryRegularInput(category.discount_regular_pct === null ? '' : String(category.discount_regular_pct));
    setCategoryGoldInput(category.discount_gold_pct === null ? '' : String(category.discount_gold_pct));
    setCategoryPremiumInput(category.discount_premium_pct === null ? '' : String(category.discount_premium_pct));
  };

  const parseNullablePercentageInput = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      throw new Error('Diskon kategori harus angka 0-100 atau kosong.');
    }
    return Math.round(parsed * 100) / 100;
  };

  const handleSaveCategoryDiscount = async () => {
    if (editingCategoryId === null) return;
    try {
      setSavingCategoryDiscount(true);
      setError('');
      setActionMessage('');

      const payload = {
        discount_regular_pct: parseNullablePercentageInput(categoryRegularInput),
        discount_gold_pct: parseNullablePercentageInput(categoryGoldInput),
        discount_premium_pct: parseNullablePercentageInput(categoryPremiumInput),
      };

      const res = await api.admin.inventory.updateCategoryTierDiscount(editingCategoryId, payload);
      setActionMessage(res.data?.message || 'Diskon kategori berhasil diperbarui.');
      setEditingCategoryId(null);
      await loadCategories();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Gagal menyimpan diskon kategori');
    } finally {
      setSavingCategoryDiscount(false);
    }
  };

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/admin" className="inline-flex items-center gap-2 text-xs font-bold text-slate-600">
          <ArrowLeft size={14} />
          Kembali ke Overview
        </Link>
        <Link href="/admin/sales" className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700">
          Kembali ke List Customer
        </Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-[28px] p-5 shadow-sm">
        <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em]">Modifikasi Diskon Tier</p>
        <h1 className="text-2xl font-black text-slate-900 mt-1">Atur Diskon Persentase Gold & Premium</h1>
        <p className="text-sm text-slate-600 mt-2">
          Cukup set persentase diskon sekali, lalu terapkan ke semua produk aktif tanpa edit satu per satu.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-black text-slate-900">Preview Produk (Aktif)</h2>
            <button
              type="button"
              onClick={() => void loadProducts()}
              disabled={loadingProducts}
              className="inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-slate-100 text-slate-700 disabled:opacity-50"
            >
              <RefreshCw size={12} /> Refresh
            </button>
          </div>

          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama produk atau SKU"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm"
            />
          </div>

          {loadingProducts ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-500">Memuat produk...</div>
          ) : products.length === 0 ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-500">Produk tidak ditemukan.</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 font-black uppercase">Produk</th>
                    <th className="px-3 py-2 font-black uppercase">SKU</th>
                    <th className="px-3 py-2 font-black uppercase">Reguler</th>
                    <th className="px-3 py-2 font-black uppercase">Gold (Preview)</th>
                    <th className="px-3 py-2 font-black uppercase">Premium (Preview)</th>
                  </tr>
                </thead>
                <tbody>
                  {sampleRows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-semibold text-slate-800">{row.name}</td>
                      <td className="px-3 py-2 text-slate-600">{row.sku}</td>
                      <td className="px-3 py-2 text-slate-700">{formatCurrency(row.previewRegular)}</td>
                      <td className="px-3 py-2 text-slate-700">
                        <span className="font-semibold">{formatCurrency(row.previewGold)}</span>
                        <span className="ml-1 text-[10px] text-slate-500">(saat ini {formatCurrency(row.currentGold)})</span>
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        <span className="font-semibold">{formatCurrency(row.previewPremium)}</span>
                        <span className="ml-1 text-[10px] text-slate-500">(saat ini {formatCurrency(row.currentPremium)})</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-3">
          <h2 className="text-sm font-black text-slate-900">Atur Diskon Tier</h2>
          <p className="text-xs text-slate-500">Diskon dihitung dari harga reguler setiap produk.</p>

          <div className="space-y-2">
            <label className="block">
              <span className="text-[11px] font-semibold text-slate-600">Reguler</span>
              <input
                type="text"
                value="0% (harga dasar)"
                disabled
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-600"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold text-slate-600">Diskon Gold (%)</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={goldDiscount}
                onChange={(e) => setGoldDiscount(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold text-slate-600">Diskon Premium (%)</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={premiumDiscount}
                onChange={(e) => setPremiumDiscount(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={() => void handleApplyBulkDiscount()}
            disabled={applyingDiscount}
            className="w-full inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-bold bg-emerald-600 text-white disabled:opacity-50"
          >
            {applyingDiscount ? 'Menerapkan...' : 'Terapkan ke Semua Produk Aktif'}
          </button>

          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-[11px] text-emerald-700">
            Diskon tier global adalah fallback default. Jika kategori punya diskon sendiri, checkout akan memakai diskon kategori.
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-black text-slate-900">Diskon Per Kategori</h2>
          <button
            type="button"
            onClick={() => void loadCategories()}
            disabled={loadingCategories}
            className="inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-slate-100 text-slate-700 disabled:opacity-50"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
        <p className="text-xs text-slate-500">Kosongkan nilai diskon kategori untuk memakai diskon tier global (fallback).</p>

        {loadingCategories ? (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-500">Memuat kategori...</div>
        ) : categories.length === 0 ? (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-500">Kategori tidak ditemukan.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-black uppercase">Kategori</th>
                  <th className="px-3 py-2 font-black uppercase">Regular %</th>
                  <th className="px-3 py-2 font-black uppercase">Gold %</th>
                  <th className="px-3 py-2 font-black uppercase">Premium %</th>
                  <th className="px-3 py-2 font-black uppercase">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => {
                  const isEditing = editingCategoryId === category.id;
                  return (
                    <tr key={category.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-semibold text-slate-800">{category.name}</td>
                      <td className="px-3 py-2 text-slate-700">
                        {isEditing ? (
                          <input value={categoryRegularInput} onChange={(e) => setCategoryRegularInput(e.target.value)} placeholder="Fallback" className="w-24 rounded-lg border border-slate-200 px-2 py-1" />
                        ) : (category.discount_regular_pct ?? 'Fallback')}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {isEditing ? (
                          <input value={categoryGoldInput} onChange={(e) => setCategoryGoldInput(e.target.value)} placeholder="Fallback" className="w-24 rounded-lg border border-slate-200 px-2 py-1" />
                        ) : (category.discount_gold_pct ?? 'Fallback')}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {isEditing ? (
                          <input value={categoryPremiumInput} onChange={(e) => setCategoryPremiumInput(e.target.value)} placeholder="Fallback" className="w-24 rounded-lg border border-slate-200 px-2 py-1" />
                        ) : (category.discount_premium_pct ?? 'Fallback')}
                      </td>
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <button onClick={() => void handleSaveCategoryDiscount()} disabled={savingCategoryDiscount} className="rounded-lg bg-emerald-600 text-white px-2 py-1 font-bold disabled:opacity-50">
                              Simpan
                            </button>
                            <button onClick={() => setEditingCategoryId(null)} disabled={savingCategoryDiscount} className="rounded-lg border border-slate-300 px-2 py-1 font-bold">
                              Batal
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => openCategoryEditor(category)} className="rounded-lg bg-slate-900 text-white px-2 py-1 font-bold">
                            Atur
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(error || actionMessage) && (
        <div className="space-y-2">
          {error && <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700">{error}</div>}
          {actionMessage && <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-700">{actionMessage}</div>}
        </div>
      )}
    </div>
  );
}
