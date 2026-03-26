const UUID_V4ISH = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const normalizeNullableUuid = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    const raw = typeof value === 'string' ? value : String(value);
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const lowered = trimmed.toLowerCase();
    if (['null', 'undefined', 'none', '-'].includes(lowered)) return null;
    return UUID_V4ISH.test(trimmed) ? trimmed : null;
};

export const isUuidLike = (value: unknown): boolean => Boolean(normalizeNullableUuid(value));

