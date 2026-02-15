
import React from 'react';
import { cn } from '@/lib/utils';

// Simple implementation without extra dependency for now to be safe
interface MoneyInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    onValueChange?: (val: number) => void;
}

export const MoneyInput: React.FC<MoneyInputProps> = ({
    label,
    error,
    className,
    value,
    onChange,
    onValueChange,
    ...props
}) => {
    // Handle local formatting logic
    const formatDisplay = (val: string | number | readonly string[] | undefined) => {
        if (!val) return '';
        return new Intl.NumberFormat('id-ID').format(Number(val));
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const rawValue = e.target.value.replace(/\./g, '').replace(/[^0-9]/g, '');
        const numValue = Number(rawValue);

        if (onValueChange) {
            onValueChange(numValue);
        }
    };

    return (
        <div className={cn("flex flex-col gap-1.5", className)}>
            {label && <label className="text-sm font-medium text-slate-700">{label}</label>}
            <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-medium">Rp</span>
                <input
                    type="text"
                    className={cn(
                        "w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all font-mono text-lg",
                        error && "border-red-500 focus:ring-red-200"
                    )}
                    value={formatDisplay(value)}
                    onChange={handleChange}
                    {...props}
                />
            </div>
            {error && <span className="text-xs text-red-500">{error}</span>}
        </div>
    );
};
