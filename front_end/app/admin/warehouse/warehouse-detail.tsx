'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProductRow } from '../inventory/types';
import { api } from '@/lib/api';
import { normalizeProductImageUrl } from '@/lib/image';
import { Camera, ExternalLink, History, Package, Save, X } from 'lucide-react';

interface WarehouseDetailProps {
    product: ProductRow | null;
    categories: Array<{ id: number; name: string }>;
    onClose: () => void;
    onProductUpdated?: (nextProduct: ProductRow) => void;
    mode?: 'info' | 'edit';
    onRequestEdit?: () => void;
}

interface EditFormState {
    sku: string;
    barcode: string;
    name: string;
    description: string;
    image_url: string;
    base_price: string;
    price: string;
    unit: string;
    stock_quantity: string;
    allocated_quantity: string;
    min_stock: string;
    category_id: string;
    category_ids: string[];
    status: 'active' | 'inactive';
    keterangan: string;
    tipe_modal: string;
    discount_regular_pct: string;
    discount_gold_pct: string;
    discount_platinum_pct: string;
    grosir_min_qty: string;
    grosir_price: string;
    total_modal: string;
    bin_location: string;
    vehicle_compatibility: string[];
}

interface ProductAllocationRow {
    allocation_id: string;
    allocated_qty: number;
    allocation_status: string | null;
    order_id: string | null;
    order_status: string | null;
    order_created_at: string | null;
    customer_name: string;
    invoice_number: string | null;
    payment_status: string | null;
    is_order_open: boolean;
}

interface ProductAllocationResponse {
    product_id: string;
    total_allocated: number;
    open_allocated: number;
    order_count: number;
    rows: ProductAllocationRow[];
}

interface MutationRow {
    id: string;
    type: 'in' | 'out' | string;
    qty: number;
    note?: string | null;
    reference_id?: string | null;
    createdAt: string;
}

const getErrorMessage = (error: unknown, fallback: string) => {
    if (typeof error === 'object' && error !== null) {
        const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
        if (typeof responseMessage === 'string' && responseMessage.trim()) return responseMessage;
        const message = (error as { message?: unknown }).message;
        if (typeof message === 'string' && message.trim()) return message;
    }
    return fallback;
};

const toNullableNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
};

const clampPercentage = (value: unknown): number => {
    const parsed = toNullableNumber(value);
    if (parsed === null) return 0;
    return Math.min(100, Math.max(0, parsed));
};

const calculatePriceAfterDiscount = (basePrice: number, discountPct: number) => {
    const safeBase = Math.max(0, basePrice);
    const safePct = Math.min(100, Math.max(0, discountPct));
    return Math.max(0, Math.round((safeBase * (1 - safePct / 100)) * 100) / 100);
};

const toDiscountFromPrice = (basePrice: number, tierPriceRaw: unknown): number | null => {
    const tierPrice = toNullableNumber(tierPriceRaw);
    if (!Number.isFinite(basePrice) || basePrice <= 0 || tierPrice === null) return null;
    const pct = ((basePrice - tierPrice) / basePrice) * 100;
    return clampPercentage(pct);
};

const parseVarianDiscounts = (value: unknown, sellingPrice: number): { regular: number; gold: number; platinum: number } => {
    if (value === null || value === undefined || value === '') {
        return { regular: 0, gold: 0, platinum: 0 };
    }

    let parsedValue: unknown = value;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return { regular: 0, gold: 0, platinum: 0 };
        try {
            parsedValue = JSON.parse(trimmed);
        } catch {
            const singlePct = clampPercentage(trimmed);
            return { regular: singlePct, gold: 0, platinum: 0 };
        }
    }

    if (!parsedValue || typeof parsedValue !== 'object') {
        return { regular: 0, gold: 0, platinum: 0 };
    }

    const obj = parsedValue as Record<string, unknown>;
    const discountsBlock = (obj.discounts_pct && typeof obj.discounts_pct === 'object')
        ? (obj.discounts_pct as Record<string, unknown>)
        : {};
    const pricesBlock = (obj.prices && typeof obj.prices === 'object')
        ? (obj.prices as Record<string, unknown>)
        : {};

    const resolve = (tier: 'regular' | 'gold' | 'platinum') => {
        const tierValue = obj[tier];
        if (tierValue && typeof tierValue === 'object') {
            const tierObj = tierValue as Record<string, unknown>;
            const directPct = toNullableNumber(tierObj.discount_pct);
            if (directPct !== null) return clampPercentage(directPct);

            const byTierPrice = toDiscountFromPrice(sellingPrice, tierObj.price);
            if (byTierPrice !== null) return byTierPrice;
        }

        const directPct =
            toNullableNumber(obj[`${tier}_discount_pct`]) ??
            toNullableNumber(discountsBlock[tier]);
        if (directPct !== null) return clampPercentage(directPct);

        const byPrice =
            toDiscountFromPrice(sellingPrice, obj[`${tier}_price`]) ??
            toDiscountFromPrice(sellingPrice, pricesBlock[tier]) ??
            toDiscountFromPrice(sellingPrice, obj[tier]);
        if (byPrice !== null) return byPrice;

        return 0;
    };

    return {
        regular: resolve('regular'),
        gold: resolve('gold'),
        platinum: resolve('platinum'),
    };
};

