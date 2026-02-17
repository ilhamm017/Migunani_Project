'use client';

import { Bell } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

export default function FinanceHeader({ title = 'Finance' }: { title?: string }) {
    const { user } = useAuthStore();

    return (
        <div className="flex items-center justify-between py-4">
            <div>
                <h1 className="text-sm font-bold text-emerald-600 uppercase tracking-wider mb-1">Migunani Motor <span className="text-slate-400 font-normal">Finance</span></h1>
                <h2 className="text-xl font-bold text-slate-900">{title}</h2>
            </div>
            <button className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-600 shadow-sm relative">
                <Bell size={20} />
                <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white"></span>
            </button>
        </div>
    );
}
