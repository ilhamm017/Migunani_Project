'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Boxes, ClipboardCheck, FileSpreadsheet, Layers, ScanBarcode, Shield, Truck, ShoppingCart } from 'lucide-react';

import { ArrowLeft } from 'lucide-react';

export default function WarehouseLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen flex flex-col bg-slate-50">
            {/* Simple Header for Admin Gudang */}
            <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-4 shadow-sm">
                <Link
                    href="/admin"
                    className="flex items-center justify-center w-10 h-10 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-900 hover:text-white transition-all"
                >
                    <ArrowLeft size={20} />
                </Link>
                <div>
                    <h1 className="text-xl font-black text-slate-900 leading-none">Admin Gudang</h1>
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-1">Inventori & Produk</p>
                </div>
            </header>

            <main className="flex-1 overflow-auto">
                {children}
            </main>
        </div>
    );
}
