export type ArItem = {
  id: string | number;
  qty: number;
  price_at_purchase: number;
  subtotal: number;
  product: {
    id: string;
    sku?: string | null;
    name?: string | null;
  } | null;
};

export type ArRow = {
  id: string;
  invoice_number: string;
  payment_method: 'transfer_manual' | 'cod' | 'cash_store' | string;
  payment_status: 'unpaid' | 'cod_pending' | 'paid' | string;
  payment_proof_url?: string | null;
  amount_paid: number;
  amount_due: number;
  aging_days: number;
  createdAt?: string;
  verified_at?: string | null;
  order: {
    id: string;
    customer_name?: string | null;
    source?: 'web' | 'whatsapp' | 'pos_store' | string | null;
    status?: string | null;
    total_amount: number;
    createdAt?: string | null;
    expiry_date?: string | null;
    customer?: {
      id: string;
      name?: string | null;
      email?: string | null;
      whatsapp_number?: string | null;
    } | null;
    courier?: {
      id: string;
      name?: string | null;
      whatsapp_number?: string | null;
    } | null;
    items: ArItem[];
  };
};

export const sourceLabel = (source?: string | null) => {
  if (source === 'pos_store') return 'Toko (POS)';
  if (source === 'web') return 'Online Web';
  if (source === 'whatsapp') return 'WhatsApp';
  return source || '-';
};

export const paymentMethodLabel = (method?: string) => {
  if (method === 'transfer_manual') return 'Transfer Manual';
  if (method === 'cod') return 'COD';
  if (method === 'cash_store') return 'Tunai Toko';
  return method || '-';
};

export const paymentStatusLabel = (status?: string) => {
  if (status === 'unpaid') return 'Belum Lunas';
  if (status === 'cod_pending') return 'COD Pending';
  if (status === 'paid') return 'Lunas';
  return status || '-';
};
