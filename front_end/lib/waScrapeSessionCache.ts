'use client';

export type WaScrapeSessionSnapshot = {
  session_id: string;
  saved_at_ms: number;
  session: unknown;
  messages: unknown[];
};

export type WaScrapeLastSessionMeta = {
  session_id: string;
  saved_at_ms: number;
  created_at_ms?: number;
  group_id?: string;
  group_name?: string;
  range?: { date_from?: string; date_to?: string; timezone?: string };
};

type CacheIndexRow = { session_id: string; saved_at_ms: number };

const SNAPSHOT_PREFIX = 'wa_scrape_session_cache:snapshot:';
const INDEX_KEY = 'wa_scrape_session_cache:index';
const LAST_KEY = 'wa_scrape_session_cache:last';
const MAX_SNAPSHOTS = 6;

const memCache = new Map<string, WaScrapeSessionSnapshot>();

const snapshotKey = (sessionId: string) => `${SNAPSHOT_PREFIX}${String(sessionId || '').trim()}`;

const readJsonSafe = <T,>(key: string): T | null => {
  if (typeof window === 'undefined') return null;
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const writeJsonSafe = (key: string, value: unknown) => {
  if (typeof window === 'undefined') return;
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
};

const removeKeySafe = (key: string) => {
  if (typeof window === 'undefined') return;
  if (!key) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
};

const readIndexSafe = (): CacheIndexRow[] => {
  const parsed = readJsonSafe<unknown>(INDEX_KEY);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((row) => ({
      session_id: String((row as { session_id?: unknown })?.session_id || '').trim(),
      saved_at_ms: Number((row as { saved_at_ms?: unknown })?.saved_at_ms || 0),
    }))
    .filter((row) => row.session_id && Number.isFinite(row.saved_at_ms) && row.saved_at_ms > 0);
};

const writeIndexSafe = (rows: CacheIndexRow[]) => writeJsonSafe(INDEX_KEY, rows);

const buildLastMeta = (sessionId: string, snapshot: WaScrapeSessionSnapshot): WaScrapeLastSessionMeta => {
  const session = snapshot.session as any;
  const groupId = String(session?.group?.id || '').trim();
  const groupName = String(session?.group?.name || '').trim();
  const createdAtMs = Number(session?.created_at_ms || 0);
  const range = session?.range && typeof session.range === 'object'
    ? {
      date_from: String(session.range?.date_from || '').trim(),
      date_to: String(session.range?.date_to || '').trim(),
      timezone: String(session.range?.timezone || '').trim(),
    }
    : undefined;
  return {
    session_id: sessionId,
    saved_at_ms: snapshot.saved_at_ms,
    ...(Number.isFinite(createdAtMs) && createdAtMs > 0 ? { created_at_ms: createdAtMs } : {}),
    ...(groupId ? { group_id: groupId } : {}),
    ...(groupName ? { group_name: groupName } : {}),
    ...(range?.date_from && range?.date_to ? { range } : {}),
  };
};

export const getWaScrapeSessionSnapshot = (sessionId: string): WaScrapeSessionSnapshot | null => {
  const id = String(sessionId || '').trim();
  if (!id) return null;
  const fromMem = memCache.get(id);
  if (fromMem) return fromMem;

  const key = snapshotKey(id);
  const parsed = readJsonSafe<unknown>(key);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const savedAtMs = Number((parsed as { saved_at_ms?: unknown })?.saved_at_ms || 0);
  const session = (parsed as { session?: unknown })?.session;
  const messages = (parsed as { messages?: unknown })?.messages;
  if (!Number.isFinite(savedAtMs) || savedAtMs <= 0) return null;
  if (!Array.isArray(messages)) return null;

  const snapshot: WaScrapeSessionSnapshot = {
    session_id: id,
    saved_at_ms: savedAtMs,
    session,
    messages,
  };
  memCache.set(id, snapshot);
  return snapshot;
};

export const setWaScrapeSessionSnapshot = (sessionId: string, payload: {
  session: unknown;
  messages: unknown[];
  savedAtMs?: number;
}) => {
  const id = String(sessionId || '').trim();
  if (!id) return;
  const savedAtMs = Number(payload.savedAtMs || Date.now());
  if (!Number.isFinite(savedAtMs) || savedAtMs <= 0) return;

  const snapshot: WaScrapeSessionSnapshot = {
    session_id: id,
    saved_at_ms: savedAtMs,
    session: payload.session,
    messages: Array.isArray(payload.messages) ? payload.messages : [],
  };
  memCache.set(id, snapshot);

  const key = snapshotKey(id);
  writeJsonSafe(key, snapshot);

  const index = readIndexSafe();
  const nextIndex = [
    { session_id: id, saved_at_ms: savedAtMs },
    ...index.filter((row) => row.session_id !== id),
  ].sort((a, b) => b.saved_at_ms - a.saved_at_ms);

  const keep = nextIndex.slice(0, MAX_SNAPSHOTS);
  const drop = nextIndex.slice(MAX_SNAPSHOTS);
  writeIndexSafe(keep);
  for (const row of drop) {
    memCache.delete(row.session_id);
    removeKeySafe(snapshotKey(row.session_id));
  }

  writeJsonSafe(LAST_KEY, buildLastMeta(id, snapshot));
};

export const clearWaScrapeSessionSnapshot = (sessionId: string) => {
  const id = String(sessionId || '').trim();
  if (!id) return;
  memCache.delete(id);
  removeKeySafe(snapshotKey(id));
  const index = readIndexSafe();
  const nextIndex = index.filter((row) => row.session_id !== id);
  writeIndexSafe(nextIndex);
};

export const getWaScrapeLastSessionMeta = (): WaScrapeLastSessionMeta | null => {
  const parsed = readJsonSafe<unknown>(LAST_KEY);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const sessionId = String((parsed as { session_id?: unknown })?.session_id || '').trim();
  const savedAtMs = Number((parsed as { saved_at_ms?: unknown })?.saved_at_ms || 0);
  if (!sessionId || !Number.isFinite(savedAtMs) || savedAtMs <= 0) return null;
  const createdAtMs = Number((parsed as { created_at_ms?: unknown })?.created_at_ms || 0);
  const groupId = String((parsed as { group_id?: unknown })?.group_id || '').trim();
  const groupName = String((parsed as { group_name?: unknown })?.group_name || '').trim();
  const rangeRaw = (parsed as { range?: unknown })?.range;
  const range = rangeRaw && typeof rangeRaw === 'object' && !Array.isArray(rangeRaw)
    ? {
      date_from: String((rangeRaw as any)?.date_from || '').trim(),
      date_to: String((rangeRaw as any)?.date_to || '').trim(),
      timezone: String((rangeRaw as any)?.timezone || '').trim(),
    }
    : undefined;

  return {
    session_id: sessionId,
    saved_at_ms: savedAtMs,
    ...(Number.isFinite(createdAtMs) && createdAtMs > 0 ? { created_at_ms: createdAtMs } : {}),
    ...(groupId ? { group_id: groupId } : {}),
    ...(groupName ? { group_name: groupName } : {}),
    ...(range?.date_from && range?.date_to ? { range } : {}),
  };
};

