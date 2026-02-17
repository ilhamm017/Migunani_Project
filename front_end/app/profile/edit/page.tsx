'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, User, Mail, Phone, Save } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

export default function EditProfilePage() {
    const router = useRouter();
    const { user, updateUser } = useAuthStore();

    const [name, setName] = useState(user?.name || '');
    const [email, setEmail] = useState(user?.email || '');
    const [whatsapp, setWhatsapp] = useState(user?.whatsapp_number || '');

    const handleSave = () => {
        if (user) {
            updateUser({
                ...user,
                name,
                email,
                whatsapp_number: whatsapp
            });
            router.back();
        }
    };

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center gap-4">
                <button
                    onClick={() => router.back()}
                    className="w-10 h-10 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-slate-900 active:scale-95 transition-all shadow-sm"
                >
                    <ChevronLeft size={20} />
                </button>
                <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">Edit Profil</h3>
            </div>

            <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm space-y-4">
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Nama Lengkap</label>
                    <div className="relative">
                        <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full h-12 pl-12 pr-4 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold text-slate-900 focus:outline-none focus:border-emerald-500 transition-all"
                            placeholder="Nama Anda"
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Email</label>
                    <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full h-12 pl-12 pr-4 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold text-slate-900 focus:outline-none focus:border-emerald-500 transition-all"
                            placeholder="email@example.com"
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Nomor WhatsApp</label>
                    <div className="relative">
                        <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            type="tel"
                            value={whatsapp}
                            onChange={(e) => setWhatsapp(e.target.value)}
                            className="w-full h-12 pl-12 pr-4 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold text-slate-900 focus:outline-none focus:border-emerald-500 transition-all"
                            placeholder="08123456789"
                        />
                    </div>
                </div>

                <button
                    onClick={handleSave}
                    className="w-full h-14 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-emerald-200 mt-4 active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                    <Save size={18} />
                    Simpan Perubahan
                </button>
            </div>
        </div>
    );
}
