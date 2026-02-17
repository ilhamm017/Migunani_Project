'use client';

import type { OrderStatusChangedEvent } from '@/lib/orderStatusMeta';

export type { OrderStatusChangedEvent };

export type ReturStatusChangedEvent = {
  retur_id: string;
  order_id: string;
  from_status: string | null;
  to_status: string;
  courier_id?: string | null;
  triggered_by_role?: string | null;
  triggered_at?: string;
  target_roles?: string[];
  target_user_ids?: string[];
};

export type CodSettlementUpdatedEvent = {
  driver_id: string;
  order_ids?: string[];
  invoice_ids?: string[];
  total_expected?: number | null;
  amount_received?: number | null;
  driver_debt_before?: number | null;
  driver_debt_after?: number | null;
  settled_at?: string;
  triggered_by_role?: string | null;
  target_roles?: string[];
  target_user_ids?: string[];
};
