'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import AdminChatTabs from '@/components/chat/AdminChatTabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ArrowLeft, ArrowRight, Image as ImageIcon, RefreshCw } from 'lucide-react';
import { buildWaScrapeOrderedScopeKey, getWaScrapeOrderedMap, listWaScrapeCustomerOrders, WaScrapeOrderedMap } from '@/lib/waScrapeLocal';
import { notifyWarning } from '@/lib/notify';
import { getWaScrapeSessionSnapshot, setWaScrapeSessionSnapshot } from '@/lib/waScrapeSessionCache';

type ScrapeCustomerSummary = {
  customer_key: string;
  chat_name: string;
  match_status: 'unique' | 'ambiguous' | 'unmatched' | string;
  candidates_count: number;
  blocks_count: number;
  items_count: number;
  unresolved_qty_count: number;
  has_media: boolean;
};

type ScrapeSessionSummary = {
  session_id: string;
  created_at_ms?: number;
  group?: { id: string; name: string; participants_count: number | null };
  range?: { date_from: string; date_to: string; timezone: string };
  truncated?: boolean;
  message_limit?: number;
  messages_scanned?: number;
  customers?: ScrapeCustomerSummary[];
};

type ScrapeChatMessage = {
  message_id: string;
  timestamp: number;
  type: string;
  body: string;
  has_media: boolean;
  author: string | null;
  scrape_groups?: ScrapeMessageGrouping[];
};

type ScrapeMessageGrouping = {
  customer_key: string;
  block_id: string;
  is_addon: boolean;
  kind: 'marker' | 'item';
};

type ScrapeSessionMessagesResponse = {
  session_id: string;
  created_at_ms?: number;
  group?: { id: string; name: string; participants_count: number | null };
  range?: { date_from: string; date_to: string; timezone: string };
  truncated?: boolean;
  messages?: ScrapeChatMessage[];
};

const formatJakartaDateTime = (ms: number) => {
  const value = Number(ms || 0);
  if (!Number.isFinite(value) || value <= 0) return '';
  return new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });
};

const formatJakartaTimestamp = (unixSeconds: number) => {
  const value = Number(unixSeconds || 0);
  if (!Number.isFinite(value) || value <= 0) return '';
  return new Date(value * 1000).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });
};

const authorLabel = (author: string | null) => {
  const raw = String(author || '').trim();
  if (!raw) return '';
  return raw.includes('@') ? raw.split('@')[0] : raw;
};

const SCRAPE_COLORS = [
  { left: 'border-l-emerald-500', bg: 'bg-emerald-50/70', badge: 'bg-emerald-100 text-emerald-800' },
  { left: 'border-l-blue-500', bg: 'bg-blue-50/70', badge: 'bg-blue-100 text-blue-800' },
  { left: 'border-l-violet-500', bg: 'bg-violet-50/70', badge: 'bg-violet-100 text-violet-800' },
  { left: 'border-l-amber-500', bg: 'bg-amber-50/70', badge: 'bg-amber-100 text-amber-800' },
  { left: 'border-l-rose-500', bg: 'bg-rose-50/70', badge: 'bg-rose-100 text-rose-800' },
  { left: 'border-l-cyan-500', bg: 'bg-cyan-50/70', badge: 'bg-cyan-100 text-cyan-800' },
  { left: 'border-l-lime-500', bg: 'bg-lime-50/70', badge: 'bg-lime-100 text-lime-800' },
  { left: 'border-l-fuchsia-500', bg: 'bg-fuchsia-50/70', badge: 'bg-fuchsia-100 text-fuchsia-800' },
  { left: 'border-l-teal-500', bg: 'bg-teal-50/70', badge: 'bg-teal-100 text-teal-800' },
  { left: 'border-l-indigo-500', bg: 'bg-indigo-50/70', badge: 'bg-indigo-100 text-indigo-800' },
] as const;

const hashString = (value: string) => {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) >>> 0;
  }
  return h;
};

const colorForCustomerKey = (customerKey: string) => {
  const key = String(customerKey || '').trim();
  if (!key) return null;
  const idx = hashString(key) % SCRAPE_COLORS.length;
  return SCRAPE_COLORS[idx];
};

