'use client';

import AdminHeader from '@/components/layout/AdminHeader';

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="min-h-screen bg-slate-50 [--admin-header-height:72px]">
            <AdminHeader />
            {children}
        </div>
    );
}
