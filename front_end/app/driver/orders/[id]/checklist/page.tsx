'use client';

import Link from 'next/link';
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
    const t = window.setTimeout(() => {
      router.replace(`/driver/invoices/${encodeURIComponent(id)}`);
    }, 1200);
    return () => window.clearTimeout(t);
  }, [allowed, id, router]);

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-4 pb-24">
      <div className="bg-white border border-slate-200 rounded-[24px] p-5 shadow-sm">
        <h1 className="text-lg font-black text-slate-900">Checklist Driver Dihapus</h1>
        <p className="text-sm text-slate-600 mt-2">
          Checklist driver sudah dipindahkan ke proses <span className="font-black">Tracker/Checker Gudang</span>.
          Jika ada masalah barang saat pengantaran, gunakan fitur <span className="font-black">Lapor Issue</span> di detail invoice.
        </p>
        <div className="mt-4">
          <Link
            href={`/driver/invoices/${encodeURIComponent(id)}`}
            className="rounded-xl bg-slate-900 px-4 py-2 text-[11px] font-black uppercase tracking-wider text-white"
          >
            Kembali ke Detail
          </Link>
        </div>
      </div>
    </div>
  );
}
