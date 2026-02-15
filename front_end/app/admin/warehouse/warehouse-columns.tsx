'use client';

import { ColumnDef } from '@tanstack/react-table';
import { ProductRow } from '../inventory/types';
import { ArrowUpDown, Check, Copy, PencilLine } from 'lucide-react';
import { MouseEvent, useCallback, useEffect, useState } from 'react';

type InlineField = 'barcode' | 'name' | 'bin_location' | 'min_stock' | 'base_price' | 'status';

export interface WarehouseTableMeta {
    isEditMode?: boolean;
    onInlineUpdate?: (product: ProductRow, field: InlineField, value: string | number) => Promise<void> | void;
    onAdjustStock?: (product: ProductRow, nextStock: number) => Promise<void> | void;
    onExpandEdit?: (product: ProductRow) => void;
}

const getMeta = (table: any): WarehouseTableMeta => {
    return (table.options.meta || {}) as WarehouseTableMeta;
};

const currency = (value: number) =>
    new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0,
    }).format(Number(value || 0));

const CopySKUCell = ({ row }: { row: any }) => {
    const sku: string = row.original.sku || '';
    const [copied, setCopied] = useState(false);

    const copy = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        if (!sku) return;
        navigator.clipboard.writeText(sku).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    }, [sku]);

    return (
        <button
            onClick={copy}
            className="inline-flex items-center gap-1.5 group cursor-pointer font-mono text-xs font-bold text-slate-700 hover:text-emerald-700 transition-colors min-h-0 min-w-0 px-1.5 py-1 rounded hover:bg-emerald-50"
            title="Klik untuk copy"
        >
            {sku}
            {copied
                ? <Check size={11} className="text-emerald-500" />
                : <Copy size={11} className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400" />}
        </button>
    );
};

const EditableTextCell = ({
    row,
    getValue,
    table,
    field,
    placeholder,
    transform,
    className,
}: {
    row: any;
    getValue: () => any;
    table: any;
    field: InlineField;
    placeholder?: string;
    transform?: (value: string) => string;
    className?: string;
}) => {
    const meta = getMeta(table);
    const initialValue = String(getValue() ?? '');
    const [value, setValue] = useState(initialValue);
    const [saving, setSaving] = useState(false);

    useEffect(() => { setValue(initialValue); }, [initialValue]);

    const commit = async () => {
        const normalized = transform ? transform(value) : value;
        if (normalized === initialValue) return;
        setSaving(true);
        try {
            await meta.onInlineUpdate?.(row.original, field, normalized);
        } catch {
            setValue(initialValue);
        } finally {
            setSaving(false);
        }
    };

    if (!meta.isEditMode) {
        return (
            <div className={className || 'text-xs font-semibold text-slate-800 truncate'}>
                {initialValue || placeholder || '—'}
            </div>
        );
    }

    return (
        <input
            value={value}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setValue(transform ? transform(event.target.value) : event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') {
                    setValue(initialValue);
                    event.currentTarget.blur();
                }
            }}
            placeholder={placeholder}
            className={`w-full rounded-lg border border-emerald-300 bg-white px-2 py-1.5 text-xs font-semibold outline-none focus:border-emerald-500 ${saving ? 'opacity-60' : ''}`}
        />
    );
};

const EditableNumberCell = ({
    row,
    getValue,
    table,
    field,
    integer = false,
    displayAsCurrency = false,
    alignRight = false,
}: {
    row: any;
    getValue: () => any;
    table: any;
    field: InlineField;
    integer?: boolean;
    displayAsCurrency?: boolean;
    alignRight?: boolean;
}) => {
    const meta = getMeta(table);
    const initialNumeric = Number(getValue() || 0);
    const initialValue = Number.isFinite(initialNumeric) ? initialNumeric : 0;
    const [value, setValue] = useState(String(initialValue));
    const [saving, setSaving] = useState(false);

    useEffect(() => { setValue(String(initialValue)); }, [initialValue]);

    const commit = async () => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) {
            setValue(String(initialValue));
            return;
        }
        const normalized = integer ? Math.trunc(parsed) : parsed;
        if (normalized === initialValue) return;

        setSaving(true);
        try {
            await meta.onInlineUpdate?.(row.original, field, normalized);
        } catch {
            setValue(String(initialValue));
        } finally {
            setSaving(false);
        }
    };

    if (!meta.isEditMode) {
        if (displayAsCurrency) {
            return <div className="text-right font-bold text-xs text-slate-800">{currency(initialValue)}</div>;
        }
        return (
            <div className={`${alignRight ? 'text-right' : 'text-center'} text-xs font-bold text-slate-700`}>
                {initialValue}
            </div>
        );
    }

    return (
        <input
            type="number"
            min="0"
            value={value}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setValue(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') {
                    setValue(String(initialValue));
                    event.currentTarget.blur();
                }
            }}
            className={`w-full rounded-lg border border-emerald-300 bg-white px-2 py-1.5 text-xs font-bold outline-none focus:border-emerald-500 ${alignRight ? 'text-right' : 'text-center'} ${saving ? 'opacity-60' : ''}`}
        />
    );
};