export default function ScrapeSessionPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir']);
  const params = useParams<{ sessionId?: string }>();
  const sessionId = String(params?.sessionId || '').trim();

  const [session, setSession] = useState<ScrapeSessionSummary | null>(null);
  const [messages, setMessages] = useState<ScrapeChatMessage[]>([]);
  const [orderedMap, setOrderedMap] = useState<WaScrapeOrderedMap>({});
  const [selectedOrderIdByCustomerKey, setSelectedOrderIdByCustomerKey] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mobileTab, setMobileTab] = useState<'scrape' | 'chat'>('scrape');
  const staleWarnedKeyRef = useRef<string>('');

  const [mediaUrlById, setMediaUrlById] = useState<Record<string, string>>({});
  const [mediaLoadingById, setMediaLoadingById] = useState<Record<string, boolean>>({});
  const mediaUrlsRef = useRef<string[]>([]);

  const orderedScopeKey = useMemo(() => {
    return buildWaScrapeOrderedScopeKey({
      groupId: session?.group?.id,
      dateFrom: session?.range?.date_from,
      dateTo: session?.range?.date_to,
      timezone: session?.range?.timezone,
      sessionIdFallback: sessionId,
    });
  }, [session?.group?.id, session?.range?.date_from, session?.range?.date_to, session?.range?.timezone, sessionId]);

  const refreshOrderedMap = useCallback(() => {
    if (!orderedScopeKey && !sessionId) return;
    setOrderedMap(getWaScrapeOrderedMap({ scopeKey: orderedScopeKey, legacySessionId: sessionId }));
  }, [orderedScopeKey, sessionId]);

  const fetchAll = async () => {
    if (!sessionId) {
      setError('SessionId tidak ditemukan.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      const [s, m] = await Promise.all([
        api.whatsapp.scrapeGetSession(sessionId),
        api.whatsapp.scrapeGetMessages(sessionId),
      ]);
      const sessionPayload = s.data as ScrapeSessionSummary;
      setSession(sessionPayload);
      const msgPayload = (m.data || {}) as ScrapeSessionMessagesResponse;
      const messageRows = Array.isArray(msgPayload.messages) ? msgPayload.messages : [];
      setMessages(messageRows);
      setWaScrapeSessionSnapshot(sessionId, { session: sessionPayload, messages: messageRows });
    } catch (e: unknown) {
      console.error(e);
      const statusCode = Number((e as { response?: { status?: unknown } })?.response?.status || 0);
      const message = typeof e === 'object' && e && 'response' in e
        ? String((e as { response?: { data?: { message?: string } } }).response?.data?.message || '')
        : '';
      if (statusCode === 404) setError('Scrape session tidak ditemukan / sudah expired.');
      else if (statusCode === 409) setError(message || 'WhatsApp belum READY.');
      else setError(message || 'Gagal memuat data scrape.');
    } finally {
      setLoading(false);
    }
  };

  const loadMedia = async (messageId: string) => {
    const id = String(messageId || '').trim();
    if (!sessionId || !id) return;
    if (mediaUrlById[id]) return;
    if (mediaLoadingById[id]) return;

    try {
      setMediaLoadingById((prev) => ({ ...prev, [id]: true }));
      const res = await api.whatsapp.scrapeGetMedia(sessionId, id);
      const blob = res.data as Blob;
      const url = URL.createObjectURL(blob);
      mediaUrlsRef.current.push(url);
      setMediaUrlById((prev) => ({ ...prev, [id]: url }));
    } catch (e) {
      console.error('Failed to load WA media:', e);
    } finally {
      setMediaLoadingById((prev) => ({ ...prev, [id]: false }));
    }
  };

  useEffect(() => {
    if (!allowed) return;
    if (!sessionId) return;
    const snapshot = getWaScrapeSessionSnapshot(sessionId);
    if (snapshot) {
      setError('');
      setSession(snapshot.session as ScrapeSessionSummary);
      setMessages(Array.isArray(snapshot.messages) ? (snapshot.messages as ScrapeChatMessage[]) : []);
      return;
    }
    void fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, sessionId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => refreshOrderedMap();
    window.addEventListener('focus', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('focus', handler);
      window.removeEventListener('storage', handler);
    };
  }, [refreshOrderedMap]);

  useEffect(() => {
    if (!allowed) return;
    refreshOrderedMap();
  }, [allowed, refreshOrderedMap]);

  useEffect(() => {
    const createdAtMs = Number(session?.created_at_ms || 0);
    const baseMs = Number.isFinite(createdAtMs) && createdAtMs > 0 ? createdAtMs : 0;
    if (!sessionId || !baseMs) return;
    const ageMs = Date.now() - baseMs;
    if (!Number.isFinite(ageMs) || ageMs <= 60 * 60 * 1000) return;
    const warnKey = `${sessionId}:${baseMs}`;
    if (staleWarnedKeyRef.current === warnKey) return;
    staleWarnedKeyRef.current = warnKey;
    notifyWarning(
      `Data scrape ini diambil pada ${formatJakartaDateTime(baseMs)} dan sudah lebih dari 1 jam. Pastikan order masih relevan atau lakukan scrape ulang.`
    );
  }, [sessionId, session?.created_at_ms]);

  useEffect(() => {
    return () => {
      for (const url of mediaUrlsRef.current) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
      mediaUrlsRef.current = [];
    };
  }, []);

  const customers = useMemo(() => {
    const rows = Array.isArray(session?.customers) ? session!.customers! : [];
    return rows;
  }, [session]);

  const customerNameByKey = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of customers) {
      const key = String(c.customer_key || '').trim();
      if (!key) continue;
      map[key] = String(c.chat_name || key);
    }
    return map;
  }, [customers]);

  const orderedCount = useMemo(() => {
    return customers.filter((c) => listWaScrapeCustomerOrders(orderedMap, c.customer_key).length > 0).length;
  }, [customers, orderedMap]);

  useEffect(() => {
    if (customers.length === 0) return;
    setSelectedOrderIdByCustomerKey((prev) => {
      const next: Record<string, string> = { ...prev };
      let changed = false;
      for (const c of customers) {
        const key = String(c.customer_key || '').trim();
        if (!key) continue;
        const orders = listWaScrapeCustomerOrders(orderedMap, key);
        if (orders.length === 0) continue;
        const current = String(next[key] || '').trim();
        if (current && orders.some((o) => String(o.order_id || '').trim() === current)) continue;
        next[key] = String(orders[0].order_id || '').trim();
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [customers, orderedMap]);

  const isStale = useMemo(() => {
    const createdAtMs = Number(session?.created_at_ms || 0);
    if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return false;
    return Date.now() - createdAtMs > 60 * 60 * 1000;
  }, [session?.created_at_ms]);

  if (!allowed) return null;

  return (
    <div className="container mx-auto max-w-7xl p-3 sm:p-4 py-4 sm:py-6 lg:py-8 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 leading-tight">Scrap Data Grup</h1>
          <p className="text-gray-500 mt-1">Kiri: hasil parse. Kanan: keseluruhan chat pada rentang tanggal.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/chat/whatsapp/scraping-grup-order"
            className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-black uppercase tracking-widest text-slate-700 hover:bg-slate-200"
          >
            <ArrowLeft size={14} /> Setup
          </Link>
          <Button
            onClick={fetchAll}
            disabled={loading}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <AdminChatTabs />

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-800">
          {error}
        </div>
      )}

      {session && (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-black text-slate-900">Grup:</span> {session.group?.name || '(tanpa nama)'}
            {session.range?.date_from && session.range?.date_to ? (
              <span>• Range: {session.range.date_from} → {session.range.date_to} ({session.range.timezone || 'Asia/Jakarta'})</span>
            ) : null}
            {typeof session.created_at_ms === 'number' ? (
              <span>• Diambil: {formatJakartaDateTime(session.created_at_ms)}</span>
            ) : null}
            {isStale ? (
              <span className="rounded-full bg-rose-100 px-3 py-1 font-black text-rose-800">STALE &gt; 1 JAM</span>
            ) : null}
            {session.truncated ? (
              <span className="rounded-full bg-amber-100 px-3 py-1 font-black text-amber-800">TRUNCATED</span>
            ) : (
              <span className="rounded-full bg-emerald-100 px-3 py-1 font-black text-emerald-800">OK</span>
            )}
            <span className="ml-auto rounded-full bg-slate-100 px-3 py-1 font-black text-slate-700">
              Ordered: {orderedCount}/{customers.length}
            </span>
          </div>
        </div>
      )}

      <div className="lg:hidden bg-white border border-slate-200 rounded-2xl p-2 shadow-sm">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMobileTab('scrape')}
            className={`px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-colors ${
              mobileTab === 'scrape'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Hasil ({customers.length})
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('chat')}
            className={`px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-colors ${
              mobileTab === 'chat'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Chat ({messages.length})
          </button>
        </div>
      </div>

	      <div className="grid gap-4 lg:grid-cols-4 lg:items-start">
	        <Card className={`lg:min-h-[60vh] lg:col-span-3 ${mobileTab === 'chat' ? 'hidden lg:block' : ''}`}>
	          <CardHeader className="pb-2">
	            <CardTitle className="text-sm text-slate-700">Hasil Scrape</CardTitle>
	          </CardHeader>
	          <CardContent className="space-y-3">
            {!session ? (
              <p className="text-sm text-slate-500">{loading ? 'Memuat...' : 'Tidak ada data session.'}</p>
            ) : customers.length === 0 ? (
              <p className="text-sm text-slate-500">Tidak ada customer terdeteksi dari format chat.</p>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-slate-50">
                    <tr className="text-[10px] uppercase tracking-widest text-slate-500">
                      <th className="px-4 py-3 font-black">Customer (Chat)</th>
                      <th className="px-4 py-3 font-black">Match</th>
                      <th className="px-4 py-3 font-black">Blok</th>
                      <th className="px-4 py-3 font-black">Item</th>
                      <th className="px-4 py-3 font-black">Qty kosong</th>
                      <th className="px-4 py-3 font-black">Media</th>
                      <th className="px-4 py-3 font-black">Order</th>
                      <th className="px-4 py-3 font-black"></th>
                    </tr>
                  </thead>
	                  <tbody className="bg-white">
	                    {customers.map((c) => {
	                      const orders = listWaScrapeCustomerOrders(orderedMap, c.customer_key);
	                      const selectedOrderId = String(selectedOrderIdByCustomerKey[c.customer_key] || '').trim() || (orders[0]?.order_id || '');
	                      return (
	                        <tr key={c.customer_key} className="border-t">
	                          <td className="px-4 py-3 align-middle font-black text-slate-900">{c.chat_name}</td>
		                          <td className="px-4 py-3 align-middle whitespace-nowrap">
		                            <span className={`inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wide leading-none ${
		                              c.match_status === 'unique'
		                                ? 'bg-emerald-100 text-emerald-800'
		                                : c.match_status === 'ambiguous'
		                                  ? 'bg-amber-100 text-amber-800'
		                                  : 'bg-slate-100 text-slate-700'
		                            }`}>
		                              {c.match_status} • {c.candidates_count}
		                            </span>
		                          </td>
	                          <td className="px-4 py-3 align-middle">{c.blocks_count}</td>
	                          <td className="px-4 py-3 align-middle">{c.items_count}</td>
	                          <td className="px-4 py-3 align-middle">{c.unresolved_qty_count}</td>
	                          <td className="px-4 py-3 align-middle">{c.has_media ? 'Ya' : 'Tidak'}</td>
		                          <td className="px-4 py-3 align-middle">
		                            {orders.length === 0 ? (
		                              <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-600">
		                                Belum
		                              </span>
		                            ) : orders.length === 1 ? (
		                              <Link
		                                href={`/admin/orders/detail/${encodeURIComponent(orders[0].order_id)}`}
		                                className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-800 hover:bg-emerald-200"
		                                title={`Dibuat: ${formatJakartaDateTime(orders[0].created_at_ms)}`}
		                              >
		                                Order #{orders[0].order_id}
		                              </Link>
		                            ) : (
		                              <div className="flex flex-wrap items-center gap-2">
		                                <select
		                                  className="rounded-xl border border-slate-200 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-700"
		                                  value={selectedOrderId}
		                                  onChange={(e) => {
		                                    const v = String(e.target.value || '').trim();
		                                    setSelectedOrderIdByCustomerKey((prev) => ({ ...prev, [c.customer_key]: v }));
		                                  }}
		                                >
		                                  {orders.map((o) => (
		                                    <option key={o.order_id} value={o.order_id}>
		                                      {String(o.order_id).slice(-8).toUpperCase()} • {formatJakartaDateTime(o.created_at_ms)}
		                                    </option>
		                                  ))}
		                                </select>
		                                <Link
		                                  href={`/admin/orders/detail/${encodeURIComponent(selectedOrderId || orders[0].order_id)}`}
		                                  className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-800 hover:bg-emerald-200"
		                                >
		                                  Buka
		                                </Link>
		                              </div>
		                            )}
		                          </td>
	                          <td className="px-4 py-3 align-middle">
	                            <Link
	                              href={`/admin/orders/create?scrapeSessionId=${encodeURIComponent(session.session_id)}&scrapeCustomerKey=${encodeURIComponent(c.customer_key)}`}
	                              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white hover:bg-emerald-700"
	                            >
	                              Buat Order <ArrowRight size={14} />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

		        <Card className={`lg:min-h-[60vh] lg:col-span-1 ${mobileTab === 'scrape' ? 'hidden lg:block' : ''}`}>
		          <CardHeader className="pb-2">
		            <CardTitle className="text-sm text-slate-700">Chat (Rentang Tanggal)</CardTitle>
		          </CardHeader>
		          <CardContent className="space-y-2 pb-2">
		            {loading && messages.length === 0 ? (
		              <p className="text-sm text-slate-500">Memuat chat...</p>
		            ) : messages.length === 0 ? (
		              <p className="text-sm text-slate-500">Tidak ada chat pada rentang ini (atau message_limit kurang besar).</p>
		            ) : (
		              <div className="max-h-[calc(100vh_-_var(--admin-header-height,72px)_-_260px)] overflow-y-auto space-y-2 pr-1">
		                {messages.map((m) => {
		                  const id = String(m.message_id || '').trim();
		                  const isMedia = !!m.has_media || String(m.type || '').toLowerCase() === 'image';
		                  const label = authorLabel(m.author);
                  const scrapeGroups = Array.isArray(m.scrape_groups) ? m.scrape_groups : [];
                  const group = scrapeGroups.length > 0 ? scrapeGroups[0] : null;
                  const extraGroups = Math.max(0, scrapeGroups.length - 1);
                  const groupCustomerKey = group ? String(group.customer_key || '').trim() : '';
                  const groupColor = groupCustomerKey ? colorForCustomerKey(groupCustomerKey) : null;
                  const groupCustomerName = groupCustomerKey ? (customerNameByKey[groupCustomerKey] || groupCustomerKey) : '';
                  const orders = groupCustomerKey ? listWaScrapeCustomerOrders(orderedMap, groupCustomerKey) : [];
                  const groupLabel = group
                    ? `${groupCustomerName} • ${group.block_id}${group.is_addon ? ' • addon' : ''}${group.kind === 'marker' ? ' • marker' : ''}${extraGroups ? ` +${extraGroups}` : ''}`
                    : '';
                  return (
                    <div
                      key={id}
                      className={`rounded-2xl border border-slate-200 bg-white p-3 ${
                        groupColor ? `border-l-4 ${groupColor.left} ${groupColor.bg}` : ''
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-[10px] uppercase tracking-widest text-slate-500">
                          {formatJakartaTimestamp(m.timestamp)}{label ? ` • ${label}` : ''}{m.type ? ` • ${m.type}` : ''}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {group ? (
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-widest ${
                                groupColor ? groupColor.badge : 'bg-slate-100 text-slate-700'
                              }`}
                              title={groupLabel}
                            >
                              {groupCustomerName} • {group.block_id}{group.is_addon ? ' • addon' : ''}{group.kind === 'marker' ? ' • marker' : ''}{extraGroups ? ` +${extraGroups}` : ''}
                            </span>
                          ) : null}
                          {orders.length > 0 ? (
                            <span
                              className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-800"
                              title={
                                orders.length === 1
                                  ? `Order #${orders[0].order_id} • Dibuat: ${formatJakartaDateTime(orders[0].created_at_ms)}`
                                  : orders.length > 1
                                    ? `Ada ${orders.length} order untuk customer ini. Terbaru: ${orders[0].order_id} (${formatJakartaDateTime(orders[0].created_at_ms)})`
                                    : ''
                              }
                            >
                              ✓ {orders.length === 1 ? `Order #${orders[0].order_id}` : `Order x${orders.length}`}
                            </span>
                          ) : null}
                          {isMedia ? (
                            <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-slate-700">
                              <ImageIcon size={12} /> Media
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-2 text-sm text-slate-900 whitespace-pre-wrap break-words">
                        {isMedia ? (m.body ? `<image> ${m.body}` : '<image>') : (m.body || '')}
                      </div>

                      {isMedia ? (
                        <div className="mt-2 space-y-2">
                          {!mediaUrlById[id] ? (
                            <Button
                              variant="ghost"
                              onClick={() => void loadMedia(id)}
                              disabled={!!mediaLoadingById[id]}
                              className="flex items-center gap-2"
                            >
                              <ImageIcon size={14} /> {mediaLoadingById[id] ? 'Memuat...' : 'Muat Gambar'}
                            </Button>
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={mediaUrlById[id]}
                              alt="WA media"
                              className="max-h-64 rounded-xl border border-slate-200 object-contain bg-slate-50"
                            />
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
