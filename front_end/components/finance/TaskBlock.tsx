
import React from 'react';
import { cn } from '@/lib/utils';
import { ChevronRight } from 'lucide-react';

interface TaskBlockProps {
    title: string;
    count?: number;
    children: React.ReactNode;
    actionLabel?: string;
    onAction?: () => void;
    href?: string;
    className?: string;
}

export const TaskBlock: React.FC<TaskBlockProps> = ({
    title,
    count,
    children,
    actionLabel,
    onAction,
    href,
    className
}) => {
    return (
        <div className={cn("bg-white rounded-xl border border-slate-200 overflow-hidden", className)}>
            <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-800 text-sm">{title}</h3>
                    {count !== undefined && count > 0 && (
                        <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                            {count}
                        </span>
                    )}
                </div>
                {href && (
                    <a href={href} className="text-xs text-blue-600 font-medium flex items-center hover:underline">
                        Lihat Semua <ChevronRight className="w-3 h-3 ml-0.5" />
                    </a>
                )}
            </div>
            <div className="p-4">
                {children}
            </div>
            {actionLabel && onAction && (
                <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/50">
                    <button
                        onClick={onAction}
                        className="w-full text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 py-1.5 rounded-lg transition-colors"
                    >
                        {actionLabel}
                    </button>
                </div>
            )}
        </div>
    );
};
