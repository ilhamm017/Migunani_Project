const toNumber = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};

export const round2 = (value: unknown): number => Math.round(toNumber(value) * 100) / 100;

/**
 * Deterministically allocate a pool across invoice ids by their outstanding targets.
 *
 * - First pass: allocate up to each invoice outstanding (in request order).
 * - Second pass: if pool still remains, allocate remainder to the last invoice (overpay bucket).
 *
 * This ensures total allocated == pool (rounded to cents) as long as pool is finite.
 */
export const allocatePoolByOutstanding = (params: {
    invoiceIds: string[];
    outstandingByInvoiceId: Map<string, number>;
    pool: number;
}): Map<string, number> => {
    const invoiceIds = (params.invoiceIds || []).map((v) => String(v || '').trim()).filter(Boolean);
    const pool = Math.max(0, round2(params.pool));

    const allocations = new Map<string, number>();
    if (invoiceIds.length === 0 || pool <= 0) return allocations;

    let remaining = pool;
    for (const invId of invoiceIds) {
        if (remaining <= 0) break;
        const outstanding = Math.max(0, round2(params.outstandingByInvoiceId.get(invId) || 0));
        if (outstanding <= 0) continue;
        const pay = Math.min(outstanding, remaining);
        const paid = round2(pay);
        if (paid <= 0) continue;
        allocations.set(invId, round2((allocations.get(invId) || 0) + paid));
        remaining = round2(remaining - paid);
    }

    // Overpay bucket: assign any remainder to the last invoice id so sums stay consistent
    if (remaining > 0) {
        const last = invoiceIds[invoiceIds.length - 1]!;
        allocations.set(last, round2((allocations.get(last) || 0) + remaining));
    }

    // Drop zeros
    Array.from(allocations.entries()).forEach(([k, v]) => {
        if (round2(v) === 0) allocations.delete(k);
        else allocations.set(k, round2(v));
    });
    return allocations;
};

