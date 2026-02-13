'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { getDashboardPathByRole } from '@/lib/roleRedirect';
import { Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
    const router = useRouter();
    const login = useAuthStore((state) => state.login);

    const [formData, setFormData] = useState({
        email: '',
        password: '',
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const response = await api.auth.login(formData);
            const { token, user } = response.data;

            login(token, user);
            router.replace(getDashboardPathByRole(user?.role));
        } catch (err: any) {
            setError(err.response?.data?.message || 'Login gagal. Coba lagi.');
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

                {/* Login Card */}
                <div className="bg-white rounded-[40px] shadow-2xl p-8 space-y-6">
                    <div className="text-center">
                        <h2 className="text-xl font-black text-slate-900">Masuk</h2>
                        <p className="text-[11px] text-slate-400 mt-1">Masuk ke akun Anda untuk melanjutkan</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {error && (
                            <div className="p-3 bg-rose-50 text-rose-500 rounded-2xl text-[11px] font-bold text-center">
                                {error}
                            </div>
                        )}

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

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-4 bg-emerald-600 text-white font-black rounded-2xl text-xs uppercase shadow-lg shadow-emerald-200 active:scale-95 transition-all disabled:opacity-50"
                        >
                            {loading ? 'Memproses...' : 'Masuk'}
                        </button>

                        <div className="text-center text-[11px] text-slate-400">
                            Belum punya akun?{' '}
                            <Link href="/auth/register" className="text-emerald-600 font-bold">
                                Daftar di sini
                            </Link>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
