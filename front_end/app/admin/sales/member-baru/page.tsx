'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';

type TierType = 'regular' | 'gold' | 'platinum';

const TIER_OPTIONS: Array<{ value: TierType; label: string }> = [
  { value: 'regular', label: 'Regular' },
  { value: 'gold', label: 'Gold' },
  { value: 'platinum', label: 'Platinum' },
];

export default function SalesMemberCreatePage() {
  const allowed = useRequireRoles(['super_admin', 'kasir']);

  const [name, setName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tier, setTier] = useState<TierType>('regular');
  const [otp, setOtp] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  const handleSendOtp = async () => {
    if (!whatsapp.trim()) {
      setError('Nomor WhatsApp wajib diisi untuk kirim OTP.');
      return;
    }

    try {
      setSendingOtp(true);
      setError('');
      setActionMessage('');
      await api.admin.customers.sendOtp({ whatsapp_number: whatsapp.trim() });
      setOtpSent(true);
      setActionMessage('OTP berhasil dikirim ke WhatsApp customer.');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Gagal mengirim OTP WhatsApp');
    } finally {
      setSendingOtp(false);
    }
  };

  const handleCreateCustomer = async () => {
    if (!name.trim()) {
      setError('Nama customer wajib diisi.');
      return;
    }
    if (!whatsapp.trim()) {
      setError('Nomor WhatsApp wajib diisi.');
      return;
    }
    if (!email.trim()) {
      setError('Email wajib diisi.');
      return;
    }
    if (!password.trim()) {
      setError('Password wajib diisi.');
      return;
    }
    if (password.trim().length < 6) {
      setError('Password minimal 6 karakter.');
      return;
    }
    if (!/^\d{6}$/.test(otp.trim())) {
      setError('Kode OTP harus 6 digit.');
      return;
    }

    try {
      setCreatingCustomer(true);
      setError('');
      setActionMessage('');
      await api.admin.customers.create({
        name: name.trim(),
        whatsapp_number: whatsapp.trim(),
        otp_code: otp.trim(),
        email: email.trim(),
        password: password.trim(),
        tier,
      });

      setActionMessage('Member baru berhasil didaftarkan.');
      setName('');
      setWhatsapp('');
      setEmail('');
      setPassword('');
      setOtp('');
      setTier('regular');
      setOtpSent(false);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Gagal menambahkan customer');
    } finally {
      setCreatingCustomer(false);
    }
  };

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/admin/sales" className="inline-flex items-center gap-2 text-xs font-bold text-slate-600">
          <ArrowLeft size={14} />
          Kembali ke List Customer
        </Link>
        <Link href="/admin/chat/whatsapp" className="inline-flex items-center gap-2 text-xs font-bold text-blue-700">
          Cek Status WA Bot
        </Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-[28px] p-5 shadow-sm">
        <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em]">Registrasi Member Baru</p>
        <h1 className="text-2xl font-black text-slate-900 mt-1">Tambah Customer (OTP WhatsApp)</h1>
        <p className="text-sm text-slate-600 mt-2">
          Nomor WhatsApp customer diverifikasi lewat OTP sebelum akun customer dibuat.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nama customer"
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          <input
            value={whatsapp}
            onChange={(e) => {
              setWhatsapp(e.target.value);
              if (otpSent) {
                setOtpSent(false);
                setOtp('');
              }
            }}
            placeholder="Nomor WhatsApp (contoh: 0812xxxx)"
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email (wajib)"
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password akun customer (min. 6 karakter)"
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as TierType)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          >
            {TIER_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                Tier: {item.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
          <input
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
            placeholder="Masukkan kode OTP 6 digit dari WhatsApp customer"
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm tracking-[0.18em]"
          />
          <button
            type="button"
            onClick={() => void handleSendOtp()}
            disabled={sendingOtp || creatingCustomer}
            className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold disabled:opacity-50"
          >
            {sendingOtp ? 'Mengirim OTP...' : (otpSent ? 'Kirim Ulang OTP' : 'Kirim OTP')}
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500">
            OTP dikirim via WhatsApp bot untuk memastikan nomor benar-benar milik customer.
          </p>
          <button
            type="button"
            onClick={() => void handleCreateCustomer()}
            disabled={creatingCustomer || !otpSent}
            className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold disabled:opacity-50"
          >
            {creatingCustomer ? 'Menyimpan Customer...' : 'Tambah Customer'}
          </button>
        </div>
      </div>

      {(error || actionMessage) && (
        <div className="space-y-2">
          {error && <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700">{error}</div>}
          {actionMessage && <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-700">{actionMessage}</div>}
        </div>
      )}
    </div>
  );
}
