import axios from 'axios';

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
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Response interceptor - handle errors
apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            // Unauthorized - clear token and redirect to login
            if (typeof window !== 'undefined') {
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                localStorage.removeItem('web_chat_session_id');
                localStorage.removeItem('web_chat_guest_id');
                window.dispatchEvent(new CustomEvent('webchat:close'));
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
            items?: Array<{ product_id: string; qty: number }>;
        }) => apiClient.post('/orders/checkout', data),
        getMyOrders: (params?: { page?: number; limit?: number; status?: string }) =>
            apiClient.get('/orders/my-orders', { params }),
        getOrderById: (id: string) => apiClient.get(`/orders/${id}`),
        uploadPaymentProof: (orderId: string, formData: FormData) =>
            apiClient.post(`/orders/${orderId}/proof`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            }),
        getAllAdmin: (params?: {
            page?: number;
            limit?: number;
            status?: string;
            search?: string;
            startDate?: string;
            endDate?: string;
        }) =>
            apiClient.get('/orders/admin/list', { params }),
        getCouriers: () => apiClient.get('/orders/admin/couriers'),
        updateStatusAdmin: (id: string, data: {
            status: string;
            courier_id?: string;
            issue_type?: 'shortage';
            issue_note?: string;
        }) =>
            apiClient.patch(`/orders/admin/${id}/status`, data),
    },

    // Admin - Inventory
    admin: {
        inventory: {
            getProducts: (params?: { page?: number; limit?: number; search?: string; category_id?: number; status?: 'all' | 'active' | 'inactive' }) =>
                apiClient.get('/admin/products', { params }),
            getCategories: () => apiClient.get('/admin/categories'),
            createCategory: (data: { name: string; description?: string; icon?: string }) =>
                apiClient.post('/admin/categories', data),
            updateCategory: (id: number, data: { name?: string; description?: string; icon?: string }) =>
                apiClient.put(`/admin/categories/${id}`, data),
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
            createProduct: (data: any) => apiClient.post('/admin/products', data),
            updateProduct: (id: string, data: any) => apiClient.put(`/admin/products/${id}`, data),
            uploadProductImage: (formData: FormData) =>
                apiClient.post('/admin/products/upload-image', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                }),
            createMutation: (data: any) => apiClient.post('/admin/inventory/mutation', data),
            createPO: (data: any) => apiClient.post('/admin/inventory/po', data),
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
            importCommit: (rows: any[]) =>
                apiClient.post('/admin/inventory/import/commit', { rows }),
            importFromPath: (filePath: string) =>
                apiClient.post('/admin/inventory/import-from-path', { file_path: filePath }),
        },
        orders: {
            getAll: (params?: {
                page?: number;
                limit?: number;
                status?: string;
                search?: string;
                startDate?: string;
                endDate?: string;
            }) =>
                apiClient.get('/orders/admin/list', { params }),
            updateStatus: (id: string, data: {
                status: string;
                courier_id?: string;
                issue_type?: 'shortage';
                issue_note?: string;
            }) => apiClient.patch(`/orders/admin/${id}/status`, data),
        },
        finance: {
            getExpenses: (params?: { page?: number; limit?: number; startDate?: string; endDate?: string; category?: string }) =>
                apiClient.get('/admin/finance/expenses', { params }),
            createExpense: (data: {
                category: string;
                amount: number;
                date?: string;
                note?: string;
                details?: Array<{ key: string; value: string }>;
            }) =>
                apiClient.post('/admin/finance/expenses', data),
            getExpenseLabels: () =>
                apiClient.get('/admin/finance/expense-labels'),
            createExpenseLabel: (data: { name: string; description?: string }) =>
                apiClient.post('/admin/finance/expense-labels', data),
            updateExpenseLabel: (id: number, data: { name: string; description?: string }) =>
                apiClient.put(`/admin/finance/expense-labels/${id}`, data),
            deleteExpenseLabel: (id: number) =>
                apiClient.delete(`/admin/finance/expense-labels/${id}`),
            verifyPayment: (orderId: string, action: 'approve' | 'reject') =>
                apiClient.patch(`/admin/finance/orders/${orderId}/verify`, { action }),
            getAR: () => apiClient.get('/admin/finance/ar'),
            getARById: (invoiceId: string) => apiClient.get(`/admin/finance/ar/${invoiceId}`),
            getPnL: (params?: { startDate?: string; endDate?: string }) =>
                apiClient.get('/admin/finance/pnl', { params }),
        },
        staff: {
            getAll: () => apiClient.get('/admin/staff'),
            getById: (id: string) => apiClient.get(`/admin/staff/${id}`),
            create: (data: {
                name: string;
                email?: string;
                whatsapp_number: string;
                role: 'admin_gudang' | 'admin_finance' | 'kasir' | 'driver';
                password: string;
            }) => apiClient.post('/admin/staff', data),
            update: (id: string, data: {
                name?: string;
                email?: string;
                whatsapp_number?: string;
                role?: 'admin_gudang' | 'admin_finance' | 'kasir' | 'driver';
                status?: 'active' | 'banned';
                password?: string;
            }) => apiClient.patch(`/admin/staff/${id}`, data),
            remove: (id: string) => apiClient.delete(`/admin/staff/${id}`),
        },
    },

    // Chat
    chat: {
        getSessions: () => apiClient.get('/chat/sessions'),
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
        holdOrder: (data: any) => apiClient.post('/pos/hold', data),
        getHoldOrders: () => apiClient.get('/pos/hold'),
        resumeOrder: (id: string) => apiClient.get(`/pos/resume/${id}`),
        voidTransaction: (id: string) => apiClient.delete(`/pos/void/${id}`),
    },

    // Driver
    driver: {
        getOrders: (params?: { status?: string }) => apiClient.get('/driver/orders', { params }),
        completeOrder: (orderId: string, formData: FormData) =>
            apiClient.post(`/driver/orders/${orderId}/complete`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            }),
        getWallet: () => apiClient.get('/driver/wallet'),
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
