'use client';

import { useParams, useSearchParams } from 'next/navigation';
import AdminOrdersWorkspace from '@/components/orders/AdminOrdersWorkspace';

export default function CustomerOrderDetailPage() {
  const params = useParams<{ customerId: string }>();
  const searchParams = useSearchParams();
  const decodedCustomerId = decodeURIComponent(params.customerId);
  const customerName = searchParams.get('customerName');

  return (
    <AdminOrdersWorkspace
      forcedCustomerId={decodedCustomerId.startsWith('guest:') ? undefined : decodedCustomerId}
      forcedCustomerKey={decodedCustomerId}
      forcedCustomerName={customerName ? decodeURIComponent(customerName) : undefined}
    />
  );
}
