import { Suspense } from 'react';
import CreditNoteClient from './CreditNoteClient';

export default function CreditNotePage() {
    return (
        <Suspense fallback={<div className="p-6 text-sm text-slate-500">Memuat credit note...</div>}>
            <CreditNoteClient />
        </Suspense>
    );
}
