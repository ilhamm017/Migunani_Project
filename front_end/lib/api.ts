import axios from 'axios';
import type {
    AdminOrderListResponse,
    DriverAssignedOrderRow,
    InvoiceDetailResponse,
    OrderDetailResponse,
} from './apiTypes';

// Use Next.js rewrite proxy to avoid browser->backend connectivity/cors issues in local dev.
export const API_BASE_URL = '/api';

// Create axios instance
export const apiClient = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Request interceptor - add auth token
apiClient.interceptors.request.use(
    (config) => {
        const token = sessionStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

type JsonRecord = Record<string, unknown>;
type SavedAddressesPayload = unknown[];

// Response interceptor - handle errors
apiClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        const status = error.response?.status;
        const message = String(error.response?.data?.message || '');
        const isAuthTokenInvalid =
            status === 401 ||
            (status === 403 && /invalid (or )?expired token|invalid token payload/i.test(message));

        if (isAuthTokenInvalid) {
            // Unauthorized - clear auth state and redirect to login
            if (typeof window !== 'undefined') {
                try {
                    const { useAuthStore } = await import('@/store/authStore');
                    useAuthStore.getState().logout();
                } catch {
                    sessionStorage.removeItem('token');
                    sessionStorage.removeItem('user');
                    sessionStorage.removeItem('web_chat_session_id');
                    sessionStorage.removeItem('web_chat_guest_id');
                    window.dispatchEvent(new CustomEvent('webchat:close'));
                }
                window.location.href = '/auth/login';
            }
        }
        return Promise.reject(error);
    }
);

