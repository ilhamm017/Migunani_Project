'use client';

import { useRequireRoles } from '@/lib/guards';
import AdminOrdersListView from '@/components/orders/AdminOrdersListView';

export default function AdminOrdersPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'admin_finance']);
  if (!allowed) return null;

  return (
    <AdminOrdersListView
      title="Admin Order Management"
      description="Halaman ini menampilkan semua order. Gunakan tab status untuk memisahkan volume order yang besar."
      fixedStatus="all"
    />
  );
}

