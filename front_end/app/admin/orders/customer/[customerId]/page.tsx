'use client';

import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import AdminOrdersWorkspace from '@/components/orders/AdminOrdersWorkspace';

function CustomerOrderDetailPageContent() {
  const params = useParams<{ customerId: string }>();
  const searchParams = useSearchParams();
  const decodedCustomerId = decodeURIComponent(params.customerId);
  const customerName = searchParams.get('customerName');
  const requestedSection = searchParams.get('section');
  const requestedOrderId = searchParams.get('orderId');
  const initialSection = requestedSection === 'backorder'
    || requestedSection === 'baru'
    || requestedSection === 'allocated'
    || requestedSection === 'pembayaran'
    || requestedSection === 'checker'
    || requestedSection === 'gudang'
    || requestedSection === 'pengiriman'
    || requestedSection === 'selesai'
    || requestedSection === 'all'
    ? requestedSection
    : undefined;

  return (
    <AdminOrdersWorkspace
      forcedCustomerId={decodedCustomerId.startsWith('guest:') ? undefined : decodedCustomerId}
      forcedCustomerKey={decodedCustomerId}
      forcedCustomerName={customerName ? decodeURIComponent(customerName) : undefined}
      initialSection={initialSection}
      initialFocusOrderId={requestedOrderId ? decodeURIComponent(requestedOrderId) : undefined}
    />
  );
}

export default function CustomerOrderDetailPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Memuat detail customer...</div>}>
      <CustomerOrderDetailPageContent />
    </Suspense>
  );
}
