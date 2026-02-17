'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Save, Upload } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';

interface PreviewSummary {
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  error_count: number;
}

interface CommitSummary {
  total_rows: number;
  processed_rows: number;
  created_count: number;
  updated_count: number;
  error_count: number;
}

interface ImportErrorRow {
  row: number;
  sku: string;
  reason: string;
}

interface PreviewRow {
  row: number;
  sku: string;
  name: string;
  category_name: string;
  unit: string;
  barcode: string;
  base_price: number | null;
  price: number | null;
  stock_quantity: number | null;
  status: 'active' | 'inactive';
  keterangan: string;
  tipe_modal: string;
  discount_regular_pct?: number | null;
  discount_gold_pct?: number | null;
  discount_platinum_pct?: number | null;
  grosir_min_qty?: number | null;
  varian_harga_text: string;
  grosir_text: string;
  total_modal: number | null;
  is_valid: boolean;
  reasons: string[];
}

interface IndexedPreviewRow {
  index: number;
  row: PreviewRow;
}

const toNonNegativeNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, parsed);
};

const toNonNegativeInteger = (value: unknown): number | null => {
  const parsed = toNonNegativeNumber(value);
  if (parsed === null) return null;
  return Math.trunc(parsed);
};

const clampPercentage = (value: unknown): number | null => {
  const parsed = toNonNegativeNumber(value);
  if (parsed === null) return null;
  return Math.min(100, parsed);
};

const calculatePriceAfterDiscount = (basePrice: number, discountPct: number) => {
  const safeBase = Math.max(0, basePrice);
  const safePct = Math.min(100, Math.max(0, discountPct));
  return Math.max(0, Math.round((safeBase * (1 - safePct / 100)) * 100) / 100);
};

const parseGrosirMinQty = (text: string): number | null => {
  if (!text?.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      const first = parsed[0] as Record<string, unknown> | undefined;
      return toNonNegativeInteger(first?.min_qty ?? first?.qty ?? first?.minQty);
    }
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      return toNonNegativeInteger(obj.min_qty ?? obj.qty ?? obj.minQty);
    }
  } catch {
    const fromText = toNonNegativeInteger(text);
    return fromText;
  }
  return null;
};

const toDiscountFromPrice = (basePrice: number | null, tierPriceRaw: unknown): number | null => {
  const tierPrice = toNonNegativeNumber(tierPriceRaw);
  if (basePrice === null || basePrice <= 0 || tierPrice === null) return null;
  const pct = ((basePrice - tierPrice) / basePrice) * 100;
  return clampPercentage(pct);
};

const parseVarianDiscountFields = (text: string, sellingPrice: number | null) => {
  const empty = { regular: 0, gold: 0, platinum: 0 };
  if (!text?.trim()) return empty;

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return empty;

    const parsedObject = parsed as Record<string, unknown>;
    const discountsBlock = (parsedObject.discounts_pct && typeof parsedObject.discounts_pct === 'object')
      ? (parsedObject.discounts_pct as Record<string, unknown>)
      : {};
    const pricesBlock = (parsedObject.prices && typeof parsedObject.prices === 'object')
      ? (parsedObject.prices as Record<string, unknown>)
      : {};

    const resolveDiscount = (tier: 'regular' | 'gold' | 'platinum') => {
      const tierValue = parsedObject[tier];
      if (tierValue && typeof tierValue === 'object') {
        const tierObj = tierValue as Record<string, unknown>;
        const directPct = clampPercentage(tierObj.discount_pct);
        if (directPct !== null) return directPct;
        const byPrice = toDiscountFromPrice(sellingPrice, tierObj.price);
        if (byPrice !== null) return byPrice;
      }

      const directPct =
        clampPercentage(parsedObject[`${tier}_discount_pct`]) ??
        clampPercentage(discountsBlock[tier]);
      if (directPct !== null) return directPct;

      const byPrice =
        toDiscountFromPrice(sellingPrice, parsedObject[`${tier}_price`]) ??
        toDiscountFromPrice(sellingPrice, pricesBlock[tier]) ??
        toDiscountFromPrice(sellingPrice, parsedObject[tier]);
      if (byPrice !== null) return byPrice;

      return 0;
    };

    return {
      regular: resolveDiscount('regular'),
      gold: resolveDiscount('gold'),
      platinum: resolveDiscount('platinum'),
    };
  } catch {
    const singlePct = clampPercentage(text);
    return {
      regular: singlePct ?? 0,
      gold: 0,
      platinum: 0,
    };
  }
};

