'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Layers, Pencil, Plus, RefreshCw, X } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { formatCurrency, formatDateTime } from '@/lib/utils';

type ProductOption = {
  id: string;
  name: string;
  sku: string;
  price?: number | string | null;
  unit?: string | null;
  image_url?: string | null;
  stock_quantity?: number | string | null;
};

type CostLayerRow = {
  unit_cost: number;
  qty_on_hand: number;
  qty_reserved_total: number;
  qty_available: number;
};

type ClearancePromoRow = {
  id: string;
  name: string;
  product_id: string;
  target_unit_cost: number | string;
  qty_limit?: number | string | null;
  qty_used?: number | string | null;
  pricing_mode: 'fixed_price' | 'percent_off' | string;
  promo_unit_price?: number | string | null;
  discount_pct?: number | string | null;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  remaining_qty?: number | string | null;
  Product?: {
    id: string;
    sku?: string | null;
    name?: string | null;
    unit?: string | null;
    price?: number | string | null;
    image_url?: string | null;
  } | null;
};

type ApiErrorWithMessage = {
  response?: { data?: { message?: string } };
};

const pad2 = (value: number) => String(value).padStart(2, '0');

const toDateTimeLocalInputValue = (date: Date): string => {
  const safe = new Date(date);
  if (!Number.isFinite(safe.getTime())) return '';
  return `${safe.getFullYear()}-${pad2(safe.getMonth() + 1)}-${pad2(safe.getDate())}T${pad2(safe.getHours())}:${pad2(safe.getMinutes())}`;
};

const parseDateTimeLocalInput = (value: string): Date | null => {
  const raw = value.trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const localDate = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    localDate.getFullYear() !== year ||
    localDate.getMonth() !== month - 1 ||
    localDate.getDate() !== day ||
    localDate.getHours() !== hour ||
    localDate.getMinutes() !== minute
  ) {
    return null;
  }
  return localDate;
};

const computePromoUnitPrice = (promo: ClearancePromoRow): number => {
  const pricingMode = String(promo.pricing_mode || '');
  if (pricingMode === 'fixed_price') return Math.round(Number(promo.promo_unit_price || 0) * 100) / 100;
  const normalPrice = Number(promo.Product?.price || 0);
  const pct = Number(promo.discount_pct || 0);
  if (!Number.isFinite(normalPrice) || normalPrice <= 0) return 0;
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return 0;
  return Math.round(normalPrice * (1 - pct / 100));
};

const computePercentOffPrice = (normalPriceRaw: unknown, pctRaw: unknown): number => {
  const normalPrice = Number(normalPriceRaw || 0);
  const pct = Number(pctRaw || 0);
  if (!Number.isFinite(normalPrice) || normalPrice <= 0) return 0;
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return 0;
  return Math.round(normalPrice * (1 - pct / 100));
};