// API Methods
export const api = {
    // Auth
    auth: {
        login: (credentials: { email: string; password: string }) =>
            apiClient.post('/auth/login', credentials),
        register: (userData: {
            email: string;
            password: string;
            name: string;
            phone?: string;
            whatsapp_number?: string;
        }) =>
            apiClient.post('/auth/register', {
                name: userData.name,
                email: userData.email,
                password: userData.password,
                whatsapp_number: userData.whatsapp_number ?? userData.phone,
            }),
    },

    // Catalog (Public)
    catalog: {
        getProducts: (params?: { search?: string; category?: string; category_id?: number | string; page?: number; limit?: number }) => {
            const fallbackCategoryId = typeof params?.category === 'string' && params.category.trim() && !Number.isNaN(Number(params.category))
                ? Number(params.category)
                : undefined;
            const normalizedParams = {
                ...params,
                category_id: params?.category_id ?? fallbackCategoryId,
            };
            return apiClient.get('/catalog', { params: normalizedParams });
        },
        getCategories: (params?: { limit?: number }) =>
            apiClient.get('/catalog/categories', { params }),
        getProductById: (id: string) =>
            apiClient.get(`/catalog/${id}`),
    },

    // Cart
    cart: {
        getCart: () => apiClient.get('/cart'),
        addToCart: (data: { productId: string; quantity: number }) =>
            apiClient.post('/cart', {
                product_id: data.productId,
                qty: data.quantity,
            }),
        updateCartItem: (itemId: string, quantity: number) =>
            apiClient.patch(`/cart/item/${itemId}`, { qty: quantity }),
        removeCartItem: (itemId: string) =>
            apiClient.delete(`/cart/item/${itemId}`),
        clearCart: () => apiClient.delete('/cart'),
    },

    // Orders
    orders: {
        checkout: (data: {
            from_cart?: boolean;
            payment_method?: 'transfer_manual' | 'cod' | 'cash_store';
            items?: Array<{
                product_id: string;
                qty: number;
                clearance_promo_id?: string;
                unit_price_override?: number;
                unit_price_override_reason?: string;
            }>;
            customer_id?: string; // Optional for admin manual order
            shipping_method_code?: string;
            promo_code?: string;
            shipping_address?: string;
            customer_note?: string;
            price_override_reason?: string;
        }) => apiClient.post('/orders/checkout', data),
        getMyOrders: (params?: { page?: number; limit?: number; status?: string; include_collectible_total?: string }) =>
            apiClient.get('/orders/my-orders', { params }),
        getOrderById: (id: string) => apiClient.get<OrderDetailResponse>(`/orders/${id}`),
        uploadPaymentProof: (orderId: string, formData: FormData) =>
            apiClient.post(`/orders/${orderId}/proof`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            }),
        reportMissingItem: (id: string, data: { items: { product_id: string; qty_missing: number }[]; note?: string }) =>
            apiClient.post(`/orders/${id}/missing-item`, data),
    },

    // Profile (Customer)
    profile: {
        getMe: () => apiClient.get('/profile/me'),
        getBalance: () => apiClient.get('/profile/balance'),
        updateAddresses: (addresses: SavedAddressesPayload) => apiClient.patch('/profile/addresses', { saved_addresses: addresses }),
    },

    // Promos
    promos: {
        validate: (code: string) => apiClient.get(`/promos/validate/${code}`),
    },

    clearancePromos: {
        getActive: () => apiClient.get('/clearance-promos/active'),
    },

    // Shipping Methods (Public)
    shippingMethods: {
        getAll: (params?: { active_only?: boolean }) =>
            apiClient.get('/shipping-methods', { params }),
    },

    invoices: {
        getById: (invoiceId: string) => apiClient.get<InvoiceDetailResponse>(`/invoices/${invoiceId}`),
        getWarehouseQueue: (params?: { status?: string; q?: string; limit?: number | string }) =>
            apiClient.get(`/invoices/admin/warehouse/queue`, { params }),
        getWarehousePicklist: (params?: { status?: string; q?: string; limit?: number | string }) =>
            apiClient.get(`/invoices/admin/warehouse/picklist`, { params }),
        downloadWarehousePicklistXlsx: (params?: { status?: string; q?: string; limit?: number | string }) =>
            apiClient.get(`/invoices/admin/warehouse/picklist.xlsx`, { params, responseType: 'blob' }),
        getPicklist: (invoiceId: string) => apiClient.get(`/invoices/${invoiceId}/picklist`),
        downloadPicklistXlsx: (invoiceId: string) => apiClient.get(`/invoices/${invoiceId}/picklist.xlsx`, { responseType: 'blob' }),
        getMy: (params?: {
            page?: number;
            limit?: number;
            q?: string;
            stage?: 'all' | 'active' | 'completed' | string;
            payment_status?: string; // comma-separated
            payment_method?: string; // comma-separated
            shipment_status?: string; // comma-separated
            has_proof?: 'true' | 'false' | string;
            verified?: 'true' | 'false' | string;
            created_from?: string;
            created_to?: string;
            expiry_from?: string;
            expiry_to?: string;
            min_total?: number | string;
            max_total?: number | string;
            order_id?: string;
            sort?: 'createdAt_desc' | 'createdAt_asc' | 'total_desc' | 'total_asc' | 'expiry_desc' | 'expiry_asc' | string;
            include_collectible_total?: 'true' | 'false' | string;
        }) => apiClient.get(`/invoices/my`, { params }),
        uploadPaymentProof: (invoiceId: string, formData: FormData) =>
            apiClient.post(`/invoices/${invoiceId}/proof`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            }),
        assignDriver: (invoiceId: string, data: { courier_id: string }) =>
            apiClient.patch(`/invoices/${invoiceId}/assign-driver`, data),
    },

    deliveryHandovers: {
        check: (formData: FormData) =>
            apiClient.post(`/admin/delivery-handovers/check`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            }),
        latest: (invoiceId: string) =>
            apiClient.get(`/admin/delivery-handovers/latest`, { params: { invoice_id: invoiceId } }),
        handover: (handoverId: number | string) =>
            apiClient.post(`/admin/delivery-handovers/${handoverId}/handover`, {}),
    },

    // Allocation (Admin)
    allocation: {
        getPending: (params?: { scope?: 'shortage' | 'all' }) =>
            apiClient.get('/allocation/pending', { params }),
        getPicklist: (params?: {
            view?: 'product' | 'customer';
            q?: string;
            allocation_status?: 'pending' | 'picked' | 'shipped' | 'all' | string;
            order_status?: string; // comma-separated
            order_ids?: string; // comma-separated
            limit?: number;
        }) => apiClient.get('/allocation/picklist', { params }),
        getByProduct: (productId: string) => apiClient.get(`/allocation/product/${productId}`),
        getDetail: (id: string) => apiClient.get(`/allocation/${id}`),
        allocate: (id: string, items: Array<{ product_id: string; qty: number }>) =>
            apiClient.post(`/allocation/${id}`, { items }),
        cancelBackorder: (id: string, reason: string) =>
            apiClient.post(`/allocation/${id}/cancel-backorder`, { reason }),
        cancelBackorderItems: (id: string, reason: string, productIds: string[]) =>
            apiClient.post(`/allocation/${id}/cancel-backorder-items`, {
                reason,
                product_ids: productIds,
            }),
    },

    // Retur (Customer & Admin)
    retur: {
        request: (data: FormData) => apiClient.post('/retur/request', data, {
            headers: { 'Content-Type': 'multipart/form-data' }
        }),
        getMyReturs: () => apiClient.get('/retur/my'),
        getAll: (params?: string | { status?: string; retur_type?: 'customer_request' | 'delivery_refusal' | 'delivery_damage' | string }) => {
            if (typeof params === 'string') {
                return apiClient.get('/retur/all', { params: { status: params } });
            }
            return apiClient.get('/retur/all', { params });
        },
        updateStatus: (id: string, data: {
            status: string;
            admin_response?: string;
            courier_id?: string;
            refund_amount?: number;
            is_back_to_stock?: boolean;
            qty_received?: number;
        }) => apiClient.put(`/retur/${id}/status`, data),
        disburse: (id: string, note?: string) => apiClient.post(`/retur/${id}/disburse`, { note }),
        getHandovers: (params?: { status?: 'submitted' | 'received' }) =>
            apiClient.get('/retur/handovers', { params }),
        receiveHandover: (handoverId: number | string, payload: { items: Array<{ retur_id: string; qty_received: number }>; note?: string }) =>
            apiClient.post(`/retur/handovers/${handoverId}/receive`, payload),
    },

    // Admin
    admin: {
        pos: {
            createSale: (data: {
                customer_id?: string;
                note?: string;
                discount_percent?: number;
                amount_received: number;
                items: Array<{
                    product_id: string;
                    qty: number;
                    clearance_promo_id?: string;
                    unit_price_override?: number;
                    override_reason?: string;
                }>;
            }) => apiClient.post('/admin/pos/sales', data),
            listSales: (params?: {
                page?: number;
                limit?: number;
                q?: string;
                startDate?: string;
                endDate?: string;
                cashier_user_id?: string;
                status?: 'paid' | 'voided' | 'refunded' | string;
            }) => apiClient.get('/admin/pos/sales', { params }),
            getSaleById: (id: string) => apiClient.get(`/admin/pos/sales/${id}`),
            refundSale: (id: string, data: { reason?: string }) =>
                apiClient.post(`/admin/pos/sales/${id}/refund`, data),
            voidSale: (id: string, data: { reason?: string }) =>
                apiClient.post(`/admin/pos/sales/${id}/void`, data),
            getDailySummary: (params?: { date?: string }) =>
                apiClient.get('/admin/pos/reports/daily-summary', { params }),
        },
        driverDeposit: {
            getList: () => apiClient.get('/admin/driver-deposit'),
            getHistory: (params?: {
                driver_id?: string;
                from?: string;
                to?: string;
                include_status?: 'all' | 'submitted' | 'received' | string;
                limit?: number;
                offset?: number;
            }) => apiClient.get('/admin/driver-deposit/history', { params }),
            confirm: (payload: {
                driver_id: string;
                cod?: { invoice_ids: string[]; amount_received: number };
                handovers?: Array<{
                    handover_id: number;
                    note?: string;
                    items: Array<{ retur_id: string; qty_received: number }>;
                }>;
            }) => apiClient.post('/admin/driver-deposit/confirm', payload),
        },
        customers: {
            search: (query: string, params?: { status?: 'all' | 'active' | 'banned'; limit?: number }) =>
                apiClient.get('/admin/customers/search', { params: { search: query, ...params } }),
            getAll: (params?: {
                page?: number;
                limit?: number;
                search?: string;
                status?: 'all' | 'active' | 'banned';
            }) => apiClient.get('/admin/customers', { params }),
            getById: (id: string) => apiClient.get(`/admin/customers/${id}`),
            getOrders: (id: string, params?: {
                page?: number;
                limit?: number;
                scope?: 'all' | 'open';
                status?: string;
                startDate?: string;
                endDate?: string;
                include_collectible_total?: boolean;
            }) => apiClient.get(`/admin/customers/${id}/orders`, { params }),
            exportOrdersXlsx: (id: string, params?: {
                scope?: 'all' | 'open';
                status?: string;
                startDate?: string;
                endDate?: string;
                limit?: number;
            }) => apiClient.get(`/admin/customers/${id}/orders/export-xlsx`, { params, responseType: 'blob' }),
            getTopProducts: (id: string, params?: {
                startDate?: string;
                endDate?: string;
                limit?: number;
                include_inactive?: boolean;
            }) => apiClient.get(`/admin/customers/${id}/top-products`, { params }),
            updateEmail: (id: string, email: string) =>
                apiClient.patch(`/admin/customers/${id}/email`, { email }),
            updatePassword: (id: string, password: string) =>
                apiClient.patch(`/admin/customers/${id}/password`, { password }),
            updateStatus: (id: string, data: {
                status: 'active' | 'banned';
                halt_open_orders?: boolean;
            }) => apiClient.patch(`/admin/customers/${id}/status`, data),
            sendOtp: (data: { whatsapp_number: string }) =>
                apiClient.post('/admin/customers/otp/send', data),
            create: (data: {
                name: string;
                whatsapp_number: string;
                otp_code: string;
                email: string;
                password: string;
                tier?: 'regular' | 'gold' | 'platinum';
                address?: string;
            }) => apiClient.post('/admin/customers/create', data),
            quickCreate: (data: {
                name: string;
                whatsapp_number?: string;
                tier?: 'regular' | 'gold' | 'platinum';
                address?: string;
            }) => apiClient.post('/admin/customers/quick-create', data),
            updateTier: (id: string, tier: 'regular' | 'gold' | 'platinum') =>
                apiClient.patch(`/admin/customers/${id}/tier`, { tier }),
            getBalance: (id: string, params?: { limit?: number; offset?: number }) =>
                apiClient.get(`/admin/customers/${id}/balance`, { params }),
            manualPayment: (id: string, data: { amount: number; payment_account_code?: '1101' | '1102' | string; note?: string; idempotency_key?: string }) =>
                apiClient.post(`/admin/customers/${id}/balance/manual-payment`, data),
            manualRefund: (id: string, data: { amount: number; payment_account_code?: '1101' | '1102' | string; note?: string; idempotency_key?: string }) =>
                apiClient.post(`/admin/customers/${id}/balance/manual-refund`, data),
            manualAdjustment: (id: string, data: { amount_signed: number; contra_account_code: string; note: string; idempotency_key?: string }) =>
                apiClient.post(`/admin/customers/${id}/balance/manual-adjustment`, data),
        },
        shippingMethods: {
            getAll: (params?: { active_only?: boolean }) =>
                apiClient.get('/admin/shipping-methods', { params }),
            create: (data: {
                code: string;
                name: string;
                fee: number;
                is_active?: boolean;
                sort_order?: number;
            }) => apiClient.post('/admin/shipping-methods', data),
            update: (code: string, data: {
                name?: string;
                fee?: number;
                is_active?: boolean;
                sort_order?: number;
            }) => apiClient.patch(`/admin/shipping-methods/${encodeURIComponent(code)}`, data),
            remove: (code: string) => apiClient.delete(`/admin/shipping-methods/${encodeURIComponent(code)}`),
        },
        discountVouchers: {
            getAll: (params?: { active_only?: boolean; available_only?: boolean }) =>
                apiClient.get('/admin/discount-vouchers', { params }),
            create: (data: {
                code: string;
                discount_pct: number;
                max_discount_rupiah: number;
                product_id: string;
                starts_at?: string;
                expires_at?: string;
                valid_days?: number;
                usage_limit: number;
                is_active?: boolean;
            }) => apiClient.post('/admin/discount-vouchers', data),
            update: (code: string, data: {
                discount_pct?: number;
                max_discount_rupiah?: number;
                product_id?: string;
                starts_at?: string;
                expires_at?: string;
                valid_days?: number;
                usage_limit?: number;
                is_active?: boolean;
            }) => apiClient.patch(`/admin/discount-vouchers/${encodeURIComponent(code)}`, data),
            remove: (code: string) => apiClient.delete(`/admin/discount-vouchers/${encodeURIComponent(code)}`),
        },
        clearancePromos: {
            getAll: (params?: { include_inactive?: boolean }) =>
                apiClient.get('/admin/clearance-promos', { params }),
            create: (data: {
                name: string;
                product_id: string;
                target_unit_cost: number;
                qty_limit: number;
                pricing_mode: 'fixed_price' | 'percent_off';
                promo_unit_price?: number;
                discount_pct?: number;
                starts_at: string;
                ends_at: string;
                is_active?: boolean;
            }) => apiClient.post('/admin/clearance-promos', data),
            update: (id: string, data: {
                name?: string;
                product_id?: string;
                target_unit_cost?: number;
                qty_limit?: number;
                pricing_mode?: 'fixed_price' | 'percent_off';
                promo_unit_price?: number;
                discount_pct?: number;
                starts_at?: string;
                ends_at?: string;
                is_active?: boolean;
            }) => apiClient.patch(`/admin/clearance-promos/${encodeURIComponent(id)}`, data),
        },
	        orderManagement: {
            getAll: (params?: {
                page?: number;
                limit?: number;
                status?: string;
                search?: string;
                startDate?: string;
                endDate?: string;
                is_backorder?: string;
                exclude_backorder?: string;
                updatedAfter?: string;
                include_collectible_total?: string;
            }) =>
                apiClient.get<AdminOrderListResponse>('/orders/admin/list', { params }),
            getStats: () => apiClient.get('/orders/admin/stats'),
            getCouriers: () => apiClient.get('/orders/admin/couriers'),
	            updateStatus: (id: string, data: {
	                status: string;
	                reason?: string;
	                courier_id?: string;
	                issue_type?: 'shortage';
	                issue_note?: string;
	                resolution_note?: string;
	            }) => apiClient.patch(`/orders/admin/${id}/status`, data),
	            cancelItems: (id: string, data: {
	                reason: string;
	                items: Array<{ order_item_id: string; cancel_qty?: number }>;
	            }) => apiClient.post(`/orders/admin/${id}/cancel-items`, data),
			            updatePricing: (id: string, data: {
			                items: Array<{ order_item_id: string; unit_price_override: number; preferred_unit_cost?: number | null; reason?: string }>;
			                reason?: string;
			            }) => apiClient.patch(`/orders/admin/${id}/pricing`, data),
			            updateCostLayerPreference: (id: string, data: {
			                items: Array<{ order_item_id: string; preferred_unit_cost?: number | null; reason?: string }>;
			                reason?: string;
			            }) => apiClient.patch(`/orders/admin/${id}/cost-layer`, data),
	            moveToIndent: (id: string) => apiClient.post(`/orders/admin/${id}/move-to-indent`),
	        },
	        inventory: {
            getProducts: (params?: { page?: number; limit?: number; search?: string; category_id?: number; status?: 'all' | 'active' | 'inactive'; stock_filter?: 'all' | 'empty' | 'low' }) =>
                apiClient.get('/admin/products', { params }),
            getRestockSuggestions: (params?: { page?: number; limit?: number; search?: string; status?: 'active' | 'inactive' | 'all' }) =>
                apiClient.get('/admin/products/restock-suggestions', { params }),
            getProductAliases: (id: string) =>
                apiClient.get(`/admin/products/${encodeURIComponent(id)}/aliases`),
            updateProductAliases: (id: string, aliases: string[]) =>
                apiClient.put(`/admin/products/${encodeURIComponent(id)}/aliases`, { aliases }),
            getVehicleTypes: () => apiClient.get('/admin/vehicle-types'),
            createVehicleType: (data: { name: string }) => apiClient.post('/admin/vehicle-types', data),
            renameVehicleType: (data: { from: string; to: string }) => apiClient.patch('/admin/vehicle-types/rename', data),
            deleteVehicleType: (data: { name: string; replacement?: string }) =>
                apiClient.delete('/admin/vehicle-types', { data }),
            getCategories: () => apiClient.get('/admin/categories'),
            createCategory: (data: { name: string; description?: string; icon?: string }) =>
                apiClient.post('/admin/categories', data),
            updateCategory: (id: number, data: { name?: string; description?: string; icon?: string }) =>
                apiClient.put(`/admin/categories/${id}`, data),
            updateCategoryTierDiscount: (
                id: number,
                data: {
                    discount_regular_pct: number | null;
                    discount_gold_pct: number | null;
                    discount_premium_pct: number | null;
                }
            ) => apiClient.patch(`/admin/categories/${id}/tier-discount`, data),
            deleteCategory: (id: number, replacement_category_id?: number) =>
                apiClient.delete(`/admin/categories/${id}`, {
                    data: replacement_category_id ? { replacement_category_id } : undefined,
                }),
            getSuppliers: () => apiClient.get('/admin/suppliers'),
            createSupplier: (data: { name: string; contact?: string; address?: string }) =>
                apiClient.post('/admin/suppliers', data),
            updateSupplier: (id: number, data: { name?: string; contact?: string; address?: string }) =>
                apiClient.put(`/admin/suppliers/${id}`, data),
            deleteSupplier: (id: number, replacement_supplier_id?: number) =>
                apiClient.delete(`/admin/suppliers/${id}`, {
                    data: replacement_supplier_id ? { replacement_supplier_id } : undefined,
                }),
            createProduct: (data: JsonRecord) => apiClient.post('/admin/products', data),
            updateProduct: (id: string, data: JsonRecord) => apiClient.put(`/admin/products/${id}`, data),
            updateTierPricing: (
                id: string,
                data: { regular_price: number; gold_price: number; platinum_price: number }
            ) => apiClient.patch(`/admin/products/${id}/tier-pricing`, data),
            updateTierDiscountBulk: (data: { regular_discount_pct?: number; gold_discount_pct: number; premium_discount_pct: number; status?: 'active' | 'inactive' | 'all'; product_ids?: string[]; search?: string }) =>
                apiClient.patch('/admin/products/tier-pricing/bulk-discount', data),
            uploadProductImage: (formData: FormData) =>
                apiClient.post('/admin/products/upload-image', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                }),
            createMutation: (data: JsonRecord) => apiClient.post('/admin/inventory/mutation', data),
            getCostLayers: (productId: string, params?: { include_batches?: boolean; order_id?: string }) =>
                apiClient.get(`/admin/inventory/cost-layers/${productId}`, { params }),
            // Inbound Gudang (canonical)
            createInbound: (data: JsonRecord) => apiClient.post('/admin/inventory/inbound', data),
            getInbounds: (params?: { page?: number; limit?: number; status?: string; supplier_id?: number; startDate?: string; endDate?: string }) =>
                apiClient.get('/admin/inventory/inbound', { params }),
            getInboundById: (id: string) => apiClient.get(`/admin/inventory/inbound/${id}`),
            exportInboundXlsx: (id: string) =>
                apiClient.get(`/admin/inventory/inbound/${id}/export-xlsx`, { responseType: 'blob' }),
            updateInboundItemCosts: (id: string, data: { items: Array<{ product_id: string; unit_cost: number; cost_note?: string }> }) =>
                apiClient.patch(`/admin/inventory/inbound/${id}/items-cost`, data),
            verifyInboundStep1: (id: string) => apiClient.patch(`/admin/inventory/inbound/${id}/verify-1`, {}),
            verifyInboundStep2: (id: string) => apiClient.patch(`/admin/inventory/inbound/${id}/verify-2`, {}),
            receiveInbound: (id: string, data: { items: Array<{ product_id: string; received_qty: number; note?: string }> }) =>
                apiClient.patch(`/admin/inventory/inbound/${id}/receive`, data),

            // Legacy alias (Deprecated): kept for compatibility
            createPO: (data: JsonRecord) => apiClient.post('/admin/inventory/po', data),
            getPOs: (params?: { page?: number; limit?: number; status?: string; supplier_id?: number; startDate?: string; endDate?: string }) =>
                apiClient.get('/admin/inventory/po', { params }),
            getPOById: (id: string) => apiClient.get(`/admin/inventory/po/${id}`),
            exportPOXlsx: (id: string) =>
                apiClient.get(`/admin/inventory/po/${id}/export-xlsx`, { responseType: 'blob' }),
            receivePO: (id: string, data: { items: Array<{ product_id: string; received_qty: number; note?: string }> }) =>
                apiClient.patch(`/admin/inventory/po/${id}/receive`, data),
            scanBySku: (sku: string) =>
                apiClient.get('/admin/inventory/scan', {
                    params: { code: sku },
                }),
            importFile: (formData: FormData) =>
                apiClient.post('/admin/inventory/import', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                }),
            importPreview: (formData: FormData) =>
                apiClient.post('/admin/inventory/import/preview', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                }),
            importCommit: (rows: JsonRecord[]) =>
                apiClient.post('/admin/inventory/import/commit', { rows }),
            importFromPath: (filePath: string) =>
                apiClient.post('/admin/inventory/import-from-path', { file_path: filePath }),
            getMutations: (productId: string) =>
                apiClient.get(`/admin/inventory/mutation/${productId}`),
            getStockHistory: (productId: string, params?: { limit?: number }) =>
                apiClient.get(`/admin/inventory/stock-history/${productId}`, { params }),

            // Audit
            getAudits: () => apiClient.get('/inventory/audit'),
            startAudit: (data: { notes?: string }) => apiClient.post('/inventory/audit', data),
            getAuditDetail: (id: string) => apiClient.get(`/inventory/audit/${id}`),
            auditItem: (id: string, data: { product_id: string; physical_qty: number }) =>
                apiClient.post(`/inventory/audit/${id}/item`, data),
            finishAudit: (id: string) => apiClient.post(`/inventory/audit/${id}/finish`),
        },
        procurement: {
            createPreorder: (data: JsonRecord) => apiClient.post('/admin/procurement/preorders', data),
            getPreorders: (params?: { page?: number; limit?: number; status?: string; supplier_id?: number; startDate?: string; endDate?: string }) =>
                apiClient.get('/admin/procurement/preorders', { params }),
            getPreorderById: (id: string) => apiClient.get(`/admin/procurement/preorders/${id}`),
            updatePreorder: (id: string, data: JsonRecord) => apiClient.patch(`/admin/procurement/preorders/${id}`, data),
            finalizePreorder: (id: string) => apiClient.post(`/admin/procurement/preorders/${id}/finalize`, {}),
            exportPreorderXlsx: (id: string) =>
                apiClient.get(`/admin/procurement/preorders/${id}/export-xlsx`, { responseType: 'blob' }),
        },
        finance: {
            getExpenses: (params?: { page?: number; limit?: number; startDate?: string; endDate?: string; category?: string; status?: string }) =>
                apiClient.get('/admin/finance/expenses', { params }),
            createExpense: (data: {
                category: string;
                amount: number;
                date?: string;
                note?: string;
                details?: Array<{ key: string; value: string }>;
            }) =>
                apiClient.post('/admin/finance/expenses', data),
            approveExpense: (id: string) =>
                apiClient.post(`/admin/finance/expenses/${id}/approve`),
            payExpense: (id: string, account_id: string | number) =>
                apiClient.post(`/admin/finance/expenses/${id}/pay`, { account_id }),
            getExpenseLabels: () =>
                apiClient.get('/admin/finance/expense-labels'),
            createExpenseLabel: (data: { name: string; description?: string }) =>
                apiClient.post('/admin/finance/expense-labels', data),
            updateExpenseLabel: (id: number, data: { name: string; description?: string }) =>
                apiClient.put(`/admin/finance/expense-labels/${id}`, data),
            deleteExpenseLabel: (id: number) =>
                apiClient.delete(`/admin/finance/expense-labels/${id}`),
            issueInvoice: (orderId: string) =>
                apiClient.post(`/admin/finance/orders/${orderId}/issue-invoice`),
            issueInvoiceBatch: (orderIds: string[]) =>
                apiClient.post('/admin/finance/invoices/issue-batch', { order_ids: orderIds }),
            issueInvoiceByItems: (items: Array<{ order_item_id: string | number; qty: number }>) =>
                apiClient.post('/admin/finance/invoices/issue-items', { items }),
            verifyPayment: (orderId: string, action: 'approve' | 'reject', amount_received?: number) =>
                apiClient.patch(`/admin/finance/orders/${orderId}/verify`, {
                    action,
                    ...(amount_received !== undefined ? { amount_received } : {}),
                }),
            getAR: () => apiClient.get('/admin/finance/ar'),
            getARById: (invoiceId: string) => apiClient.get(`/admin/finance/ar/${invoiceId}`),
            getInvoiceCostOverrides: (invoiceId: string) =>
                apiClient.get(`/admin/finance/invoices/${invoiceId}/cost-overrides`),
            updateInvoiceCostOverrides: (
                invoiceId: string,
                data: {
                    reason: string;
                    overrides: Array<{ product_id: string; unit_cost_override: number | null }>;
                }
            ) => apiClient.put(`/admin/finance/invoices/${invoiceId}/cost-overrides`, data),
            getPnL: (params?: { startDate?: string; endDate?: string }) =>
                apiClient.get('/admin/finance/reports/pnl', { params }),
            getBalanceSheet: (params?: { asOfDate?: string }) =>
                apiClient.get('/admin/finance/reports/balance-sheet', { params }),
            getCashFlow: (params?: { startDate?: string; endDate?: string }) =>
                apiClient.get('/admin/finance/reports/cash-flow', { params }),
            getInventoryValue: () =>
                apiClient.get('/admin/finance/reports/inventory-value'),
            getAPAging: () =>
                apiClient.get('/admin/finance/reports/aging-ap'),
            getARAging: () =>
                apiClient.get('/admin/finance/reports/aging-ar'),
            getCustomerBalanceReport: (params?: { q?: string; only_negative?: boolean; only_positive?: boolean; min_abs?: number; limit?: number; offset?: number }) =>
                apiClient.get('/admin/finance/reports/customer-balance', { params }),
            getBackorderReport: (params?: { startDate?: string; endDate?: string }) =>
                apiClient.get('/admin/finance/reports/backorders', { params }),
            exportBackorderReport: (params?: { startDate?: string; endDate?: string; extract?: 'full' | 'po' }) =>
                apiClient.get('/admin/finance/reports/backorders/export', { params, responseType: 'blob' }),
            printBackorderReportThermal: (params?: { startDate?: string; endDate?: string }) =>
                apiClient.get('/admin/finance/reports/backorders/print', { params, responseType: 'blob' }),
            getStockReductionReport: (params?: {
                startDate?: string;
                endDate?: string;
                eventType?: 'all' | 'allocation' | 'goods_out';
                search?: string;
            }) => apiClient.get('/admin/finance/reports/stock-reduction', { params }),
            exportStockReductionReport: (params?: {
                startDate?: string;
                endDate?: string;
                eventType?: 'all' | 'allocation' | 'goods_out';
                search?: string;
            }) => apiClient.get('/admin/finance/reports/stock-reduction/export', {
                params,
                responseType: 'blob',
            }),
            getTaxSummary: (params: { startDate: string; endDate: string }) =>
                apiClient.get('/admin/finance/reports/tax-summary', { params }),
            getVatMonthly: (params?: { year?: number }) =>
                apiClient.get('/admin/finance/reports/vat-monthly', { params }),
            getDriverCodList: () => apiClient.get('/admin/finance/driver-cod'),
            verifyDriverCod: (data: { driver_id: string; order_ids: string[]; amount_received: number }) =>
                apiClient.post('/admin/finance/driver-cod/verify', data),
            getAuditLogs: (params?: { limit?: number; q?: string; method?: string; actor_role?: string; status_group?: 'success' | 'error' | '' }) =>
                apiClient.get('/admin/finance/audit-logs', { params }),
            getAuditLogById: (id: number | string) =>
                apiClient.get(`/admin/finance/audit-logs/${id}`),
            createCreditNote: (data: {
                invoice_id: string;
                reason?: string;
                mode?: 'receivable' | 'cash_refund';
                amount: number;
                tax_amount?: number;
                lines?: Array<{
                    product_id?: string;
                    description?: string;
                    qty?: number;
                    unit_price?: number;
                    line_subtotal?: number;
                    line_tax?: number;
                    line_total?: number;
                }>;
            }) => apiClient.post('/admin/finance/credit-notes', data),
            postCreditNote: (id: number, data?: { pay_now?: boolean; payment_account_code?: string }) =>
                apiClient.post(`/admin/finance/credit-notes/${id}/post`, data || {}),
            voidInvoice: (invoiceId: string) => apiClient.post(`/admin/finance/invoices/${invoiceId}/void`),
            getPeriods: () => apiClient.get('/admin/finance/periods'),
            closePeriod: (data: { month: number; year: number }) => apiClient.post('/admin/finance/periods/close', data),
            createAdjustmentJournal: (data: { date: string; description: string; lines: Array<{ account_id: number; debit: number; credit: number }> }) =>
                apiClient.post('/admin/finance/journals/adjustment', data),
            getJournals: (params?: { page?: number; limit?: number; startDate?: string; endDate?: string }) => apiClient.get('/admin/finance/journals', { params }),
            getTaxSettings: () => apiClient.get('/admin/finance/settings/tax'),
            updateTaxSettings: (data: { company_tax_mode: 'pkp' | 'non_pkp'; vat_percent: number; pph_final_percent: number }) =>
                apiClient.put('/admin/finance/settings/tax', data),
            getSupplierInvoices: (params?: {
                page?: number;
                limit?: number;
                status?: 'all' | 'unpaid' | 'paid' | 'overdue' | string;
                supplier_id?: number;
                q?: string;
                startDate?: string;
                endDate?: string;
                dueBefore?: string;
                dueAfter?: string;
            }) => apiClient.get('/admin/finance/supplier-invoices', { params }),
            getSupplierInvoiceById: (id: number | string) =>
                apiClient.get(`/admin/finance/supplier-invoices/${id}`),
            createSupplierInvoice: (data: {
                purchase_order_id: string;
                invoice_number: string;
                subtotal?: number;
                tax_amount?: number;
                tax_percent?: number;
                total: number;
                due_date: string;
            }) => apiClient.post('/admin/finance/supplier-invoice', data),
            paySupplierInvoice: (data: {
                invoice_id: number;
                amount: number;
                account_id: number;
                note?: string;
            }) => apiClient.post('/admin/finance/supplier-invoice/pay', data),
            getProductsSoldReport: (params: { startDate: string; endDate: string; limit?: number }) =>
                apiClient.get('/admin/finance/reports/products-sold', { params }),
            exportProductsSoldReport: (params: { startDate: string; endDate: string; limit?: number }) =>
                apiClient.get('/admin/finance/reports/products-sold/export', { params, responseType: 'blob' }),
            getTopCustomersReport: (params: { startDate: string; endDate: string; limit?: number }) =>
                apiClient.get('/admin/finance/reports/top-customers', { params }),
            exportTopCustomersReport: (params: { startDate: string; endDate: string; limit?: number }) =>
                apiClient.get('/admin/finance/reports/top-customers/export', { params, responseType: 'blob' }),
        },
        // Profile
        profile: {
            getMe: () => apiClient.get('/profile/me'),
            updateAddresses: (addresses: SavedAddressesPayload) => apiClient.patch('/profile/addresses', { saved_addresses: addresses }),
        },
        // Promos
        promos: {
            validate: (code: string) => apiClient.get(`/promos/validate/${code}`),
        },
        staff: {
            getAll: () => apiClient.get('/admin/staff'),
            getById: (id: string) => apiClient.get(`/admin/staff/${id}`),
            create: (data: {
                name: string;
                email?: string;
                whatsapp_number: string;
                role: 'admin_gudang' | 'checker_gudang' | 'admin_finance' | 'kasir' | 'driver';
                password: string;
            }) => apiClient.post('/admin/staff', data),
            update: (id: string, data: {
                name?: string;
                email?: string;
                whatsapp_number?: string;
                role?: 'admin_gudang' | 'checker_gudang' | 'admin_finance' | 'kasir' | 'driver';
                status?: 'active' | 'banned';
                password?: string;
            }) => apiClient.patch(`/admin/staff/${id}`, data),
            remove: (id: string) => apiClient.delete(`/admin/staff/${id}`),
        },
        accounts: {
            getAll: (params?: { type?: string; code?: string }) => apiClient.get('/admin/accounts', { params }),
            create: (data: JsonRecord) => apiClient.post('/admin/accounts', data),
            update: (id: number, data: JsonRecord) => apiClient.put(`/admin/accounts/${id}`, data),
            delete: (id: number) => apiClient.delete(`/admin/accounts/${id}`),
        },
    },

    // Chat
    chat: {
        getThreads: (params?: {
            scope?: 'staff_dm' | 'staff_customer' | 'support_omni' | 'wa_lead';
            q?: string;
            cursor?: string;
            limit?: number;
        }) => apiClient.get('/chat/threads', { params }),
        openThread: (data: {
            target_user_id?: string;
            mode: 'staff_dm' | 'staff_customer' | 'support';
        }) => apiClient.post('/chat/threads/open', data),
        getThreadMessages: (threadId: string, params?: { cursor?: string; limit?: number }) =>
            apiClient.get(`/chat/threads/${threadId}/messages`, { params }),
        sendThreadMessage: (threadId: string, data: {
            message?: string;
            attachment?: File | null;
            quoted_message_id?: string;
            channel?: 'app' | 'whatsapp';
        }) => {
            const formData = new FormData();
            const trimmedMessage = typeof data.message === 'string' ? data.message.trim() : '';
            if (trimmedMessage) formData.append('message', trimmedMessage);
            if (data.attachment) formData.append('attachment', data.attachment);
            if (data.quoted_message_id) formData.append('quoted_message_id', data.quoted_message_id);
            if (data.channel) formData.append('channel', data.channel);
            return apiClient.post(`/chat/threads/${threadId}/messages`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
        },
        markThreadRead: (threadId: string) => apiClient.post(`/chat/threads/${threadId}/read`),
        getThreadContacts: (params?: {
            type?: 'staff' | 'customer_contextual';
            q?: string;
            limit?: number;
        }) => apiClient.get('/chat/contacts', { params }),
        searchContacts: (q: string, limit = 20) => apiClient.get('/chat/contacts', { params: { q, limit } }),
        getSessions: (params?: { user_id?: string; platform?: 'web' | 'whatsapp' }) => apiClient.get('/chat/sessions', { params }),
        getMessages: (sessionId: string) => apiClient.get(`/chat/sessions/${sessionId}/messages`),
        replyToChat: (sessionId: string, data: { message?: string; attachment?: File | null }) => {
            const formData = new FormData();
            const trimmedMessage = typeof data.message === 'string' ? data.message.trim() : '';
            if (trimmedMessage) formData.append('message', trimmedMessage);
            if (data.attachment) formData.append('attachment', data.attachment);

            return apiClient.post(`/chat/sessions/${sessionId}/reply`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
        },
        uploadWebAttachment: (attachment: File) => {
            const formData = new FormData();
            formData.append('attachment', attachment);
            return apiClient.post('/chat/web/attachment', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
        },
        getMyWebSession: () => apiClient.get('/chat/web/session/me'),
        getMyWebSessions: () => apiClient.get('/chat/web/sessions/me'),
        getMyWebSessionByStaff: (staffId: string) => apiClient.get('/chat/web/session/by-staff', { params: { staff_id: staffId } }),
        getWebMessages: (sessionId: string, guestId?: string, userId?: string, limit = 200) =>
            apiClient.get('/chat/web/messages', {
                params: {
                    session_id: sessionId,
                    guest_id: guestId,
                    user_id: userId,
                    limit,
                },
            }),
    },

    // POS
    pos: {
        searchCustomers: (q: string) =>
            apiClient.get('/pos/customers/search', { params: { q } }),
        checkout: (data: {
            customer_name?: string;
            customer_whatsapp?: string;
            payment_method: 'cash' | 'transfer' | 'debt';
            cash_received?: number;
            items: Array<{ product_id: string; qty: number }>;
        }) => apiClient.post('/pos/checkout', data),
        startShift: (data: { initialCash: number }) =>
            apiClient.post('/pos/shift/start', { start_cash: data.initialCash }),
        endShift: (data: { endCash: number }) =>
            apiClient.post('/pos/shift/end', { end_cash: data.endCash }),
        holdOrder: (data: JsonRecord) => apiClient.post('/pos/hold', data),
        getHoldOrders: () => apiClient.get('/pos/hold'),
        resumeOrder: (id: string) => apiClient.get(`/pos/resume/${id}`),
        voidTransaction: (id: string) => apiClient.delete(`/pos/void/${id}`),
    },

    // Driver
    driver: {
        getOrders: (params?: { status?: string; startDate?: string; endDate?: string }) =>
            apiClient.get<DriverAssignedOrderRow[]>('/driver/orders', { params }),
        completeOrder: (orderId: string, formData: FormData) =>
            apiClient.post(`/driver/orders/${orderId}/complete`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            }),
        createDeliveryReturTicket: (
            orderOrInvoiceId: string,
            payload: {
                retur_type?: 'delivery_refusal' | 'delivery_damage';
                items: Array<{ product_id: string; qty: number; order_id?: string; reason?: string; evidence_img?: string }>;
            }
        ) => apiClient.post(`/driver/orders/${orderOrInvoiceId}/retur`, payload),
        submitReturHandover: (payload: { invoice_id: string; note?: string }) =>
            apiClient.post('/driver/retur/handovers', payload),
        recordPayment: (orderId: string, payload: { amount_received?: number; proof?: File | null }) => {
            const formData = new FormData();
            if (payload.amount_received !== undefined && payload.amount_received !== null) {
                formData.append('amount_received', String(payload.amount_received));
            }
            if (payload.proof) {
                formData.append('proof', payload.proof);
            }
            return apiClient.post(`/driver/orders/${orderId}/payment`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
        },
        reportIssue: (
            orderId: string,
            payload: string | { note: string; checklist_snapshot?: string; evidence?: File | null }
        ) => {
            if (typeof payload === 'string') {
                return apiClient.post(`/driver/orders/${orderId}/issue`, { note: payload });
            }

            const formData = new FormData();
            formData.append('note', payload.note);
            if (payload.checklist_snapshot) {
                formData.append('checklist_snapshot', payload.checklist_snapshot);
            }
            if (payload.evidence) {
                formData.append('evidence', payload.evidence);
            }
            return apiClient.post(`/driver/orders/${orderId}/issue`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
        },
        updatePaymentMethod: (orderId: string, payment_method: 'cod' | 'transfer_manual') =>
            apiClient.patch(`/driver/orders/${orderId}/payment-method`, { payment_method }),
        getWallet: () => apiClient.get('/driver/wallet'),
        getReturs: () => apiClient.get('/driver/retur'),
        getReturById: (returId: string) => apiClient.get(`/driver/retur/${returId}`),
        updateReturStatus: (returId: string, status: 'picked_up' | 'handed_to_warehouse') =>
            apiClient.patch(`/driver/retur/${returId}/status`, { status }),
    },

    // WhatsApp
    whatsapp: {
        getQr: () => apiClient.get('/whatsapp/qr', {
            params: { _t: Date.now() },
            headers: { 'Cache-Control': 'no-cache' },
        }),
        getStatus: () => apiClient.get('/whatsapp/status', {
            params: { _t: Date.now() },
            headers: { 'Cache-Control': 'no-cache' },
        }),
        connect: (force = false) => apiClient.post('/whatsapp/connect', { force }),
        logout: () => apiClient.post('/whatsapp/logout'),
    },
};

export default apiClient;
