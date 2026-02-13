'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Camera, Loader2, Pencil, Save, Upload, X } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { normalizeProductImageUrl } from '@/lib/image';

interface ProductRow {
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
  min_stock: number;
  category_id: number;
  status: 'active' | 'inactive';
  keterangan?: string | null;
  tipe_modal?: string | null;
  total_modal?: number | null;
  Category?: { name?: string };
  Categories?: Array<{ id: number; name: string }>;
}

interface CategoryOption {
  id: number;
  name: string;
}

interface EditFormState {
  sku: string;
  name: string;
  barcode: string;
  description: string;
  image_url: string;
  base_price: string;
  price: string;
  unit: string;
  stock_quantity: string;
  min_stock: string;
  category_id: string;
  status: 'active' | 'inactive';
  keterangan: string;
  tipe_modal: string;
  total_modal: string;
}

const toEditForm = (product: ProductRow): EditFormState => ({
  sku: product.sku || '',
  name: product.name || '',
  barcode: product.barcode || '',
  description: product.description || '',
  image_url: normalizeProductImageUrl(product.image_url),
  base_price: String(product.base_price ?? 0),
  price: String(product.price ?? 0),
  unit: product.unit || 'Pcs',
  stock_quantity: String(product.stock_quantity ?? 0),
  min_stock: String(product.min_stock ?? 0),
  category_id: String(product.category_id ?? ''),
  status: product.status || 'active',
  keterangan: product.keterangan || '',
  tipe_modal: product.tipe_modal || '',
  total_modal: product.total_modal === null || product.total_modal === undefined ? '' : String(product.total_modal),
});

const IMAGE_MAX_DIMENSION_PX = 1280;
const IMAGE_TARGET_MAX_BYTES = 700 * 1024;
const IMAGE_HARD_MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_MIN_QUALITY = 0.55;
const PRODUCTS_PER_PAGE = 50;

const fileToDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.readAsDataURL(file);
  });
};

const loadImageElement = (src: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Gagal memproses gambar.'));
    image.src = src;
  });
};

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Gagal membuat file gambar.'));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
};

