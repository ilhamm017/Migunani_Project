'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CreditCard, Truck } from 'lucide-react';
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

  const shippingFee = useMemo(() => {
    if (shippingMethod === 'same_day') return 25000;
    if (shippingMethod === 'pickup') return 0;
    return 12000;
  }, [shippingMethod]);

  const grandTotal = totalPrice + shippingFee;

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
        items: payloadItems,
      });

      clearCart();
      const orderId = res.data?.order_id;
      if (orderId) {
        router.push(`/orders/${orderId}`);
      } else {
        router.push('/orders');
      }
    } catch (error) {
      console.error('Checkout failed:', error);
      alert('Checkout gagal. Pastikan produk valid dan stok tersedia.');
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
            <label className="text-sm font-bold text-slate-900">Alamat Pengiriman</label>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={3}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-3 text-sm"
              placeholder="Masukkan alamat lengkap"
            />
          </div>
        )}

        <div className="space-y-3">
          <h2 className="text-sm font-bold text-slate-900">Metode Pembayaran</h2>
          <div className="grid grid-cols-1 gap-2">
            <label className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3">
              <div className="flex items-center gap-2 text-slate-800">
                <CreditCard size={16} />
                <span className="text-sm font-medium">Transfer Manual</span>
              </div>
              <input type="radio" checked={paymentMethod === 'transfer_manual'} onChange={() => setPaymentMethod('transfer_manual')} />
            </label>
            <label className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3">
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
            className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-3 text-sm"
            placeholder="Contoh: tolong hubungi dulu sebelum kirim"
          />
        </div>

        <div className="bg-slate-900 rounded-3xl p-5 text-white space-y-2">
          <div className="flex justify-between text-sm"><span>Subtotal</span><span>{formatCurrency(totalPrice)}</span></div>
          <div className="flex justify-between text-sm"><span>Ongkir</span><span>{formatCurrency(shippingFee)}</span></div>
          <div className="border-t border-white/20 my-2"></div>
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
