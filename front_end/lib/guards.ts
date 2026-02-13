'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';

const getPersistApi = () => (useAuthStore as any).persist;

export function useRequireAuth(redirectTo: string = '/auth/login') {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const [hydrated, setHydrated] = useState(() => {
    const persistApi = getPersistApi();
    return persistApi?.hasHydrated?.() ?? false;
  });

  useEffect(() => {
    const persistApi = getPersistApi();
    if (!persistApi) {
      setHydrated(true);
      return;
    }

    const unsub = persistApi.onFinishHydration?.(() => setHydrated(true));
    setHydrated(persistApi.hasHydrated?.() ?? true);

    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

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
  const [hydrated, setHydrated] = useState(() => {
    const persistApi = getPersistApi();
    return persistApi?.hasHydrated?.() ?? false;
  });
  const rolesKey = roles.join(',');
  const hasRole = !!user && roles.includes(user.role);

  useEffect(() => {
    const persistApi = getPersistApi();
    if (!persistApi) {
      setHydrated(true);
      return;
    }

    const unsub = persistApi.onFinishHydration?.(() => setHydrated(true));
    setHydrated(persistApi.hasHydrated?.() ?? true);

    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

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
