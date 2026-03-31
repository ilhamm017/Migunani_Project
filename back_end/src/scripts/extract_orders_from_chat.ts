import path from 'path';
import fs from 'fs';

type ChatMessage = {
  timestamp: number;
  body?: string;
  type?: string;
  hasMedia?: boolean;
};

type ExtractedOrder = {
  at: string;
  is_addon: boolean;
  items: string[];
};

type ExtractedCustomer = {
  customer_key: string;
  display_name: string;
  orders: ExtractedOrder[];
};

const normalizeKey = (input: string) =>
  String(input || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const stripPlus = (input: string) => String(input || '').trim().replace(/^\+\s*/, '');

const isMedia = (m: ChatMessage) => !!m.hasMedia || String(m.type || '').toLowerCase() === 'image';

const isNameLine = (m: ChatMessage) => {
  if (isMedia(m)) return false;
  const t = String(m.body || '').trim();
  if (!t) return false;
  if (t.includes('\n')) return false;
  const stripped = stripPlus(t);
  if (!stripped) return false;
  if (stripped.length > 60) return false;
  if (/[0-9]/.test(stripped)) return false;
  if (/[\\/:=@]/.test(stripped)) return false;
  return true;
};

const fmtJakarta = (tsSeconds: number) =>
  new Date(tsSeconds * 1000).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });

const messageToItem = (m: ChatMessage) => {
  if (isMedia(m)) {
    const cap = String(m.body || '').trim();
    return `<image>${cap ? ` ${cap}` : ''}`;
  }
  return String(m.body || '').trim();
};

const main = () => {
  const chatFile = process.argv[2];
  if (!chatFile) {
    console.error('Usage: ts-node src/scripts/extract_orders_from_chat.ts <chat_json_path>');
    process.exit(1);
  }

  const fullPath = path.resolve(process.cwd(), chatFile);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const messages = JSON.parse(raw) as ChatMessage[];

  const customers = new Map<string, ExtractedCustomer>();

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!isNameLine(m)) continue;

    const rawLine = String(m.body || '').trim();
    const isAddon = rawLine.startsWith('+');
    const displayName = stripPlus(rawLine);
    const key = normalizeKey(displayName);

    const items: string[] = [];
    let j = i - 1;

    // Collect context messages directly above the ( + )name line.
    // Stop when hitting another known customer name line, or when messages are too far apart.
    while (j >= 0) {
      const prev = messages[j];
      const prevKey = isNameLine(prev) ? normalizeKey(stripPlus(String(prev.body || ''))) : null;
      if (prevKey && customers.has(prevKey)) break;

      const delta = Number(m.timestamp || 0) - Number(prev.timestamp || 0);
      if (delta > 120) break;

      const it = messageToItem(prev);
      if (it) items.unshift(it);
      j--;
    }

    if (!customers.has(key)) {
      customers.set(key, { customer_key: key, display_name: displayName, orders: [] });
    }

    // Rule: a "+Name" line means "additional items for that customer".
    // We still record it as an order entry, but under the same customer key.
    customers.get(key)!.orders.push({ at: fmtJakarta(m.timestamp), is_addon: isAddon, items });
  }

  const result = Array.from(customers.values()).sort((a, b) => a.display_name.localeCompare(b.display_name));
  console.log(JSON.stringify({ chat_file: fullPath, timezone: 'Asia/Jakarta', customers: result }, null, 2));
};

main();

