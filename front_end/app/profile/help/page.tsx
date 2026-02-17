'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft, HelpCircle, MessageSquare, Mail, Phone } from 'lucide-react';

export default function HelpPage() {
    const router = useRouter();

    const helpItems = [
        { icon: MessageSquare, label: 'Chat WhatsApp', desc: 'Respon cepat via WhatsApp CS', color: 'text-emerald-500' },
        { icon: Mail, label: 'Email Support', desc: 'support@migunani.id', color: 'text-blue-500' },
        { icon: Phone, label: 'Pusat Panggilan', desc: '021-1234-5678', color: 'text-slate-500' },
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
                <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">Bantuan</h3>
            </div>

            <div className="space-y-6">
                <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm text-center space-y-4">
                    <div className="w-20 h-20 rounded-3xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto ring-8 ring-emerald-50/50">
                        <HelpCircle size={40} />
                    </div>
                    <div>
                        <h4 className="text-xl font-black text-slate-900">Butuh Bantuan?</h4>
                        <p className="text-xs text-slate-500 max-w-[200px] mx-auto leading-relaxed">Tim kami siap membantu kendala belanja atau pertanyaan Anda</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-3">
                    {helpItems.map((item, i) => {
                        const Icon = item.icon;
                        return (
                            <button key={i} className="bg-white p-5 rounded-[32px] border border-slate-100 shadow-sm flex items-center gap-4 active:scale-95 transition-all text-left">
                                <div className={`w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center ${item.color} shrink-0`}>
                                    <Icon size={22} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h5 className="text-sm font-black text-slate-900">{item.label}</h5>
                                    <p className="text-xs text-slate-400">{item.desc}</p>
                                </div>
                            </button>
                        );
                    })}
                </div>

                <div className="bg-emerald-600 p-6 rounded-[32px] text-white space-y-4">
                    <h5 className="text-sm font-black uppercase tracking-widest">FAQ Populer</h5>
                    <div className="space-y-3">
                        <details className="group">
                            <summary className="list-none text-xs font-bold flex justify-between items-center cursor-pointer">
                                Cara retur barang?
                                <span className="text-emerald-300 group-open:rotate-180 transition-transform">▾</span>
                            </summary>
                            <p className="text-[10px] text-emerald-100 mt-2 leading-relaxed">
                                Buka tab Pesanan, pilih barang yang ingin dikembalikan, lalu pilih Alasan Retur.
                            </p>
                        </details>
                        <div className="h-px bg-white/10" />
                        <details className="group">
                            <summary className="list-none text-xs font-bold flex justify-between items-center cursor-pointer">
                                Lupa password?
                                <span className="text-emerald-300 group-open:rotate-180 transition-transform">▾</span>
                            </summary>
                            <p className="text-[10px] text-emerald-100 mt-2 leading-relaxed">
                                Klik 'Lupa Password' pada halaman login dan ikuti instruksi email.
                            </p>
                        </details>
                    </div>
                </div>
            </div>
        </div>
    );
}
