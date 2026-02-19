'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, CheckCircle2, Package2, Tag } from 'lucide-react';
import { useCartStore } from '@/store/cartStore';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

type SavedAddressEntry = string | { label?: string; address?: string };

type UserProfilePayload = {
  CustomerProfile?: {
    saved_addresses?: SavedAddressEntry[];
  };
};

type PromoPayload = {
  code: string;
  discount_pct: number;
  max_discount_rupiah: number;
  product_id: string;
  product_name?: string | null;
  product_sku?: string | null;
};

type ShippingOption = {
  id: string;
  label: string;
  eta: string;
  fee: number;
};

const SHIPPING_OPTIONS: ShippingOption[] = [
  { id: 'kurir_reguler', label: 'Kurir Reguler', eta: 'Estimasi 2-3 hari', fee: 12000 },
  { id: 'same_day', label: 'Same Day', eta: 'Tiba di hari yang sama', fee: 25000 },
  { id: 'pickup', label: 'Ambil di Toko', eta: 'Tanpa ongkir', fee: 0 },
];

export default function CheckoutPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { items, totalPrice, totalItems, clearCart } = useCartStore();

  const [shippingMethod, setShippingMethod] = useState<string>(SHIPPING_OPTIONS[0].id);
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [checkoutError, setCheckoutError] = useState('');

  const [userProfile, setUserProfile] = useState<UserProfilePayload | null>(null);
  const [didAutofillAddress, setDidAutofillAddress] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [promoData, setPromoData] = useState<PromoPayload | null>(null);
  const [promoError, setPromoError] = useState('');
  const [validatingPromo, setValidatingPromo] = useState(false);

  const selectedShippingMethod = useMemo(
    () => SHIPPING_OPTIONS.find((option) => option.id === shippingMethod) || SHIPPING_OPTIONS[0],
    [shippingMethod]
  );

  const shippingFee = selectedShippingMethod.fee;
  const isPickup = selectedShippingMethod.id === 'pickup';

  const savedAddresses = useMemo(() => {
    const raw = userProfile?.CustomerProfile?.saved_addresses;
    if (!Array.isArray(raw)) return [];

    return raw
      .map((entry: SavedAddressEntry, index: number) => {
        const addrText = typeof entry === 'string' ? entry.trim() : String(entry?.address || '').trim();
        const labelRaw = typeof entry === 'string' ? '' : String(entry?.label || '').trim();
        if (!addrText) return null;
        return {
          key: `${index}-${addrText}`,
          label: labelRaw || `Alamat ${index + 1}`,
          address: addrText,
        };
      })
      .filter(Boolean) as Array<{ key: string; label: string; address: string }>;
  }, [userProfile]);

  const itemCount = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    [items]
  );

  const promoEligibleTotal = useMemo(() => {
    if (!promoData) return 0;
    return items.reduce((sum, item) => {
      if (item.productId !== promoData.product_id) return sum;
      return sum + (Number(item.price || 0) * Number(item.quantity || 0));
    }, 0);
  }, [items, promoData]);

  const promoDiscount = useMemo(() => {
    if (!promoData) return 0;
    if (promoEligibleTotal <= 0) return 0;
    const discount = Math.min(
      Math.round(promoEligibleTotal * (promoData.discount_pct / 100)),
      promoData.max_discount_rupiah || Infinity
    );
    return discount;
  }, [promoData, promoEligibleTotal]);

  const grandTotal = Math.max(0, totalPrice + shippingFee - promoDiscount);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;

    const loadProfile = async () => {
      try {
        const res = await api.profile.getMe();
        if (cancelled) return;
        setUserProfile(res.data?.user || null);
      } catch (error) {
        console.error('Failed to load profile for checkout:', error);
      }
    };

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (didAutofillAddress) return;
    if (savedAddresses.length === 0) return;
    setAddress((prev) => prev.trim() || savedAddresses[0].address);
    setDidAutofillAddress(true);
  }, [savedAddresses, didAutofillAddress]);

  const handleValidatePromo = async () => {
    if (!promoCode.trim()) {
      setPromoError('Masukkan kode promo terlebih dahulu.');
      return;
    }
    try {
      setValidatingPromo(true);
      setPromoError('');
      const res = await api.promos.validate(promoCode.trim());
      const promo = res.data?.promo;
      if (!promo) {
        setPromoData(null);
        setPromoError('Kode promo tidak valid.');
        return;
      }
      const normalizedProductId = String(promo.product_id || '').trim();
      const hasEligibleProduct = items.some((item) => item.productId === normalizedProductId);
      if (!normalizedProductId || !hasEligibleProduct) {
        setPromoData(null);
        setPromoError('Voucher tidak berlaku untuk produk di keranjang.');
        return;
      }
      setPromoData({
        code: String(promo.code || '').trim().toUpperCase(),
        discount_pct: Number(promo.discount_pct || 0),
        max_discount_rupiah: Number(promo.max_discount_rupiah || 0),
        product_id: normalizedProductId,
        product_name: promo.product_name || null,
        product_sku: promo.product_sku || null,
      });
    } catch (error: unknown) {
      const maybeMessage = typeof (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message === 'string'
        ? String((error as { response?: { data?: { message?: unknown } } }).response?.data?.message)
        : null;
      setPromoData(null);
      setPromoError(maybeMessage || 'Kode promo tidak valid');
    } finally {
      setValidatingPromo(false);
    }
  };

  useEffect(() => {
    if (!promoData) return;
    const hasEligibleProduct = items.some((item) => item.productId === promoData.product_id);
    if (!hasEligibleProduct) {
      setPromoData(null);
      setPromoError('Voucher tidak berlaku untuk produk di keranjang.');
    }
  }, [items, promoData]);

  const removePromo = () => {
    setPromoData(null);
    setPromoError('');
    setPromoCode('');
  };

  const maybeSaveAddressToProfile = async (rawAddress: string) => {
    const nextAddress = rawAddress.trim();
    if (!nextAddress || isPickup) return;

    const existing = Array.isArray(userProfile?.CustomerProfile?.saved_addresses)
      ? userProfile.CustomerProfile.saved_addresses
      : [];

    const normalizedNext = nextAddress.toLowerCase();
    const alreadyExists = existing.some((entry: SavedAddressEntry) => {
      const raw = typeof entry === 'string' ? entry : entry?.address;
      return String(raw || '').trim().toLowerCase() === normalizedNext;
    });
    if (alreadyExists) return;

    const nextPayload = [
      ...existing,
      {
        label: `Alamat ${existing.length + 1}`,
        address: nextAddress,
      },
    ];

    try {
      await api.profile.updateAddresses(nextPayload);
      setUserProfile((prev) => ({
        ...prev,
        CustomerProfile: {
          ...(prev?.CustomerProfile || {}),
          saved_addresses: nextPayload,
        },
      }));
    } catch (error: unknown) {
      console.error('Failed to save checkout address to profile:', error);
    }
  };

  const handleCheckout = async () => {
    if (!isAuthenticated) {
      router.push('/auth/login');
      return;
    }

    setFormError('');
    setCheckoutError('');

    if (!isPickup && !address.trim()) {
      setFormError('Alamat pengiriman wajib diisi untuk metode kirim yang dipilih.');
      return;
    }

    if (items.length === 0) {
      setFormError('Keranjang masih kosong. Tambahkan produk terlebih dahulu.');
      return;
    }

    if (notes.trim().length > 300) {
      setFormError('Catatan maksimal 300 karakter.');
      return;
    }

    try {
      setLoading(true);

      const payloadItems = items.map((item) => ({
        product_id: item.productId,
        qty: item.quantity,
      }));

      const res = await api.orders.checkout({
        from_cart: false,
        shipping_method_code: shippingMethod,
        items: payloadItems,
        promo_code: promoData?.code || undefined,
        shipping_address: isPickup ? undefined : address.trim(),
        customer_note: notes.trim() || undefined,
      });

      await maybeSaveAddressToProfile(address);
      clearCart();
      const orderId = res.data?.order_id;
      if (orderId) {
        router.push(`/orders/${orderId}`);
      } else {
        router.push('/orders');
      }
    } catch (error: unknown) {
      console.error('Checkout failed:', error);
      const backendMessage = typeof (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message === 'string'
        ? String((error as { response?: { data?: { message?: unknown } } }).response?.data?.message)
        : null;
      setCheckoutError(backendMessage || 'Checkout gagal. Pastikan produk valid dan stok tersedia.');
    } finally {
      setLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="p-6 max-w-xl mx-auto space-y-4">
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-3">
          <h1 className="text-lg font-black text-slate-900">Checkout</h1>
          <p className="text-sm text-slate-600">Silakan login untuk melanjutkan checkout.</p>
          <Link href="/auth/login" className="inline-flex items-center justify-center h-11 px-5 rounded-2xl bg-emerald-600 text-white text-xs font-black uppercase">
            Login
          </Link>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-5">
        <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
          <ArrowLeft size={16} /> Kembali
        </button>
        <div className="bg-white border border-slate-200 rounded-[32px] p-8 shadow-sm text-center space-y-4">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center">
            <Package2 size={24} />
          </div>
          <h2 className="text-lg font-black text-slate-900">Keranjang Masih Kosong</h2>
          <p className="text-sm text-slate-500">Tambahkan produk terlebih dahulu sebelum checkout.</p>
          <div className="flex gap-2 justify-center">
            <Link href="/catalog" className="inline-flex items-center justify-center h-11 px-5 rounded-2xl bg-emerald-600 text-white text-xs font-black uppercase">
              Lihat Katalog
            </Link>
            <Link href="/cart" className="inline-flex items-center justify-center h-11 px-5 rounded-2xl border border-slate-200 text-xs font-black uppercase text-slate-700">
              Buka Keranjang
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
        <ArrowLeft size={16} /> Kembali
      </button>

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr] items-start">
        <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm space-y-6">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-xl font-black text-slate-900">Checkout</h1>
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700 bg-emerald-50 border border-emerald-100 px-3 py-1 rounded-full">
              {itemCount || totalItems} Item
            </span>
          </div>

          {(formError || checkoutError) && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-xs font-semibold text-red-700 flex items-center gap-2">
                <AlertCircle size={14} />
                {formError || checkoutError}
              </p>
            </div>
          )}

          <div className="space-y-3">
            <h2 className="text-sm font-bold text-slate-900">Metode Pengiriman</h2>
            <div className="grid grid-cols-1 gap-2">
              {SHIPPING_OPTIONS.map((option) => (
                <label
                  key={option.id}
                  className={`flex items-center justify-between rounded-2xl px-4 py-3 cursor-pointer border transition-all ${
                    shippingMethod === option.id
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                  }`}
                >
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-slate-900">{option.label}</p>
                    <p className="text-[11px] text-slate-500">{option.eta}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-black text-slate-700">
                      {option.fee === 0 ? 'Gratis' : formatCurrency(option.fee)}
                    </span>
                    <input
                      type="radio"
                      name="shipping"
                      checked={shippingMethod === option.id}
                      onChange={() => setShippingMethod(option.id)}
                    />
                  </div>
                </label>
              ))}
            </div>
          </div>

          {!isPickup && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-bold text-slate-900">Alamat Pengiriman</label>
                {savedAddresses.length > 0 && (
                  <div className="flex gap-1 overflow-x-auto pb-1 max-w-[240px]">
                    {savedAddresses.map((addr) => (
                      <button
                        key={addr.key}
                        onClick={() => setAddress(addr.address)}
                        className={`whitespace-nowrap px-3 py-1 rounded-full text-[10px] font-bold border transition-all ${
                          address === addr.address
                            ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm'
                            : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                        }`}
                      >
                        {addr.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <textarea
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  if (formError) setFormError('');
                }}
                rows={3}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-3 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                placeholder="Masukkan alamat lengkap"
              />
              <p className="text-[10px] text-slate-500">
                Alamat otomatis diambil dari profil jika tersedia. Kelola di{' '}
                <Link href="/profile/addresses" className="font-bold text-emerald-700">
                  Profil &gt; Alamat Saya
                </Link>.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-900">Catatan (Opsional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={300}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-3 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
              placeholder="Contoh: tolong hubungi dulu sebelum kirim"
            />
            <p className="text-[10px] text-slate-400 text-right">{notes.length}/300</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Tag size={14} className="text-emerald-600" />
              Kode Promo
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={promoCode}
                  onChange={(e) => {
                    const next = e.target.value.toUpperCase();
                    setPromoCode(next);
                    if (promoError) setPromoError('');
                    if (promoData && next.trim() !== String(promoData.code || '').trim().toUpperCase()) {
                      setPromoData(null);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void handleValidatePromo();
                    }
                  }}
                  className={`w-full bg-slate-50 border rounded-2xl p-3 text-sm uppercase font-bold tracking-wider placeholder:normal-case placeholder:font-normal transition-all ${
                    promoError ? 'border-red-300 bg-red-50 text-red-900' : 'border-slate-200 focus:border-emerald-500'
                  }`}
                  placeholder="Masukkan kode promo"
                />
                {promoData && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 bg-emerald-500 text-white rounded-full p-1">
                    <CheckCircle2 size={12} />
                  </div>
                )}
              </div>
              <button
                onClick={() => void handleValidatePromo()}
                disabled={validatingPromo || !promoCode.trim()}
                className="px-5 bg-slate-900 text-white rounded-2xl text-xs font-black uppercase disabled:opacity-50"
              >
                {validatingPromo ? 'Cek...' : 'Cek'}
              </button>
              {promoData && (
                <button
                  onClick={removePromo}
                  className="px-4 border border-slate-200 text-slate-600 rounded-2xl text-xs font-black uppercase"
                >
                  Hapus
                </button>
              )}
            </div>
            {promoError && <p className="text-[10px] font-bold text-red-600 pl-1">{promoError}</p>}
            {promoData && (
              <p className="text-[10px] font-bold text-emerald-600 pl-1">
                Promo aktif: {promoData.code} ({promoData.discount_pct}% maks {formatCurrency(promoData.max_discount_rupiah)}) •
                <span className="text-emerald-900">
                  {promoData.product_name || 'Produk'}{promoData.product_sku ? ` (${promoData.product_sku})` : ''}
                </span>
              </p>
            )}
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20">
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-black text-slate-900">Ringkasan Item</h3>
            <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
              {items.map((item) => (
                <div key={item.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                  <p className="text-xs font-bold text-slate-900">{item.productName}</p>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                    <span>{item.quantity} x {formatCurrency(item.price)}</span>
                    <span className="font-bold text-slate-700">{formatCurrency(item.price * item.quantity)}</span>
                  </div>
                </div>
              ))}
            </div>
            <Link href="/cart" className="inline-flex text-[11px] font-bold text-emerald-700">
              Ubah isi keranjang
            </Link>
          </div>

          <div className="bg-slate-900 rounded-3xl p-5 text-white space-y-2 shadow-xl shadow-slate-200">
            <div className="flex justify-between text-sm opacity-80">
              <span>Subtotal</span>
              <span>{formatCurrency(totalPrice)}</span>
            </div>
            <div className="flex justify-between text-sm opacity-80">
              <span>Ongkir ({selectedShippingMethod.label})</span>
              <span>{shippingFee === 0 ? 'Gratis' : formatCurrency(shippingFee)}</span>
            </div>
            {promoDiscount > 0 && (
              <div className="flex justify-between text-sm text-emerald-400 font-bold">
                <span>Diskon Promo</span>
                <span>-{formatCurrency(promoDiscount)}</span>
              </div>
            )}
            <div className="border-t border-white/10 my-2" />
            <div className="flex justify-between text-lg font-black">
              <span>Total</span>
              <span>{formatCurrency(grandTotal)}</span>
            </div>
          </div>

          <button
            onClick={() => void handleCheckout()}
            disabled={loading}
            className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black text-sm uppercase shadow-lg shadow-emerald-200 disabled:opacity-50"
          >
            {loading ? 'Memproses...' : 'Buat Pesanan'}
          </button>
        </aside>
      </div>
    </div>
  );
}