const buildVarianHargaText = (row: PreviewRow): string => {
  const basePrice = toNonNegativeNumber(row.price) ?? 0;
  const regularPct = clampPercentage(row.discount_regular_pct) ?? 0;
  const goldPct = clampPercentage(row.discount_gold_pct) ?? 0;
  const platinumPct = clampPercentage(row.discount_platinum_pct) ?? 0;

  const payload = {
    base_price: basePrice,
    discounts_pct: {
      regular: regularPct,
      gold: goldPct,
      platinum: platinumPct,
    },
    prices: {
      regular: calculatePriceAfterDiscount(basePrice, regularPct),
      gold: calculatePriceAfterDiscount(basePrice, goldPct),
      platinum: calculatePriceAfterDiscount(basePrice, platinumPct),
    },
  };

  return JSON.stringify(payload);
};

const buildGrosirText = (row: PreviewRow): string => {
  const basePrice = toNonNegativeNumber(row.price);
  const minQty = toNonNegativeInteger(row.grosir_min_qty) ?? 10;
  const payload: Record<string, number> = { min_qty: minQty };
  if (basePrice !== null) payload.price = basePrice;
  return JSON.stringify(payload);
};

const normalizeDraftRow = (row: PreviewRow): PreviewRow => {
  const rawSku = row.sku?.trim() || '';
  const rawName = row.name?.trim() || '';
  const resolvedSku = rawSku || rawName;
  const resolvedName = rawName || rawSku;
  const normalizedPrice = toNonNegativeNumber(row.price);
  const varianDiscounts = parseVarianDiscountFields(row.varian_harga_text, normalizedPrice);
  const grosirMinQtyFromText = parseGrosirMinQty(row.grosir_text);

  const normalized: PreviewRow = {
    ...row,
    sku: resolvedSku,
    name: resolvedName,
    base_price: toNonNegativeNumber(row.base_price),
    price: normalizedPrice,
    stock_quantity: toNonNegativeInteger(row.stock_quantity),
    total_modal: toNonNegativeNumber(row.total_modal),
    discount_regular_pct: clampPercentage(
      row.discount_regular_pct !== undefined ? row.discount_regular_pct : varianDiscounts.regular
    ) ?? 0,
    discount_gold_pct: clampPercentage(
      row.discount_gold_pct !== undefined ? row.discount_gold_pct : varianDiscounts.gold
    ) ?? 0,
    discount_platinum_pct: clampPercentage(
      row.discount_platinum_pct !== undefined ? row.discount_platinum_pct : varianDiscounts.platinum
    ) ?? 0,
    grosir_min_qty: toNonNegativeInteger(
      row.grosir_min_qty !== undefined ? row.grosir_min_qty : grosirMinQtyFromText
    ) ?? 10,
  };

  return {
    ...normalized,
    varian_harga_text: buildVarianHargaText(normalized),
    grosir_text: buildGrosirText(normalized),
  };
};

