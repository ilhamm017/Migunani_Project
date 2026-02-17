export type OrderStatusChangedEvent = {
  order_id: string;
  from_status: string | null;
  to_status: string;
  source?: string | null;
  payment_method?: string | null;
  courier_id?: string | null;
  triggered_by_role?: string | null;
  triggered_at?: string;
  target_roles?: string[];
  target_user_ids?: string[];
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  waiting_invoice: 'Menunggu Invoice',
  waiting_payment: 'Menunggu Pembayaran',
  waiting_admin_verification: 'Menunggu Verifikasi Admin',
  ready_to_ship: 'Siap Dikirim',
  allocated: 'Dialokasikan',
  partially_fulfilled: 'Terpenuhi Sebagian',
  debt_pending: 'Utang Belum Lunas',
  shipped: 'Dalam Pengiriman',
  delivered: 'Terkirim',
  completed: 'Selesai',
  canceled: 'Dibatalkan',
  hold: 'Bermasalah',
  expired: 'Kadaluarsa',
};

export const formatOrderStatusLabel = (statusRaw: unknown): string => {
  const key = String(statusRaw || '').trim().toLowerCase();
  if (!key) return '-';
  return STATUS_LABELS[key] || key.replace(/_/g, ' ');
};

export const formatOrderStatusToastMessage = (event: OrderStatusChangedEvent): string => {
  const shortOrderId = String(event.order_id || '').slice(-8).toUpperCase();
  const statusLabel = formatOrderStatusLabel(event.to_status);
  return `Pesanan #${shortOrderId} pindah ke ${statusLabel}, perlu aksi Anda.`;
};