const optimizeImageForUpload = async (file: File): Promise<File> => {
  if (!file.type.startsWith('image/')) {
    throw new Error('File yang dipilih bukan gambar.');
  }

  // GIF animasi dipertahankan apa adanya agar frame tidak hilang.
  if (file.type === 'image/gif') {
    if (file.size > IMAGE_HARD_MAX_BYTES) {
      throw new Error('Ukuran GIF terlalu besar (maksimal 2MB).');
    }
    return file;
  }

  const dataUrl = await fileToDataUrl(file);
  const image = await loadImageElement(dataUrl);
  const ratio = Math.min(1, IMAGE_MAX_DIMENSION_PX / Math.max(image.width, image.height));
  const targetWidth = Math.max(1, Math.round(image.width * ratio));
  const targetHeight = Math.max(1, Math.round(image.height * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Tidak dapat memproses gambar.');
  }

  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  let quality = 0.85;
  let blob = await canvasToBlob(canvas, 'image/jpeg', quality);
  while (blob.size > IMAGE_TARGET_MAX_BYTES && quality > IMAGE_MIN_QUALITY) {
    quality -= 0.1;
    blob = await canvasToBlob(canvas, 'image/jpeg', quality);
  }

  if (blob.size > IMAGE_HARD_MAX_BYTES) {
    throw new Error('Ukuran gambar masih terlalu besar setelah kompresi. Gunakan gambar yang lebih kecil.');
  }

  const optimizedName = file.name.replace(/\.[^.]+$/, '') || `img-${Date.now()}`;
  return new File([blob], `${optimizedName}.jpg`, { type: 'image/jpeg' });
};

export default function InventoryAdminPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang']);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [hasSearchedProduct, setHasSearchedProduct] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalProducts, setTotalProducts] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  const [selectedProduct, setSelectedProduct] = useState<ProductRow | null>(null);
  const [form, setForm] = useState<EditFormState | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  const categoryOptions = useMemo(() => {
    return categories.map((category) => ({ id: category.id, name: category.name }));
  }, [categories]);

  const loadProducts = async () => {
    try {
      setLoading(true);
      const params: { page: number; limit: number; status: 'all'; search?: string; category_id?: number } = {
        page: currentPage,
        limit: PRODUCTS_PER_PAGE,
        status: 'all',
      };
      if (search.trim()) {
        params.search = search.trim();
      }
      if (selectedCategory !== 'all') {
        params.category_id = Number(selectedCategory);
      }

      const res = await api.admin.inventory.getProducts(params);
      setProducts(res.data?.products || []);
      setTotalProducts(Number(res.data?.total || 0));
      const nextTotalPages = Math.max(1, Number(res.data?.totalPages || 1));
      setTotalPages(nextTotalPages);
      if (currentPage > nextTotalPages) {
        setCurrentPage(nextTotalPages);
      }
      setHasSearchedProduct(true);
    } catch (error) {
      setMessageType('error');
      const err = error as any;
      setMessage(err?.response?.data?.message || 'Gagal memuat daftar produk.');
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const res = await api.admin.inventory.getCategories();
      setCategories(res.data?.categories || []);
    } catch (error) {
      setMessageType('error');
      const err = error as any;
      setMessage(err?.response?.data?.message || 'Gagal memuat kategori.');
    }
  };

  useEffect(() => {
    if (allowed) {
      void loadCategories();
    }
  }, [allowed]);

  useEffect(() => {
    if (!allowed) return;
    const timer = setTimeout(() => {
      void loadProducts();
    }, 250);
    return () => clearTimeout(timer);
  }, [allowed, search, selectedCategory, currentPage]);

  useEffect(() => {
    return () => {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((track) => track.stop());
        cameraStreamRef.current = null;
      }
    };
  }, []);

  if (!allowed) return null;

  const stopCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }
    setIsCameraOpen(false);
  };

  const openEditor = (product: ProductRow) => {
    stopCamera();
    setCameraError('');
    setSelectedProduct(product);
    setForm(toEditForm(product));
    setMessage('');
  };

  const closeEditor = () => {
    if (isSaving || isUploadingImage) return;
    stopCamera();
    setCameraError('');
    setSelectedProduct(null);
    setForm(null);
  };

  const updateForm = (key: keyof EditFormState, value: string) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const pageStart = totalProducts === 0 ? 0 : (currentPage - 1) * PRODUCTS_PER_PAGE + 1;
  const pageEnd = totalProducts === 0 ? 0 : Math.min(currentPage * PRODUCTS_PER_PAGE, totalProducts);

  const visiblePages = (() => {
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, currentPage + 2);
    const pages: number[] = [];
    for (let page = start; page <= end; page += 1) {
      pages.push(page);
    }
    return pages;
  })();

  const uploadImageFile = async (file: File) => {
    if (!file) return;

    setIsUploadingImage(true);
    setCameraError('');
    try {
      const optimizedImage = await optimizeImageForUpload(file);
      const formData = new FormData();
      formData.append('image', optimizedImage);
      const res = await api.admin.inventory.uploadProductImage(formData);
      const imageUrl = normalizeProductImageUrl(String(res.data?.image_url || '').trim());
      if (!imageUrl) {
        throw new Error('URL gambar dari server kosong.');
      }
      updateForm('image_url', imageUrl);
      setMessageType('success');
      setMessage('Gambar berhasil diunggah ke server.');
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || error?.message || 'Gagal mengunggah gambar produk.');
    } finally {
      setIsUploadingImage(false);
    }
  };

  const onSelectLocalImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await uploadImageFile(file);
    event.target.value = '';
  };

  const startCamera = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('Browser tidak mendukung akses kamera.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        await cameraVideoRef.current.play();
      }
      setIsCameraOpen(true);
      setCameraError('');
    } catch {
      setCameraError('Tidak bisa mengakses kamera. Pastikan izin kamera diberikan.');
      stopCamera();
    }
  };

  const captureFromCamera = async () => {
    if (!cameraVideoRef.current || !cameraStreamRef.current) {
      setCameraError('Kamera belum aktif.');
      return;
    }

    const width = cameraVideoRef.current.videoWidth || 1280;
    const height = cameraVideoRef.current.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      setCameraError('Tidak bisa memproses gambar kamera.');
      return;
    }

    context.drawImage(cameraVideoRef.current, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), 'image/jpeg', 0.9);
    });

    if (!blob) {
      setCameraError('Gagal mengambil gambar dari kamera.');
      return;
    }

    const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
    await uploadImageFile(file);
    stopCamera();
  };

  const onSaveProduct = async () => {
    if (!selectedProduct || !form) return;
    if (isUploadingImage) {
      setMessageType('error');
      setMessage('Tunggu proses upload gambar selesai terlebih dahulu.');
      return;
    }

    const basePrice = Number(form.base_price);
    const price = Number(form.price);
    const stockQuantity = Number(form.stock_quantity);
    const minStock = Number(form.min_stock);
    const categoryId = Number(form.category_id);
    const totalModal = form.total_modal.trim() === '' ? null : Number(form.total_modal);

    if (!form.sku.trim() || !form.name.trim()) {
      setMessageType('error');
      setMessage('SKU dan Nama produk wajib diisi.');
      return;
    }
    if (!Number.isFinite(basePrice) || !Number.isFinite(price)) {
      setMessageType('error');
      setMessage('Harga beli dan harga jual harus berupa angka.');
      return;
    }
    if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
      setMessageType('error');
      setMessage('Stok harus bilangan bulat dan tidak boleh negatif.');
      return;
    }
    if (!Number.isInteger(minStock) || minStock < 0) {
      setMessageType('error');
      setMessage('Minimum stok harus bilangan bulat dan tidak boleh negatif.');
      return;
    }
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      setMessageType('error');
      setMessage('Kategori produk wajib dipilih.');
      return;
    }
    if (totalModal !== null && !Number.isFinite(totalModal)) {
      setMessageType('error');
      setMessage('Total modal harus berupa angka.');
      return;
    }

    setIsSaving(true);
    setMessage('');
    try {
      await api.admin.inventory.updateProduct(selectedProduct.id, {
        sku: form.sku.trim(),
        name: form.name.trim(),
        barcode: form.barcode.trim() || null,
        description: form.description.trim() || null,
        image_url: form.image_url.trim() || null,
        base_price: basePrice,
        price,
        unit: form.unit.trim() || 'Pcs',
        min_stock: minStock,
        category_id: categoryId,
        status: form.status,
        keterangan: form.keterangan.trim() || null,
        tipe_modal: form.tipe_modal.trim() || null,
        total_modal: totalModal,
      });

      const delta = stockQuantity - Number(selectedProduct.stock_quantity || 0);
      if (delta !== 0) {
        await api.admin.inventory.createMutation({
          product_id: selectedProduct.id,
          type: delta > 0 ? 'in' : 'out',
          qty: Math.abs(delta),
          note: 'Penyesuaian stok dari halaman admin gudang',
          reference_id: `MANUAL-EDIT-${selectedProduct.id}`,
        });
      }

      await loadProducts();
      setMessageType('success');
      setMessage('Produk berhasil diperbarui.');
      closeEditor();
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Gagal menyimpan perubahan produk.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm">
        <h1 className="text-xl font-black text-slate-900">Admin Gudang</h1>
        <p className="text-sm text-slate-600 mt-1">Kelola data produk, stok, harga, gambar, dan informasi inventori.</p>
      </div>

      {message && (
        <div className={`rounded-2xl border p-3 text-sm ${messageType === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Link href="/admin/inventory" className="bg-slate-900 border border-slate-900 rounded-2xl p-4 text-sm font-bold text-white">Daftar Produk</Link>
        <Link href="/admin/inventory/categories" className="bg-white border border-slate-200 rounded-2xl p-4 text-sm font-bold text-slate-800">Manajemen Kategori</Link>
        <Link href="/admin/inventory/suppliers" className="bg-white border border-slate-200 rounded-2xl p-4 text-sm font-bold text-slate-800">Manajemen Supplier</Link>
        <Link href="/admin/inventory/import" className="bg-white border border-slate-200 rounded-2xl p-4 text-sm font-bold text-slate-800">Import Excel/CSV</Link>
        <Link href="/admin/inventory/scanner" className="bg-white border border-slate-200 rounded-2xl p-4 text-sm font-bold text-slate-800">Scanner SKU</Link>
        <Link href="/admin/inventory/purchase-order" className="bg-white border border-slate-200 rounded-2xl p-4 text-sm font-bold text-slate-800">Purchase Order</Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <h2 className="text-sm font-black text-slate-900">Daftar Produk ({totalProducts})</h2>
          <div className="w-full md:w-auto grid grid-cols-1 md:grid-cols-[200px_320px] gap-2">
            <select
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
            >
              <option value="all">Semua Kategori</option>
              {categoryOptions.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Cari nama, SKU, barcode..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
            />
          </div>
        </div>

        {loading ? <p className="text-sm text-slate-500">Memuat...</p> : (
          <div className="space-y-2 max-h-[520px] overflow-auto pr-1">
            {products.length === 0 ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-500">
                {hasSearchedProduct ? 'Produk tidak ditemukan.' : 'Belum ada hasil pencarian.'}
              </div>
            ) : products.map((product) => {
              const categoryLabel = product.Categories && product.Categories.length > 0
                ? product.Categories.map((item) => item.name).join(', ')
                : (product.Category?.name || '-');
              return (
                <div key={product.id} className="bg-slate-50 border border-slate-200 rounded-xl p-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_120px_auto] md:items-center gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{product.name}</p>
                  <p className="text-xs text-slate-500 truncate">
                    SKU: {product.sku || '-'} • {categoryLabel} • Harga: Rp {Number(product.price || 0).toLocaleString('id-ID')}
                  </p>
                </div>
                <div className="md:text-right">
                  <p className="text-xs font-bold text-slate-700">Stok: {product.stock_quantity ?? 0}</p>
                  <p className={`text-[11px] font-bold ${product.status === 'active' ? 'text-emerald-700' : 'text-slate-500'}`}>
                    {product.status === 'active' ? 'Aktif' : 'Nonaktif'}
                  </p>
                </div>
                <div className="flex md:justify-end">
                  <button
                    onClick={() => openEditor(product)}
                    className="inline-flex w-full md:w-24 justify-center items-center gap-1 rounded-lg bg-slate-900 text-white text-xs font-bold px-3 py-2"
                  >
                    <Pencil size={12} />
                    Edit
                  </button>
                </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && totalProducts > 0 && (
          <div className="pt-2 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <p className="text-xs text-slate-500">
              Menampilkan {pageStart}-{pageEnd} dari {totalProducts} produk
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage <= 1}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 disabled:opacity-40"
              >
                Prev
              </button>
              {visiblePages.map((page) => (
                <button
                  key={page}
                  type="button"
                  onClick={() => setCurrentPage(page)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-bold ${
                    page === currentPage
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 text-slate-700'
                  }`}
                >
                  {page}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage >= totalPages}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {selectedProduct && form && (
        <div className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-sm flex items-end md:items-center justify-center p-2 md:p-6">
          <div className="w-full max-w-4xl bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h3 className="text-lg font-black text-slate-900">Edit Produk: {selectedProduct.sku}</h3>
              <button onClick={closeEditor} disabled={isSaving || isUploadingImage} className="rounded-lg bg-slate-100 p-2 text-slate-500"><X size={16} /></button>
            </div>

            <div className="p-5 max-h-[70vh] overflow-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <label className="space-y-1"><span className="text-slate-600">SKU</span><input value={form.sku} onChange={(e) => updateForm('sku', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2" /></label>
                <label className="space-y-1"><span className="text-slate-600">Nama Produk</span><input value={form.name} onChange={(e) => updateForm('name', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2" /></label>
                <label className="space-y-1"><span className="text-slate-600">Barcode</span><input value={form.barcode} onChange={(e) => updateForm('barcode', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2" /></label>
                <label className="space-y-1"><span className="text-slate-600">Unit</span><input value={form.unit} onChange={(e) => updateForm('unit', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2" /></label>
                <label className="space-y-1"><span className="text-slate-600">Harga Beli</span><input type="number" value={form.base_price} onChange={(e) => updateForm('base_price', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2" /></label>
                <label className="space-y-1"><span className="text-slate-600">Harga Jual</span><input type="number" value={form.price} onChange={(e) => updateForm('price', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2" /></label>
                <label className="space-y-1"><span className="text-slate-600">Stok (akan disesuaikan via mutasi)</span><input type="number" value={form.stock_quantity} onChange={(e) => updateForm('stock_quantity', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2" /></label>
                <label className="space-y-1"><span className="text-slate-600">Min Stock</span><input type="number" value={form.min_stock} onChange={(e) => updateForm('min_stock', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2" /></label>
                <label className="space-y-1">
                  <span className="text-slate-600">Kategori</span>
                  <select value={form.category_id} onChange={(e) => updateForm('category_id', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 bg-white">
                    <option value="">Pilih kategori</option>
                    {categoryOptions.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.id} - {cat.name}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-slate-600">Status</span>
                  <select value={form.status} onChange={(e) => updateForm('status', e.target.value as 'active' | 'inactive')} className="w-full border border-slate-200 rounded-lg px-3 py-2 bg-white">
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </select>
                </label>
                <div className="space-y-2 md:col-span-2 border border-slate-200 rounded-xl p-3">
                  <p className="text-slate-700 font-semibold">Gambar Produk</p>
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 cursor-pointer">
                      {isUploadingImage ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                      Upload Gambar
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                        className="hidden"
                        onChange={onSelectLocalImage}
                        disabled={isUploadingImage}
                      />
                    </label>
                    {!isCameraOpen ? (
                      <button
                        type="button"
                        onClick={startCamera}
                        disabled={isUploadingImage}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                      >
                        <Camera size={14} />
                        Gunakan Kamera
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={stopCamera}
                        disabled={isUploadingImage}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                      >
                        <X size={14} />
                        Tutup Kamera
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500">Format: JPG/PNG/WEBP/GIF, otomatis dikompres. Batas final maksimal 2MB.</p>
                  {cameraError && (
                    <p className="text-xs text-rose-600">{cameraError}</p>
                  )}
                  {isCameraOpen && (
                    <div className="space-y-2 rounded-lg border border-slate-200 p-2 bg-slate-50">
                      <video
                        ref={cameraVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full max-h-64 rounded-lg bg-black object-cover"
                      />
                      <button
                        type="button"
                        onClick={captureFromCamera}
                        disabled={isUploadingImage}
                        className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white"
                      >
                        {isUploadingImage ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                        Ambil Foto
                      </button>
                    </div>
                  )}
                  <label className="space-y-1 block">
                    <span className="text-slate-600">URL Gambar</span>
                    <input value={form.image_url} onChange={(e) => updateForm('image_url', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2" />
                  </label>
                  {form.image_url && (
                    <div className="rounded-lg border border-slate-200 p-2 bg-white">
                      <img src={form.image_url} alt={form.name || 'Preview gambar produk'} className="h-32 w-32 rounded-lg object-cover bg-slate-100" />
                    </div>
                  )}
                </div>
                <label className="space-y-1 md:col-span-2"><span className="text-slate-600">Deskripsi</span><textarea value={form.description} onChange={(e) => updateForm('description', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 h-20" /></label>
                <label className="space-y-1 md:col-span-2"><span className="text-slate-600">Keterangan</span><textarea value={form.keterangan} onChange={(e) => updateForm('keterangan', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 h-20" /></label>
                <label className="space-y-1"><span className="text-slate-600">Tipe Modal</span><input value={form.tipe_modal} onChange={(e) => updateForm('tipe_modal', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2" /></label>
                <label className="space-y-1"><span className="text-slate-600">Total Modal</span><input type="number" value={form.total_modal} onChange={(e) => updateForm('total_modal', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2" /></label>
              </div>
            </div>

            <div className="border-t border-slate-200 p-5 flex justify-end gap-2">
              <button onClick={closeEditor} disabled={isSaving || isUploadingImage} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-bold">Batal</button>
              <button onClick={onSaveProduct} disabled={isSaving || isUploadingImage} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold inline-flex items-center gap-2">
                <Save size={14} />
                {isSaving ? 'Menyimpan...' : (isUploadingImage ? 'Mengunggah Gambar...' : 'Simpan Perubahan')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
