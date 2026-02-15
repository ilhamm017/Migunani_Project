
import React from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/Card';

interface KpiCardProps {
    title: string;
    value: string;
    subValue?: string;
    icon?: React.ReactNode;
    trend?: 'up' | 'down' | 'neutral';
    trendValue?: string;
    onClick?: () => void;
    className?: string;
    color?: 'blue' | 'green' | 'red' | 'yellow' | 'default';
}

const colorMap = {
    default: 'bg-white border-slate-200',
    blue: 'bg-blue-50 border-blue-200 text-blue-900',
    green: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    red: 'bg-red-50 border-red-200 text-red-900',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-900',
};

export const KpiCard: React.FC<KpiCardProps> = ({
    title,
    value,
    subValue,
    icon,
    trend,
    trendValue,
    onClick,
    className,
    color = 'default'
}) => {
    return (
        <div
            onClick={onClick}
            className={cn(
                "min-w-[160px] p-4 rounded-xl border flex flex-col justify-between cursor-pointer transition-all hover:shadow-md h-[100px]",
                colorMap[color],
                className
            )}
        >
            <div className="flex justify-between items-start">
                <p className="text-xs font-medium opacity-70 uppercase tracking-wider">{title}</p>
                {icon && <div className="opacity-80">{icon}</div>}
            </div>
            <div>
                <h3 className="text-xl font-bold font-mono">{value}</h3>
                {subValue && <p className="text-xs opacity-70 mt-1">{subValue}</p>}
            </div>
        </div>
    );
};
