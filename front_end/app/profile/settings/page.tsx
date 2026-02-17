'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft, Bell, Globe, Moon, Trash2 } from 'lucide-react';

export default function SettingsPage() {
    const router = useRouter();

    const settingItems = [
        { icon: Bell, label: 'Notifikasi', desc: 'Push notification, email, WhatsApp', color: 'text-blue-500' },
        { icon: Globe, label: 'Bahasa', desc: 'Bahasa Indonesia (Default)', color: 'text-emerald-500' },
        { icon: Moon, label: 'Mode Gelap', desc: 'Ikuti sistem perangkat', color: 'text-purple-500' },
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
                <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">Pengaturan</h3>
            </div>

            <div className="space-y-4">
                <div className="bg-white p-4 rounded-[32px] border border-slate-100 shadow-sm space-y-2">
                    {settingItems.map((item, i) => {
                        const Icon = item.icon;
                        return (
                            <button key={i} className="w-full p-4 rounded-2xl flex items-center gap-4 hover:bg-slate-50 active:scale-95 transition-all text-left">
                                <div className={`w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center ${item.color} shrink-0`}>
                                    <Icon size={18} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h5 className="text-xs font-bold text-slate-900">{item.label}</h5>
                                    <p className="text-[10px] text-slate-400">{item.desc}</p>
                                </div>
                            </button>
                        );
                    })}
                </div>

                <div className="bg-white p-4 rounded-[32px] border border-slate-100 shadow-sm">
                    <button className="w-full p-4 rounded-2xl flex items-center gap-4 hover:bg-rose-50 active:scale-95 transition-all text-left">
                        <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center text-rose-500 shrink-0">
                            <Trash2 size={18} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <h5 className="text-xs font-bold text-rose-500">Hapus Akun</h5>
                            <p className="text-[10px] text-rose-300">Hapus permanen data dan akun Anda</p>
                        </div>
                    </button>
                </div>
            </div>
        </div>
    );
}
