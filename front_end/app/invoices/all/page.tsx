import { Suspense } from 'react';
import CustomerAllInvoicesPage from './ClientPage';

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Memuat...</div>}>
      <CustomerAllInvoicesPage />
    </Suspense>
  );
}

