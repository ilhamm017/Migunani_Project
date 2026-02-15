'use client';

import Link from 'next/link';
import { MessageCircle, ArrowLeft } from 'lucide-react';

export default function RegisterPage() {
    const whatsappNumber = '6281234567890'; // Replace with actual superadmin number from env if available
    const message = encodeURIComponent('Halo Admin, saya ingin mendaftar akun baru untuk aplikasi Migunani Motor.');

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="bg-white max-w-md w-full rounded-3xl p-8 shadow-sm text-center border border-slate-100">
                <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <MessageCircle size={32} />
                </div>

                <h1 className="text-2xl font-black text-slate-900 mb-2">Pendaftaran Akun</h1>
                <p className="text-slate-600 mb-8">
                    Untuk menjaga keamanan dan validitas data, pendaftaran akun baru wajib melalui verifikasi Admin via WhatsApp.
                </p>

                <a
                    href={`https://wa.me/${whatsappNumber}?text=${message}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-emerald-100"
                >
                    Hubungi Admin via WhatsApp
                </a>

                <div className="mt-8 pt-6 border-t border-slate-100">
                    <Link href="/auth/login" className="text-slate-500 hover:text-slate-800 text-sm font-bold inline-flex items-center gap-2">
                        <ArrowLeft size={16} />
                        Kembali ke Login
                    </Link>
                </div>
            </div>
        </div>
    );
}
