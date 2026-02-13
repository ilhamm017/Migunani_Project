'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ChipItem {
    id: string;
    label: string;
    value?: string;
}

export interface ScrollChipsProps {
    items: ChipItem[];
    activeId?: string;
    onItemClick?: (id: string) => void;
    className?: string;
}

export function ScrollChips({ items, activeId, onItemClick, className }: ScrollChipsProps) {
    return (
        <div className={cn('scroll-chips', className)}>
            {items.map((item) => {
                const isActive = activeId === item.id;
                return (
                    <button
                        key={item.id}
                        type="button"
                        onClick={() => onItemClick?.(item.id)}
                        className={cn(
                            'flex-shrink-0 px-4 py-2 rounded-xl font-bold text-[10px] uppercase tracking-wider',
                            'transition-all touch-manipulation active:scale-95',
                            isActive && 'bg-emerald-600 text-white shadow-sm shadow-emerald-200',
                            !isActive && 'bg-white text-slate-400 border border-slate-100 hover:text-slate-600'
                        )}
                    >
                        {item.label}
                    </button>
                );
            })}
        </div>
    );
}

// Status badge chip
export interface StatusChipProps {
    label: string;
    variant?: 'success' | 'warning' | 'danger' | 'info' | 'default';
    className?: string;
}

export function StatusChip({ label, variant = 'default', className }: StatusChipProps) {
    return (
        <span
            className={cn(
                'inline-flex items-center px-2 py-0.5 rounded-lg text-[9px] font-black uppercase',
                {
                    'bg-emerald-50 text-emerald-600': variant === 'success',
                    'bg-amber-50 text-amber-600': variant === 'warning',
                    'bg-rose-50 text-rose-500': variant === 'danger',
                    'bg-blue-50 text-blue-600': variant === 'info',
                    'bg-slate-100 text-slate-400': variant === 'default',
                },
                className
            )}
        >
            {label}
        </span>
    );
}
