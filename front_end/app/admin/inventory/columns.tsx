'use client';

import { ColumnDef } from '@tanstack/react-table';
import { ProductRow } from './types';
import { ArrowUpDown, Copy, Camera } from 'lucide-react';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

// Inline Editable Cell Component for Bin Location
const EditableBinCell = ({ row, getValue, table }: { row: any; getValue: () => any; table: any }) => {
    const initialValue = getValue() || '';
    const [value, setValue] = useState(initialValue);
    const [isEditing, setIsEditing] = useState(false);

    const onBlur = async () => {
        setIsEditing(false);
        if (value !== initialValue) {
            try {
                // Optimistic update handled by table data refresh usually, but here we just call API
                await api.admin.inventory.updateProduct(row.original.id, { bin_location: value });
                // We should probably trigger a data refresh here, but for now let's hope the user refreshes or we use a context
                // You can access table.options.meta?.updateData if we implement it.
                table.options.meta?.refreshData?.();
            } catch (error) {
                console.error('Failed to update bin location', error);
                setValue(initialValue); // Revert on error
            }
        }
    };

    useEffect(() => {
        setValue(initialValue);
    }, [initialValue]);

    if (isEditing) {
        return (
            <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={onBlur}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') onBlur();
                }}
                autoFocus
                className="w-full bg-white border border-emerald-500 rounded px-2 py-1 text-xs font-bold text-slate-900 outline-none"
            />
        );
    }

    return (
        <div
            onClick={() => setIsEditing(true)}
            className="cursor-pointer hover:bg-slate-100 p-1 rounded min-h-[24px] flex items-center text-xs font-mono text-slate-700 font-bold"
        >
            {value || <span className="text-slate-300 italic">--</span>}
        </div>
    );
};

// Inline Editable Cell Component for Stock
const EditableStockCell = ({ row, getValue, table }: { row: any; getValue: () => any; table: any }) => {
    const initialValue = Number(getValue() || 0);
    // Note: Stock update usually requires a mutation record, but user asked for "Inline Editing".
    // We will use the mutation API if the value changes.
    const [value, setValue] = useState(String(initialValue));
    const [isEditing, setIsEditing] = useState(false);

    const onBlur = async () => {
        setIsEditing(false);
        const newValue = Number(value);
        if (!isNaN(newValue) && newValue !== initialValue) {
            const diff = newValue - initialValue;
            if (diff === 0) return;

            try {
                // Create mutation
                await api.admin.inventory.createMutation({
                    product_id: row.original.id,
                    type: diff > 0 ? 'in' : 'out', // or 'adjustment'
                    qty: Math.abs(diff),
                    note: 'Inline stock edit from Data Grid',
                    reference_id: `INLINE-${Date.now()}`
                });
                table.options.meta?.refreshData?.();
            } catch (error) {
                console.error('Failed to update stock', error);
                setValue(String(initialValue));
            }
        } else {
            setValue(String(initialValue));
        }
    };

    useEffect(() => {
        setValue(String(initialValue));
    }, [initialValue]);

    if (isEditing) {
        return (
            <input
                type="number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={onBlur}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') onBlur();
                }}
                autoFocus
                className="w-16 bg-white border border-emerald-500 rounded px-1 py-1 text-xs font-bold text-right outline-none"
            />
        );
    }

    const isSafe = initialValue > (row.original.min_stock || 0);
    const isZero = initialValue === 0;

    return (
        <div
            onClick={() => setIsEditing(true)}
            className={`cursor-pointer px-2 py-1 rounded text-xs font-bold text-center border ${isZero ? 'bg-rose-100 text-rose-700 border-rose-200' :
                    !isSafe ? 'bg-amber-100 text-amber-700 border-amber-200' :
                        'bg-emerald-100 text-emerald-700 border-emerald-200'
                }`}
        >
            {initialValue}
        </div>
    );
};

export const columns: ColumnDef<ProductRow>[] = [
    {
        accessorKey: 'sku',
        header: ({ column }) => {
            return (
                <button
                    className="flex items-center gap-1 font-bold text-slate-700"
                    onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
                >
                    SKU / Name
                    <ArrowUpDown className="ml-2 h-3 w-3" />
                </button>
            );
        },
        cell: ({ row }) => {
            const product = row.original;
            const copySku = () => {
                navigator.clipboard.writeText(product.sku);
                // Optional: toast 'Copied'
            };
            return (
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-slate-100 border border-slate-200 flex-shrink-0 overflow-hidden">
                        {product.image_url ? (
                            <img src={product.image_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-300">
                                <Camera size={12} />
                            </div>
                        )}
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 cursor-pointer group" onClick={copySku}>
                            <span className="font-mono text-xs font-bold text-slate-600">{product.sku}</span>
                            <Copy size={10} className="text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <div className="font-bold text-sm text-slate-900 truncate max-w-[200px]" title={product.name}>
                            {product.name}
                        </div>
                    </div>
                </div>
            );
        },
        size: 250,
        enableSorting: true,
    },
    {
        accessorKey: 'bin_location',
        header: 'Lokasi Rak',
        cell: EditableBinCell,
        size: 100,
    },
    {
        accessorKey: 'category_id',
        header: 'Kategori',
        cell: ({ row }) => {
            const product = row.original;
            const categoryLabel = product.Categories && product.Categories.length > 0
                ? product.Categories.map((item) => item.name).join(', ')
                : (product.Category?.name || '-');
            return <span className="text-xs text-slate-600 truncate max-w-[120px] block" title={categoryLabel}>{categoryLabel}</span>;
        }
    },
    {
        accessorKey: 'stock_quantity',
        header: ({ column }) => (
            <div className="text-center w-full">Stok Fisik</div>
        ),
        cell: EditableStockCell,
        size: 100
    },
    {
        accessorKey: 'price',
        header: () => <div className="text-right">Harga Jual</div>,
        cell: ({ row }) => {
            const amount = parseFloat(row.getValue('price'));
            const formatted = new Intl.NumberFormat('id-ID', {
                style: 'currency',
                currency: 'IDR',
                maximumFractionDigits: 0
            }).format(amount);
            return <div className="text-right font-bold text-xs text-slate-900">{formatted}</div>;
        }
    },
    {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => {
            const status = row.getValue('status') as string;
            return (
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                    {status}
                </span>
            )
        },
        size: 80
    }
];
