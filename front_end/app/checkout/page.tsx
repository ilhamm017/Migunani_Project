'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CreditCard, Tag, Truck } from 'lucide-react';
import { useCartStore } from '@/store/cartStore';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

export default function CheckoutPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { items, totalPrice, clearCart } = useCartStore();

  const [shippingMethod, setShippingMethod] = useState('kurir_reguler');
  const [paymentMethod, setPaymentMethod] = useState<'transfer_manual' | 'cod'>('transfer_manual');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const [userProfile, setUserProfile] = useState<any>(null);
  const [promoCode, setPromoCode] = useState('');
  const [promoData, setPromoData] = useState<any>(null);
  const [promoError, setPromoError] = useState('');
  const [validatingPromo, setValidatingPromo] = useState(false);

  const shippingFee = useMemo(() => {
    if (shippingMethod === 'same_day') return 25000;
    if (shippingMethod === 'pickup') return 0;
    return 12000;
  }, [shippingMethod]);

  const promoDiscount = useMemo(() => {
    if (!promoData) return 0;
    const itemsTotal = totalPrice;
    const discount = Math.min(
      Math.round(itemsTotal * (promoData.discount_pct / 100)),
      promoData.max_discount_rupiah || Infinity
    );
    return discount;
  }, [promoData, totalPrice]);

  const grandTotal = Math.max(0, totalPrice + shippingFee - promoDiscount);

  useEffect(() => {
    if (isAuthenticated) {
      api.profile.getMe().then((res) => {
        const user = res.data?.user;
        setUserProfile(user);
        const addresses = user?.CustomerProfile?.saved_addresses;
        if (Array.isArray(addresses) && addresses.length > 0 && !address) {
          setAddress(addresses[0]);
        }
      }).catch(console.error);
    }
  }, [isAuthenticated]);

  const handleValidatePromo = async () => {
    if (!promoCode.trim()) return;
    try {
      setValidatingPromo(true);
      setPromoError('');
      const res = await api.promos.validate(promoCode);
      setPromoData(res.data?.promo);
      alert('Kode promo berhasil diterapkan!');
    } catch (error: any) {
      setPromoData(null);
      setPromoError(error?.response?.data?.message || 'Kode promo tidak valid');
    } finally {
      setValidatingPromo(false);
    }
  };

  const handleCheckout = async () => {
    if (!isAuthenticated) {
      router.push('/auth/login');
      return;
    }

    if (!address && shippingMethod !== 'pickup') {
      alert('Alamat pengiriman wajib diisi.');
      return;
    }

    if (items.length === 0) {
      alert('Keranjang masih kosong.');
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
        payment_method: paymentMethod,
        shipping_method_code: shippingMethod,
        items: payloadItems,
        promo_code: promoData?.code || undefined,
      });

      clearCart();
      const orderId = res.data?.order_id;
      alert('Pesanan berhasil dibuat! Mohon tunggu konfirmasi admin.');
      if (orderId) {
        router.push(`/orders/${orderId}`);
      } else {
        router.push('/orders');
      }
    } catch (error: any) {
      console.error('Checkout failed:', error);
      const backendMessage = error?.response?.data?.message;
      alert(backendMessage || 'Checkout gagal. Pastikan produk valid dan stok tersedia.');
    } finally {
      setLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-sm text-slate-600">Silakan login untuk melanjutkan checkout.</p>
        <Link href="/auth/login" className="text-sm font-bold text-emerald-700">Login</Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
        <ArrowLeft size={16} /> Kembali
      </button>

      <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm space-y-5">
        <h1 className="text-xl font-black text-slate-900">Checkout</h1>

        <div className="space-y-3">
          <h2 className="text-sm font-bold text-slate-900">Metode Pengiriman</h2>
          <div className="grid grid-cols-1 gap-2">
            {[
              { id: 'kurir_reguler', label: 'Kurir Reguler', fee: 12000 },
              { id: 'same_day', label: 'Same Day', fee: 25000 },
              { id: 'pickup', label: 'Ambil di Toko', fee: 0 },
            ].map((m) => (
              <label key={m.id} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3">
                <span className="text-sm font-medium text-slate-800">{m.label}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-slate-600">{m.fee === 0 ? 'Gratis' : formatCurrency(m.fee)}</span>
                  <input type="radio" name="shipping" checked={shippingMethod === m.id} onChange={() => setShippingMethod(m.id)} />
                </div>
              </label>
            ))}
          </div>
        </div>

        {shippingMethod !== 'pickup' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-bold text-slate-900">Alamat Pengiriman</label>
              {userProfile?.CustomerProfile?.saved_addresses?.length > 0 && (
                <div className="flex gap-1 overflow-x-auto pb-1 max-w-[200px] scrollbar-hide">
                  {userProfile.CustomerProfile.saved_addresses.map((addr: string, idx: number) => (
                    <button
                      key={idx}
                      onClick={() => setAddress(addr)}
                      className={`whitespace-nowrap px-2 py-1 rounded-full text-[10px] font-bold border transition-all ${address === addr
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                        }`}
                    >
                      Alamat {idx + 1}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={3}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-3 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
              placeholder="Masukkan alamat lengkap"
            />
          </div>
        )}

        <div className="space-y-3">
          <h2 className="text-sm font-bold text-slate-900">Metode Pembayaran</h2>
          <div className="grid grid-cols-1 gap-2">
            <label className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 cursor-pointer">
              <div className="flex items-center gap-2 text-slate-800">
                <CreditCard size={16} />
                <span className="text-sm font-medium">Transfer Manual</span>
              </div>
              <input type="radio" checked={paymentMethod === 'transfer_manual'} onChange={() => setPaymentMethod('transfer_manual')} />
            </label>
            <label className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 cursor-pointer">
              <div className="flex items-center gap-2 text-slate-800">
                <Truck size={16} />
                <span className="text-sm font-medium">COD (Bayar di Tempat)</span>
              </div>
              <input type="radio" checked={paymentMethod === 'cod'} onChange={() => setPaymentMethod('cod')} />
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-900">Catatan (Opsional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-3 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
            placeholder="Contoh: tolong hubungi dulu sebelum kirim"
          />
        </div>

        {/* Promo Code Section */}
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
                onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                className={`w-full bg-slate-50 border rounded-2xl p-3 text-sm uppercase font-bold tracking-wider placeholder:normal-case placeholder:font-normal transition-all ${promoError ? 'border-red-300 bg-red-50 text-red-900' : 'border-slate-200 focus:border-emerald-500'
                  }`}
                placeholder="Masukkan kode promo"
              />
              {promoData && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 bg-emerald-500 text-white rounded-full p-1">
                  <Tag size={12} />
                </div>
              )}
            </div>
            <button
              onClick={handleValidatePromo}
              disabled={validatingPromo || !promoCode.trim()}
              className="px-6 bg-slate-900 text-white rounded-2xl text-xs font-black uppercase disabled:opacity-50"
            >
              Cek
            </button>
          </div>
          {promoError && <p className="text-[10px] font-bold text-red-600 pl-1">{promoError}</p>}
          {promoData && (
            <p className="text-[10px] font-bold text-emerald-600 pl-1">
              Tersimpan: Diskon {promoData.discount_pct}% (Maks {formatCurrency(promoData.max_discount_rupiah)})
            </p>
          )}
        </div>

        <div className="bg-slate-900 rounded-3xl p-5 text-white space-y-2 shadow-xl shadow-slate-200">
          <div className="flex justify-between text-sm opacity-80"><span>Subtotal</span><span>{formatCurrency(totalPrice)}</span></div>
          <div className="flex justify-between text-sm opacity-80"><span>Ongkir</span><span>{formatCurrency(shippingFee)}</span></div>
          {promoDiscount > 0 && (
            <div className="flex justify-between text-sm text-emerald-400 font-bold">
              <span>Diskon Promo</span>
              <span>-{formatCurrency(promoDiscount)}</span>
            </div>
          )}
          <div className="border-t border-white/10 my-2"></div>
          <div className="flex justify-between text-lg font-black"><span>Total</span><span>{formatCurrency(grandTotal)}</span></div>
        </div>

        <button
          onClick={handleCheckout}
          disabled={loading || items.length === 0}
          className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black text-sm uppercase shadow-lg shadow-emerald-200 disabled:opacity-50"
        >
          {loading ? 'Memproses...' : 'Buat Pesanan'}
        </button>
      </div>
    </div>
  );
}
