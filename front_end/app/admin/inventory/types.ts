export interface ProductRow {
    id: string;
    sku: string;
    name: string;
    barcode?: string | null;
    description?: string | null;
    image_url?: string | null;
    base_price: number;
    price: number;
    unit: string;
    stock_quantity: number;
    allocated_quantity?: number;
    min_stock: number;
    category_id: number;
    status: 'active' | 'inactive';
    keterangan?: string | null;
    tipe_modal?: string | null;
    varian_harga?: unknown | null;
    grosir?: unknown | null;
    total_modal?: number | null;
    bin_location?: string | null;
    vehicle_compatibility?: string | null;
    createdAt?: string;
    updatedAt?: string;
    Category?: { name?: string };
    Categories?: Array<{ id: number; name: string }>;
}
