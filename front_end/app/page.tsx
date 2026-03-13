'use client';

import { useSyncExternalStore } from 'react';
import GuestLanding from '@/components/home/GuestLanding';
import MemberHome from '@/components/home/MemberHome';
import { useAuthStore } from '@/store/authStore';

type PersistApi = {
  hasHydrated?: () => boolean;
  onFinishHydration?: (callback: () => void) => (() => void) | void;
};

const getPersistApi = (): PersistApi | undefined => {
  const store = useAuthStore as unknown as { persist?: PersistApi };
  return store.persist;
};

export default function HomePage() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hydrated = useSyncExternalStore(
    (onStoreChange) => {
      const persistApi = getPersistApi();
      const unsubscribe = persistApi?.onFinishHydration?.(onStoreChange);
      return typeof unsubscribe === 'function' ? unsubscribe : () => undefined;
    },
    () => {
      const persistApi = getPersistApi();
      return persistApi?.hasHydrated?.() ?? true;
    },
    () => true
  );

  if (!hydrated) {
    return (
      <div className="p-6">
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
          <p className="text-sm text-slate-500">Memuat halaman...</p>
        </div>
      </div>
    );
  }

  return isAuthenticated ? <MemberHome /> : <GuestLanding />;
}
