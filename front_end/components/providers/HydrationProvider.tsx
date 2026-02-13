'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useCartStore } from '@/store/cartStore';

export default function HydrationProvider({ children }: { children: React.ReactNode }) {
    useEffect(() => {
        // Rehydrate stores on client mount
        const authPersist = (useAuthStore as any).persist;
        const cartPersist = (useCartStore as any).persist;
        authPersist?.rehydrate?.();
        cartPersist?.rehydrate?.();
    }, []);

    return <>{children}</>;
}
