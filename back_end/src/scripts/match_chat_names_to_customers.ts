import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import User from '../models/User';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

type Match = {
  chat_name: string;
  matched_customers: Array<{ id: string; name: string }>;
};

const normalize = (input: string) =>
  String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenize = (input: string) => normalize(input).split(' ').filter(Boolean);

const isLikelyNameLine = (raw: string) => {
  const t = String(raw || '').trim();
  if (!t) return false;
  if (t.includes('\n')) return false;
  const stripped = t.replace(/^\+\s*/, '');
  if (!stripped) return false;
  if (stripped.length > 60) return false;
  if (/[0-9]/.test(stripped)) return false;
  if (/[\\/:=@]/.test(stripped)) return false;
  return true;
};

const containsTokenSequence = (haystackTokens: string[], needleTokens: string[]) => {
  if (needleTokens.length === 0) return false;
  for (let i = 0; i <= haystackTokens.length - needleTokens.length; i++) {
    let ok = true;
    for (let j = 0; j < needleTokens.length; j++) {
      if (haystackTokens[i + j] !== needleTokens[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
};

const isFuzzyMatch = (chatName: string, customerName: string) => {
  const chatTokens = tokenize(chatName);
  const customerTokens = tokenize(customerName);
  if (chatTokens.length === 0 || customerTokens.length === 0) return false;

  // Exact normalized match.
  if (normalize(chatName) === normalize(customerName)) return true;

  // Allow chatName to be a contiguous token sequence inside customerName (e.g. "said" matches "SAID MULYA MOTOR").
  if (containsTokenSequence(customerTokens, chatTokens)) return true;

  // Allow chat tokens to match as a subsequence / unordered subset (e.g. "aguzt nolelo" matches "Aguzt Bintang nolelo").
  // Guard: ignore very short tokens to reduce false positives.
  if (chatTokens.length >= 2) {
    const filtered = chatTokens.filter((t) => t.length >= 3);
    if (filtered.length >= 2) {
      const customerSet = new Set(customerTokens);
      const allPresent = filtered.every((t) => customerSet.has(t));
      if (allPresent) return true;
    }
  }

  // If chat name is 1 token, allow it to match any token in customer name (avoid super short noise).
  if (chatTokens.length === 1 && chatTokens[0].length >= 3) {
    return customerTokens.includes(chatTokens[0]);
  }

  return false;
};

const main = async () => {
  const chatFile = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : path.resolve(process.cwd(), 'testing/wa_group_messages_orderan_migunani_20260331_20260331_183114.json');

  const raw = fs.readFileSync(chatFile, 'utf8');
  const messages = JSON.parse(raw) as Array<{ body?: string }>;

  const chatNames = Array.from(
    new Set(
      messages
        .map((m) => String(m.body || ''))
        .filter(isLikelyNameLine)
        .map((s) => normalize(s.replace(/^\+\s*/, '')))
        .filter(Boolean)
    )
  );

  const customers = await User.findAll({
    where: { role: 'customer' },
    attributes: ['id', 'name'],
  });

  const customerList = customers.map((u: any) => ({ id: String(u.id), name: String(u.name || '') }));

  const matches: Match[] = [];
  const matchedCustomerIds = new Set<string>();

  for (const chatName of chatNames) {
    const matched = customerList.filter((c) => isFuzzyMatch(chatName, c.name));
    if (matched.length > 0) {
      for (const c of matched) matchedCustomerIds.add(c.id);
    }
    matches.push({ chat_name: chatName, matched_customers: matched });
  }

  const summary = {
    chat_file: chatFile,
    db_customers_total: customerList.length,
    chat_names_total: chatNames.length,
    matched_chat_names_total: matches.filter((m) => m.matched_customers.length > 0).length,
    matched_unique_customers_total: matchedCustomerIds.size,
    matches,
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
