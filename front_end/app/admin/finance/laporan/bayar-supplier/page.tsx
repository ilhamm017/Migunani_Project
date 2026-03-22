import { Suspense } from 'react';
import BayarSupplierClient from './BayarSupplierClient';

export default function BayarSupplierPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50 p-5 text-sm text-slate-500">Loading...</div>}>
      <BayarSupplierClient />
    </Suspense>
  );
}