const EditableStockCell = ({ row, getValue, table }: { row: any; getValue: () => any; table: any }) => {
    const meta = getMeta(table);
    const initialStock = Number(getValue() || 0);
    const minStock = Number(row.original.min_stock || 0);
    const [value, setValue] = useState(String(initialStock));
    const [saving, setSaving] = useState(false);

    useEffect(() => { setValue(String(initialStock)); }, [initialStock]);

    const commit = async () => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) {
            setValue(String(initialStock));
            return;
        }
        const normalized = Math.trunc(parsed);
        if (normalized === initialStock) return;

        setSaving(true);
        try {
            await meta.onAdjustStock?.(row.original, normalized);
        } catch {
            setValue(String(initialStock));
        } finally {
            setSaving(false);
        }
    };

    if (!meta.isEditMode) {
        const isZero = initialStock === 0;
        const isLow = initialStock > 0 && initialStock <= minStock;
        let statusClasses = 'bg-emerald-50 text-emerald-700 border-emerald-200';
        if (isZero) statusClasses = 'bg-rose-50 text-rose-700 border-rose-200';
        else if (isLow) statusClasses = 'bg-amber-50 text-amber-700 border-amber-200';
        return (
            <div className={`px-2.5 py-1 rounded-lg text-xs font-bold text-center border ${statusClasses}`}>
                {initialStock}
            </div>
        );
    }

    return (
        <input
            type="number"
            min="0"
            value={value}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setValue(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') {
                    setValue(String(initialStock));
                    event.currentTarget.blur();
                }
            }}
            className={`w-full rounded-lg border border-emerald-300 bg-white px-2 py-1.5 text-xs font-bold text-center outline-none focus:border-emerald-500 ${saving ? 'opacity-60' : ''}`}
        />
    );
};

