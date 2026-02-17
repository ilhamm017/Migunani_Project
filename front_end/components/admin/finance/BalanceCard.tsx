'use client';

import { Plus } from 'lucide-react';
import { formatCurrency } from '@/lib/utils'; // Assuming this utility exists

export default function BalanceCard({
    title,
    amount,
    onAdd
}: {
    title: string;
    amount: number;
    onAdd?: () => void
}) {
    return (
        <div className="bg-white rounded-[24px] p-5 border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden">
            <div className="flex justify-between items-start mb-4">
                <h3 className="text-sm font-bold text-slate-900">{title}</h3>
                <p className="text-xs text-slate-400 font-medium">Updated just now</p>
            </div>

            <div className="flex items-center justify-between">
                <div className="bg-emerald-600 text-white px-5 py-3 rounded-2xl flex-1 shadow-lg shadow-emerald-200 flex items-center justify-between">
                    <span className="text-lg font-bold">{formatCurrency(amount)}</span>
                    {onAdd && (
                        <button onClick={onAdd} className="bg-white/20 p-1.5 rounded-full hover:bg-white/30 transition-colors">
                            <Plus size={16} className="text-white" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
