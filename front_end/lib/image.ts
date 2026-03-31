export const normalizeProductImageUrl = (value?: string | null): string => {
  const rawInput = String(value ?? '').trim();
  if (!rawInput) return '';
  if (rawInput === 'null' || rawInput === 'undefined') return '';
  const raw = rawInput.replace(/\\/g, '/');
  if (!raw) return '';
  if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
  if (raw.startsWith('/')) return raw;
  if (raw.startsWith('uploads/')) return `/${raw}`;

  try {
    const parsed = new URL(raw);
    if (parsed.pathname.startsWith('/uploads/')) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return raw;
  } catch {
    // non-absolute path -> ensure it becomes a valid URL for next/image
  }

  return `/${raw.replace(/^\/+/, '')}`;
};
