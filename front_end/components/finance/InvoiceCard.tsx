
import React from 'react';
import { cn } from '@/lib/utils';
import { Check, X } from 'lucide-react';

interface InvoiceCardProps {
    title: string;
    subtitle: string;
    amount: number;
    amountPaid?: number;
    status: 'paid' | 'unpaid' | 'pending' | 'cod_pending' | 'void';
    date: string;
    onClick?: () => void;
    onApprove?: () => void;
    onReject?: () => void;
    className?: string;
}

export const InvoiceCard: React.FC<InvoiceCardProps> = ({
    title,
    subtitle,
    amount,
    amountPaid,
    status,
    date,
    onClick,
    onApprove,
    onReject,
    className
}) => {
    const formatRp = (val: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);

    const statusColors = {
        paid: 'bg-emerald-100 text-emerald-800',
        unpaid: 'bg-red-100 text-red-800',
        pending: 'bg-yellow-100 text-yellow-800',
        cod_pending: 'bg-orange-100 text-orange-800',
        void: 'bg-slate-100 text-slate-800 line-through',
    };

    return (
        <div
            onClick={onClick}
            className={cn("bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer", className)}
        >
            <div className="flex justify-between items-start mb-2">
                <div>
                    <h4 className="font-semibold text-slate-800">{title}</h4>
                    <p className="text-xs text-slate-500">{subtitle}</p>
                </div>
                <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wide", statusColors[status])}>
                    {status.replace('_', ' ')}
                </span>
            </div>

            <div className="flex justify-between items-end mt-3">
                <div>
                    <p className="text-xs text-slate-400 mb-0.5">{date}</p>
                    <p className="font-mono text-slate-900 font-bold text-lg">{formatRp(amount)}</p>
                    {amountPaid !== undefined && amountPaid > 0 && (
                        <p className="text-xs text-emerald-600">Sudah bayar: {formatRp(amountPaid)}</p>
                    )}
                </div>

                {(onApprove || onReject) && (
                    <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        {onReject && (
                            <button
                                onClick={onReject}
                                className="p-2 rounded-full bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition-colors"
                            >
                                <X size={18} />
                            </button>
                        )}
                        {onApprove && (
                            <button
                                onClick={onApprove}
                                className="p-2 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200 transition-colors"
                            >
                                <Check size={18} />
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
