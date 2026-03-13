'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';

type PersistApi = {
  hasHydrated?: () => boolean;
  onFinishHydration?: (callback: () => void) => (() => void) | void;
};

const getPersistApi = (): PersistApi | undefined => {
  const store = useAuthStore as unknown as { persist?: PersistApi };
  return store.persist;
};

const noopUnsubscribe = () => undefined;

function useAuthHydrated() {
  return useSyncExternalStore(
    (onStoreChange) => {
      const persistApi = getPersistApi();
      const unsubscribe = persistApi?.onFinishHydration?.(onStoreChange);
      return typeof unsubscribe === 'function' ? unsubscribe : noopUnsubscribe;
    },
    () => {
      const persistApi = getPersistApi();
      return persistApi?.hasHydrated?.() ?? true;
    },
    () => true
  );
}

export function useRequireAuth(redirectTo: string = '/auth/login') {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const hydrated = useAuthHydrated();

  useEffect(() => {
    if (!hydrated) return;
    if (!isAuthenticated) {
      router.push(redirectTo);
    }
  }, [hydrated, isAuthenticated, redirectTo, router]);

  return hydrated && isAuthenticated;
}

export function useRequireRoles(roles: string[], redirectTo: string = '/') {
  const router = useRouter();
  const { isAuthenticated, user } = useAuthStore();
  const hydrated = useAuthHydrated();
  const rolesKey = roles.join(',');
  const hasRole = !!user && roles.includes(user.role);

  useEffect(() => {
    if (!hydrated) return;
    if (!isAuthenticated) {
      router.push('/auth/login');
      return;
    }

    if (user && !hasRole) {
      router.push(redirectTo);
    }
  }, [hasRole, hydrated, isAuthenticated, redirectTo, rolesKey, router, user]);

  return hydrated && isAuthenticated && hasRole;
}
