export const getIsoDate = (d: Date) => d.toISOString().split('T')[0];

export const getDefaultMonthRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { startDate: getIsoDate(start), endDate: getIsoDate(end) };
};

export const toNumber = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

export const toText = (value: unknown, fallback = '-') => {
  const text = String(value ?? '').trim();
  return text ? text : fallback;
};

