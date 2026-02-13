'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { roleOptions, StaffRole } from '../staffShared';

export default function StaffCreatePage() {
  const allowed = useRequireRoles(['super_admin']);
  const router = useRouter();

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    email: '',
    whatsapp_number: '',
    role: 'driver' as StaffRole,
    password: '',
  });

  if (!allowed) return null;

  const handleCreate = async () => {
    if (!form.name.trim() || !form.whatsapp_number.trim() || !form.password.trim()) {
      setError('Nama, nomor WhatsApp, dan password wajib diisi.');
      return;
    }

    try {
      setCreating(true);
      setError('');
      const res = await api.admin.staff.create({
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        whatsapp_number: form.whatsapp_number.trim(),
        role: form.role,
        password: form.password,
      });

      const createdId = String(res.data?.staff?.id || '');
      if (createdId) {
        router.push(`/admin/staff/${createdId}`);
        return;
      }
      router.push('/admin/staff/daftar');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Gagal menambahkan staff');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Link href="/admin/staff" className="inline-flex items-center gap-2 text-xs font-bold text-slate-600">
          <ArrowLeft size={14} />
          Kembali ke Modul Staff
        </Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm">
        <h1 className="text-xl font-black text-slate-900">Tambah Staff</h1>
        <p className="text-sm text-slate-600 mt-1">Data staff disimpan ke database dan dipakai oleh modul tracking order.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3">
        <input
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          placeholder="Nama staff"
          value={form.name}
          onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
          disabled={creating}
        />
        <input
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          placeholder="Email (opsional)"
          value={form.email}
          onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
          disabled={creating}
        />
        <input
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          placeholder="Nomor WhatsApp"
          value={form.whatsapp_number}
          onChange={(e) => setForm((prev) => ({ ...prev, whatsapp_number: e.target.value }))}
          disabled={creating}
        />
        <select
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          value={form.role}
          onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value as StaffRole }))}
          disabled={creating}
        >
          {roleOptions.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </select>
        <input
          type="password"
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          placeholder="Password (min 6)"
          value={form.password}
          onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
          disabled={creating}
        />

        {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl p-3">{error}</div>}

        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Save size={14} />
            {creating ? 'Menyimpan...' : 'Simpan Staff'}
          </button>
          <Link
            href="/admin/staff/daftar"
            className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold inline-flex items-center justify-center"
          >
            Lihat Daftar Staff
          </Link>
        </div>
      </div>
    </div>
  );
}