const EditableStatusCell = ({ row, table }: { row: any; table: any }) => {
    const meta = getMeta(table);
    const initialValue = String(row.original.status || 'inactive').toLowerCase() === 'active' ? 'active' : 'inactive';
    const [value, setValue] = useState<'active' | 'inactive'>(initialValue);
    const [saving, setSaving] = useState(false);

    useEffect(() => { setValue(initialValue); }, [initialValue]);

    const commit = async (nextValue: 'active' | 'inactive') => {
        if (nextValue === initialValue) return;
        setSaving(true);
        try {
            await meta.onInlineUpdate?.(row.original, 'status', nextValue);
        } catch {
            setValue(initialValue);
        } finally {
            setSaving(false);
        }
    };

    if (!meta.isEditMode) {
        const active = initialValue === 'active';
        return (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${active
                ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                : 'bg-slate-200 text-slate-700 border-slate-300'
                }`}>
                {active ? 'ACTIVE' : 'INACTIVE'}
            </span>
        );
    }

    return (
        <select
            value={value}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
                const nextValue = (event.target.value === 'active' ? 'active' : 'inactive');
                setValue(nextValue);
                void commit(nextValue);
            }}
            className={`w-full rounded-lg border border-emerald-300 bg-white px-2 py-1.5 text-xs font-bold outline-none focus:border-emerald-500 ${saving ? 'opacity-60' : ''}`}
        >
            <option value="active">active</option>
            <option value="inactive">inactive</option>
        </select>
    );
};

const StatusCell = ({ row }: { row: any }) => {
    const stock = Number(row.original.stock_quantity || 0);
    const minStock = Number(row.original.min_stock || 0);

    let label: string;
    let classes: string;

    if (stock === 0) {
        label = 'KOSONG';
        classes = 'bg-rose-100 text-rose-700 border-rose-200';
    } else if (stock <= minStock) {
        label = 'LOW';
        classes = 'bg-amber-100 text-amber-700 border-amber-200';
    } else {
        label = 'AMAN';
        classes = 'bg-emerald-100 text-emerald-700 border-emerald-200';
    }

    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${classes}`}>
            <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${stock === 0 ? 'bg-rose-500' : stock <= minStock ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            {label}
        </span>
    );
};

export const warehouseColumns: ColumnDef<ProductRow>[] = [
    {
        accessorKey: 'sku',
        header: ({ column }) => (
            <button
                className="flex items-center gap-1 font-bold text-slate-600 text-[11px] uppercase tracking-wider min-h-0 min-w-0"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            >
                Part Number
                <ArrowUpDown className="ml-1 h-3 w-3" />
            </button>
        ),
        cell: CopySKUCell,
        size: 140,
        enableSorting: true,
    },
    {
        accessorKey: 'barcode',
        header: () => <span className="font-bold text-slate-600 text-[11px] uppercase tracking-wider">Barcode</span>,
        cell: ({ row, getValue, table }) => (
            <EditableTextCell
                row={row}
                getValue={getValue}
                table={table}
                field="barcode"
                placeholder="—"
                className="font-mono text-[11px] text-slate-500"
            />
        ),
        size: 130,
    },
    {
        accessorKey: 'name',
        header: ({ column }) => (
            <button
                className="flex items-center gap-1 font-bold text-slate-600 text-[11px] uppercase tracking-wider min-h-0 min-w-0"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            >
                Nama Barang
                <ArrowUpDown className="ml-1 h-3 w-3" />
            </button>
        ),
        cell: ({ row, getValue, table }) => (
            <EditableTextCell
                row={row}
                getValue={getValue}
                table={table}
                field="name"
                placeholder="Tanpa nama"
                className="font-semibold text-sm text-slate-900 truncate max-w-[260px]"
            />
        ),
        size: 260,
        enableSorting: true,
    },
    {
        id: 'category_name',
        header: () => <span className="font-bold text-slate-600 text-[11px] uppercase tracking-wider">Kategori</span>,
        cell: ({ row }) => {
            const fallback = row.original.Category?.name;
            const primary = row.original.Categories?.[0]?.name;
            return (
                <span className="text-xs font-semibold text-slate-700">{primary || fallback || '—'}</span>
            );
        },
        size: 130,
    },
    {
        accessorKey: 'bin_location',
        header: () => <span className="font-bold text-slate-600 text-[11px] uppercase tracking-wider">Lokasi Rak</span>,
        cell: ({ row, getValue, table }) => (
            <EditableTextCell
                row={row}
                getValue={getValue}
                table={table}
                field="bin_location"
                placeholder="Belum diset"
                transform={(value) => value.toUpperCase()}
                className="text-xs font-mono font-bold text-emerald-700"
            />
        ),
        size: 110,
    },
    {
        accessorKey: 'stock_quantity',
        header: ({ column }) => (
            <button
                className="flex items-center justify-center gap-1 font-bold text-slate-600 text-[11px] uppercase tracking-wider w-full min-h-0 min-w-0"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            >
                Stok Fisik
                <ArrowUpDown className="ml-1 h-3 w-3" />
            </button>
        ),
        cell: EditableStockCell,
        size: 100,
    },
    {
        accessorKey: 'allocated_quantity',
        header: () => <span className="font-bold text-slate-600 text-[11px] uppercase tracking-wider">Teralokasi</span>,
        cell: ({ row }) => (
            <div className="text-xs font-bold text-center text-blue-700">
                {Number(row.original.allocated_quantity || 0)}
            </div>
        ),
        size: 90,
    },
    {
        accessorKey: 'min_stock',
        header: () => <span className="font-bold text-slate-600 text-[11px] uppercase tracking-wider">Min Stok</span>,
        cell: ({ row, getValue, table }) => (
            <EditableNumberCell
                row={row}
                getValue={getValue}
                table={table}
                field="min_stock"
                integer
            />
        ),
        size: 90,
    },
    {
        id: 'stock_status',
        header: () => <span className="font-bold text-slate-600 text-[11px] uppercase tracking-wider">Status</span>,
        cell: StatusCell,
        size: 100,
    },
    {
        accessorKey: 'status',
        header: () => <span className="font-bold text-slate-600 text-[11px] uppercase tracking-wider">Status Data</span>,
        cell: ({ row, table }) => <EditableStatusCell row={row} table={table} />,
        size: 120,
    },
    {
        accessorKey: 'base_price',
        header: () => <div className="text-right font-bold text-slate-600 text-[11px] uppercase tracking-wider">Harga Modal</div>,
        cell: ({ row, getValue, table }) => (
            <EditableNumberCell
                row={row}
                getValue={getValue}
                table={table}
                field="base_price"
                displayAsCurrency
                alignRight
            />
        ),
        size: 120,
    },
    {
        accessorKey: 'price',
        header: () => <div className="text-right font-bold text-slate-600 text-[11px] uppercase tracking-wider">Harga Jual</div>,
        cell: ({ row }) => (
            <div className="text-right font-bold text-xs text-slate-800">
                {currency(Number(row.original.price || 0))}
            </div>
        ),
        size: 120,
    },
];

export const warehouseEditActionColumn: ColumnDef<ProductRow> = {
    id: 'expand_edit',
    header: () => <div className="text-center font-bold text-slate-600 text-[11px] uppercase tracking-wider">Edit Lengkap</div>,
    cell: ({ row, table }) => {
        const meta = getMeta(table);
        return (
            <div className="flex justify-center">
                <button
                    onClick={(event) => {
                        event.stopPropagation();
                        meta.onExpandEdit?.(row.original);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"
                >
                    <PencilLine size={12} />
                    Expand
                </button>
            </div>
        );
    },
    size: 120,
};
