// Date input (`YYYY-MM-DD`) should reflect the user's local calendar date,
// not UTC. Using `toISOString()` can shift the date in positive timezones.
export const getIsoDate = (d: Date) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

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
