'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function FinanceAdminHubPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/admin');
  }, [router]);

  return <div className="p-6 text-center text-slate-500">Redirecting to Dashboard...</div>;
}
