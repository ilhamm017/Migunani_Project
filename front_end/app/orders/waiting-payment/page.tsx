'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function WaitingPaymentPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace('/orders');
    }, [router]);

    return (
        <div className="p-6">
            <p className="text-sm text-slate-500">Mengalihkan ke riwayat pesanan...</p>
        </div>
    );
}
