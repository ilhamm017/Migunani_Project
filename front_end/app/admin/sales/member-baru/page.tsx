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
  const [address, setAddress] = useState('');
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  // handleSendOtp is disabled

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
    /* 
    if (!/^\d{6}$/.test(otp.trim())) {
      setError('Kode OTP harus 6 digit.');
      return;
    }
    */

    try {
      setCreatingCustomer(true);
      setError('');
      setActionMessage('');
      await api.admin.customers.create({
        name: name.trim(),
        whatsapp_number: whatsapp.trim(),
        otp_code: '000000', // Dummy OTP since security is disabled
        email: email.trim(),
        password: password.trim(),
        tier,
        address: address.trim(),
      });

      setActionMessage('Member baru berhasil didaftarkan.');
      setName('');
      setWhatsapp('');
      setEmail('');
      setPassword('');
      setTier('regular');
      setAddress('');
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
          Registrasi member baru tanpa verifikasi OTP (Sementara).
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
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Alamat lengkap customer (opsional)"
            rows={3}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm md:col-span-2"
          />
        </div>

        {/* OTP section hidden */}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500">
            Pendaftaran langsung. Anggap nomor WhatsApp sudah benar.
          </p>
          <button
            type="button"
            onClick={() => void handleCreateCustomer()}
            disabled={creatingCustomer}
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
