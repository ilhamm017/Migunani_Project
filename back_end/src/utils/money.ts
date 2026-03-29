export const parseMoneyInput = (value: unknown): number | null => {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value !== 'string') return null;

    let raw = value.trim();
    if (!raw) return null;

    // Remove currency labels/spaces, keep digits and common separators.
    raw = raw
        .replace(/\s+/g, '')
        .replace(/^rp/i, '')
        .replace(/[^\d,.\-]/g, '');

    if (!raw || raw === '-' || raw === ',' || raw === '.') return null;

    const isNegative = raw.startsWith('-');
    if (isNegative) raw = raw.slice(1);

    const lastComma = raw.lastIndexOf(',');
    const lastDot = raw.lastIndexOf('.');

    const hasComma = lastComma >= 0;
    const hasDot = lastDot >= 0;

    let decimalSep: ',' | '.' | null = null;
    let thousandsSep: ',' | '.' | null = null;

    const digitsAfter = (sepIndex: number) => {
        if (sepIndex < 0) return 0;
        const after = raw.slice(sepIndex + 1);
        if (!after) return 0;
        const digitsOnly = after.replace(/\D/g, '');
        // Accept 1..2 decimals for currency inputs; other lengths are likely thousand separators.
        return digitsOnly.length;
    };

    if (hasComma && hasDot) {
        // Whichever separator appears last is assumed decimal separator.
        decimalSep = lastComma > lastDot ? ',' : '.';
        thousandsSep = decimalSep === ',' ? '.' : ',';
    } else if (hasComma) {
        const d = digitsAfter(lastComma);
        decimalSep = d >= 1 && d <= 2 ? ',' : null;
        thousandsSep = decimalSep ? '.' : ',';
    } else if (hasDot) {
        const d = digitsAfter(lastDot);
        decimalSep = d >= 1 && d <= 2 ? '.' : null;
        thousandsSep = decimalSep ? ',' : '.';
    }

    const stripThousands = (text: string) => {
        if (!thousandsSep) return text;
        const re = thousandsSep === '.' ? /\./g : /,/g;
        return text.replace(re, '');
    };

    let normalized = raw;
    normalized = stripThousands(normalized);

    if (decimalSep) {
        const idx = normalized.lastIndexOf(decimalSep);
        const intPart = idx >= 0 ? normalized.slice(0, idx) : normalized;
        const fracPart = idx >= 0 ? normalized.slice(idx + 1) : '';
        const intDigits = intPart.replace(/\D/g, '');
        const fracDigits = fracPart.replace(/\D/g, '');
        normalized = intDigits + (fracDigits ? `.${fracDigits}` : '');
    } else {
        normalized = normalized.replace(/[^\d]/g, '');
    }

    if (!normalized) return null;
    const n = Number(normalized);
    if (!Number.isFinite(n)) return null;
    return isNegative ? -n : n;
};

export const parseMoneyInputOrZero = (value: unknown): number => {
    const parsed = parseMoneyInput(value);
    return parsed === null ? 0 : parsed;
};

