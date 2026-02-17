'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

interface PaymentCountdownProps {
    expiryDate: string | Date;
    onExpire?: () => void;
    className?: string;
}

export default function PaymentCountdown({ expiryDate, onExpire, className = '' }: PaymentCountdownProps) {
    const [timeLeft, setTimeLeft] = useState<{ h: number; m: number; s: number } | null>(null);

    useEffect(() => {
        const calculate = () => {
            const now = new Date().getTime();
            const expiry = new Date(expiryDate).getTime();
            const diff = expiry - now;

            if (diff <= 0) {
                setTimeLeft(null);
                if (onExpire) onExpire();
                return;
            }

            const h = Math.floor(diff / (1000 * 60 * 60));
            const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const s = Math.floor((diff % (1000 * 60)) / 1000);

            setTimeLeft({ h, m, s });
        };

        calculate();
        const timer = setInterval(calculate, 1000);
        return () => clearInterval(timer);
    }, [expiryDate, onExpire]);

    if (!timeLeft) {
        return (
            <div className={`flex items-center gap-1.5 text-rose-600 font-black uppercase text-[10px] ${className}`}>
                <Clock size={12} />
                <span>WAKTU HABIS</span>
            </div>
        );
    }

    const isUrgent = timeLeft.h < 1;

    return (
        <div className={`flex items-center gap-2 ${className}`}>
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg ${isUrgent ? 'bg-rose-50 text-rose-600 border border-rose-100' : 'bg-amber-50 text-amber-700 border border-amber-100'}`}>
                <Clock size={12} className={isUrgent ? 'animate-pulse' : ''} />
                <span className="text-[10px] font-black uppercase tracking-wider font-mono">
                    {String(timeLeft.h).padStart(2, '0')}:{String(timeLeft.m).padStart(2, '0')}:{String(timeLeft.s).padStart(2, '0')}
                </span>
            </div>
        </div>
    );
}
