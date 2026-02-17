'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, RefreshCw, Search, Send } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import getSocket from '@/lib/socket';
import { useAuthStore } from '@/store/authStore';

type ChatSessionRow = {
  id: string;
  user_id?: string | null;
  unread_count?: number;
  platform?: 'web' | 'whatsapp' | string;
  whatsapp_number?: string;
  User?: { name?: string };
  Messages?: Array<{
    body?: string;
    sender_type?: 'customer' | 'admin' | string;
    is_read?: boolean;
    sender_id?: string;
  }>;
};

type ChatMessage = {
  id?: string;
  body?: string;
  sender_type?: 'customer' | 'admin' | 'bot' | string;
  sender_id?: string;
  created_at?: string;
  createdAt?: string;
};

type ChatContactRow = {
  id: string;
  name?: string;
  whatsapp_number?: string;
  role?: string;
};

type ChatSocketPayload = {
  session_id?: string;
};

function DriverChatContent() {
  const allowed = useRequireRoles(['driver', 'super_admin', 'admin_gudang']);
  const { user } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const role = String(user?.role || '').trim();
  const canViewWhatsapp = ['super_admin', 'kasir'].includes(role);

  const userIdParam = searchParams.get('userId');
  const phoneParam = searchParams.get('phone') || searchParams.get('whatsapp');
  const sessionIdParam = searchParams.get('sessionId') || '';
  const currentUserId = String(user?.id || '').trim();

  const [sessions, setSessions] = useState<ChatSessionRow[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [contactResults, setContactResults] = useState<ChatContactRow[]>([]);
  const [contactLoading, setContactLoading] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'list' | 'chat'>('list');

  const normalizeWhatsapp = (value?: string | null) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('0')) return `62${digits.slice(1)}`;
    if (digits.startsWith('62')) return digits;
    return digits;
  };

  const getPhoneSearchCandidates = (value?: string | null) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return [] as string[];

    const variants = new Set<string>([digits]);
    if (digits.startsWith('0')) {
      variants.add(`62${digits.slice(1)}`);
    } else if (digits.startsWith('62')) {
      variants.add(`0${digits.slice(2)}`);
    } else if (digits.startsWith('8')) {
      variants.add(`62${digits}`);
      variants.add(`0${digits}`);
    }

    return Array.from(variants).filter((item) => item.length >= 3);
  };

  const doesPhoneMatchKeyword = useCallback((phone: string, keyword: string) => {
    const phoneCandidates = getPhoneSearchCandidates(phone);
    const keywordCandidates = getPhoneSearchCandidates(keyword);
    if (!phoneCandidates.length || !keywordCandidates.length) return false;

    return keywordCandidates.some((keywordPart) =>
      phoneCandidates.some((phonePart) => phonePart.includes(keywordPart) || keywordPart.includes(phonePart))
    );
  }, []);

  const getSessionName = (session: ChatSessionRow) =>
    session.User?.name || session.whatsapp_number || 'Customer';

  const getSessionUnreadCount = useCallback((session: ChatSessionRow): number => {
    const unread = Number(session.unread_count || 0);
    if (Number.isFinite(unread) && unread > 0) return unread;

    const latest = Array.isArray(session.Messages) && session.Messages.length > 0 ? session.Messages[0] : null;
    const latestSenderId = String(latest?.sender_id || '').trim();
    const isFromOtherUser = latestSenderId
      ? latestSenderId !== currentUserId
      : latest?.sender_type !== 'admin' && latest?.sender_type !== 'bot';
    if (isFromOtherUser && latest?.is_read === false) return 1;
    return 0;
  }, [currentUserId]);

  const getRoleLabel = (rawRole?: string) => {
    if (rawRole === 'super_admin') return 'Super Admin';
    if (rawRole === 'admin_gudang') return 'Admin Gudang';
    if (rawRole === 'admin_finance') return 'Admin Finance';
    if (rawRole === 'kasir') return 'Admin Pemasaran';
    if (rawRole === 'driver') return 'Driver';
    return rawRole || 'Akun';
  };

  const formatTime = (row: ChatMessage) => {
    const value = row.created_at || row.createdAt;
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(date);
  };

  const loadMessages = useCallback(async (sessionId: string) => {
    try {
      const res = await api.chat.getMessages(sessionId);
      setMessages(Array.isArray(res.data?.messages) ? res.data.messages : []);
    } catch (error) {
      console.error('Error loading driver chat messages:', error);
    }
  }, []);

  const loadSessions = useCallback(async (
    params?: { user_id?: string; platform?: 'web' | 'whatsapp' },
    preferredSessionId?: string
  ) => {
    try {
      setInboxLoading(true);
      const effectiveParams = params || (!canViewWhatsapp ? { platform: 'web' as const } : undefined);
      const res = await api.chat.getSessions(effectiveParams);
      const rowsRaw = Array.isArray(res.data?.sessions) ? (res.data.sessions as ChatSessionRow[]) : [];
      const rows = canViewWhatsapp
        ? rowsRaw
        : rowsRaw.filter((item) => String(item.platform || 'web').toLowerCase() !== 'whatsapp');
      setSessions(rows);

      const preferredFromUserId = userIdParam
        ? rows.find((item: ChatSessionRow) => String(item?.user_id || '') === userIdParam)?.id
        : '';
      const preferredFromSessionId = sessionIdParam
        ? rows.find((item: ChatSessionRow) => String(item.id || '') === sessionIdParam)?.id
        : '';
      const normalizedTargetPhone = normalizeWhatsapp(phoneParam);
      const preferredFromPhone = normalizedTargetPhone
        ? rows.find((item: ChatSessionRow) => normalizeWhatsapp(item.whatsapp_number) === normalizedTargetPhone)?.id
        : '';
      const keepCurrent = rows.some((item: ChatSessionRow) => item.id === selectedSessionId) ? selectedSessionId : '';
      const deepLinkPreferred = keepCurrent ? '' : (preferredFromSessionId || preferredFromUserId || preferredFromPhone);
      const nextSessionId = preferredSessionId || keepCurrent || deepLinkPreferred || '';

      if (nextSessionId) {
        setSelectedSessionId(nextSessionId);
        await loadMessages(nextSessionId);
        if (userIdParam || preferredSessionId || preferredFromSessionId) setMobilePanel('chat');
      } else {
        setSelectedSessionId('');
        setMessages([]);
        setMobilePanel('list');
      }
    } catch (error) {
      console.error('Error loading driver chat sessions:', error);
    } finally {
      setInboxLoading(false);
    }
  }, [canViewWhatsapp, loadMessages, phoneParam, selectedSessionId, sessionIdParam, userIdParam]);

  useEffect(() => {
    if (allowed) {
      void loadSessions();
    }
  }, [allowed, loadSessions]);

  useEffect(() => {
    if (!allowed) {
      setContactResults([]);
      setContactLoading(false);
      return;
    }

    const keyword = searchQuery.trim();
    if (keyword.length < 2) {
      setContactResults([]);
      setContactLoading(false);
      return;
    }

    let isMounted = true;
    const timer = window.setTimeout(async () => {
      try {
        setContactLoading(true);
        const res = await api.chat.searchContacts(keyword, 12);
        const rows = Array.isArray(res.data?.contacts) ? res.data.contacts : [];
        if (isMounted) {
          setContactResults(rows);
        }
      } catch (error) {
        if (isMounted) {
          setContactResults([]);
        }
        console.error('Error searching internal contacts from driver chat:', error);
      } finally {
        if (isMounted) {
          setContactLoading(false);
        }
      }
    }, 260);

    return () => {
      isMounted = false;
      window.clearTimeout(timer);
    };
  }, [allowed, searchQuery]);

  useEffect(() => {
    if (!allowed) return;

    const socket = getSocket();
    const onChatMessage = (payload: ChatSocketPayload) => {
      if (payload?.session_id && payload.session_id === selectedSessionId) {
        void loadMessages(payload.session_id);
      }
      void loadSessions();
    };

    socket.on('chat:message', onChatMessage);
    return () => {
      socket.off('chat:message', onChatMessage);
    };
  }, [allowed, selectedSessionId, loadMessages, loadSessions]);

  const selectedSession = useMemo(
    () => sessions.find((item) => item.id === selectedSessionId) || null,
    [sessions, selectedSessionId]
  );

  const filteredSessions = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) return sessions;

    return sessions.filter((session) => {
      const name = getSessionName(session).toLowerCase();
      const phone = String(session.whatsapp_number || '');
      const latest = Array.isArray(session.Messages) && session.Messages.length > 0 ? session.Messages[0] : null;
      const preview = String(latest?.body || '').toLowerCase();
      return name.includes(keyword) || preview.includes(keyword) || doesPhoneMatchKeyword(phone, keyword);
    });
  }, [sessions, searchQuery, doesPhoneMatchKeyword]);

  const unreadSessionCount = useMemo(
    () => sessions.filter((session) => getSessionUnreadCount(session) > 0).length,
    [sessions, getSessionUnreadCount]
  );

  const handleSelectSession = async (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setMobilePanel('chat');
    await loadSessions(undefined, sessionId);
  };

  const handleSelectContact = async (contact: ChatContactRow) => {
    setSearchQuery('');
    const res = await api.chat.getSessions({
      user_id: contact.id,
      ...(!canViewWhatsapp ? { platform: 'web' as const } : {}),
    });
    const rowsRaw = Array.isArray(res.data?.sessions) ? (res.data.sessions as ChatSessionRow[]) : [];
    const rows = canViewWhatsapp
      ? rowsRaw
      : rowsRaw.filter((item) => String(item.platform || 'web').toLowerCase() !== 'whatsapp');
    const targetSessionId = rows[0]?.id ? String(rows[0].id) : '';
    await loadSessions(undefined, targetSessionId || undefined);
    setMobilePanel('chat');
  };

  const sendReply = async () => {
    if (!selectedSessionId || !replyText.trim()) return;
    try {
      setSending(true);
      await api.chat.replyToChat(selectedSessionId, { message: replyText.trim() });
      setReplyText('');
      await loadMessages(selectedSessionId);
      await loadSessions(undefined, selectedSessionId);
    } catch (error) {
      console.error('Error sending driver chat reply:', error);
      alert('Gagal mengirim pesan.');
    } finally {
      setSending(false);
    }
  };

  if (!allowed) return null;

  return (
    <div className="p-4 md:p-6 pb-0 -mb-24 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
          <ArrowLeft size={16} /> Kembali
        </button>
        <button
          onClick={() => void loadSessions()}
          disabled={inboxLoading}
          className="inline-flex items-center gap-2 text-xs font-black uppercase text-slate-700 border border-slate-200 rounded-xl px-3 py-2"
        >
          <RefreshCw size={14} className={inboxLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-visible min-h-[620px] lg:grid lg:grid-cols-[320px_1fr]">
        <div className={`${mobilePanel === 'chat' ? 'hidden lg:flex' : 'flex'} flex-col border-r border-slate-200 bg-slate-50/60`}>
          <div className="p-4 border-b border-slate-200 bg-white/80 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-black text-slate-900">Daftar Chat</p>
              <div className="flex items-center gap-2">
                {unreadSessionCount > 0 ? (
                  <span className="text-[11px] font-black px-2 py-1 rounded-full bg-rose-100 text-rose-700">
                    {unreadSessionCount} belum dibalas
                  </span>
                ) : null}
                <span className="text-[10px] md:text-[11px] font-bold px-2 py-1 rounded-full bg-slate-200 text-slate-700 whitespace-nowrap">
                  {sessions.length} sesi
                </span>
              </div>
            </div>
            <div className="relative">
              <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari customer, admin, atau nomor..."
                className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {searchQuery.trim().length >= 2 && (
              <div className="border-b border-slate-200 bg-white/70">
                <p className="px-4 pt-3 pb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Kontak Internal
                </p>
                {contactLoading ? (
                  <p className="px-4 pb-3 text-xs text-slate-500">Mencari admin/staff...</p>
                ) : contactResults.length === 0 ? (
                  <p className="px-4 pb-3 text-xs text-slate-500">Admin/staff tidak ditemukan.</p>
                ) : (
                  contactResults.map((contact) => (
                    <button
                      key={`contact-${contact.id}`}
                      onClick={() => void handleSelectContact(contact)}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-t border-slate-100"
                    >
                      <p className="text-sm font-bold text-slate-900 truncate">{contact.name || '-'}</p>
                      <p className="text-[11px] text-slate-500 truncate">{contact.whatsapp_number || '-'}</p>
                      <p className="text-[10px] text-emerald-700 font-bold mt-0.5">{getRoleLabel(contact.role)}</p>
                    </button>
                  ))
                )}
              </div>
            )}

            {filteredSessions.length === 0 ? (
              <p className="text-sm text-slate-500 p-4">
                {inboxLoading ? 'Memuat chat...' : 'Belum ada sesi chat.'}
              </p>
            ) : filteredSessions.map((session) => {
              const latest = Array.isArray(session.Messages) && session.Messages.length > 0 ? session.Messages[0] : null;
              const active = selectedSessionId === session.id;
              const unreadCount = getSessionUnreadCount(session);
              const unread = unreadCount > 0;
              return (
                <button
                  key={session.id}
                  onClick={() => void handleSelectSession(session.id)}
                  className={`w-full text-left px-4 py-3 border-b border-slate-200 transition-all ${active ? 'bg-white ring-1 ring-inset ring-emerald-200' : 'hover:bg-white'} ${unread && !active ? 'bg-rose-50/60 border-l-4 border-l-rose-400' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold text-slate-900 truncate">{getSessionName(session)}</p>
                    {unread ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 shrink-0">
                        <span className="hidden sm:inline">Belum dibalas</span>
                        <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-rose-600 text-white text-[9px] leading-none">
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-slate-500 truncate">{session.whatsapp_number || '-'}</p>
                  <p className={`text-xs truncate mt-1 ${unread ? 'text-rose-700 font-semibold' : 'text-slate-600'}`}>{latest?.body || 'Belum ada pesan'}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className={`${mobilePanel === 'list' ? 'hidden lg:flex' : 'flex'} min-h-[620px] flex-col relative`}>
          <div className="p-4 border-b border-slate-200 bg-white flex items-center gap-3">
            <button
              onClick={() => setMobilePanel('list')}
              className="lg:hidden inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white h-9 w-9"
              aria-label="Kembali ke daftar chat"
            >
              <ArrowLeft size={16} />
            </button>
            <div className="min-w-0">
              <p className="text-sm font-black text-slate-900 truncate">
                {selectedSession ? getSessionName(selectedSession) : 'Percakapan'}
              </p>
              <p className="text-xs text-slate-500 truncate">{selectedSession?.whatsapp_number || 'Pilih sesi di panel kiri.'}</p>
            </div>
          </div>

          <div className="flex-1 p-4 md:p-6 pb-28 md:pb-32 space-y-3 overflow-y-auto bg-gradient-to-b from-white to-slate-50/70">
            {!selectedSessionId ? (
              <p className="text-sm text-slate-500">Pilih customer untuk melihat riwayat chat.</p>
            ) : messages.length === 0 ? (
              <p className="text-sm text-slate-500">Belum ada pesan. Mulai percakapan sekarang.</p>
            ) : (
              messages.map((message, idx) => {
                const senderId = String(message.sender_id || '').trim();
                const actorId = String(user?.id || '').trim();
                const isOwnMessage = senderId
                  ? senderId === actorId
                  : message.sender_type === 'admin';
                return (
                  <div key={`${message.id || 'row'}-${idx}`} className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[90%] sm:max-w-[84%] rounded-2xl px-3 py-2 text-sm ${isOwnMessage ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
                      <p className="whitespace-pre-wrap break-words">{message.body || ''}</p>
                      <p className={`text-[10px] mt-1 text-right ${isOwnMessage ? 'text-emerald-100' : 'text-slate-500'}`}>
                        {formatTime(message)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="sticky bottom-[calc(6rem+env(safe-area-inset-bottom))] z-20 p-4 border-t border-slate-200 bg-white/95 backdrop-blur-sm flex gap-2">
            <input
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void sendReply();
                }
              }}
              placeholder={selectedSessionId ? 'Tulis pesan...' : 'Pilih sesi dulu'}
              className="flex-1 min-w-0 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
              disabled={!selectedSessionId || sending}
            />
            <button
              onClick={() => void sendReply()}
              disabled={!selectedSessionId || !replyText.trim() || sending}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 bg-emerald-600 text-white rounded-xl px-3 sm:px-4 py-2 text-sm font-black disabled:opacity-50"
            >
              <Send size={14} />
              <span className="hidden sm:inline">{sending ? '...' : 'Kirim'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DriverChatPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading chat...</div>}>
      <DriverChatContent />
    </Suspense>
  );
}
