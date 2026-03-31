export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type UserLite = {
  id?: string;
  name?: string;
  role?: string;
  email?: string | null;
  whatsapp_number?: string | null;
  CustomerProfile?: {
    saved_addresses?: unknown;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
};

export type ProductLite = {
  id?: string;
  name?: string | null;
  sku?: string | null;
  unit?: string | null;
  stock_quantity?: number | string | null;
  allocated_quantity?: number | string | null;
  image_url?: string | null;
  [key: string]: unknown;
};

export type OrderAllocationRow = {
  id?: string;
  product_id?: string;
  allocated_qty?: number;
  status?: string;
  [key: string]: unknown;
};

export type OrderItemRow = {
  id?: string;
  order_id?: string;
  product_id?: string;
  qty?: number;
  ordered_qty_original?: number;
  qty_canceled_backorder?: number;
  qty_canceled_manual?: number;
  price_at_purchase?: number;
  Product?: ProductLite | null;
  [key: string]: unknown;
};

export type InvoiceLite = {
  id?: string;
  invoice_number?: string;
  total?: number;
  payment_status?: string;
  payment_method?: string;
  shipment_status?: string;
  createdAt?: string;
  [key: string]: unknown;
};

export type PosSaleItemRow = {
  id?: string;
  pos_sale_id?: string;
  product_id?: string;
  sku_snapshot?: string;
  name_snapshot?: string;
  unit_snapshot?: string;
  qty?: number;
  unit_price?: number;
  line_total?: number;
  unit_cost?: number;
  cogs_total?: number;
  [key: string]: unknown;
};

export type PosSaleRow = {
  id?: string;
  receipt_no?: string | number;
  receipt_number?: string | null;
  invoice_id?: string | null;
  invoice_number?: string | null;
  cashier_user_id?: string;
  customer_name?: string | null;
  note?: string | null;
  status?: 'paid' | 'voided' | 'refunded' | string;
  subtotal?: number;
  discount_amount?: number;
  discount_percent?: number;
  tax_percent?: number;
  tax_amount?: number;
  total?: number;
  amount_received?: number;
  change_amount?: number;
  paid_at?: string;
  voided_at?: string | null;
  voided_by?: string | null;
  void_reason?: string | null;
  refunded_at?: string | null;
  refunded_by?: string | null;
  refund_reason?: string | null;
  Cashier?: UserLite | null;
  Invoice?: { id?: string; invoice_number?: string; payment_status?: string } | null;
  Items?: PosSaleItemRow[];
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

export type PosSaleListResponse = {
  page: number;
  limit: number;
  total: number;
  rows: PosSaleRow[];
  period?: { start: string; end: string };
};

export type PosDailySummaryResponse = {
  date: string;
  period: { start: string; end: string };
  summary: { total_transactions: number; total_revenue: number; total_qty: number };
  top_items: Array<{
    product_id: string;
    sku: string;
    product_name: string;
    unit: string;
    qty_sold: number;
    revenue: number;
    cogs: number;
  }>;
};

export type AdminOrderListRow = {
  id?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  customer_id?: string;
  customer_name?: string;
  courier_id?: string | null;
  invoice_id?: string | null;
  invoice_number?: string | null;
  payment_method?: string | null;
  total_amount?: number | null;
  allocated_amount?: number | null;
  is_backorder?: boolean;
  Customer?: UserLite;
  Courier?: UserLite;
  Issues?: unknown[];
  Children?: Array<{ id?: string; [key: string]: unknown }>;
  Allocations?: OrderAllocationRow[];
  OrderItems?: Array<{ id?: string; product_id?: string; price_at_purchase?: number; [key: string]: unknown }>;
  Invoice?: InvoiceLite | null;
  Invoices?: InvoiceLite[];
  [key: string]: unknown;
};

export type AdminOrderListResponse = {
  total: number;
  totalPages: number;
  currentPage: number;
  orders: AdminOrderListRow[];
};

export type AdminOrderMonitoringTopBackorderRow = {
  order_id: string;
  customer_name: string;
  status: string;
  createdAt: string;
  qty_pending: number;
};

export type AdminOrderMonitoringTopCanceledRow = {
  order_id: string;
  customer_name: string;
  status: string;
  createdAt: string;
  qty_canceled: number;
};

export type AdminOrderMonitoringResponse = {
  scope: 'active' | 'all';
  range: { startDate?: string; endDate?: string };
  quantities: {
    ordered_net: number;
    allocated: number;
    backorder_pending: number;
    canceled: number;
  };
  orders: {
    by_status: Record<string, number>;
    total: number;
  };
  top: {
    backorder_orders: AdminOrderMonitoringTopBackorderRow[];
    canceled_orders: AdminOrderMonitoringTopCanceledRow[];
  };
};

export type AdminOrderMonitoringSkuRow = {
  product_id: string;
  sku: string;
  name: string;
  product_status: string;
  stock_quantity: number;
  min_stock: number;
  order_count: number;
  ordered_net_qty: number;
  allocated_qty: number;
  backorder_pending_qty: number;
  canceled_qty: number;
  unallocated_qty: number;
  suggested_purchase_qty: number;
};

export type AdminOrderMonitoringSkuResponse = {
  scope: 'active' | 'all';
  range: { startDate?: string; endDate?: string };
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  rows: AdminOrderMonitoringSkuRow[];
};

export type OrderItemSummaryRow = {
  order_item_id: string;
  ordered_qty_original: number;
  allocated_qty_total: number;
  invoiced_qty_total: number;
  backorder_open_qty: number;
  backorder_canceled_qty: number;
  manual_canceled_qty?: number;
  [key: string]: unknown;
};

export type OrderTimelineEventRow = {
  id: string;
  event_type: string;
  order_item_id: string | null;
  invoice_id: string | null;
  reason: unknown;
  actor_role: unknown;
  occurred_at: unknown;
  payload: unknown;
  [key: string]: unknown;
};

export type OrderDetailResponse = {
  id: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  customer_id?: string;
  customer_name?: string;
  courier_id?: string | null;
  invoice_id?: string | null;
  invoice_number?: string | null;
  payment_method?: string | null;
  total_amount?: number | null;
  parent_order_id?: string | null;
  active_issue?: {
    note?: string | null;
    due_at?: string | null;
    [key: string]: unknown;
  } | null;
  issue_overdue?: boolean;
  Customer?: UserLite;
  Courier?: UserLite;
  Issues?: unknown[];
  Children?: Array<{ id?: string; [key: string]: unknown }>;
  Retur?: unknown;
  Returs?: Array<{
    id?: string;
    qty?: number;
    createdAt?: string;
    status?: string;
    admin_response?: string | null;
    [key: string]: unknown;
  }>;
  OrderItems?: OrderItemRow[];
  Allocations?: OrderAllocationRow[];
  Invoice?: InvoiceLite | null;
  Invoices?: InvoiceLite[];
  item_summaries?: OrderItemSummaryRow[];
  timeline?: OrderTimelineEventRow[];
  [key: string]: unknown;
};

export type InvoiceCustomerRow = {
  id: string;
  name?: string | null;
  email?: string | null;
  whatsapp_number?: string | null;
  [key: string]: unknown;
};

export type InvoiceItemRow = {
  id?: string;
  qty?: number;
  unit_price?: number;
  line_total?: number;
  order_item_id?: string;
  ordered_qty?: number;
  invoice_qty?: number;
  allocated_qty?: number;
  remaining_qty?: number;
  previously_allocated_qty?: number;
  canceled_backorder_qty?: number;
  OrderItem?: OrderItemRow | null;
  Product?: ProductLite | null;
  [key: string]: unknown;
};

export type InvoiceDetailResponse = {
  id?: string;
  invoice_number?: string;
  payment_status?: string;
  payment_method?: string;
  subtotal?: number;
  discount_amount?: number;
  shipping_fee_total?: number;
  tax_amount?: number;
  total?: number;
  createdAt?: string;
  shipping_method_name?: string | null;
  order_ids?: string[];
  customer?: InvoiceCustomerRow | null;
  InvoiceItems?: InvoiceItemRow[];
  Items?: InvoiceItemRow[];
  [key: string]: unknown;
};

export type DriverAssignedOrderRow = {
  id?: string;
  real_order_id?: string;
  invoice_id?: string;
  invoice_number?: string;
  total_amount?: number;
  payment_status?: string;
  payment_method?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  Customer?: UserLite;
  OrderItems?: OrderItemRow[];
  Invoice?: InvoiceLite | null;
  Invoices?: InvoiceLite[];
  [key: string]: unknown;
};
