export const normalizeProductImageUrl = (value?: string | null): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/uploads/')) return raw;

  try {
    const parsed = new URL(raw);
    if (parsed.pathname.startsWith('/uploads/')) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    // Keep original value when URL parsing fails.
  }

  return raw;
};