export default function AdminClearancePromosPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir'], '/admin');
  const { user } = useAuthStore();
  const isSuperAdmin = user?.role === 'super_admin';

  const [promos, setPromos] = useState<ClearancePromoRow[]>([]);
  const [includeInactive, setIncludeInactive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [processingPromoId, setProcessingPromoId] = useState('');
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  const [createProductQuery, setCreateProductQuery] = useState('');
  const [createProductOptions, setCreateProductOptions] = useState<ProductOption[]>([]);
  const [createProductLoading, setCreateProductLoading] = useState(false);
  const [selectedCreateProduct, setSelectedCreateProduct] = useState<ProductOption | null>(null);
  const [createCostLayers, setCreateCostLayers] = useState<CostLayerRow[]>([]);
  const [createCostLayerLoading, setCreateCostLayerLoading] = useState(false);
  const [selectedCreateUnitCost, setSelectedCreateUnitCost] = useState('');

  const [editingPromo, setEditingPromo] = useState<ClearancePromoRow | null>(null);
  const [updating, setUpdating] = useState(false);
  const [editName, setEditName] = useState('');
  const [editProductId, setEditProductId] = useState('');
  const [editPricingMode, setEditPricingMode] = useState<'fixed_price' | 'percent_off'>('fixed_price');
  const [editPromoUnitPrice, setEditPromoUnitPrice] = useState('');
  const [editDiscountPct, setEditDiscountPct] = useState('');
  const [editStartsAt, setEditStartsAt] = useState('');
  const [editEndsAt, setEditEndsAt] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editProductQuery, setEditProductQuery] = useState('');
  const [editProductOptions, setEditProductOptions] = useState<ProductOption[]>([]);
  const [editProductLoading, setEditProductLoading] = useState(false);
  const [selectedEditProduct, setSelectedEditProduct] = useState<ProductOption | null>(null);
  const [editCostLayers, setEditCostLayers] = useState<CostLayerRow[]>([]);
  const [editCostLayerLoading, setEditCostLayerLoading] = useState(false);
  const [selectedEditUnitCost, setSelectedEditUnitCost] = useState('');
  const [editTargetUnitCost, setEditTargetUnitCost] = useState('');
  const [editQtyLimit, setEditQtyLimit] = useState('');
  const [editQtyUsed, setEditQtyUsed] = useState(0);

	  const [newName, setNewName] = useState('');
	  const [newProductId, setNewProductId] = useState('');
	  const [newTargetUnitCost, setNewTargetUnitCost] = useState('');
	  const [newPricingMode, setNewPricingMode] = useState<'fixed_price' | 'percent_off'>('fixed_price');
	  const [newPromoUnitPrice, setNewPromoUnitPrice] = useState('');
	  const [newDiscountPct, setNewDiscountPct] = useState('10');
	  const [newStartsAt, setNewStartsAt] = useState('');
	  const [newEndsAt, setNewEndsAt] = useState('');
	  const [newIsActive, setNewIsActive] = useState(true);
	  const [newQtyLimit, setNewQtyLimit] = useState('');

  useEffect(() => {
    const now = new Date();
    now.setSeconds(0, 0);
    const in7days = new Date(now);
    in7days.setDate(in7days.getDate() + 7);
    setNewStartsAt(toDateTimeLocalInputValue(now));
    setNewEndsAt(toDateTimeLocalInputValue(in7days));
  }, []);

  const searchProducts = useCallback(async (query: string): Promise<ProductOption[]> => {
    const raw = query.trim();
    if (!raw) return [];

    try {
      const res = await api.admin.inventory.getProducts({
        page: 1,
        limit: 10,
        search: raw,
        status: 'active',
      });
      const rows = Array.isArray(res.data?.products) ? (res.data.products as any[]) : [];
      return rows.map((row) => ({
        id: String(row?.id || ''),
        name: String(row?.name || ''),
        sku: String(row?.sku || ''),
        price: row?.price ?? null,
        unit: row?.unit ?? null,
        image_url: row?.image_url ?? null,
        stock_quantity: row?.stock_quantity ?? null,
      })).filter((row) => Boolean(String(row.id || '').trim()));
    } catch {
      return [];
    }
  }, []);

  const loadCostLayers = useCallback(async (productId: string): Promise<CostLayerRow[]> => {
    const id = String(productId || '').trim();
    if (!id) return [];
    try {
      const res = await api.admin.inventory.getCostLayers(id);
      const layersRaw = Array.isArray((res.data as any)?.layers) ? ((res.data as any).layers as any[]) : [];
      return layersRaw
        .map((row) => ({
          unit_cost: Number(row?.unit_cost || 0),
          qty_on_hand: Math.max(0, Math.trunc(Number(row?.qty_on_hand || 0))),
          qty_reserved_total: Math.max(0, Math.trunc(Number(row?.qty_reserved_total || 0))),
          qty_available: Math.max(0, Math.trunc(Number(row?.qty_available || 0))),
        }))
        .filter((row) => Number.isFinite(row.unit_cost) && row.unit_cost >= 0);
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    if (!allowed || !isSuperAdmin) return;

    const t = setTimeout(async () => {
      const q = createProductQuery.trim();
      if (q.length < 2) {
        setCreateProductOptions([]);
        setCreateProductLoading(false);
        return;
      }
      setCreateProductLoading(true);
      const rows = await searchProducts(q);
      setCreateProductOptions(rows);
      setCreateProductLoading(false);
    }, 400);

    return () => clearTimeout(t);
  }, [allowed, isSuperAdmin, createProductQuery, searchProducts]);

  useEffect(() => {
    if (!allowed || !isSuperAdmin) return;

    const t = setTimeout(async () => {
      const q = editProductQuery.trim();
      if (q.length < 2) {
        setEditProductOptions([]);
        setEditProductLoading(false);
        return;
      }
      setEditProductLoading(true);
      const rows = await searchProducts(q);
      setEditProductOptions(rows);
      setEditProductLoading(false);
    }, 400);

    return () => clearTimeout(t);
  }, [allowed, isSuperAdmin, editProductQuery, searchProducts]);

  useEffect(() => {
    if (!allowed || !isSuperAdmin) return;
    const productId = String(newProductId || '').trim();
    if (!productId) {
      setCreateCostLayers([]);
      setSelectedCreateUnitCost('');
      setNewTargetUnitCost('');
      return;
    }

    let ignore = false;
    setCreateCostLayerLoading(true);
    void (async () => {
      const rows = await loadCostLayers(productId);
      if (ignore) return;
      setCreateCostLayers(rows);
      setCreateCostLayerLoading(false);
      if (selectedCreateUnitCost && rows.some((r) => String(r.unit_cost) === String(selectedCreateUnitCost))) {
        setNewTargetUnitCost(String(selectedCreateUnitCost));
      } else {
        setSelectedCreateUnitCost('');
        setNewTargetUnitCost('');
      }
    })();

    return () => {
      ignore = true;
    };
  }, [allowed, isSuperAdmin, newProductId, loadCostLayers, selectedCreateUnitCost]);

  useEffect(() => {
    if (!allowed || !isSuperAdmin) return;
    const productId = String(editProductId || '').trim();
    if (!productId) {
      setEditCostLayers([]);
      setSelectedEditUnitCost('');
      setEditTargetUnitCost('');
      return;
    }

    let ignore = false;
    setEditCostLayerLoading(true);
    void (async () => {
      const rows = await loadCostLayers(productId);
      if (ignore) return;
      setEditCostLayers(rows);
      setEditCostLayerLoading(false);
      if (selectedEditUnitCost && rows.some((r) => String(r.unit_cost) === String(selectedEditUnitCost))) {
        setEditTargetUnitCost(String(selectedEditUnitCost));
      } else {
        const current = Number(editTargetUnitCost);
        if (Number.isFinite(current) && rows.some((r) => Number(r.unit_cost) === Number(current))) {
          setSelectedEditUnitCost(String(current));
        } else {
          setSelectedEditUnitCost('');
          setEditTargetUnitCost(String(editTargetUnitCost || ''));
        }
      }
    })();

    return () => {
      ignore = true;
    };
  }, [allowed, isSuperAdmin, editProductId, loadCostLayers, editTargetUnitCost, selectedEditUnitCost]);

  const loadPromos = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.admin.clearancePromos.getAll({ include_inactive: includeInactive });
      const rows = Array.isArray(res.data?.promos) ? (res.data.promos as ClearancePromoRow[]) : [];
      setPromos(rows);
    } catch (e: unknown) {
      const err = e as ApiErrorWithMessage;
      setPromos([]);
      setError(err?.response?.data?.message || 'Gagal memuat promo cepat habis');
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => {
    if (!allowed) return;
    void loadPromos();
  }, [allowed, loadPromos]);

  const openEdit = (promo: ClearancePromoRow) => {
    if (!isSuperAdmin) return;
    setError('');
    setActionMessage('');
    setEditingPromo(promo);
    setEditName(String(promo.name || ''));
    setEditProductId(String(promo.product_id || ''));
    setEditTargetUnitCost(String(promo.target_unit_cost ?? ''));
    setEditQtyLimit(String(promo.qty_limit ?? ''));
    setEditQtyUsed(Math.max(0, Math.trunc(Number(promo.qty_used || 0))));
    setEditPricingMode((String(promo.pricing_mode || '') as any) === 'percent_off' ? 'percent_off' : 'fixed_price');
    setEditPromoUnitPrice(String(promo.promo_unit_price ?? ''));
    setEditDiscountPct(String(promo.discount_pct ?? ''));
    setEditStartsAt(toDateTimeLocalInputValue(new Date(promo.starts_at)));
    setEditEndsAt(toDateTimeLocalInputValue(new Date(promo.ends_at)));
    setEditIsActive(Boolean(promo.is_active));

    const productName = String(promo.Product?.name || '');
    const productSku = String(promo.Product?.sku || '');
    const selected: ProductOption | null = promo.Product
      ? {
        id: String(promo.product_id || ''),
        name: productName,
        sku: productSku,
        price: promo.Product?.price ?? null,
        unit: promo.Product?.unit ?? null,
        image_url: promo.Product?.image_url ?? null,
      }
      : null;
    setSelectedEditProduct(selected);
    setEditProductQuery(selected ? `${productName}${productSku ? ` (${productSku})` : ''}` : '');
    setEditProductOptions([]);
    setSelectedEditUnitCost(String(promo.target_unit_cost ?? ''));
  };

  const closeEdit = () => {
    if (updating) return;
    setEditingPromo(null);
  };

  const handleCreate = async () => {
    if (!isSuperAdmin) return;

    const name = newName.trim();
    const productId = String(newProductId || '').trim();
    const targetUnitCost = Number(newTargetUnitCost);
    const startsAt = parseDateTimeLocalInput(newStartsAt);
    const endsAt = parseDateTimeLocalInput(newEndsAt);

    if (!name) {
      setError('Nama promo wajib diisi.');
      return;
    }
    if (!productId) {
      setError('Pilih produk terlebih dahulu.');
      return;
    }
    if (!selectedCreateUnitCost) {
      setError('Pilih target modal dari cost layer (batch harga).');
      return;
    }
    if (!createCostLayers.some((row) => String(row.unit_cost) === String(selectedCreateUnitCost))) {
      setError('Target modal harus diambil dari cost layer (batch harga) yang tersedia.');
      return;
    }
    const qtyLimit = Math.max(0, Math.trunc(Number(newQtyLimit)));
    const selectedLayer = createCostLayers.find((row) => String(row.unit_cost) === String(selectedCreateUnitCost));
    const maxQty = selectedLayer ? Math.max(0, Math.trunc(Number(selectedLayer.qty_available || 0))) : 0;
    if (!Number.isFinite(qtyLimit) || qtyLimit <= 0) {
      setError('Qty promo wajib diisi (>= 1).');
      return;
    }
    if (maxQty > 0 && qtyLimit > maxQty) {
      setError(`Qty promo tidak boleh melebihi sisa batch (${maxQty}).`);
      return;
    }
    if (!Number.isFinite(targetUnitCost) || targetUnitCost < 0) {
      setError('Target modal (unit cost) tidak valid.');
      return;
    }
    if (!startsAt || !endsAt || startsAt.getTime() >= endsAt.getTime()) {
      setError('Periode promo tidak valid (ends_at harus lebih besar dari starts_at).');
      return;
    }

    const payload: any = {
      name,
      product_id: productId,
      target_unit_cost: targetUnitCost,
      qty_limit: qtyLimit,
      pricing_mode: newPricingMode,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      is_active: newIsActive,
    };

    if (newPricingMode === 'fixed_price') {
      const promoUnitPrice = Number(newPromoUnitPrice);
      if (!Number.isFinite(promoUnitPrice) || promoUnitPrice <= 0) {
        setError('Harga promo wajib diisi (fixed price).');
        return;
      }
      payload.promo_unit_price = promoUnitPrice;
    } else {
      const discountPct = Number(newDiscountPct);
      if (!Number.isFinite(discountPct) || discountPct <= 0 || discountPct >= 100) {
        setError('Diskon (%) wajib diisi (1-99.99).');
        return;
      }
      payload.discount_pct = discountPct;
    }

    try {
      setCreating(true);
      setError('');
      setActionMessage('');
      await api.admin.clearancePromos.create(payload);
      setActionMessage('Promo cepat habis berhasil dibuat.');
      setNewName('');
      setNewQtyLimit('');
      await loadPromos();
    } catch (e: unknown) {
      const err = e as ApiErrorWithMessage;
      setError(err?.response?.data?.message || 'Gagal membuat promo cepat habis');
    } finally {
      setCreating(false);
    }
  };

  const handleUpdate = async () => {
    if (!isSuperAdmin) return;
    const promoId = String(editingPromo?.id || '').trim();
    if (!promoId) return;

    const name = editName.trim();
    const productId = String(editProductId || '').trim();
    const targetUnitCost = Number(editTargetUnitCost);
    const startsAt = parseDateTimeLocalInput(editStartsAt);
    const endsAt = parseDateTimeLocalInput(editEndsAt);

    if (!name) {
      setError('Nama promo wajib diisi.');
      return;
    }
    if (!productId) {
      setError('Pilih produk terlebih dahulu.');
      return;
    }
    if (!selectedEditUnitCost) {
      setError('Pilih target modal dari cost layer (batch harga).');
      return;
    }
    if (!editCostLayers.some((row) => String(row.unit_cost) === String(selectedEditUnitCost))) {
      setError('Target modal harus diambil dari cost layer (batch harga) yang tersedia.');
      return;
    }
    const qtyLimit = Math.max(0, Math.trunc(Number(editQtyLimit)));
    const selectedLayer = editCostLayers.find((row) => String(row.unit_cost) === String(selectedEditUnitCost));
    const maxQty = selectedLayer ? Math.max(0, Math.trunc(Number(selectedLayer.qty_available || 0))) : 0;
    const maxAllowed = maxQty + Math.max(0, Math.trunc(Number(editQtyUsed || 0)));
    if (!Number.isFinite(qtyLimit) || qtyLimit <= 0) {
      setError('Qty promo wajib diisi (>= 1).');
      return;
    }
    if (maxAllowed > 0 && qtyLimit > maxAllowed) {
      setError(`Qty promo tidak boleh melebihi total batch (sisa ${maxQty} + terpakai ${editQtyUsed} = ${maxAllowed}).`);
      return;
    }
    if (!Number.isFinite(targetUnitCost) || targetUnitCost < 0) {
      setError('Target modal (unit cost) tidak valid.');
      return;
    }
    if (!startsAt || !endsAt || startsAt.getTime() >= endsAt.getTime()) {
      setError('Periode promo tidak valid (ends_at harus lebih besar dari starts_at).');
      return;
    }

    const payload: any = {
      name,
      product_id: productId,
      target_unit_cost: targetUnitCost,
      qty_limit: qtyLimit,
      pricing_mode: editPricingMode,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      is_active: editIsActive,
    };

    if (editPricingMode === 'fixed_price') {
      const promoUnitPrice = Number(editPromoUnitPrice);
      if (!Number.isFinite(promoUnitPrice) || promoUnitPrice <= 0) {
        setError('Harga promo wajib diisi (fixed price).');
        return;
      }
      payload.promo_unit_price = promoUnitPrice;
    } else {
      const discountPct = Number(editDiscountPct);
      if (!Number.isFinite(discountPct) || discountPct <= 0 || discountPct >= 100) {
        setError('Diskon (%) wajib diisi (1-99.99).');
        return;
      }
      payload.discount_pct = discountPct;
    }

    try {
      setUpdating(true);
      setError('');
      setActionMessage('');
      await api.admin.clearancePromos.update(promoId, payload);
      setActionMessage('Promo cepat habis berhasil diperbarui.');
      setEditingPromo(null);
      await loadPromos();
    } catch (e: unknown) {
      const err = e as ApiErrorWithMessage;
      setError(err?.response?.data?.message || 'Gagal memperbarui promo cepat habis');
    } finally {
      setUpdating(false);
    }
  };

  const handleToggleActive = async (promo: ClearancePromoRow) => {
    if (!isSuperAdmin) return;
    const promoId = String(promo.id || '').trim();
    if (!promoId) return;

    try {
      setProcessingPromoId(promoId);
      setError('');
      setActionMessage('');
      await api.admin.clearancePromos.update(promoId, { is_active: !promo.is_active });
      setActionMessage(`Promo ${promo.is_active ? 'dinonaktifkan' : 'diaktifkan'}.`);
      await loadPromos();
    } catch (e: unknown) {
      const err = e as ApiErrorWithMessage;
      setError(err?.response?.data?.message || 'Gagal memperbarui status promo');
    } finally {
      setProcessingPromoId('');
    }
  };

  const rowsWithComputedPrice = useMemo(() => {
    return promos.map((promo) => ({
      ...promo,
      computed_promo_unit_price: computePromoUnitPrice(promo),
    }));
  }, [promos]);

  const createPercentOffPreviewPrice = useMemo(() => {
    if (newPricingMode !== 'percent_off') return 0;
    return computePercentOffPrice(selectedCreateProduct?.price, newDiscountPct);
  }, [newPricingMode, selectedCreateProduct?.price, newDiscountPct]);

  const editPercentOffPreviewPrice = useMemo(() => {
    if (editPricingMode !== 'percent_off') return 0;
    return computePercentOffPrice(selectedEditProduct?.price, editDiscountPct);
  }, [editPricingMode, selectedEditProduct?.price, editDiscountPct]);

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      {editingPromo && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-3xl bg-white rounded-3xl border border-slate-200 shadow-xl p-4 space-y-3 mt-10">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Edit Promo</p>
                <h2 className="text-base font-black text-slate-900 mt-0.5">{String(editingPromo.name || 'Promo')}</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Produk: {String(editingPromo.Product?.name || '')} {editingPromo.Product?.sku ? `(${editingPromo.Product?.sku})` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={closeEdit}
                disabled={updating}
                className="inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-slate-100 text-slate-700 disabled:opacity-60"
              >
                <X size={14} /> Tutup
              </button>
            </div>

            <div className="space-y-2">
              <div className="relative">
                <input
                  value={editProductQuery}
                  onChange={(event) => {
                    const next = event.target.value;
                    setEditProductQuery(next);
                    setEditProductId('');
                    setSelectedEditProduct(null);
                    setSelectedEditUnitCost('');
                    setEditTargetUnitCost('');
                    setEditQtyLimit('');
                  }}
                  placeholder="Cari produk (nama/SKU)"
                  disabled={updating}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm w-full"
                />
                {editProductLoading && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400">
                    Mencari...
                  </div>
                )}
                {editProductOptions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-xl z-20 max-h-64 overflow-y-auto">
                    {editProductOptions.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        disabled={updating}
                        onClick={() => {
                          setEditProductId(p.id);
                          setSelectedEditProduct(p);
                          setEditProductQuery(`${p.name}${p.sku ? ` (${p.sku})` : ''}`);
                          setSelectedEditUnitCost('');
                          setEditTargetUnitCost('');
                          setEditQtyLimit('');
                          setEditProductOptions([]);
                        }}
                        className="w-full text-left p-3 hover:bg-slate-50 border-b last:border-0 disabled:opacity-60"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-black text-slate-900">{p.name || 'Produk'}</p>
                            <p className="text-[11px] text-slate-500">SKU: {p.sku || '-'}</p>
                            {p.stock_quantity !== undefined && p.stock_quantity !== null && (
                              <p className="text-[11px] text-slate-500">Stok: {Number(p.stock_quantity || 0).toLocaleString('id-ID')}</p>
                            )}
                          </div>
                          <p className="text-xs font-black text-emerald-700">{formatCurrency(Number(p.price || 0))}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedEditProduct && (
                <div className="text-xs text-slate-600">
                  Terpilih: <span className="font-bold text-slate-900">{selectedEditProduct.name}</span>{' '}
                  {selectedEditProduct.sku ? `(${selectedEditProduct.sku})` : ''}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-8 gap-2">
              <input
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                placeholder="Nama promo"
                disabled={updating}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm md:col-span-2"
              />
              <select
                value={selectedEditUnitCost}
                onChange={(event) => {
                  const v = event.target.value;
                  setSelectedEditUnitCost(v);
                  if (v) {
                    setEditTargetUnitCost(v);
                    const layer = editCostLayers.find((row) => String(row.unit_cost) === String(v));
                    if (layer && !String(editQtyLimit || '').trim()) {
                      const maxAllowed = Math.max(0, Math.trunc(Number(layer.qty_available || 0))) + Math.max(0, Math.trunc(Number(editQtyUsed || 0)));
                      if (maxAllowed > 0) setEditQtyLimit(String(maxAllowed));
                    }
                  }
                }}
                disabled={updating || editCostLayerLoading || !editProductId}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                title="Pilih dari cost layer (batch harga)"
              >
                <option value="">
                  {editCostLayerLoading ? 'Memuat layer...' : 'Ambil dari cost layer'}
                </option>
                {editCostLayers.map((layer) => (
                  <option key={String(layer.unit_cost)} value={String(layer.unit_cost)}>
                    {formatCurrency(Number(layer.unit_cost || 0))} — sisa {layer.qty_available.toLocaleString('id-ID')}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                step={1}
                value={editQtyLimit}
                onChange={(event) => setEditQtyLimit(event.target.value)}
                placeholder="Qty promo"
                disabled={updating || !selectedEditUnitCost}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                title="Batas maksimum qty yang boleh dipakai promo"
              />
              <select
                value={editPricingMode}
                onChange={(event) => setEditPricingMode(event.target.value as any)}
                disabled={updating}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
              >
                <option value="fixed_price">Harga Fix</option>
                <option value="percent_off">Diskon %</option>
              </select>
              {editPricingMode === 'fixed_price' ? (
                <input
                  type="number"
                  value={editPromoUnitPrice}
                  onChange={(event) => setEditPromoUnitPrice(event.target.value)}
                  placeholder="Harga promo (Rp)"
                  disabled={updating}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                />
              ) : (
                <div className="flex flex-col gap-1">
                  <input
                    type="number"
                    step="0.01"
                    value={editDiscountPct}
                    onChange={(event) => setEditDiscountPct(event.target.value)}
                    placeholder="Diskon (%)"
                    disabled={updating}
                    className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                  />
                  <p className="text-[10px] font-bold text-slate-500 px-1">
                    Harga promo:{' '}
                    <span className="text-slate-700">
                      {editPercentOffPreviewPrice > 0 ? formatCurrency(editPercentOffPreviewPrice) : '-'}
                    </span>
                  </p>
                </div>
              )}
              <input
                type="datetime-local"
                value={editStartsAt}
                onChange={(event) => setEditStartsAt(event.target.value)}
                disabled={updating}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
              />
              <input
                type="datetime-local"
                value={editEndsAt}
                onChange={(event) => setEditEndsAt(event.target.value)}
                disabled={updating}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
              />
            </div>

            {editProductId && !editCostLayerLoading && editCostLayers.length === 0 && (
              <div className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                Produk ini belum punya cost layer dengan stok tersedia. Target modal wajib dari batch stok.
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                <input
                  type="checkbox"
                  checked={editIsActive}
                  onChange={(event) => setEditIsActive(event.target.checked)}
                  disabled={updating}
                />
                Aktif
              </label>

              <button
                type="button"
                onClick={() => void handleUpdate()}
                disabled={updating || !editProductId || !selectedEditUnitCost || !String(editQtyLimit || '').trim()}
                className="inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-emerald-600 text-white disabled:opacity-60"
              >
                <Pencil size={12} /> {updating ? 'Menyimpan...' : 'Simpan Perubahan'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          <Link href="/admin" className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700">
            <ArrowLeft size={14} /> Kembali ke Dashboard Admin
          </Link>
          <h1 className="text-2xl font-black text-slate-900 mt-2">Manajemen Promo Cepat Habis</h1>
          <p className="text-sm text-slate-500 mt-1">
            Promo berbasis modal (batch cost layer). Checkout akan otomatis split promo + normal jika stok modal target kurang.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadPromos()}
          disabled={loading}
          className="inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-slate-100 text-slate-700 disabled:opacity-50"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-xs text-slate-700 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(event) => setIncludeInactive(event.target.checked)}
          />
          Tampilkan nonaktif
        </label>
        <Link
          href="/promo/cepat-habis"
          className="inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200"
        >
          <Layers size={14} /> Lihat Halaman Customer
        </Link>
      </div>

      {isSuperAdmin && (
        <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-3">
          <h2 className="text-sm font-black text-slate-900">Buat Promo Baru</h2>

          <div className="space-y-2">
            <div className="relative">
              <input
                value={createProductQuery}
                onChange={(event) => {
                  const next = event.target.value;
                  setCreateProductQuery(next);
                  setNewProductId('');
                  setSelectedCreateProduct(null);
                  setSelectedCreateUnitCost('');
                  setNewTargetUnitCost('');
                  setNewQtyLimit('');
                }}
                placeholder="Cari produk (nama/SKU)"
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm w-full"
              />
              {createProductLoading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400">
                  Mencari...
                </div>
              )}
              {createProductOptions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-xl z-20 max-h-64 overflow-y-auto">
                  {createProductOptions.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setNewProductId(p.id);
                        setSelectedCreateProduct(p);
                        setCreateProductQuery(`${p.name}${p.sku ? ` (${p.sku})` : ''}`);
                        setSelectedCreateUnitCost('');
                        setNewTargetUnitCost('');
                        setNewQtyLimit('');
                        setCreateProductOptions([]);
                      }}
                      className="w-full text-left p-3 hover:bg-slate-50 border-b last:border-0"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-black text-slate-900">{p.name || 'Produk'}</p>
                          <p className="text-[11px] text-slate-500">SKU: {p.sku || '-'}</p>
                          {p.stock_quantity !== undefined && p.stock_quantity !== null && (
                            <p className="text-[11px] text-slate-500">Stok: {Number(p.stock_quantity || 0).toLocaleString('id-ID')}</p>
                          )}
                        </div>
                        <p className="text-xs font-black text-emerald-700">{formatCurrency(Number(p.price || 0))}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedCreateProduct && (
              <div className="text-xs text-slate-600">
                Terpilih: <span className="font-bold text-slate-900">{selectedCreateProduct.name}</span>{' '}
                {selectedCreateProduct.sku ? `(${selectedCreateProduct.sku})` : ''}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-8 gap-2">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Nama promo (contoh: Stok Diskon Modal 7000)"
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm md:col-span-2"
            />
            <select
              value={selectedCreateUnitCost}
              onChange={(event) => {
                const v = event.target.value;
                setSelectedCreateUnitCost(v);
                if (v) {
                  setNewTargetUnitCost(v);
                  const layer = createCostLayers.find((row) => String(row.unit_cost) === String(v));
                  if (layer && !String(newQtyLimit || '').trim()) {
                    const maxQty = Math.max(0, Math.trunc(Number(layer.qty_available || 0)));
                    if (maxQty > 0) setNewQtyLimit(String(maxQty));
                  }
                }
              }}
              disabled={creating || createCostLayerLoading || !newProductId}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
              title="Pilih dari cost layer (batch harga)"
            >
              <option value="">
                {createCostLayerLoading ? 'Memuat layer...' : 'Ambil dari cost layer'}
              </option>
              {createCostLayers.map((layer) => (
                <option key={String(layer.unit_cost)} value={String(layer.unit_cost)}>
                  {formatCurrency(Number(layer.unit_cost || 0))} — sisa {layer.qty_available.toLocaleString('id-ID')}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              step={1}
              value={newQtyLimit}
              onChange={(event) => setNewQtyLimit(event.target.value)}
              placeholder="Qty promo"
              disabled={creating || !selectedCreateUnitCost}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
              title="Batas maksimum qty yang boleh dipakai promo"
            />
            <select
              value={newPricingMode}
              onChange={(event) => setNewPricingMode(event.target.value as any)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
            >
              <option value="fixed_price">Harga Fix</option>
              <option value="percent_off">Diskon %</option>
            </select>
            {newPricingMode === 'fixed_price' ? (
              <input
                type="number"
                value={newPromoUnitPrice}
                onChange={(event) => setNewPromoUnitPrice(event.target.value)}
                placeholder="Harga promo (Rp)"
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
              />
            ) : (
              <div className="flex flex-col gap-1">
                <input
                  type="number"
                  step="0.01"
                  value={newDiscountPct}
                  onChange={(event) => setNewDiscountPct(event.target.value)}
                  placeholder="Diskon (%)"
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                />
                <p className="text-[10px] font-bold text-slate-500 px-1">
                  Harga promo:{' '}
                  <span className="text-slate-700">
                    {createPercentOffPreviewPrice > 0 ? formatCurrency(createPercentOffPreviewPrice) : '-'}
                  </span>
                </p>
              </div>
            )}
            <input
              type="datetime-local"
              value={newStartsAt}
              onChange={(event) => setNewStartsAt(event.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
            />
            <input
              type="datetime-local"
              value={newEndsAt}
              onChange={(event) => setNewEndsAt(event.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
            />
          </div>

          {newProductId && !createCostLayerLoading && createCostLayers.length === 0 && (
            <div className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
              Produk ini belum punya cost layer dengan stok tersedia. Tidak bisa buat promo sebelum ada batch stok.
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
              <input
                type="checkbox"
                checked={newIsActive}
                onChange={(event) => setNewIsActive(event.target.checked)}
              />
              Aktif
            </label>

            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating || !newProductId || !selectedCreateUnitCost || !String(newQtyLimit || '').trim()}
              className="inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-emerald-600 text-white disabled:opacity-60"
            >
              <Plus size={12} /> {creating ? 'Membuat...' : 'Buat Promo'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black text-slate-900">Daftar Promo</h2>
          <p className="text-xs text-slate-500">{rowsWithComputedPrice.length} promo</p>
        </div>

        <div className="space-y-2">
          {rowsWithComputedPrice.length === 0 ? (
            <div className="text-sm text-slate-500">
              {loading ? 'Memuat promo...' : 'Belum ada promo cepat habis.'}
            </div>
          ) : (
            rowsWithComputedPrice.map((promo) => {
              const productName = String(promo.Product?.name || '');
              const productSku = String(promo.Product?.sku || '');
              const normalPrice = Number(promo.Product?.price || 0);
              const computedPromoPrice = Number((promo as any).computed_promo_unit_price || 0);
              const remainingQty = Math.max(0, Math.trunc(Number(promo.remaining_qty || 0)));
              const qtyLimit = (promo as any).qty_limit === null || (promo as any).qty_limit === undefined
                ? null
                : Math.max(0, Math.trunc(Number((promo as any).qty_limit || 0)));
              const qtyUsed = (promo as any).qty_used === null || (promo as any).qty_used === undefined
                ? 0
                : Math.max(0, Math.trunc(Number((promo as any).qty_used || 0)));
              const remainingAllocation = qtyLimit === null ? null : Math.max(0, qtyLimit - qtyUsed);
              const isProcessing = processingPromoId === promo.id;
              const isActiveNow =
                promo.is_active &&
                Number.isFinite(new Date(promo.starts_at).getTime()) &&
                Number.isFinite(new Date(promo.ends_at).getTime()) &&
                Date.now() >= new Date(promo.starts_at).getTime() &&
                Date.now() <= new Date(promo.ends_at).getTime();

              return (
                <div
                  key={promo.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-3 flex flex-col gap-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                        {isActiveNow ? 'Aktif Sekarang' : promo.is_active ? 'Aktif (Terjadwal)' : 'Nonaktif'}
                      </p>
                      <h3 className="text-sm font-black text-slate-900 mt-0.5">{promo.name}</h3>
                      <p className="text-xs text-slate-600 mt-1">
                        {productName || 'Produk'} {productSku ? `(${productSku})` : ''}
                      </p>
                    </div>
                    {isSuperAdmin && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={() => openEdit(promo)}
                          className="inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 disabled:opacity-60"
                        >
                          <Pencil size={14} /> Edit
                        </button>
                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={() => {
                            void handleToggleActive(promo);
                          }}
                          className={`inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl border disabled:opacity-60 ${
                            promo.is_active
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          }`}
                        >
                          {isProcessing ? 'Memproses...' : promo.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-xs">
                    <div className="bg-white border border-slate-200 rounded-xl p-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Target Modal</p>
                      <p className="font-black text-slate-900 mt-0.5">{formatCurrency(Number(promo.target_unit_cost || 0))}</p>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Harga Promo</p>
                      <p className="font-black text-slate-900 mt-0.5">{formatCurrency(computedPromoPrice)}</p>
                      {normalPrice > 0 && (
                        <p className="text-[10px] text-slate-500 mt-0.5">Normal {formatCurrency(normalPrice)}</p>
                      )}
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Qty Promo</p>
                      <p className="font-black text-slate-900 mt-0.5">
                        {qtyLimit === null ? '-' : qtyLimit.toLocaleString('id-ID')}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Terpakai {qtyUsed.toLocaleString('id-ID')} • Sisa alokasi {qtyLimit === null ? '-' : (remainingAllocation || 0).toLocaleString('id-ID')}
                      </p>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Periode</p>
                      <p className="text-[11px] font-bold text-slate-700 mt-0.5">{formatDateTime(promo.starts_at)}</p>
                      <p className="text-[11px] font-bold text-slate-700">{formatDateTime(promo.ends_at)}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">Sisa promo {remainingQty.toLocaleString('id-ID')}</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
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
