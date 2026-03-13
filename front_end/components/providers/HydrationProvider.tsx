'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useCartStore } from '@/store/cartStore';

type PersistApi = {
    rehydrate?: () => void;
};

const getPersist = (store: unknown): PersistApi | undefined => {
    const typedStore = store as { persist?: PersistApi };
    return typedStore.persist;
};

export default function HydrationProvider({ children }: { children: React.ReactNode }) {
    useEffect(() => {
        // Rehydrate stores on client mount
        const authPersist = getPersist(useAuthStore);
        const cartPersist = getPersist(useCartStore);
        authPersist?.rehydrate?.();
        cartPersist?.rehydrate?.();
    }, []);

    return <>{children}</>;
}
