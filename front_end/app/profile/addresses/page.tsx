'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, MapPin, Plus, Home, Briefcase, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

interface Address {
    label: string;
    address: string;
    isPrimary?: boolean;
}

export default function AddressesPage() {
    const router = useRouter();
    const { isAuthenticated } = useAuthStore();
    const [addresses, setAddresses] = useState<Address[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddForm, setShowAddForm] = useState(false);
    const [newLabel, setNewLabel] = useState('');
    const [newAddress, setNewAddress] = useState('');

    useEffect(() => {
        if (!isAuthenticated) {
            router.push('/auth/login');
            return;
        }

        fetchAddresses();
    }, [isAuthenticated]);

    const fetchAddresses = async () => {
        try {
            setLoading(true);
            const res = await api.profile.getMe();
            const saved = res.data?.user?.CustomerProfile?.saved_addresses || [];
            if (Array.isArray(saved)) {
                setAddresses(saved);
            }
        } catch (error) {
            console.error('Failed to fetch addresses:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleAddAddress = async () => {
        if (!newLabel || !newAddress) return;

        const updated = [...addresses, { label: newLabel, address: newAddress }];
        try {
            await api.profile.updateAddresses(updated);
            setAddresses(updated);
            setNewLabel('');
            setNewAddress('');
            setShowAddForm(false);
        } catch (error) {
            alert('Gagal menambah alamat');
        }
    };

    const handleDeleteAddress = async (index: number) => {
        const updated = addresses.filter((_, i) => i !== index);
        try {
            await api.profile.updateAddresses(updated);
            setAddresses(updated);
        } catch (error) {
            alert('Gagal menghapus alamat');
        }
    };

    if (loading) {
        return <div className="p-6 text-center text-slate-500 font-bold">Memuat...</div>;
    }

    return (
        <div className="p-6 space-y-6 pb-24">
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
                {addresses.length === 0 && !showAddForm && (
                    <div className="text-center py-10 text-slate-400">
                        <MapPin size={48} className="mx-auto mb-2 opacity-20" />
                        <p className="text-sm font-medium">Belum ada alamat tersimpan</p>
                    </div>
                )}

                {addresses.map((addr, idx) => (
                    <div key={idx} className="bg-white p-5 rounded-[32px] border border-slate-100 shadow-sm flex gap-4 items-start">
                        <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400 shrink-0">
                            {addr.label.toLowerCase().includes('rumah') ? <Home size={20} /> : <Briefcase size={20} />}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                                <h4 className="text-sm font-black text-slate-900">{addr.label}</h4>
                                <button
                                    onClick={() => handleDeleteAddress(idx)}
                                    className="text-slate-300 hover:text-red-500 transition-colors"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                            <p className="text-xs text-slate-500 mt-1">{addr.address}</p>
                        </div>
                    </div>
                ))}

                {showAddForm ? (
                    <div className="bg-white p-6 rounded-[32px] border-2 border-emerald-500/20 shadow-xl shadow-emerald-500/5 space-y-4">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Label Alamat</label>
                            <input
                                type="text"
                                placeholder="Rumah / Kantor / Kost"
                                value={newLabel}
                                onChange={(e) => setNewLabel(e.target.value)}
                                className="w-full h-12 px-4 rounded-2xl bg-slate-50 border border-slate-100 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/5 transition-all text-sm font-bold text-slate-900"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Alamat Lengkap</label>
                            <textarea
                                placeholder="Jl. Raya No. 123..."
                                value={newAddress}
                                onChange={(e) => setNewAddress(e.target.value)}
                                rows={3}
                                className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-100 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/5 transition-all text-sm font-bold text-slate-900 resize-none"
                            />
                        </div>
                        <div className="flex gap-2 pt-2">
                            <button
                                onClick={() => setShowAddForm(false)}
                                className="flex-1 h-12 rounded-2xl bg-slate-100 text-slate-500 font-black text-xs uppercase active:scale-95 transition-all"
                            >
                                Batal
                            </button>
                            <button
                                onClick={handleAddAddress}
                                className="flex-1 h-12 rounded-2xl bg-emerald-600 text-white font-black text-xs uppercase active:scale-95 transition-all shadow-lg shadow-emerald-200"
                            >
                                Simpan
                            </button>
                        </div>
                    </div>
                ) : (
                    <button
                        onClick={() => setShowAddForm(true)}
                        className="w-full py-4 border-2 border-dashed border-slate-200 rounded-[32px] text-slate-400 font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 transition-all hover:bg-slate-50 hover:border-slate-300"
                    >
                        <Plus size={16} />
                        Tambah Alamat Baru
                    </button>
                )}
            </div>
        </div>
    );
}
