export const VEHICLE_TYPES_SETTING_KEY = 'vehicle_compatibility_options';

export const normalizeVehicleToken = (value: string): string => {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
};

const splitVehicleTokens = (value: string): string[] => {
    const normalized = normalizeVehicleToken(value);
    if (!normalized) return [];
    return normalized
        .split(/[\n,;|]+/g)
        .map((token) => normalizeVehicleToken(token))
        .filter(Boolean);
};

export const dedupeCaseInsensitive = (tokens: string[]): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const token of tokens) {
        const normalized = normalizeVehicleToken(token);
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(normalized);
    }
    return result;
};

export const parseVehicleCompatibilityInput = (input: unknown): string[] => {
    if (input === null || input === undefined) return [];

    if (Array.isArray(input)) {
        const asStrings = input.map((item) => normalizeVehicleToken(String(item ?? ''))).filter(Boolean);
        return dedupeCaseInsensitive(asStrings);
    }

    if (typeof input === 'string') {
        const trimmed = input.trim();
        if (!trimmed) return [];

        if (trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) {
                    const asStrings = parsed.map((item) => normalizeVehicleToken(String(item ?? ''))).filter(Boolean);
                    return dedupeCaseInsensitive(asStrings);
                }
            } catch {
                // fallthrough to split tokens
            }
        }

        return dedupeCaseInsensitive(splitVehicleTokens(trimmed));
    }

    if (typeof input === 'object') {
        // Legacy callers might send { values: [...] } etc.
        const maybeValues = (input as any).values ?? (input as any).items ?? (input as any).vehicle_compatibility;
        if (Array.isArray(maybeValues)) return parseVehicleCompatibilityInput(maybeValues);
    }

    return [];
};

export const parseVehicleCompatibilityDbString = (value: unknown): string[] => {
    if (typeof value !== 'string') return [];
    return parseVehicleCompatibilityInput(value);
};

export const buildCanonicalVehicleMap = (options: string[]): Map<string, string> => {
    const map = new Map<string, string>();
    for (const raw of options) {
        const normalized = normalizeVehicleToken(raw);
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (!map.has(key)) map.set(key, normalized);
    }
    return map;
};

export const canonicalizeVehicleList = (
    tokens: string[],
    canonicalMap: Map<string, string>
): { canonical: string[]; unknown: string[] } => {
    const canonical: string[] = [];
    const unknown: string[] = [];
    const seen = new Set<string>();

    for (const token of tokens) {
        const normalized = normalizeVehicleToken(token);
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const canonicalToken = canonicalMap.get(key);
        if (canonicalToken) {
            canonical.push(canonicalToken);
        } else {
            unknown.push(normalized);
        }
    }

    return { canonical, unknown };
};

export const toVehicleCompatibilityDbValue = (canonical: string[]): string | null => {
    const deduped = dedupeCaseInsensitive(canonical);
    if (deduped.length === 0) return null;
    return JSON.stringify(deduped);
};