const parseGrosirConfig = (value: unknown, fallbackPrice: number): { minQty: number; price: number } => {
    const safeFallbackPrice = Math.max(0, fallbackPrice);

    if (value === null || value === undefined || value === '') {
        return { minQty: 10, price: safeFallbackPrice };
    }

    let parsedValue: unknown = value;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return { minQty: 10, price: safeFallbackPrice };
        try {
            parsedValue = JSON.parse(trimmed);
        } catch {
            const parsedPrice = toNullableNumber(trimmed);
            return {
                minQty: 10,
                price: Math.max(0, parsedPrice ?? safeFallbackPrice),
            };
        }
    }

    if (Array.isArray(parsedValue) && parsedValue.length > 0 && parsedValue[0] && typeof parsedValue[0] === 'object') {
        const item = parsedValue[0] as Record<string, unknown>;
        const minQtyRaw = toNullableNumber(item.min_qty ?? item.qty ?? item.minQty);
        const priceRaw = toNullableNumber(item.price ?? item.harga);
        return {
            minQty: Math.max(0, Math.trunc(minQtyRaw ?? 10)),
            price: Math.max(0, priceRaw ?? safeFallbackPrice),
        };
    }

    if (parsedValue && typeof parsedValue === 'object') {
        const item = parsedValue as Record<string, unknown>;
        const minQtyRaw = toNullableNumber(item.min_qty ?? item.qty ?? item.minQty);
        const priceRaw = toNullableNumber(item.price ?? item.harga);
        return {
            minQty: Math.max(0, Math.trunc(minQtyRaw ?? 10)),
            price: Math.max(0, priceRaw ?? safeFallbackPrice),
        };
    }

    const parsedPrice = toNullableNumber(parsedValue);
    return {
        minQty: 10,
        price: Math.max(0, parsedPrice ?? safeFallbackPrice),
    };
};

const parseVehicleCompatibilityToArray = (value: unknown): string[] => {
    const raw = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
    if (!raw) return [];

    let tokens: string[] = [];
    if (raw.startsWith('[')) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                tokens = parsed.map((item) => String(item ?? '').trim()).filter(Boolean);
            }
        } catch {
            // fallthrough
        }
    }
    if (tokens.length === 0) {
        tokens = raw.split(/[\n,;|]+/g).map((t) => t.trim()).filter(Boolean);
    }

    const seen = new Set<string>();
    const result: string[] = [];
    for (const token of tokens) {
        const normalized = token.replace(/\s+/g, ' ').trim();
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(normalized);
    }
    return result;
};

const toFormState = (product: ProductRow): EditFormState => {
    const sellingPrice = Math.max(0, Number(product.price || 0));
    const discounts = parseVarianDiscounts(product.varian_harga, sellingPrice);
    const grosir = parseGrosirConfig(product.grosir, sellingPrice);
    const primaryCategoryId = String(product.category_id || '').trim();
    const taggedCategoryIds = Array.isArray(product.Categories)
        ? product.Categories.map((item) => String(item?.id ?? '').trim()).filter(Boolean)
        : [];
    const mergedCategoryIds = [primaryCategoryId, ...taggedCategoryIds].filter(Boolean);
    const uniqueCategoryIds: string[] = [];
    const seenCategoryIds = new Set<string>();
    for (const id of mergedCategoryIds) {
        if (seenCategoryIds.has(id)) continue;
        seenCategoryIds.add(id);
        uniqueCategoryIds.push(id);
    }

    return {
        sku: String(product.sku || ''),
        barcode: String(product.barcode || ''),
        name: String(product.name || ''),
        description: String(product.description || ''),
        image_url: normalizeProductImageUrl(product.image_url),
        base_price: String(product.base_price ?? 0),
        price: String(product.price ?? 0),
        unit: String(product.unit || 'Pcs'),
        stock_quantity: String(Number(product.stock_quantity || 0)),
        allocated_quantity: String(Number(product.allocated_quantity || 0)),
        min_stock: String(Number(product.min_stock || 0)),
        category_id: primaryCategoryId,
        category_ids: uniqueCategoryIds,
        status: product.status === 'inactive' ? 'inactive' : 'active',
        keterangan: String(product.keterangan || ''),
        tipe_modal: String(product.tipe_modal || ''),
        discount_regular_pct: String(discounts.regular),
        discount_gold_pct: String(discounts.gold),
        discount_platinum_pct: String(discounts.platinum),
        grosir_min_qty: String(grosir.minQty),
        grosir_price: String(grosir.price),
        total_modal: product.total_modal === null || product.total_modal === undefined ? '' : String(product.total_modal),
        bin_location: String(product.bin_location || ''),
        vehicle_compatibility: parseVehicleCompatibilityToArray(product.vehicle_compatibility),
    };
};

