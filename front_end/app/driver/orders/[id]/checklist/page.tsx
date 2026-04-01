'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useRequireRoles } from '@/lib/guards';

export default function DriverOrderChecklistPage() {
  const allowed = useRequireRoles(['driver', 'super_admin', 'admin_gudang'], '/driver');
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = String(params?.id || '');

  useEffect(() => {
    if (!allowed) return;
    router.replace(`/driver/invoices/${encodeURIComponent(id)}`);
  }, [allowed, id, router]);

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-4 pb-24">
      <div className="bg-white border border-slate-200 rounded-[24px] p-5 shadow-sm">
        <h1 className="text-lg font-black text-slate-900">Mengalihkan...</h1>
        <p className="text-sm text-slate-600 mt-2">Halaman ini sudah tidak digunakan. Anda akan diarahkan ke detail invoice.</p>
      </div>
    </div>
  );
}
