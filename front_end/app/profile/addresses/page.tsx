'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft, MapPin, Plus, Home, Briefcase } from 'lucide-react';

export default function AddressesPage() {
    const router = useRouter();

    const addresses = [
        { id: 1, label: 'Rumah', address: 'Jl. Merdeka No. 123, Jakarta Pusat', isPrimary: true, icon: Home },
        { id: 2, label: 'Kantor', address: 'Gedung Rahmat, Lantai 5, Jakarta Selatan', isPrimary: false, icon: Briefcase },
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
                <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">Alamat Saya</h3>
            </div>

            <div className="space-y-3">
                {addresses.map((addr) => {
                    const Icon = addr.icon;
                    return (
                        <div key={addr.id} className="bg-white p-5 rounded-[32px] border border-slate-100 shadow-sm flex gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400 shrink-0">
                                <Icon size={20} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <h4 className="text-sm font-black text-slate-900">{addr.label}</h4>
                                    {addr.isPrimary && (
                                        <span className="px-2 py-0.5 bg-emerald-100 text-[8px] font-black text-emerald-700 uppercase tracking-tighter rounded-full">Utama</span>
                                    )}
                                </div>
                                <p className="text-xs text-slate-500 mt-1 line-clamp-2">{addr.address}</p>
                            </div>
                        </div>
                    );
                })}

                <button className="w-full py-4 border-2 border-dashed border-slate-200 rounded-[32px] text-slate-400 font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 transition-all">
                    <Plus size={16} />
                    Tambah Alamat Baru
                </button>
            </div>
        </div>
    );
}