const parseRequiredNonNegativeNumber = (value: string, label: string, integer = false): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`${label} harus berupa angka yang valid.`);
    if (parsed < 0) throw new Error(`${label} tidak boleh negatif.`);
    if (integer && !Number.isInteger(parsed)) throw new Error(`${label} harus bilangan bulat.`);
    return parsed;
};

const parseOptionalNonNegativeNumber = (value: string, label: string): number | null => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) throw new Error(`${label} harus berupa angka yang valid.`);
    if (parsed < 0) throw new Error(`${label} tidak boleh negatif.`);
    return parsed;
};

type MultiSelectOption = {
    value: string;
    label: string;
};

const normalizeIdList = (ids: string[]): string[] => {
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const raw of ids) {
        const trimmed = String(raw ?? '').trim();
        if (!trimmed) continue;
        if (!/^\d+$/.test(trimmed)) continue;
        const normalized = String(Math.max(0, Math.trunc(Number(trimmed))));
        if (normalized === '0') continue;
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        unique.push(normalized);
    }
    return unique;
};

const MultiSelectCombobox = ({
    value,
    options,
    onChange,
    placeholder = 'Ketik untuk mencari...',
    disabled = false,
}: {
    value: string[];
    options: MultiSelectOption[];
    onChange: (next: string[]) => void;
    placeholder?: string;
    disabled?: boolean;
}) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');

    const selectedSet = useMemo(() => new Set(value), [value]);

    const filteredOptions = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return options;
        return options.filter((opt) => opt.label.toLowerCase().includes(q));
    }, [options, query]);

    const toggleValue = useCallback((nextValue: string) => {
        onChange(selectedSet.has(nextValue)
            ? value.filter((v) => v !== nextValue)
            : [...value, nextValue]
        );
    }, [onChange, selectedSet, value]);

    useEffect(() => {
        if (!open) return;
        const handler = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (!target) return;
            if (containerRef.current && !containerRef.current.contains(target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const selectedChips = value
        .map((v) => options.find((opt) => opt.value === v) ?? { value: v, label: v });

    return (
        <div ref={containerRef} className="mt-1 relative">
            <button
                type="button"
                disabled={disabled}
                onClick={() => setOpen((prev) => !prev)}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-left text-xs outline-none focus:border-emerald-500 bg-white disabled:bg-slate-100 disabled:text-slate-500"
            >
                <div className="flex flex-wrap gap-1.5">
                    {selectedChips.length === 0 ? (
                        <span className="text-slate-400">{placeholder}</span>
                    ) : (
                        selectedChips.map((chip) => (
                            <span
                                key={chip.value}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700"
                                onClick={(e) => e.stopPropagation()}
                            >
                                {chip.label}
                                <span
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => toggleValue(chip.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') toggleValue(chip.value);
                                    }}
                                    className="ml-0.5 inline-flex items-center justify-center rounded hover:bg-slate-200 px-0.5"
                                    aria-label={`Hapus ${chip.label}`}
                                >
                                    <X size={12} />
                                </span>
                            </span>
                        ))
                    )}
                </div>
            </button>

            {open && !disabled && (
                <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
                    <div className="p-2 border-b border-slate-100">
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Cari..."
                            className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-emerald-500"
                            autoFocus
                        />
                        {value.length > 0 && (
                            <button
                                type="button"
                                onClick={() => onChange([])}
                                className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                            >
                                Kosongkan pilihan
                            </button>
                        )}
                    </div>
                    <div className="max-h-[220px] overflow-auto">
                        {filteredOptions.length === 0 ? (
                            <div className="p-3 text-xs text-slate-500">Tidak ada hasil.</div>
                        ) : (
                            filteredOptions.map((opt) => {
                                const checked = selectedSet.has(opt.value);
                                return (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() => toggleValue(opt.value)}
                                        className={`w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-slate-50 ${checked ? 'bg-emerald-50' : 'bg-white'}`}
                                    >
                                        <span className="text-slate-800">{opt.label}</span>
                                        <span className={`text-[11px] font-black ${checked ? 'text-emerald-700' : 'text-slate-300'}`}>
                                            {checked ? 'TERPILIH' : '—'}
                                        </span>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default function WarehouseDetailPanel({ product, categories, onClose, onProductUpdated, mode = 'info', onRequestEdit }: WarehouseDetailProps) {
    const [mutations, setMutations] = useState<MutationRow[]>([]);
    const [loadingMutations, setLoadingMutations] = useState(false);
    const [allocationRows, setAllocationRows] = useState<ProductAllocationRow[]>([]);
    const [allocationSummary, setAllocationSummary] = useState({ totalAllocated: 0, openAllocated: 0, orderCount: 0 });
    const [loadingAllocations, setLoadingAllocations] = useState(false);
    const [allocationError, setAllocationError] = useState<string | null>(null);
    const [form, setForm] = useState<EditFormState | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [vehicleOptions, setVehicleOptions] = useState<string[]>([]);
    const [loadingVehicleOptions, setLoadingVehicleOptions] = useState(false);

    useEffect(() => {
        if (!product) {
            setForm(null);
            setMutations([]);
            setAllocationRows([]);
            setAllocationSummary({ totalAllocated: 0, openAllocated: 0, orderCount: 0 });
            setAllocationError(null);
            return;
        }
        setForm(toFormState(product));
        setFeedback(null);
    }, [product]);

    useEffect(() => {
        setLoadingVehicleOptions(true);
        api.admin.inventory.getVehicleTypes()
            .then((res) => {
                const list = Array.isArray(res.data?.options) ? res.data.options : [];
                setVehicleOptions(list.map((v: unknown) => String(v ?? '').trim()).filter(Boolean));
            })
            .catch(() => {
                setVehicleOptions([]);
            })
            .finally(() => setLoadingVehicleOptions(false));
    }, []);

    useEffect(() => {
        if (!product?.id) {
            setMutations([]);
            return;
        }
        setLoadingMutations(true);
        api.admin.inventory.getMutations(product.id)
            .then((res) => {
                const rows = Array.isArray(res.data?.mutations) ? res.data.mutations : [];
                const mapped: MutationRow[] = rows.map((row: Record<string, unknown>) => ({
                    id: String(row.id ?? ''),
                    type: String(row.type ?? ''),
                    qty: Number(row.qty ?? 0),
                    note: row.note ? String(row.note) : null,
                    reference_id: row.reference_id ? String(row.reference_id) : null,
                    createdAt: String(row.createdAt ?? ''),
                })).filter((row: MutationRow) => Boolean(row.id));
                setMutations(mapped.slice(0, 10));
            })
            .catch(() => setMutations([]))
            .finally(() => setLoadingMutations(false));
    }, [product?.id]);

    useEffect(() => {
        if (!product?.id) {
            setAllocationRows([]);
            setAllocationSummary({ totalAllocated: 0, openAllocated: 0, orderCount: 0 });
            return;
        }

        let active = true;
        setLoadingAllocations(true);
        setAllocationError(null);

        api.allocation.getByProduct(product.id)
            .then((res) => {
                if (!active) return;
                const payload = (res.data || {}) as ProductAllocationResponse;
                const rows = Array.isArray(payload.rows) ? payload.rows : [];
                setAllocationRows(rows);
                setAllocationSummary({
                    totalAllocated: Number(payload.total_allocated || 0),
                    openAllocated: Number(payload.open_allocated || 0),
                    orderCount: Number(payload.order_count || rows.length || 0),
                });
            })
            .catch(() => {
                if (!active) return;
                setAllocationRows([]);
                setAllocationSummary({ totalAllocated: 0, openAllocated: 0, orderCount: 0 });
                setAllocationError('Gagal memuat data alokasi order untuk SKU ini.');
            })
            .finally(() => {
                if (active) setLoadingAllocations(false);
            });

        return () => {
            active = false;
        };
    }, [product?.id]);

    const categoryDisplay = useMemo(() => {
        if (!form?.category_id) return '';
        const categoryId = Number(form.category_id);
        const byList = categories.find((item) => item.id === categoryId)?.name;
        return byList || product?.Category?.name || '';
    }, [categories, form?.category_id, product?.Category?.name]);

    const tierPrices = useMemo(() => {
        if (!form) {
            return { regular: 0, gold: 0, platinum: 0 };
        }

        const sellingPrice = Math.max(0, Number(form.price || 0));
        const regularPct = clampPercentage(form.discount_regular_pct);
        const goldPct = clampPercentage(form.discount_gold_pct);
        const platinumPct = clampPercentage(form.discount_platinum_pct);

        return {
            regular: calculatePriceAfterDiscount(sellingPrice, regularPct),
            gold: calculatePriceAfterDiscount(sellingPrice, goldPct),
            platinum: calculatePriceAfterDiscount(sellingPrice, platinumPct),
        };
    }, [form]);

    if (!product || !form) {
        return (
            <div className="h-full flex items-center justify-center text-slate-300 p-8 text-center">
                <div>
                    <Package size={48} className="mx-auto mb-4 opacity-50" />
                    <p className="font-bold text-base mb-1 text-slate-400">Pilih Produk</p>
                    <p className="text-sm text-slate-400">Klik baris pada tabel untuk membuka mode edit produk.</p>
                </div>
            </div>
        );
    }

    const setField = <K extends keyof EditFormState>(key: K, value: EditFormState[K]) => {
        setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    };

    const saveProduct = async () => {
        if (!product || !form) return;
        if (mode !== 'edit') return;
        setIsSaving(true);
        setFeedback(null);

        try {
            const sku = form.sku.trim();
            const name = form.name.trim();
            const unit = form.unit.trim() || 'Pcs';
            const normalizedCategoryIds = normalizeIdList(form.category_ids);
            const primaryCategoryIdText = (form.category_id && normalizedCategoryIds.includes(form.category_id))
                ? form.category_id
                : (normalizedCategoryIds[0] || form.category_id);
            const categoryId = Number(primaryCategoryIdText);

            if (!sku) throw new Error('SKU wajib diisi.');
            if (!name) throw new Error('Nama produk wajib diisi.');
            if (!Number.isInteger(categoryId) || categoryId <= 0) throw new Error('Kategori wajib dipilih.');
            if (normalizedCategoryIds.length === 0) throw new Error('Minimal pilih 1 kategori.');

            const nextStock = parseRequiredNonNegativeNumber(form.stock_quantity, 'Stok Fisik', true);
            const minStock = parseRequiredNonNegativeNumber(form.min_stock, 'Min Stok', true);
            const basePrice = parseRequiredNonNegativeNumber(form.base_price, 'Harga Modal');
            const totalModal = parseOptionalNonNegativeNumber(form.total_modal, 'Total Modal');

            const grosirMinQty = parseRequiredNonNegativeNumber(form.grosir_min_qty || '10', 'Min Qty Grosir', true);
            const productSellingPrice = Math.max(0, Number(product.price || 0));
            const grosirPrice = parseRequiredNonNegativeNumber(form.grosir_price || String(productSellingPrice), 'Harga Grosir');

            const grosir = {
                min_qty: Math.max(0, Math.trunc(grosirMinQty)),
                price: Math.max(0, grosirPrice),
            };

            const orderedCategoryIds = normalizeIdList([String(categoryId), ...normalizedCategoryIds]);
            const updatePayload: Record<string, unknown> = {
                sku,
                barcode: form.barcode.trim() || null,
                name,
                description: form.description.trim() || null,
                image_url: form.image_url.trim() || null,
                base_price: basePrice,
                unit,
                min_stock: minStock,
                category_id: categoryId,
                category_ids: orderedCategoryIds.map((id) => Number(id)),
                status: form.status,
                keterangan: form.keterangan.trim() || null,
                tipe_modal: form.tipe_modal.trim() || null,
                grosir,
                total_modal: totalModal,
                bin_location: form.bin_location.trim() || null,
                vehicle_compatibility: form.vehicle_compatibility.length > 0 ? form.vehicle_compatibility : null,
            };

            const updateRes = await api.admin.inventory.updateProduct(product.id, updatePayload);

            const currentStock = Number(product.stock_quantity || 0);
            if (nextStock !== currentStock) {
                const diff = nextStock - currentStock;
                await api.admin.inventory.createMutation({
                    product_id: product.id,
                    type: diff > 0 ? 'in' : 'out',
                    qty: Math.abs(diff),
                    note: 'Penyesuaian stok dari mode edit Warehouse Command Center',
                    reference_id: `WHS-EDIT-${Date.now()}`
                });
            }

            const updatedCategoryName = categories.find((item) => item.id === categoryId)?.name;
            const selectedCategories = orderedCategoryIds
                .map((id) => Number(id))
                .filter((id) => Number.isInteger(id) && id > 0)
                .map((id) => {
                    const name = categories.find((item) => item.id === id)?.name;
                    return name ? { id, name } : null;
                })
                .filter(Boolean) as Array<{ id: number; name: string }>;
	            const mergedProduct: ProductRow = {
	                ...product,
	                ...(updateRes.data || {}),
                stock_quantity: nextStock,
                min_stock: minStock,
                base_price: basePrice,
                category_id: categoryId,
                Category: updatedCategoryName ? { name: updatedCategoryName } : product.Category,
                Categories: selectedCategories.length > 0 ? selectedCategories : product.Categories,
                grosir,
	                total_modal: totalModal,
	                bin_location: form.bin_location.trim() || null,
	                vehicle_compatibility: form.vehicle_compatibility.length > 0 ? JSON.stringify(form.vehicle_compatibility) : null,
	            };

            setForm(toFormState(mergedProduct));
            setFeedback({ type: 'success', message: 'Data produk berhasil diperbarui.' });
            onProductUpdated?.(mergedProduct);

            api.admin.inventory.getMutations(product.id)
                .then((res) => {
                    const rows = Array.isArray(res.data?.mutations) ? res.data.mutations : [];
                    const mapped: MutationRow[] = rows.map((row: Record<string, unknown>) => ({
                        id: String(row.id ?? ''),
                        type: String(row.type ?? ''),
                        qty: Number(row.qty ?? 0),
                        note: row.note ? String(row.note) : null,
                        reference_id: row.reference_id ? String(row.reference_id) : null,
                        createdAt: String(row.createdAt ?? ''),
                    })).filter((row: MutationRow) => Boolean(row.id));
                    setMutations(mapped.slice(0, 10));
                })
                .catch(() => undefined);
        } catch (error: unknown) {
            const message = getErrorMessage(error, 'Gagal menyimpan perubahan produk.');
            setFeedback({ type: 'error', message });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="h-full flex flex-col bg-white border-l border-slate-200">
            <div className="flex items-start justify-between p-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
                <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-black text-slate-900 leading-tight truncate">{product.name}</h2>
                    <p className="text-emerald-600 font-mono font-bold text-xs mt-0.5">{product.sku}</p>
                    <p className="text-[11px] text-slate-500 mt-1">{mode === 'edit' ? 'Mode Edit Produk' : 'Alokasi & Mutasi Produk'}</p>
                </div>
                <div className="flex items-center gap-1.5 ml-2">
                    {mode === 'edit' ? (
                        <button
                            onClick={saveProduct}
                            disabled={isSaving}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 text-xs font-black min-h-0 min-w-0"
                        >
                            <Save size={14} />
                            {isSaving ? 'Menyimpan...' : 'Simpan'}
                        </button>
                    ) : onRequestEdit ? (
                        <button
                            onClick={onRequestEdit}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-black min-h-0 min-w-0"
                        >
                            Aktifkan Edit
                        </button>
                    ) : null}
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors min-h-0 min-w-0"
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-8 space-y-4">
                {feedback && (
                    <div className={`rounded-xl border px-3 py-2 text-xs font-semibold ${feedback.type === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : 'bg-rose-50 border-rose-200 text-rose-700'
                        }`}>
                        {feedback.message}
                    </div>
                )}

                <div className="aspect-[4/3] w-full bg-slate-100 rounded-2xl border border-slate-200 overflow-hidden">
                    {form.image_url ? (
                        <Image src={form.image_url} alt={form.name} className="w-full h-full object-contain" width={800} height={600} />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-300">
                            <Camera size={40} />
                        </div>
                    )}
                </div>

                {mode === 'edit' ? (
                    <>
                        <section className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Identitas Produk</p>
                            <div className="grid grid-cols-2 gap-2">
                                <label className="col-span-1">
                                    <span className="text-[11px] text-slate-500 font-semibold">SKU</span>
                                    <input value={form.sku} onChange={(e) => setField('sku', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-emerald-500" />
                                </label>
                                <label className="col-span-1">
                                    <span className="text-[11px] text-slate-500 font-semibold">Barcode</span>
                                    <input value={form.barcode} onChange={(e) => setField('barcode', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-emerald-500" />
                                </label>
                                <label className="col-span-2">
                                    <span className="text-[11px] text-slate-500 font-semibold">Nama Barang</span>
                                    <input value={form.name} onChange={(e) => setField('name', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-emerald-500" />
                                </label>
                                <label className="col-span-2">
                                    <span className="text-[11px] text-slate-500 font-semibold">URL Gambar</span>
                                    <input value={form.image_url} onChange={(e) => setField('image_url', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-emerald-500" />
                                </label>
                                <label className="col-span-2">
                                    <span className="text-[11px] text-slate-500 font-semibold">Deskripsi</span>
                                    <textarea value={form.description} onChange={(e) => setField('description', e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-emerald-500 resize-none" />
                                </label>
                            </div>
                        </section>

                        <section className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Harga, Stok, Status</p>
                            <div className="grid grid-cols-2 gap-2">
                                <label>
                                    <span className="text-[11px] text-slate-500 font-semibold">Harga Modal</span>
                                    <input type="number" min="0" value={form.base_price} onChange={(e) => setField('base_price', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-emerald-500" />
                                </label>
                                <label>
                                    <span className="text-[11px] text-slate-500 font-semibold">Harga Jual</span>
                                    <input type="number" min="0" value={form.price} disabled className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs bg-slate-100 text-slate-600" />
                                    <p className="mt-1 text-[10px] text-slate-500">Harga jual dikelola dari menu Admin Sales.</p>
                                </label>
                                <label>
                                    <span className="text-[11px] text-slate-500 font-semibold">Unit</span>
                                    <input value={form.unit} onChange={(e) => setField('unit', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-emerald-500" />
                                </label>
                                <label>
                                    <span className="text-[11px] text-slate-500 font-semibold">Lokasi Rak</span>
                                    <input value={form.bin_location} onChange={(e) => setField('bin_location', e.target.value.toUpperCase())} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-emerald-500" />
                                </label>
                                <label>
                                    <span className="text-[11px] text-slate-500 font-semibold">Stok Fisik (target)</span>
                                    <input type="number" min="0" value={form.stock_quantity} onChange={(e) => setField('stock_quantity', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-emerald-500" />
                                </label>
                                <label>
                                    <span className="text-[11px] text-slate-500 font-semibold">Teralokasi (read only)</span>
                                    <input value={form.allocated_quantity} disabled className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs bg-slate-100 text-slate-600" />
                                </label>
                                <label>
                                    <span className="text-[11px] text-slate-500 font-semibold">Min Stok</span>
                                    <input type="number" min="0" value={form.min_stock} onChange={(e) => setField('min_stock', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-emerald-500" />
                                </label>
                                <label>
                                    <span className="text-[11px] text-slate-500 font-semibold">Status Data</span>
                                    <select value={form.status} onChange={(e) => setField('status', e.target.value as 'active' | 'inactive')} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-emerald-500 bg-white">
                                        <option value="active">active</option>
                                        <option value="inactive">inactive</option>
                                    </select>
                                </label>
                            </div>
                        </section>

                        <section className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Kategori & Metadata</p>
                            <div className="grid grid-cols-2 gap-2">
                                <label className="col-span-2">
                                    <span className="text-[11px] text-slate-500 font-semibold">Kategori (Multi)</span>
                                    <MultiSelectCombobox
                                        value={form.category_ids}
                                        options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
                                        onChange={(next) => {
                                            const normalized = normalizeIdList(next);
                                            setForm((prev) => {
                                                if (!prev) return prev;
                                                const primary = prev.category_id && normalized.includes(prev.category_id)
                                                    ? prev.category_id
                                                    : (normalized[0] || '');
                                                return { ...prev, category_ids: normalized, category_id: primary };
                                            });
                                        }}
                                        placeholder="Pilih satu atau lebih kategori..."
                                    />
                                    <div className="mt-2 grid grid-cols-2 gap-2">
                                        <label className="col-span-2">
                                            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Kategori Utama (untuk diskon/harga)</span>
                                            <select
                                                value={form.category_id}
                                                onChange={(e) => {
                                                    const nextPrimary = String(e.target.value || '').trim();
                                                    setForm((prev) => {
                                                        if (!prev) return prev;
                                                        const normalized = normalizeIdList([...prev.category_ids, nextPrimary]);
                                                        const primary = nextPrimary && normalized.includes(nextPrimary) ? nextPrimary : (normalized[0] || '');
                                                        const ordered = primary ? [primary, ...normalized.filter((id) => id !== primary)] : normalized;
                                                        return { ...prev, category_id: primary, category_ids: ordered };
                                                    });
                                                }}
                                                className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-emerald-500 bg-white"
                                            >
                                                <option value="">Pilih kategori utama</option>
                                                {form.category_ids.map((id) => {
                                                    const idNum = Number(id);
                                                    const name = categories.find((item) => item.id === idNum)?.name || `#${id}`;
                                                    return (
                                                        <option key={id} value={id}>
                                                            {name}
                                                        </option>
                                                    );
                                                })}
                                            </select>
                                        </label>
                                    </div>
                                    <p className="mt-1 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                                        Tips: gunakan pencarian. Multi-kategori disimpan ke tag, dan kategori utama disimpan ke field utama.
                                    </p>
                                </label>
                                <label>
                                    <span className="text-[11px] text-slate-500 font-semibold">Tipe Modal</span>
                                    <input value={form.tipe_modal} onChange={(e) => setField('tipe_modal', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-emerald-500" />
                                </label>
                                <label>
                                    <span className="text-[11px] text-slate-500 font-semibold">Total Modal</span>
                                    <input type="number" min="0" value={form.total_modal} onChange={(e) => setField('total_modal', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-emerald-500" />
                                </label>
                                <label className="col-span-1">
                                    <span className="text-[11px] text-slate-500 font-semibold">Kategori Aktif</span>
                                    <input value={categoryDisplay || '—'} disabled className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs bg-slate-100 text-slate-600" />
                                </label>
                                <label className="col-span-2">
                                    <span className="text-[11px] text-slate-500 font-semibold">Keterangan</span>
                                    <textarea value={form.keterangan} onChange={(e) => setField('keterangan', e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-emerald-500 resize-none" />
                                </label>
                                <label className="col-span-2">
                                    <span className="text-[11px] text-slate-500 font-semibold">Vehicle Compatibility</span>
                                    {loadingVehicleOptions ? (
                                        <div className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-400">
                                            Memuat master jenis kendaraan...
                                        </div>
                                    ) : vehicleOptions.length === 0 ? (
                                        <div className="mt-1 w-full rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-700">
                                            Master jenis kendaraan belum ada. Tambahkan dulu di menu{' '}
                                            <Link href="/admin/warehouse/vehicle-types" className="font-black underline underline-offset-2">
                                                Jenis Kendaraan
                                            </Link>
                                            .
                                        </div>
                                    ) : (
                                        <>
                                            <MultiSelectCombobox
                                                value={form.vehicle_compatibility}
                                                options={vehicleOptions.map((opt) => ({ value: opt, label: opt }))}
                                                onChange={(next) => setField('vehicle_compatibility', next)}
                                                placeholder="Cari & pilih jenis kendaraan..."
                                            />
                                            <p className="mt-1 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                                                Klik untuk pilih beberapa item. Gunakan pencarian untuk mempercepat.
                                            </p>
                                        </>
                                    )}
                                </label>
                            </div>
                        </section>

                        <section className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Harga Tier & Grosir</p>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
                                    <p className="font-bold text-slate-800">Harga Tier Member (Read Only dari Gudang)</p>
                                    <p>Reguler: Rp {tierPrices.regular.toLocaleString('id-ID')}</p>
                                    <p>Gold: Rp {tierPrices.gold.toLocaleString('id-ID')}</p>
                                    <p>Platinum: Rp {tierPrices.platinum.toLocaleString('id-ID')}</p>
                                    <p className="mt-1 text-[11px] font-bold text-emerald-700">Ubah di Admin Sales / Kasir.</p>
                                </div>
                                <label>
                                    <span className="text-[11px] text-slate-500 font-semibold">Grosir Min Qty</span>
                                    <input type="number" min="0" value={form.grosir_min_qty} onChange={(e) => setField('grosir_min_qty', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-emerald-500" />
                                </label>
                                <label className="col-span-2">
                                    <span className="text-[11px] text-slate-500 font-semibold">Harga Grosir</span>
                                    <input type="number" min="0" value={form.grosir_price} onChange={(e) => setField('grosir_price', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-emerald-500" />
                                </label>
                            </div>

                        </section>
                    </>
                ) : null}

                <section className="space-y-2">
                    <h3 className="font-bold text-slate-900 text-sm">Lacak Alokasi SKU</h3>
                    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
                        <div className="grid grid-cols-3 gap-2">
                            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                                <p className="text-[10px] font-bold text-slate-500 uppercase">Total Alokasi</p>
                                <p className="text-sm font-black text-slate-800">{allocationSummary.totalAllocated}</p>
                            </div>
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5">
                                <p className="text-[10px] font-bold text-emerald-600 uppercase">Masih Open</p>
                                <p className="text-sm font-black text-emerald-700">{allocationSummary.openAllocated}</p>
                            </div>
                            <div className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5">
                                <p className="text-[10px] font-bold text-blue-600 uppercase">Jumlah Order</p>
                                <p className="text-sm font-black text-blue-700">{allocationSummary.orderCount}</p>
                            </div>
                        </div>

                        <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
                            {loadingAllocations ? (
                                <div className="p-4 text-center text-slate-400 animate-pulse">Memuat alokasi order...</div>
                            ) : allocationError ? (
                                <div className="p-4 text-center text-rose-600">{allocationError}</div>
                            ) : allocationRows.length === 0 ? (
                                <div className="p-4 text-center text-slate-400 italic">Belum ada order yang mengalokasikan SKU ini.</div>
                            ) : (
                                <table className="w-full text-left">
                                    <thead className="bg-slate-50 text-slate-500 font-bold text-[10px] uppercase">
                                        <tr>
                                            <th className="px-3 py-2">Order</th>
                                            <th className="px-3 py-2">Customer</th>
                                            <th className="px-3 py-2 text-right">Qty</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {allocationRows.map((row) => (
                                            <tr key={String(row.allocation_id)} className={row.is_order_open ? 'bg-white' : 'bg-slate-50/80'}>
                                                <td className="px-3 py-2 align-top">
                                                    {row.order_id ? (
                                                        <Link
                                                            href={`/admin/orders/${row.order_id}`}
                                                            className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:text-blue-900 hover:underline"
                                                        >
                                                            #{String(row.order_id).slice(0, 8)}
                                                            <ExternalLink size={12} />
                                                        </Link>
                                                    ) : (
                                                        <span className="text-slate-400">—</span>
                                                    )}
                                                    <div className="mt-1">
                                                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${row.is_order_open
                                                            ? 'bg-amber-100 text-amber-700'
                                                            : 'bg-slate-200 text-slate-600'
                                                            }`}>
                                                            {row.order_status || 'unknown'}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2 text-slate-700 align-top">
                                                    <p className="font-semibold truncate max-w-[150px]" title={row.customer_name}>{row.customer_name || 'Customer'}</p>
                                                    <p className="text-[10px] text-slate-500">
                                                        {row.invoice_number ? row.invoice_number : 'Belum ada invoice'}
                                                    </p>
                                                </td>
                                                <td className="px-3 py-2 align-top text-right">
                                                    <p className={`font-bold ${row.is_order_open ? 'text-rose-600' : 'text-slate-500'}`}>{Number(row.allocated_qty || 0)}</p>
                                                    {row.order_created_at && (
                                                        <p className="text-[10px] text-slate-400 mt-0.5">
                                                            {new Date(row.order_created_at).toLocaleDateString('id-ID', {
                                                                day: '2-digit',
                                                                month: 'short',
                                                            })}
                                                        </p>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </section>

                <section className="space-y-2">
                    <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                        <History size={14} className="text-slate-500" />
                        Riwayat Mutasi (10 Terakhir)
                    </h3>
                    <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
                        {loadingMutations ? (
                            <div className="p-4 text-center text-slate-400 animate-pulse">Memuat riwayat...</div>
                        ) : mutations.length === 0 ? (
                            <div className="p-4 text-center text-slate-400 italic">Belum ada riwayat mutasi.</div>
                        ) : (
                            <table className="w-full text-left">
                                <thead className="bg-slate-50 text-slate-500 font-bold text-[10px] uppercase">
                                    <tr>
                                        <th className="px-3 py-2">Waktu</th>
                                        <th className="px-3 py-2">Tipe</th>
                                        <th className="px-3 py-2 text-right">Qty</th>
                                        <th className="px-3 py-2">Ref</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {mutations.map((mut) => (
                                        <tr key={mut.id} className="hover:bg-slate-50/50">
                                            <td className="px-3 py-2 text-slate-500">
                                                {new Date(mut.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                            </td>
                                            <td className="px-3 py-2">
                                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${mut.type === 'in' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                                                    {mut.type}
                                                </span>
                                            </td>
                                            <td className={`px-3 py-2 text-right font-mono font-bold ${mut.type === 'in' ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                {mut.type === 'in' ? '+' : '-'}{Math.abs(Number(mut.qty || 0))}
                                            </td>
                                            <td className="px-3 py-2 text-slate-500 truncate max-w-[90px]" title={mut.note || mut.reference_id || undefined}>
                                                {mut.reference_id || '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
}
