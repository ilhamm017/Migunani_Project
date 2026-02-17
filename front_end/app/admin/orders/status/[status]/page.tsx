'use client';

import { useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useRequireRoles } from '@/lib/guards';
import AdminOrdersListView from '@/components/orders/AdminOrdersListView';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  waiting_payment: 'Waiting Payment',
  waiting_admin_verification: 'Waiting Admin Verification',
  debt_pending: 'Utang Belum Lunas',
  shipped: 'Shipped',
  delivered: 'Delivered',
  completed: 'Completed',
  canceled: 'Canceled',
  hold: 'Bermasalah (Barang Kurang)',
};

export default function AdminOrdersByStatusPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'admin_finance', 'kasir']);
  const params = useParams();
  const router = useRouter();
  const status = String(params?.status || '');

  const label = useMemo(() => STATUS_LABELS[status], [status]);

  useEffect(() => {
    if (!status || !STATUS_LABELS[status]) {
      router.replace('/admin/orders');
    }
  }, [status, router]);

  if (!allowed) return null;
  if (!label) return null;

  return (
    <AdminOrdersListView
      title={`Order Status: ${label}`}
      description="Halaman status khusus agar monitoring order besar lebih fokus."
      fixedStatus={status}
    />
  );
}
