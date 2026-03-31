'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import AdminChatTabs from '@/components/chat/AdminChatTabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { RefreshCw, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';

type GroupRow = {
  id: string;
  name: string;
  participants_count: number | null;
};

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
  group?: GroupRow;
  range?: { date_from: string; date_to: string; timezone: string };
  truncated?: boolean;
  customers?: ScrapeCustomerSummary[];
};

const todayJakartaIso = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value || '';
  const m = parts.find((p) => p.type === 'month')?.value || '';
  const d = parts.find((p) => p.type === 'day')?.value || '';
  return `${y}-${m}-${d}`;
};

export default function ScrapingGrubOrderPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir']);
  const router = useRouter();

  const [waStatus, setWaStatus] = useState<string>('STOPPED');
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [dateFrom, setDateFrom] = useState(todayJakartaIso());
  const [dateTo, setDateTo] = useState(todayJakartaIso());
  const [messageLimit, setMessageLimit] = useState(10000);
  const [scraping, setScraping] = useState(false);
  const [error, setError] = useState('');

  const filteredGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => String(g.name || '').toLowerCase().includes(q));
  }, [groupSearch, groups]);

  const fetchStatus = async () => {
    try {
      setLoadingStatus(true);
      const res = await api.whatsapp.getStatus();
      setWaStatus(String(res.data?.status || 'STOPPED'));
    } catch (e: unknown) {
      console.error(e);
      setWaStatus('ERROR');
    } finally {
      setLoadingStatus(false);
    }
  };

  const loadGroups = async () => {
    try {
      setLoadingGroups(true);
      setError('');
      const res = await api.whatsapp.listGroups();
      const rows = Array.isArray(res.data?.groups) ? (res.data.groups as GroupRow[]) : [];
      setGroups(rows);
    } catch (e: unknown) {
      console.error(e);
      const statusCode = Number((e as { response?: { status?: unknown } })?.response?.status || 0);
      const message = typeof e === 'object' && e && 'response' in e
        ? String((e as { response?: { data?: { message?: string } } }).response?.data?.message || '')
        : '';
      setGroups([]);
      if (statusCode === 404) {
        setError('Fitur scraping belum aktif. Set `WA_SCRAPE_ENABLED=true` di backend.');
      } else {
        setError(message || 'Gagal memuat daftar grup. Pastikan WA siap dan fitur scraping aktif.');
      }
    } finally {
      setLoadingGroups(false);
    }
  };

  const runScrape = async () => {
    if (!selectedGroupId) {
      setError('Pilih grup terlebih dahulu.');
      return;
    }
    if (!dateFrom || !dateTo) {
      setError('Tanggal wajib diisi.');
      return;
    }

    try {
      setScraping(true);
      setError('');
      const res = await api.whatsapp.scrapeCreateSession({
        group_id: selectedGroupId,
        date_from: dateFrom,
        date_to: dateTo,
        timezone: 'Asia/Jakarta',
        message_limit: messageLimit,
      });
      const payload = (res.data || {}) as ScrapeSessionSummary;
      const sessionId = String(payload.session_id || '').trim();
      if (!sessionId) {
        setError('Gagal membuat scrape session (session_id kosong).');
        return;
      }
      router.push(`/admin/chat/whatsapp/scraping-grup-order/sessions/${encodeURIComponent(sessionId)}`);
    } catch (e: unknown) {
      console.error(e);
      const statusCode = Number((e as { response?: { status?: unknown } })?.response?.status || 0);
      const message = typeof e === 'object' && e && 'response' in e
        ? String((e as { response?: { data?: { message?: string } } }).response?.data?.message || '')
        : '';
      if (statusCode === 404) {
        setError('Fitur scraping belum aktif. Set `WA_SCRAPE_ENABLED=true` di backend.');
      } else {
        setError(message || 'Gagal melakukan scrape.');
      }
    } finally {
      setScraping(false);
    }
  };

  useEffect(() => {
    if (!allowed) return;
    void fetchStatus();
  }, [allowed]);

  if (!allowed) return null;

  return (
    <div className="container mx-auto max-w-6xl p-3 sm:p-4 py-4 sm:py-6 lg:py-8 space-y-4">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 leading-tight">Scraping Grub Order</h1>
        <p className="text-gray-500 mt-1">Ambil data order dari WhatsApp group untuk dibantu input ke order manual (admin tetap memutuskan).</p>
      </div>

      <AdminChatTabs />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-700">Status WhatsApp</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">Status</p>
                <p className="text-lg font-black text-slate-900">{waStatus.replace(/_/g, ' ')}</p>
              </div>
              <Button
                variant="ghost"
                onClick={fetchStatus}
                disabled={loadingStatus}
                className="flex items-center gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${loadingStatus ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
            {waStatus !== 'READY' && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
                WhatsApp belum READY. Connect dulu di halaman Koneksi WhatsApp.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-700">Pilih Grup & Rentang Tanggal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Button
                onClick={loadGroups}
                disabled={loadingGroups || waStatus !== 'READY'}
                className="flex items-center gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${loadingGroups ? 'animate-spin' : ''}`} />
                Muat Grup
              </Button>
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  value={groupSearch}
                  onChange={(e) => setGroupSearch(e.target.value)}
                  placeholder="Cari nama grup..."
                  className="w-full pl-10 pr-3 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="max-h-56 overflow-y-auto rounded-2xl border border-slate-200 bg-white">
              {filteredGroups.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">Belum ada data grup. Klik “Muat Grup”.</p>
              ) : (
                filteredGroups.map((g) => {
                  const active = selectedGroupId === g.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setSelectedGroupId(g.id)}
                      className={`w-full text-left px-4 py-3 border-b last:border-0 ${active ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}
                    >
                      <p className="text-sm font-black text-slate-900">{g.name || '(tanpa nama)'}</p>
                      <p className="text-[11px] text-slate-500">ID: {g.id}{typeof g.participants_count === 'number' ? ` • ${g.participants_count} peserta` : ''}</p>
                    </button>
                  );
                })
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1">Dari</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1">Sampai</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1">Message Limit</label>
              <input
                type="number"
                value={messageLimit}
                onChange={(e) => setMessageLimit(Number(e.target.value || 0))}
                min={100}
                max={10000}
                className="w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm"
              />
              <p className="mt-1 text-[11px] text-slate-500">Lebih besar = lebih lama. Jika hasilnya “truncated”, coba naikan limit.</p>
            </div>

            <Button
              onClick={runScrape}
              disabled={scraping || waStatus !== 'READY'}
              className="w-full"
            >
              {scraping ? 'Scraping...' : 'Scrape'}
            </Button>

            {error && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-800">
                {error}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
