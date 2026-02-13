import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'default' | 'outline' | 'ghost' | 'destructive' | 'warning' | 'dark';
    size?: 'default' | 'sm' | 'lg' | 'icon';
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant = 'default', size = 'default', ...props }, ref) => {
        return (
            <button
                ref={ref}
                className={cn(
                    // Base styles - PALUGADA
                    'inline-flex items-center justify-center rounded-2xl font-black text-xs uppercase',
                    'transition-all focus-visible:outline-none focus-visible:ring-2',
                    'focus-visible:ring-emerald-500 focus-visible:ring-offset-2',
                    'disabled:opacity-50 disabled:pointer-events-none',
                    'touch-manipulation active:scale-[0.96] active:translate-y-[1px] active:brightness-95 active:shadow-inner',
                    // Variants
                    {
                        'bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-200': variant === 'default',
                        'border-2 border-slate-200 text-slate-600 bg-white hover:bg-slate-50':
                            variant === 'outline',
                        'hover:bg-slate-50 text-slate-600': variant === 'ghost',
                        'bg-rose-500 text-white hover:bg-rose-600': variant === 'destructive',
                        'bg-amber-500 text-white hover:bg-amber-600': variant === 'warning',
                        'bg-slate-900 text-white hover:bg-slate-800 shadow-lg': variant === 'dark',
                    },
                    // Sizes (touch-friendly)
                    {
                        'h-12 px-6 py-3': size === 'default',
                        'h-9 px-4 text-[10px]': size === 'sm',
                        'h-14 px-8 text-sm': size === 'lg',
                        'h-12 w-12 p-0': size === 'icon',
                    },
                    className
                )}
                {...props}
            />
        );
    }
);

Button.displayName = 'Button';

export { Button };
