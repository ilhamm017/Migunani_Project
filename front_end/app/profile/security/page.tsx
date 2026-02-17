'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft, Shield, Lock, Smartphone, Fingerprint } from 'lucide-react';

export default function SecurityPage() {
    const router = useRouter();

    const securityItems = [
        { icon: Lock, label: 'Ubah Password', desc: 'Terakhir diubah 3 bulan lalu' },
        { icon: Smartphone, label: 'Autentikasi Dua Faktor', desc: 'Amankan akun dengan verifikasi tambahan' },
        { icon: Fingerprint, label: 'Biometrik', desc: 'Masuk lebih cepat dengan sidik jari/wajah' },
    ];

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center gap-4">
                <button
                    onClick={() => router.back()}
                    className="w-10 h-10 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-slate-900 active:scale-95 transition-all shadow-sm"
                >
                    <ChevronLeft size={20} />
                </button>
                <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">Keamanan</h3>
            </div>

            <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm space-y-6">
                <div className="flex flex-col items-center text-center space-y-3 py-4">
                    <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                        <Shield size={32} />
                    </div>
                    <div>
                        <h4 className="text-lg font-black text-slate-900">Keamanan Akun</h4>
                        <p className="text-xs text-slate-500">Kelola keamanan dan akses akun Anda</p>
                    </div>
                </div>

                <div className="space-y-4">
                    {securityItems.map((item, i) => {
                        const Icon = item.icon;
                        return (
                            <button key={i} className="w-full flex items-center gap-4 text-left active:scale-95 transition-all">
                                <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 shrink-0">
                                    <Icon size={18} />
                                </div>
                                <div className="flex-1 min-w-0 border-b border-slate-50 pb-4">
                                    <h5 className="text-xs font-bold text-slate-900">{item.label}</h5>
                                    <p className="text-[10px] text-slate-400">{item.desc}</p>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