const validateDraftRow = (row: PreviewRow): string[] => {
  const reasons: string[] = [];
  if (!row.sku?.trim() && !row.name?.trim()) reasons.push('SKU atau Nama wajib salah satu diisi');
  if (typeof row.base_price !== 'number' || !Number.isFinite(row.base_price)) reasons.push('HARGA BELI tidak valid');
  if (typeof row.price !== 'number' || !Number.isFinite(row.price)) reasons.push('HARGA JUAL tidak valid');
  if (typeof row.stock_quantity !== 'number' || !Number.isInteger(row.stock_quantity)) reasons.push('STOK harus bilangan bulat');
  if (row.total_modal !== null && (typeof row.total_modal !== 'number' || !Number.isFinite(row.total_modal))) {
    reasons.push('TOTAL MODAL tidak valid');
  }
  if (row.discount_regular_pct != null && (!Number.isFinite(row.discount_regular_pct) || row.discount_regular_pct < 0 || row.discount_regular_pct > 100)) reasons.push('Diskon regular tidak valid');
  if (row.discount_gold_pct != null && (!Number.isFinite(row.discount_gold_pct) || row.discount_gold_pct < 0 || row.discount_gold_pct > 100)) reasons.push('Diskon gold tidak valid');
  if (row.discount_platinum_pct != null && (!Number.isFinite(row.discount_platinum_pct) || row.discount_platinum_pct < 0 || row.discount_platinum_pct > 100)) reasons.push('Diskon platinum tidak valid');
  if (row.grosir_min_qty != null && (!Number.isInteger(row.grosir_min_qty) || row.grosir_min_qty < 0)) reasons.push('Grosir min qty tidak valid');

  return reasons;
};

const getTierPrices = (row: PreviewRow) => {
  const basePrice = toNonNegativeNumber(row.price) ?? 0;
  const regular = calculatePriceAfterDiscount(basePrice, clampPercentage(row.discount_regular_pct) ?? 0);
  const gold = calculatePriceAfterDiscount(basePrice, clampPercentage(row.discount_gold_pct) ?? 0);
  const platinum = calculatePriceAfterDiscount(basePrice, clampPercentage(row.discount_platinum_pct) ?? 0);
  return { regular, gold, platinum };
};

const recalculateDraftRows = (rows: PreviewRow[]): PreviewRow[] => {
  return rows.map((item) => buildValidatedRow(item));
};

const buildValidatedRow = (row: PreviewRow): PreviewRow => {
  const normalized = normalizeDraftRow(row);
  const reasons = validateDraftRow(normalized);
  return {
    ...normalized,
    reasons,
    is_valid: reasons.length === 0,
  };
};

const updateRowsAfterSingleEdit = (
  rows: PreviewRow[],
  rowIndex: number,
  field: keyof PreviewRow,
  value: any
): PreviewRow[] => {
  const previousRow = rows[rowIndex];
  if (!previousRow) return rows;

  const next = [...rows];
  const draftRow = { ...previousRow, [field]: value } as PreviewRow;
  next[rowIndex] = buildValidatedRow(draftRow);
  return next;
};

