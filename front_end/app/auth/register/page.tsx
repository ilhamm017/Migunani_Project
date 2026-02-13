'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE_URL, api } from '@/lib/api';
import { Eye, EyeOff } from 'lucide-react';

export default function RegisterPage() {
    const router = useRouter();

    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: '',
        password: '',
        confirmPassword: '',
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (formData.password !== formData.confirmPassword) {
            setError('Password tidak cocok');
            return;
        }

        setLoading(true);

        try {
            await api.auth.register({
                name: formData.name,
                email: formData.email,
                phone: formData.phone,
                password: formData.password,
            });

            router.push('/auth/login?registered=true');
        } catch (err: any) {
            if (!err?.response) {
                setError(`Gagal terhubung ke server. Cek backend dan proxy API (${API_BASE_URL}).`);
            } else {
                setError(err.response?.data?.message || `Registrasi gagal (HTTP ${err.response?.status}).`);
            }
            console.error('Register error:', err?.response?.status, err?.response?.data || err?.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
            <div className="w-full max-w-md">
                {/* Brand Header */}
                <div className="text-center mb-10">
                    <h1 className="text-2xl font-black tracking-tight italic text-emerald-600">MIGUNANI MOTOR</h1>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Suku cadang terpercaya</p>
                </div>

                {/* Register Card */}
                <div className="bg-white rounded-[40px] shadow-2xl p-8 space-y-6">
                    <div className="text-center">
                        <h2 className="text-xl font-black text-slate-900">Daftar Akun</h2>
                        <p className="text-[11px] text-slate-400 mt-1">Buat akun untuk mulai berbelanja</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {error && (
                            <div className="p-3 bg-rose-50 text-rose-500 rounded-2xl text-[11px] font-bold text-center">
                                {error}
                            </div>
                        )}

                        <div className="space-y-2">
                            <label htmlFor="name" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Nama Lengkap
                            </label>
                            <input
                                id="name"
                                type="text"
                                required
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="w-full bg-slate-50 border-none rounded-2xl py-3.5 px-4 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none transition-all shadow-inner"
                                placeholder="John Doe"
                            />
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="email" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Email
                            </label>
                            <input
                                id="email"
                                type="email"
                                required
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                className="w-full bg-slate-50 border-none rounded-2xl py-3.5 px-4 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none transition-all shadow-inner"
                                placeholder="nama@email.com"
                            />
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="phone" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Nomor WhatsApp
                            </label>
                            <input
                                id="phone"
                                type="tel"
                                required
                                value={formData.phone}
                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                className="w-full bg-slate-50 border-none rounded-2xl py-3.5 px-4 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none transition-all shadow-inner"
                                placeholder="6281234567890"
                            />
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="password" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Password
                            </label>
                            <div className="relative">
                                <input
                                    id="password"
                                    type={showPassword ? 'text' : 'password'}
                                    required
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                    className="w-full bg-slate-50 border-none rounded-2xl py-3.5 px-4 pr-12 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none transition-all shadow-inner"
                                    placeholder="••••••••"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400"
                                >
                                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="confirmPassword" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Konfirmasi Password
                            </label>
                            <input
                                id="confirmPassword"
                                type="password"
                                required
                                value={formData.confirmPassword}
                                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                                className="w-full bg-slate-50 border-none rounded-2xl py-3.5 px-4 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none transition-all shadow-inner"
                                placeholder="••••••••"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-4 bg-emerald-600 text-white font-black rounded-2xl text-xs uppercase shadow-lg shadow-emerald-200 active:scale-95 transition-all disabled:opacity-50"
                        >
                            {loading ? 'Memproses...' : 'Daftar'}
                        </button>

                        <div className="text-center text-[11px] text-slate-400">
                            Sudah punya akun?{' '}
                            <Link href="/auth/login" className="text-emerald-600 font-bold">
                                Login di sini
                            </Link>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
