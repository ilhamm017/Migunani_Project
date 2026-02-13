'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { formatDateTime, roleLabelMap, roleOptions, StaffRecord, StaffRole, StaffStatus } from '../staffShared';

export default function StaffDetailPage() {
  const allowed = useRequireRoles(['super_admin']);
  const params = useParams();
  const router = useRouter();
  const staffId = useMemo(() => {
    const raw = params?.id;
    if (Array.isArray(raw)) return String(raw[0] || '');
    return String(raw || '');
  }, [params?.id]);

  const [staff, setStaff] = useState<StaffRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    email: '',
    whatsapp_number: '',
    role: 'driver' as StaffRole,
    password: '',
  });

  const loadDetail = async () => {
    if (!staffId) return;
    try {
      setLoading(true);
      setError('');
      const res = await api.admin.staff.getById(staffId);
      const detail = (res.data?.staff || null) as StaffRecord | null;
      setStaff(detail);
      if (detail) {
        setForm({
          name: detail.name || '',
          email: detail.email || '',
          whatsapp_number: detail.whatsapp_number || '',
          role: detail.role || 'driver',
          password: '',
        });
      }
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Gagal memuat detail staff');
      setStaff(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (allowed && staffId) {
      loadDetail();
    }
  }, [allowed, staffId]);

  const handleSave = async () => {
    if (!staffId) return;
    if (!form.name.trim() || !form.whatsapp_number.trim()) {
      setError('Nama dan nomor WhatsApp wajib diisi.');
      return;
    }
    try {
      setSaving(true);
      setError('');
      await api.admin.staff.update(staffId, {
        name: form.name.trim(),
        email: form.email.trim(),
        whatsapp_number: form.whatsapp_number.trim(),
        role: form.role,
        password: form.password.trim() || undefined,
      });
      await loadDetail();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Gagal menyimpan perubahan');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!staff) return;
    const nextStatus: StaffStatus = staff.status === 'active' ? 'banned' : 'active';
    try {
      setSaving(true);
      setError('');
      await api.admin.staff.update(staff.id, { status: nextStatus });
      await loadDetail();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Gagal update status');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!staff) return;
    try {
      setSaving(true);
      setError('');
      await api.admin.staff.remove(staff.id);
      router.push('/admin/staff/daftar');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Gagal menonaktifkan staff');
    } finally {
      setSaving(false);
    }
  };

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Link href="/admin/staff/daftar" className="inline-flex items-center gap-2 text-xs font-bold text-slate-600">
          <ArrowLeft size={14} />
          Kembali ke Daftar Staff
        </Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm">
        <h1 className="text-xl font-black text-slate-900">Detail Staff</h1>
        <p className="text-sm text-slate-600 mt-1">Halaman ini dipakai untuk metadata dan edit data staff terpilih.</p>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl p-3">{error}</div>}

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 text-sm text-slate-500">Memuat detail staff...</div>
      ) : !staff ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 text-sm text-slate-500">Data staff tidak ditemukan.</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <div className="xl:col-span-4 bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
            <p className="text-xs text-slate-500">ID Staff</p>
            <p className="text-sm font-bold text-slate-900 break-all">{staff.id}</p>

            <p className="text-xs text-slate-500 pt-2">Role Saat Ini</p>
            <p className="text-sm font-semibold text-slate-900">{roleLabelMap[staff.role]}</p>

            <p className="text-xs text-slate-500 pt-2">Status</p>
            <p className={`text-sm font-bold ${staff.status === 'active' ? 'text-emerald-700' : 'text-rose-700'}`}>
              {staff.status === 'active' ? 'Aktif' : 'Nonaktif'}
            </p>

            <p className="text-xs text-slate-500 pt-2">Dibuat</p>
            <p className="text-sm text-slate-900">{formatDateTime(staff.createdAt)}</p>

            <p className="text-xs text-slate-500 pt-2">Diupdate</p>
            <p className="text-sm text-slate-900">{formatDateTime(staff.updatedAt)}</p>
          </div>

          <div className="xl:col-span-8 bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                placeholder="Nama staff"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                disabled={saving}
              />
              <input
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                placeholder="Email (opsional)"
                value={form.email}
                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                disabled={saving}
              />
              <input
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                placeholder="Nomor WhatsApp"
                value={form.whatsapp_number}
                onChange={(e) => setForm((prev) => ({ ...prev, whatsapp_number: e.target.value }))}
                disabled={saving}
              />
              <select
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                value={form.role}
                onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value as StaffRole }))}
                disabled={saving}
              >
                {roleOptions.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </div>

            <input
              type="password"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
              placeholder="Password baru (opsional)"
              value={form.password}
              onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
              disabled={saving}
            />

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Save size={14} />
                {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
              </button>
              <button
                onClick={handleToggleStatus}
                disabled={saving}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold disabled:opacity-50"
              >
                {staff.status === 'active' ? 'Set Nonaktif' : 'Set Aktif'}
              </button>
              <button
                onClick={loadDetail}
                disabled={saving || loading}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <RefreshCw size={14} />
                Refresh
              </button>
              <button
                onClick={handleDeactivate}
                disabled={saving}
                className="px-4 py-2 rounded-xl bg-rose-50 text-rose-700 text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Trash2 size={14} />
                Nonaktifkan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
