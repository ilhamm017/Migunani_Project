'use client';

import { useRequireRoles } from '@/lib/guards';
import { useAuthStore } from '@/store/authStore';
import { LogOut, User as UserIcon, Phone, Shield } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function DriverProfilePage() {
    const allowed = useRequireRoles(['driver', 'super_admin', 'admin_gudang']);
    const { user, logout } = useAuthStore();
    const router = useRouter();

    if (!allowed) return null;

    const handleLogout = () => {
        logout();
        router.replace('/auth/login');
    };

    return (
        <div className="p-6 space-y-8 pb-24">
            <div className="space-y-1">
                <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em]">Akun Saya</p>
                <h1 className="text-2xl font-black text-slate-900">Profil Driver</h1>
            </div>

            <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm space-y-6">
                <div className="flex items-center gap-4 pb-6 border-b border-slate-100">
                    <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600">
                        <UserIcon size={32} />
                    </div>
                    <div>
                        <h2 className="text-lg font-black text-slate-900">{user?.name}</h2>
                        <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase rounded-lg">
                            {user?.role?.replace('_', ' ')}
                        </span>
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="flex items-center gap-4 text-slate-600">
                        <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center">
                            <Phone size={18} />
                        </div>
                        <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase">Kontak</p>
                            <p className="text-sm font-semibold">{user?.whatsapp_number || '-'}</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-4 text-slate-600">
                        <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center">
                            <Shield size={18} />
                        </div>
                        <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase">ID Pengguna</p>
                            <p className="text-sm font-semibold font-mono">{user?.id?.slice(0, 8)}...</p>
                        </div>
                    </div>
                </div>
            </div>

            <button
                onClick={handleLogout}
                className="w-full bg-rose-50 text-rose-600 border border-rose-100 rounded-2xl py-4 font-bold flex items-center justify-center gap-2 hover:bg-rose-100 transition-colors active:scale-[0.98]"
            >
                <LogOut size={20} />
                Keluar Aplikasi
            </button>

            <div className="text-center text-[10px] text-slate-400 font-medium">
                <p>Versi Aplikasi 1.0.0</p>
                <p className="mt-1">Migunani Motor © 2026</p>
            </div>
        </div>
    );
}