export default function InventoryImportPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang'], '/admin');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isCommitLoading, setIsCommitLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [previewSummary, setPreviewSummary] = useState<PreviewSummary | null>(null);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewErrors, setPreviewErrors] = useState<ImportErrorRow[]>([]);
  const [commitSummary, setCommitSummary] = useState<CommitSummary | null>(null);
  const [commitErrors, setCommitErrors] = useState<ImportErrorRow[]>([]);
  const [showOnlyErrorRows, setShowOnlyErrorRows] = useState(false);
  const [bulkRegularPct, setBulkRegularPct] = useState('');
  const [bulkGoldPct, setBulkGoldPct] = useState('');
  const [bulkPlatinumPct, setBulkPlatinumPct] = useState('');
  const [bulkGrosirMinQty, setBulkGrosirMinQty] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(100);
  const draftSectionRef = useRef<HTMLDivElement | null>(null);
  const draftTableRef = useRef<HTMLDivElement | null>(null);

  const filteredRows = useMemo<IndexedPreviewRow[]>(
    () =>
      previewRows
        .map((row, index) => ({ row, index }))
        .filter((item) => !showOnlyErrorRows || !item.row.is_valid),
    [previewRows, showOnlyErrorRows]
  );
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / rowsPerPage));
  const pagedRows = useMemo(
    () => filteredRows.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage),
    [filteredRows, currentPage, rowsPerPage]
  );

  const currentPreviewSummary = useMemo(() => {
    if (!previewSummary) return null;
    const invalidRows = previewRows.filter((row) => !row.is_valid).length;
    return {
      total_rows: previewRows.length,
      valid_rows: previewRows.length - invalidRows,
      invalid_rows: invalidRows,
      error_count: invalidRows,
    };
  }, [previewSummary, previewRows]);

  useEffect(() => {
    setCurrentPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (previewRows.length === 0) return;
    draftTableRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    draftSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [currentPage, previewRows.length]);

  if (!allowed) return null;

  const onPreviewImport = async () => {
    if (!selectedFile) {
      setErrorMessage('Pilih file terlebih dahulu.');
      return;
    }

    setIsPreviewLoading(true);
    setErrorMessage('');
    setCommitSummary(null);
    setCommitErrors([]);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await api.admin.inventory.importPreview(formData);
      const rows: PreviewRow[] = response.data?.rows || [];
      const recalculatedRows = recalculateDraftRows(rows);
      const invalidRows = recalculatedRows.filter((row) => !row.is_valid).length;

      setPreviewRows(recalculatedRows);
      setPreviewErrors(response.data?.errors || []);
      setCurrentPage(1);
      setPreviewSummary({
        total_rows: recalculatedRows.length,
        valid_rows: recalculatedRows.length - invalidRows,
        invalid_rows: invalidRows,
        error_count: invalidRows,
      });
    } catch (error: any) {
      const message = error?.response?.data?.message || 'Gagal membaca file import.';
      setErrorMessage(message);
      setPreviewSummary(null);
      setPreviewRows([]);
      setPreviewErrors([]);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const updateRowField = (rowIndex: number, field: keyof PreviewRow, value: any) => {
    setPreviewRows((prev) => {
      return updateRowsAfterSingleEdit(prev, rowIndex, field, value);
    });
  };

  const applyBulkValues = () => {
    if (previewRows.length === 0) return;
    setPreviewRows((prev) => {
      const next = prev.map((row) => ({
        ...row,
        discount_regular_pct: bulkRegularPct === '' ? row.discount_regular_pct : Number(bulkRegularPct),
        discount_gold_pct: bulkGoldPct === '' ? row.discount_gold_pct : Number(bulkGoldPct),
        discount_platinum_pct: bulkPlatinumPct === '' ? row.discount_platinum_pct : Number(bulkPlatinumPct),
        grosir_min_qty: bulkGrosirMinQty === '' ? row.grosir_min_qty : Number(bulkGrosirMinQty),
      }));
      return recalculateDraftRows(next);
    });
  };

  const onCommitImport = async () => {
    if (previewRows.length === 0) {
      setErrorMessage('Belum ada draft data untuk disimpan.');
      return;
    }

    setIsCommitLoading(true);
    setErrorMessage('');

    try {
      const response = await api.admin.inventory.importCommit(previewRows);
      setCommitSummary(response.data?.summary || null);
      setCommitErrors(response.data?.errors || []);
    } catch (error: any) {
      const message = error?.response?.data?.message || 'Gagal commit import.';
      setErrorMessage(message);
      setCommitSummary(null);
      setCommitErrors([]);
    } finally {
      setIsCommitLoading(false);
    }
  };

  return (
    <div className="warehouse-page">
      <div>
        <h1 className="warehouse-title">Import Data Massal</h1>
        <p className="warehouse-subtitle">Gunakan file Excel/CSV untuk memperbarui stok atau menambah produk baru secara massal.</p>
      </div>

      <div className="warehouse-panel bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={(e) => {
            setSelectedFile(e.target.files?.[0] || null);
            setPreviewSummary(null);
            setPreviewRows([]);
            setPreviewErrors([]);
            setCommitSummary(null);
            setCommitErrors([]);
            setErrorMessage('');
            setBulkRegularPct('');
            setBulkGoldPct('');
            setBulkPlatinumPct('');
            setBulkGrosirMinQty('');
            setCurrentPage(1);
          }}
          className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-3 text-sm"
        />
        {selectedFile && (
          <p className="text-sm text-slate-700">
            File dipilih: <span className="font-bold">{selectedFile.name}</span>
          </p>
        )}

        <button
          onClick={onPreviewImport}
          disabled={isPreviewLoading}
          className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black text-sm uppercase shadow-lg shadow-emerald-200 disabled:opacity-60"
        >
          <Upload size={14} className="inline mr-2" />
          {isPreviewLoading ? 'Membaca File...' : 'Baca & Preview'}
        </button>

        {previewRows.length > 0 && (
          <button
            onClick={onCommitImport}
            disabled={isCommitLoading}
            className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-sm uppercase shadow-lg shadow-slate-200 disabled:opacity-60"
          >
            <Save size={14} className="inline mr-2" />
            {isCommitLoading ? 'Menyimpan ke Database...' : 'Commit Import ke Database'}
          </button>
        )}

        {errorMessage && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-rose-700 text-sm">
            <AlertCircle size={14} className="inline mr-2" />
            {errorMessage}
          </div>
        )}
      </div>

      {currentPreviewSummary && (
        <div className="warehouse-panel bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-wide">
            <CheckCircle2 size={14} className="inline mr-2 text-emerald-600" />
            Ringkasan Preview
          </h2>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-500">Total Row</span><p className="font-black">{currentPreviewSummary.total_rows}</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-500">Valid</span><p className="font-black text-emerald-700">{currentPreviewSummary.valid_rows}</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-500">Invalid</span><p className="font-black text-rose-700">{currentPreviewSummary.invalid_rows}</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-500">Error Row</span><p className="font-black text-rose-700">{currentPreviewSummary.error_count}</p></div>
          </div>
          <label className="inline-flex items-center gap-2 mt-4 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={showOnlyErrorRows}
              onChange={(e) => {
                setShowOnlyErrorRows(e.target.checked);
                setCurrentPage(1);
              }}
            />
            Tampilkan hanya baris error
          </label>
        </div>
      )}

      {previewRows.length > 0 && (
        <div ref={draftSectionRef} className="warehouse-panel bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-wide mb-3">Draft Data (Editable)</h2>
          <p className="text-xs text-slate-500 mb-3">Isi diskon member dalam persen. Harga member dihitung otomatis dari Harga Jual. Grosir min qty default 10 dan bisa diubah.</p>
          <div className="mb-3 grid grid-cols-1 md:grid-cols-5 gap-2">
            <input
              type="number"
              min={0}
              max={100}
              value={bulkRegularPct}
              onChange={(e) => setBulkRegularPct(e.target.value)}
              placeholder="Set Reguler % (semua)"
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="number"
              min={0}
              max={100}
              value={bulkGoldPct}
              onChange={(e) => setBulkGoldPct(e.target.value)}
              placeholder="Set Gold % (semua)"
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="number"
              min={0}
              max={100}
              value={bulkPlatinumPct}
              onChange={(e) => setBulkPlatinumPct(e.target.value)}
              placeholder="Set Platinum % (semua)"
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="number"
              min={0}
              value={bulkGrosirMinQty}
              onChange={(e) => setBulkGrosirMinQty(e.target.value)}
              placeholder="Set Min Grosir (semua)"
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={applyBulkValues}
              className="rounded-lg bg-slate-900 text-white text-sm font-bold px-3 py-2"
            >
              Terapkan ke Semua Baris
            </button>
          </div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="text-slate-600">
              Menampilkan {pagedRows.length} dari {filteredRows.length} baris
            </div>
            <div className="flex items-center gap-2">
              <label className="text-slate-600">Baris/halaman</label>
              <select
                value={rowsPerPage}
                onChange={(e) => {
                  setRowsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="border border-slate-200 rounded-lg px-2 py-1.5"
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
              <button
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage <= 1}
                className="border border-slate-200 rounded-lg px-3 py-1.5 disabled:opacity-50"
              >
                Prev
              </button>
              <span className="text-slate-700">Hal {currentPage} / {totalPages}</span>
              <button
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage >= totalPages}
                className="border border-slate-200 rounded-lg px-3 py-1.5 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
          <div ref={draftTableRef} className="overflow-auto border border-slate-200 rounded-2xl max-h-[560px]">
            <table className="w-full min-w-[1820px] text-sm">
              <thead className="bg-slate-50 text-slate-600 sticky top-0">
                <tr>
                  <th className="text-left p-3">Row</th>
                  <th className="text-left p-3">SKU</th>
                  <th className="text-left p-3">Nama</th>
                  <th className="text-left p-3">Kategori</th>
                  <th className="text-left p-3">Stok</th>
                  <th className="text-left p-3">Harga Beli</th>
                  <th className="text-left p-3">Harga Jual</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Diskon Reguler (%)</th>
                  <th className="text-left p-3">Diskon Gold (%)</th>
                  <th className="text-left p-3">Diskon Platinum (%)</th>
                  <th className="text-left p-3">Harga Member (Auto)</th>
                  <th className="text-left p-3">Grosir Min Qty</th>
                  <th className="text-left p-3">Error</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map(({ row, index: realIndex }) => {
                  const tierPrices = getTierPrices(row);
                  return (
                    <tr key={`${row.row}-${realIndex}`} className={`border-t border-slate-100 align-top ${row.is_valid ? 'bg-white' : 'bg-rose-50/40'}`}>
                      <td className="p-2 font-bold">{row.row}</td>
                      <td className="p-2"><input value={row.sku} onChange={(e) => updateRowField(realIndex, 'sku', e.target.value)} className="w-[160px] border border-slate-200 rounded-lg px-2 py-1.5" /></td>
                      <td className="p-2"><input value={row.name} onChange={(e) => updateRowField(realIndex, 'name', e.target.value)} className="w-[220px] border border-slate-200 rounded-lg px-2 py-1.5" /></td>
                      <td className="p-2"><input value={row.category_name} onChange={(e) => updateRowField(realIndex, 'category_name', e.target.value)} className="w-[170px] border border-slate-200 rounded-lg px-2 py-1.5" /></td>
                      <td className="p-2"><input type="number" value={row.stock_quantity ?? ''} onChange={(e) => updateRowField(realIndex, 'stock_quantity', e.target.value === '' ? null : Number(e.target.value))} className="w-[100px] border border-slate-200 rounded-lg px-2 py-1.5" /></td>
                      <td className="p-2"><input type="number" value={row.base_price ?? ''} onChange={(e) => updateRowField(realIndex, 'base_price', e.target.value === '' ? null : Number(e.target.value))} className="w-[130px] border border-slate-200 rounded-lg px-2 py-1.5" /></td>
                      <td className="p-2"><input type="number" value={row.price ?? ''} onChange={(e) => updateRowField(realIndex, 'price', e.target.value === '' ? null : Number(e.target.value))} className="w-[130px] border border-slate-200 rounded-lg px-2 py-1.5" /></td>
                      <td className="p-2">
                        <select value={row.status} onChange={(e) => updateRowField(realIndex, 'status', e.target.value as 'active' | 'inactive')} className="w-[120px] border border-slate-200 rounded-lg px-2 py-1.5">
                          <option value="active">active</option>
                          <option value="inactive">inactive</option>
                        </select>
                      </td>
                      <td className="p-2"><input type="number" min={0} max={100} value={row.discount_regular_pct ?? 0} onChange={(e) => updateRowField(realIndex, 'discount_regular_pct', e.target.value === '' ? 0 : Number(e.target.value))} className="w-[150px] border border-slate-200 rounded-lg px-2 py-1.5" /></td>
                      <td className="p-2"><input type="number" min={0} max={100} value={row.discount_gold_pct ?? 0} onChange={(e) => updateRowField(realIndex, 'discount_gold_pct', e.target.value === '' ? 0 : Number(e.target.value))} className="w-[140px] border border-slate-200 rounded-lg px-2 py-1.5" /></td>
                      <td className="p-2"><input type="number" min={0} max={100} value={row.discount_platinum_pct ?? 0} onChange={(e) => updateRowField(realIndex, 'discount_platinum_pct', e.target.value === '' ? 0 : Number(e.target.value))} className="w-[160px] border border-slate-200 rounded-lg px-2 py-1.5" /></td>
                      <td className="p-2 min-w-[220px] text-xs text-slate-700">
                        <p>Reguler: Rp {tierPrices.regular.toLocaleString('id-ID')}</p>
                        <p>Gold: Rp {tierPrices.gold.toLocaleString('id-ID')}</p>
                        <p>Platinum: Rp {tierPrices.platinum.toLocaleString('id-ID')}</p>
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          min={0}
                          value={row.grosir_min_qty ?? 10}
                          onChange={(e) => updateRowField(realIndex, 'grosir_min_qty', e.target.value === '' ? null : Number(e.target.value))}
                          className="w-[110px] border border-slate-200 rounded-lg px-2 py-1.5"
                        />
                      </td>
                      <td className="p-2 min-w-[260px] text-rose-700">{row.reasons.join('; ') || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {previewErrors.length > 0 && (
        <div className="warehouse-panel bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-wide mb-3">Error Server Saat Preview</h2>
          <div className="max-h-[280px] overflow-auto border border-slate-200 rounded-2xl">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left p-3">Row</th>
                  <th className="text-left p-3">SKU</th>
                  <th className="text-left p-3">Alasan</th>
                </tr>
              </thead>
              <tbody>
                {previewErrors.map((item, idx) => (
                  <tr key={`${item.row}-${item.sku}-${idx}`} className="border-t border-slate-100">
                    <td className="p-3 font-bold">{item.row}</td>
                    <td className="p-3">{item.sku}</td>
                    <td className="p-3 text-rose-700">{item.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {commitSummary && (
        <div className="warehouse-panel bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-wide mb-3">Hasil Commit</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
            <div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-500">Total Row</span><p className="font-black">{commitSummary.total_rows}</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-500">Diproses</span><p className="font-black">{commitSummary.processed_rows}</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-500">Buat Baru</span><p className="font-black">{commitSummary.created_count}</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-500">Diupdate</span><p className="font-black">{commitSummary.updated_count}</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-500">Error</span><p className="font-black text-rose-700">{commitSummary.error_count}</p></div>
          </div>
        </div>
      )}

      {commitErrors.length > 0 && (
        <div className="warehouse-panel bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-wide mb-3">Error Saat Commit</h2>
          <div className="max-h-[320px] overflow-auto border border-slate-200 rounded-2xl">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left p-3">Row</th>
                  <th className="text-left p-3">SKU</th>
                  <th className="text-left p-3">Alasan</th>
                </tr>
              </thead>
              <tbody>
                {commitErrors.map((item, idx) => (
                  <tr key={`${item.row}-${item.sku}-${idx}`} className="border-t border-slate-100">
                    <td className="p-3 font-bold">{item.row}</td>
                    <td className="p-3">{item.sku}</td>
                    <td className="p-3 text-rose-700">{item.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
