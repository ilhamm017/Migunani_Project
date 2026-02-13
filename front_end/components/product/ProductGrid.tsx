import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ProductGridProps {
    children: ReactNode;
    className?: string;
}

export default function ProductGrid({ children, className }: ProductGridProps) {
    return (
        <div
            className={cn(
                // Mobile-first: 2 columns (PALUGADA style)
                'grid grid-cols-2 gap-3',
                // Desktop: 3-4 columns
                'lg:grid-cols-3 xl:grid-cols-4',
                className
            )}
        >
            {children}
        </div>
    );
}
