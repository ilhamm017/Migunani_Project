'use client';

import { useEffect, useState } from 'react';
import GuestLanding from '@/components/home/GuestLanding';
import MemberHome from '@/components/home/MemberHome';
import { useAuthStore } from '@/store/authStore';

export default function HomePage() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const persistApi = (useAuthStore as any).persist;
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
