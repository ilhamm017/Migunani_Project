'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useRequireRoles } from '@/lib/guards';

export default function DriverPrecheckPage() {
  const allowed = useRequireRoles(['driver', 'super_admin', 'admin_gudang'], '/driver');
  const router = useRouter();

  useEffect(() => {
    if (!allowed) return;
    const t = window.setTimeout(() => {
      router.replace('/driver');
    }, 1200);
    return () => window.clearTimeout(t);
  }, [allowed, router]);

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-4 pb-24">
      <div className="bg-white border border-slate-200 rounded-[24px] p-5 shadow-sm">
        <h1 className="text-lg font-black text-slate-900">Checklist Driver Dihapus</h1>
        <p className="text-sm text-slate-600 mt-2">
          Proses pengecekan barang sekarang ditangani oleh <span className="font-black">Tracker/Checker Gudang</span>.
          Driver cukup menjalankan pengiriman setelah status menjadi <span className="font-black">shipped</span>.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/driver"
            className="rounded-xl bg-slate-900 px-4 py-2 text-[11px] font-black uppercase tracking-wider text-white"
          >
            Kembali ke Driver
          </Link>
        </div>
      </div>
    </div>
  );
}
