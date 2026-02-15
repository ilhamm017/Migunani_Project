const INDONESIA_COUNTRY_CODE = '62';
const MIN_LOCAL_DIGITS = 9; // e.g. 08xxxxxxxx
const MAX_INTERNATIONAL_DIGITS = 15; // E.164 max length

const uniq = (values: string[]): string[] => {
    return Array.from(new Set(values.filter(Boolean)));
};

const stripWhatsappJidSuffix = (raw: string): string => {
    const cleaned = raw.trim();
    const atIndex = cleaned.indexOf('@');
    return atIndex >= 0 ? cleaned.slice(0, atIndex) : cleaned;
};

export const normalizeWhatsappNumber = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;

    const raw = stripWhatsappJidSuffix(value);
    if (!raw) return null;

    let digits = raw.replace(/[^\d]/g, '');
    if (!digits) return null;

    // Support inputs like 00628...
    while (digits.startsWith('00')) {
        digits = digits.slice(2);
    }

    if (digits.startsWith('0')) {
        digits = `${INDONESIA_COUNTRY_CODE}${digits.slice(1)}`;
    } else if (digits.startsWith('8')) {
        digits = `${INDONESIA_COUNTRY_CODE}${digits}`;
    }

    if (!digits.startsWith(INDONESIA_COUNTRY_CODE)) return null;

    const localPartLength = digits.slice(INDONESIA_COUNTRY_CODE.length).length;
    if (localPartLength < MIN_LOCAL_DIGITS) return null;
    if (digits.length > MAX_INTERNATIONAL_DIGITS) return null;

    return digits;
};

export const getWhatsappLookupCandidates = (value: unknown): string[] => {
    const normalized = normalizeWhatsappNumber(value);
    if (!normalized) return [];

    const localWithZero = `0${normalized.slice(INDONESIA_COUNTRY_CODE.length)}`;
    const withPlusPrefix = `+${normalized}`;

    return uniq([normalized, localWithZero, withPlusPrefix]);
};
