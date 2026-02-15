
import React from 'react';
import { cn } from '@/lib/utils';
import { Wallet, Building2 } from 'lucide-react';

interface AccountSelectorProps {
    value: '1101' | '1102' | string; // 1101=Kas, 1102=Bank
    onChange: (val: string) => void;
    label?: string;
    error?: string;
}

export const AccountSelector: React.FC<AccountSelectorProps> = ({ value, onChange, label = "Sumber Dana", error }) => {
    return (
        <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-slate-700">{label}</label>
            <div className="grid grid-cols-2 gap-3">
                <button
                    type="button"
                    onClick={() => onChange('1101')}
                    className={cn(
                        "flex flex-col items-center gap-2 p-3 rounded-xl border transition-all hover:bg-slate-50",
                        value === '1101'
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-500"
                            : "border-slate-200 text-slate-600"
                    )}
                >
                    <Wallet size={24} className={value === '1101' ? "text-emerald-600" : "text-slate-400"} />
                    <span className="text-sm font-medium">KAS TUNAI</span>
                </button>

                <button
                    type="button"
                    onClick={() => onChange('1102')}
                    className={cn(
                        "flex flex-col items-center gap-2 p-3 rounded-xl border transition-all hover:bg-slate-50",
                        value === '1102'
                            ? "border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-500"
                            : "border-slate-200 text-slate-600"
                    )}
                >
                    <Building2 size={24} className={value === '1102' ? "text-blue-600" : "text-slate-400"} />
                    <span className="text-sm font-medium">TRANSFER BANK</span>
                </button>
            </div>
            {error && <span className="text-xs text-red-500">{error}</span>}
        </div>
    );
};
