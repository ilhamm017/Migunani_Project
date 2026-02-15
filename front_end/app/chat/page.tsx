'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileText, Paperclip, RefreshCw, Search, Send, Star, X } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import getSocket from '@/lib/socket';
import { api } from '@/lib/api';

type ChatEventPayload = {
  session_id?: string;
  sender?: 'customer' | 'admin' | 'bot';
  platform?: 'web' | 'whatsapp' | string;
  body?: string;
  attachment_url?: string;
  timestamp?: string;
};

type LocalChatMessage = {
  id: string;
  sender: 'customer' | 'admin';
  body: string;
  attachmentUrl?: string;
  source: 'WEB' | 'WA';
  createdAt?: string;
};

type WebHistoryMessage = {
  id?: string | number;
  body?: string;
  attachment_url?: string;
  sender_type?: 'customer' | 'admin' | 'bot' | string;
  created_via?: 'system' | 'wa_mobile_sync' | 'admin_panel' | string;
  createdAt?: string;
};

type ChatSessionRow = {
  id: string;
  staffId?: string;
  title: string;
  platform: 'web' | 'whatsapp';
  whatsappNumber: string;
  latest?: {
    body: string;
    sender: 'customer' | 'admin';
    isUnread: boolean;
    unreadCount: number;
  };
};

type ChatContactRow = {
  id: string;
  name?: string;
  whatsapp_number?: string;
  role?: string;
};

type CustomerWebSessionRow = {
  id: string;
  unread_count?: number;
  platform?: 'web' | 'whatsapp' | string;
  whatsapp_number?: string;
  staff?: {
    id?: string;
    name?: string;
    whatsapp_number?: string;
    role?: string;
  } | null;
  latest_message?: {
    body?: string;
    attachment_url?: string;
    sender_type?: 'customer' | 'admin' | string;
    is_read?: boolean;
  } | null;
};

const SESSION_KEY = 'web_chat_session_id';
const GUEST_KEY = 'web_chat_guest_id';
const ATTACHMENT_FALLBACK_BODY = '[Lampiran]';

const isImageAttachment = (attachmentUrl?: string) => {
  if (!attachmentUrl) return false;
  return /\.(png|jpe?g|webp|gif)$/i.test(attachmentUrl);
};

const formatMessageTime = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(date);
};

export default function CustomerChatPage() {
  const user = useAuthStore((state) => state.user);
  const previousAuthUserIdRef = useRef<string | null | undefined>(undefined);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const [sessionId, setSessionId] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [guestId, setGuestId] = useState('');
  const [sessions, setSessions] = useState<ChatSessionRow[]>([]);
  const [messages, setMessages] = useState<LocalChatMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [contactResults, setContactResults] = useState<ChatContactRow[]>([]);
  const [contactLoading, setContactLoading] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [selectedStaffName, setSelectedStaffName] = useState('');
  const [mobilePanel, setMobilePanel] = useState<'list' | 'chat'>('chat');
  const [inboxLoading, setInboxLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyAttachment, setReplyAttachment] = useState<File | null>(null);
  const [sendingReply, setSendingReply] = useState(false);
  const [sendError, setSendError] = useState('');
  const [zoomImageUrl, setZoomImageUrl] = useState('');

  const mapCustomerSession = useCallback((row: CustomerWebSessionRow): ChatSessionRow => {
    const latestBody = String(row.latest_message?.body || '').trim();
    const preview = latestBody === ATTACHMENT_FALLBACK_BODY
      ? 'Lampiran'
      : latestBody || (row.latest_message?.attachment_url ? 'Lampiran' : 'Belum ada pesan');
    const sender = row.latest_message?.sender_type === 'admin' ? 'admin' : 'customer';
    const title = String(row.staff?.name || '').trim() || 'Tim Migunani Motor';
    const whatsappNumber = String(row.staff?.whatsapp_number || '').trim() || '-';
    const directUnread = Number(row.unread_count || 0);
    const unreadCount = Number.isFinite(directUnread) && directUnread > 0
      ? directUnread
      : (sender === 'admin' && row.latest_message?.is_read === false ? 1 : 0);

    return {
      id: String(row.id),
      staffId: row.staff?.id ? String(row.staff.id) : undefined,
      title,
      platform: 'web',
      whatsappNumber,
      latest: {
        body: preview,
        sender,
        isUnread: unreadCount > 0,
        unreadCount,
      }
    };
  }, []);

  const updateSessionPreview = useCallback((targetSessionId: string, latestMessage: LocalChatMessage, forcedTitle?: string, options?: { markRead?: boolean }) => {
    if (!targetSessionId) return;
    const latestBody = latestMessage.body || '';
    const preview = latestBody === ATTACHMENT_FALLBACK_BODY ? 'Lampiran' : latestBody || 'Belum ada pesan';

    setSessions((prev) => {
      const index = prev.findIndex((item) => item.id === targetSessionId);
      if (index < 0) {
        const created: ChatSessionRow = {
          id: targetSessionId,
          title: forcedTitle || selectedStaffName || 'Tim Migunani Motor',
          platform: 'web',
          whatsappNumber: '-',
          latest: {
            body: preview,
            sender: latestMessage.sender,
            isUnread: options?.markRead ? false : latestMessage.sender === 'admin',
            unreadCount: options?.markRead ? 0 : (latestMessage.sender === 'admin' ? 1 : 0),
          }
        };
        return [created, ...prev];
      }

      const current = prev[index];
      const currentUnread = Number(current.latest?.unreadCount || 0);
      const nextUnreadCount = options?.markRead
        ? 0
        : latestMessage.sender === 'admin'
          ? currentUnread + 1
          : 0;
      const updated: ChatSessionRow = {
        ...current,
        title: forcedTitle || current.title,
        latest: {
          body: preview,
          sender: latestMessage.sender,
          isUnread: nextUnreadCount > 0,
          unreadCount: nextUnreadCount,
        }
      };

      return [
        updated,
        ...prev.filter((_, itemIndex) => itemIndex !== index)
      ];
    });
  }, [selectedStaffName]);

  const getRoleLabel = (rawRole?: string) => {
    if (rawRole === 'super_admin') return 'Super Admin';
    if (rawRole === 'admin_gudang') return 'Admin Gudang';
    if (rawRole === 'admin_finance') return 'Admin Finance';
    if (rawRole === 'kasir') return 'Admin Pemasaran';
    if (rawRole === 'driver') return 'Driver';
    return rawRole || 'Staff';
  };

  const resolveMyWebSession = useCallback(async (selectSession = false) => {
    if (!user?.id) return '';
    try {
      const res = await api.chat.getMyWebSession();
      const resolvedSessionId = String(res.data?.session?.id || '').trim();
      if (!resolvedSessionId) return '';

      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(SESSION_KEY, resolvedSessionId);
      }
      setSessionId(resolvedSessionId);
      if (selectSession) {
        setSelectedSessionId(resolvedSessionId);
      }
      return resolvedSessionId;
    } catch (error) {
      const status = Number((error as any)?.response?.status || 0);
      if (status !== 401 && status !== 403) {
        console.error('Error resolving customer web session:', error);
      }
      return '';
    }
  }, [user?.id]);

  const loadMessages = useCallback(async (targetSessionId: string, forcedTitle?: string) => {
    if (!targetSessionId) {
      setMessages([]);
      return;
    }

    try {
      setHistoryLoading(true);
      const res = await api.chat.getWebMessages(targetSessionId, guestId, user?.id);
      const rows: WebHistoryMessage[] = Array.isArray(res.data?.messages) ? res.data.messages : [];
      const mapped: LocalChatMessage[] = rows
        .filter((row) => row.sender_type === 'customer' || row.sender_type === 'admin')
        .map((row, index) => ({
          id: row.id ? String(row.id) : `hist-${index}`,
          sender: row.sender_type === 'admin' ? 'admin' : 'customer',
          body: row.body || '',
          attachmentUrl: row.attachment_url,
          source: row.created_via === 'wa_mobile_sync' ? 'WA' : 'WEB',
          createdAt: row.createdAt,
        }));

      setMessages(mapped);
      const latest = mapped.length > 0 ? mapped[mapped.length - 1] : null;
      if (latest) {
        updateSessionPreview(targetSessionId, latest, forcedTitle);
      }
    } catch (error: any) {
      const status = Number(error?.response?.status || 0);
      if (status === 403 || status === 404) {
        if (typeof window !== 'undefined') {
          window.sessionStorage.removeItem(SESSION_KEY);
        }
        setSessionId('');
        setSelectedSessionId('');
        setMessages([]);
        if (user?.id) {
          void resolveMyWebSession(false);
        }
      } else {
        console.error('Error loading web chat history:', error);
      }
    } finally {
      setHistoryLoading(false);
    }
  }, [guestId, resolveMyWebSession, updateSessionPreview, user?.id]);

  const loadInbox = useCallback(async () => {
    try {
      setInboxLoading(true);

      if (!user?.id && !guestId) {
        return;
      }

      let activeSessionId = selectedSessionId;

      if (user?.id && selectedStaffId) {
        const staffSessionRes = await api.chat.getMyWebSessionByStaff(selectedStaffId);
        activeSessionId = String(staffSessionRes.data?.session?.id || '').trim();
        const resolvedStaffName = String(staffSessionRes.data?.staff?.name || '').trim();
        if (resolvedStaffName) {
          if (resolvedStaffName !== selectedStaffName) {
            setSelectedStaffName(resolvedStaffName);
          }
        }
        if (activeSessionId) {
          setSessionId(activeSessionId);
          if (typeof window !== 'undefined') {
            window.sessionStorage.setItem(SESSION_KEY, activeSessionId);
          }
        }
      }

      if (!activeSessionId && user?.id) {
        await resolveMyWebSession(false);
      }

      let mappedRows: ChatSessionRow[] = [];
      if (user?.id) {
        const listRes = await api.chat.getMyWebSessions();
        const rows: CustomerWebSessionRow[] = Array.isArray(listRes.data?.sessions) ? listRes.data.sessions : [];
        mappedRows = rows.map(mapCustomerSession);
        setSessions(mappedRows);

        if (activeSessionId && mappedRows.length > 0 && !mappedRows.some((item) => item.id === activeSessionId)) {
          activeSessionId = '';
        }
      }

      if (!activeSessionId) {
        setMessages([]);
        setSelectedSessionId('');
        return;
      }

      const targetSession = mappedRows.find((item) => item.id === activeSessionId);
      setSelectedSessionId(activeSessionId);
      await loadMessages(activeSessionId, targetSession?.title || selectedStaffName || undefined);
    } finally {
      setInboxLoading(false);
    }
  }, [guestId, loadMessages, mapCustomerSession, resolveMyWebSession, selectedSessionId, selectedStaffId, selectedStaffName, sessionId, user?.id]);

  useEffect(() => {
    const currentUserId = user?.id || null;
    if (previousAuthUserIdRef.current === undefined) {
      previousAuthUserIdRef.current = currentUserId;
      return;
    }

    if (previousAuthUserIdRef.current !== currentUserId) {
      setMessages([]);
      setSessions([]);
      setSessionId('');
      setSelectedSessionId('');
      setSelectedStaffId('');
      setSelectedStaffName('');
      setReplyAttachment(null);
      setSendError('');
      setHistoryLoading(false);

      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(SESSION_KEY);
        if (!currentUserId) {
          const nextGuestId = `guest-${Math.random().toString(36).slice(2, 10)}`;
          window.sessionStorage.setItem(GUEST_KEY, nextGuestId);
          setGuestId(nextGuestId);
        }
      }
    }

    previousAuthUserIdRef.current = currentUserId;
  }, [user?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const savedSession = window.sessionStorage.getItem(SESSION_KEY) || '';
    const savedGuest = window.sessionStorage.getItem(GUEST_KEY) || `guest-${Math.random().toString(36).slice(2, 10)}`;
    if (!window.sessionStorage.getItem(GUEST_KEY)) {
      window.sessionStorage.setItem(GUEST_KEY, savedGuest);
    }

    setSessionId(savedSession);
    setSelectedSessionId(savedSession);
    setGuestId(savedGuest);
  }, []);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  useEffect(() => {
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
        console.error('Error searching migunani staff contacts:', error);
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
  }, [searchQuery]);

  useEffect(() => {
    const socket = getSocket();

    const onSession = (payload: { session_id?: string }) => {
      if (!payload?.session_id) return;
      setSessionId(payload.session_id);
      setSelectedSessionId(payload.session_id);
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(SESSION_KEY, payload.session_id);
      }
    };

    const onChatMessage = (payload: ChatEventPayload) => {
      if (!payload?.session_id) return;
      if (payload.sender !== 'admin') return;
      if (!payload.body && !payload.attachment_url) return;

      const nextIncoming: LocalChatMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sender: 'admin',
        body: payload.body || '',
        attachmentUrl: payload.attachment_url,
        source: payload.platform === 'whatsapp' ? 'WA' : 'WEB',
        createdAt: payload.timestamp || new Date().toISOString(),
      };

      if (!selectedSessionId || payload.session_id !== selectedSessionId) {
        updateSessionPreview(payload.session_id, nextIncoming);
        return;
      }

      updateSessionPreview(payload.session_id, nextIncoming, undefined, { markRead: true });
      setMessages((prev) => [...prev, nextIncoming]);
    };

    socket.on('client:session', onSession);
    socket.on('chat:message', onChatMessage);

    return () => {
      socket.off('client:session', onSession);
      socket.off('chat:message', onChatMessage);
    };
  }, [selectedSessionId, updateSessionPreview]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  const handleSelectSession = async (targetSessionId: string) => {
    setSelectedSessionId(targetSessionId);
    const row = sessions.find((item) => item.id === targetSessionId);
    setSelectedStaffId(row?.staffId || '');
    setSelectedStaffName(row?.title || '');
    setSessions((prev) => prev.map((item) => {
      if (item.id !== targetSessionId) return item;
      if (!item.latest) return item;
      return {
        ...item,
        latest: {
          ...item.latest,
          isUnread: false,
          unreadCount: 0
        }
      };
    }));
    setMobilePanel('chat');
    await loadMessages(targetSessionId, row?.title);
  };

  const handleSelectContact = (contact: ChatContactRow) => {
    if (!contact?.id) return;
    setSessionId('');
    setSelectedSessionId('');
    setMessages([]);
    setSelectedStaffName(contact.name || 'Tim Migunani Motor');
    setSelectedStaffId(contact.id);
    setSearchQuery('');
    setMobilePanel('chat');
  };

  const handleSendReply = async () => {
    const text = replyText.trim();
    if (!selectedSessionId || (!text && !replyAttachment)) return;

    try {
      setSendingReply(true);
      setSendError('');

      let uploadedAttachmentUrl: string | undefined;
      if (replyAttachment) {
        const uploadRes = await api.chat.uploadWebAttachment(replyAttachment);
        uploadedAttachmentUrl = uploadRes.data?.attachment_url;
        if (!uploadedAttachmentUrl) throw new Error('Lampiran gagal diunggah.');
      }

      const socket = getSocket();
      socket.emit('client:message', {
        session_id: selectedSessionId,
        guest_id: guestId || undefined,
        user_id: user?.id || undefined,
        whatsapp_number: user?.whatsapp_number || user?.phone || undefined,
        message: text || undefined,
        attachment_url: uploadedAttachmentUrl,
      });

      const nextMessage: LocalChatMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sender: 'customer',
        body: text || ATTACHMENT_FALLBACK_BODY,
        attachmentUrl: uploadedAttachmentUrl,
        source: 'WEB',
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => {
        const next = [...prev, nextMessage];
        updateSessionPreview(selectedSessionId, nextMessage);
        return next;
      });

      setReplyText('');
      setReplyAttachment(null);
    } catch (error: any) {
      const apiMessage = error?.response?.data?.message;
      setSendError(apiMessage || 'Gagal mengirim pesan.');
      console.error('Error sending web chat message:', error);
    } finally {
      setSendingReply(false);
    }
  };

  const filteredSessions = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) return sessions;
    return sessions.filter((session) => {
      const name = session.title.toLowerCase();
      const phone = session.whatsappNumber.toLowerCase();
      const preview = session.latest?.body?.toLowerCase() || '';
      return name.includes(keyword) || phone.includes(keyword) || preview.includes(keyword);
    });
  }, [searchQuery, sessions]);

  const selectedSession = sessions.find((session) => session.id === selectedSessionId) || null;
  const unreadSessionCount = useMemo(
    () => sessions.filter((session) => Number(session.latest?.unreadCount || 0) > 0).length,
    [sessions]
  );

  return (
    <div className="container mx-auto p-4 max-w-7xl pt-8 lg:pt-10 pb-0 -mb-24 min-h-[80vh] space-y-4">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 leading-tight">Chat Bantuan</h1>
        <p className="text-gray-500 mt-1">Tanya stok, status order, atau bantuan lain langsung ke tim Migunani.</p>
      </div>

      <div className="shadow-xl border border-slate-200 bg-white overflow-visible rounded-2xl">
        <div className="bg-slate-50 py-3 px-6 border-b border-slate-200 flex items-center justify-between">
          <p className="text-xs font-bold text-slate-700 uppercase tracking-widest">Inbox Customer</p>
          <button
            type="button"
            onClick={() => void loadInbox()}
            disabled={inboxLoading}
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 border border-slate-200 rounded-lg px-3 py-2 bg-white disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${inboxLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="min-h-[620px] lg:grid lg:grid-cols-[320px_1fr]">
          <div className={`${mobilePanel === 'chat' ? 'hidden lg:flex' : 'flex'} flex-col border-r border-slate-200 bg-slate-50/60`}>
            <div className="p-4 border-b border-slate-200 bg-white/80 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-black text-slate-900">Daftar Chat</p>
                <div className="flex items-center gap-2">
                  {unreadSessionCount > 0 ? (
                    <span className="text-[11px] font-black px-2 py-1 rounded-full bg-rose-100 text-rose-700">
                      {unreadSessionCount} belum dibuka
                    </span>
                  ) : null}
                  <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-slate-200 text-slate-700">
                    {sessions.length} sesi
                  </span>
                </div>
              </div>
              <div className="relative">
                <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari chat atau staff Migunani..."
                  className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {searchQuery.trim().length >= 2 ? (
                <div className="border-b border-slate-200 bg-white/70">
                  <p className="px-4 pt-3 pb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Staff Migunani
                  </p>
                  {contactLoading ? (
                    <p className="px-4 pb-3 text-xs text-slate-500">Mencari staff...</p>
                  ) : contactResults.length === 0 ? (
                    <p className="px-4 pb-3 text-xs text-slate-500">Staff tidak ditemukan.</p>
                  ) : (
                    contactResults.map((contact) => (
                      <button
                        key={`staff-${contact.id}`}
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
              ) : null}

              {filteredSessions.length === 0 ? (
                <p className="text-sm text-slate-500 p-4">
                  {inboxLoading ? 'Memuat chat...' : 'Belum ada percakapan.'}
                </p>
              ) : filteredSessions.map((session) => {
                const active = selectedSessionId === session.id;
                const unreadCount = Number(session.latest?.unreadCount || 0);
                const isNew = unreadCount > 0;
                return (
                  <button
                    key={session.id}
                    onClick={() => void handleSelectSession(session.id)}
                    className={`w-full text-left px-4 py-3 border-b border-slate-200 transition-all ${active ? 'bg-white ring-1 ring-inset ring-emerald-200' : 'hover:bg-white'} ${isNew && !active ? 'bg-rose-50/60 border-l-4 border-l-rose-400' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {isNew ? <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-emerald-500 shadow-sm shadow-emerald-300" /> : null}
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 truncate">{session.title}</p>
                          <p className="text-[11px] text-slate-500 truncate">{session.whatsappNumber}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {isNew ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
                            <Star size={10} className="fill-current" />
                            Belum dibuka
                            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-rose-600 text-white text-[9px] leading-none">
                              {unreadCount > 99 ? '99+' : unreadCount}
                            </span>
                          </span>
                        ) : null}
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                          {session.platform}
                        </span>
                      </div>
                    </div>
                    <p className={`text-xs truncate mt-1 ${isNew ? 'text-rose-700 font-semibold' : 'text-slate-600'}`}>{session.latest?.body || 'Belum ada pesan'}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={`${mobilePanel === 'list' ? 'hidden lg:flex' : 'flex'} min-h-[620px] flex-col relative`}>
            <div className="p-4 border-b border-slate-200 bg-white flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  onClick={() => setMobilePanel('list')}
                  className="lg:hidden inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white h-9 w-9 shrink-0"
                  aria-label="Kembali ke daftar chat"
                >
                  <ArrowLeft size={16} />
                </button>
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-900 truncate">
                    {selectedSession ? selectedSession.title : 'Percakapan'}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    {selectedSession ? `${selectedSession.whatsappNumber} • ${selectedSession.platform}` : 'Pilih sesi chat dulu'}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex-1 p-4 md:p-6 pb-28 md:pb-32 space-y-3 overflow-y-auto bg-gradient-to-b from-white to-slate-50/70">
              {!selectedSessionId ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-sm text-slate-500">Belum ada sesi chat aktif.</p>
                </div>
              ) : historyLoading && messages.length === 0 ? (
                <p className="text-sm text-slate-500">Memuat riwayat chat...</p>
              ) : messages.length === 0 ? (
                <p className="text-sm text-slate-500">Belum ada pesan di sesi ini.</p>
              ) : messages.map((message) => {
                const isCustomer = message.sender === 'customer';
                const hasAttachment = !!message.attachmentUrl;
                const hasTextBody = !!message.body && message.body !== ATTACHMENT_FALLBACK_BODY;

                return (
                  <div key={message.id} className={`flex ${isCustomer ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[84%] rounded-2xl px-3 py-2 text-sm ${isCustomer ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
                      {hasTextBody ? <p className="whitespace-pre-wrap break-words">{message.body}</p> : null}
                      {hasAttachment ? (
                        <div className={hasTextBody ? 'mt-2' : ''}>
                          {isImageAttachment(message.attachmentUrl) ? (
                            <button
                              type="button"
                              onClick={() => setZoomImageUrl(message.attachmentUrl || '')}
                              className="block rounded-lg overflow-hidden"
                              aria-label="Perbesar gambar lampiran"
                            >
                              <img
                                src={message.attachmentUrl}
                                alt="Lampiran chat"
                                className="max-h-44 max-w-[220px] rounded-lg border border-black/10 object-cover"
                              />
                            </button>
                          ) : (
                            <a
                              href={message.attachmentUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`inline-flex items-center gap-2 rounded-lg px-2.5 py-2 border text-xs font-semibold ${isCustomer ? 'border-emerald-300/70 bg-emerald-500/30 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
                            >
                              <FileText size={14} />
                              Lihat lampiran
                            </a>
                          )}
                        </div>
                      ) : null}
                      <div className={`text-[10px] mt-1 flex items-center gap-1 ${isCustomer ? 'justify-end text-emerald-100' : 'justify-end text-slate-500'}`}>
                        {formatMessageTime(message.createdAt) ? <span>{formatMessageTime(message.createdAt)}</span> : null}
                        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${isCustomer ? 'bg-emerald-500/30 text-emerald-50' : 'bg-slate-200 text-slate-700'}`}>
                          {message.source}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            <div className="sticky bottom-[calc(6rem+env(safe-area-inset-bottom))] z-20 p-4 border-t border-slate-200 bg-white/95 backdrop-blur-sm space-y-2">
              {replyAttachment ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <p className="text-xs font-semibold text-emerald-800 truncate">
                    Lampiran: {replyAttachment.name}
                  </p>
                  <button
                    onClick={() => setReplyAttachment(null)}
                    className="h-7 w-7 min-h-0 min-w-0 inline-flex items-center justify-center rounded-md border border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                    aria-label="Hapus lampiran"
                    type="button"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : null}

              <div className="flex gap-2">
                <label className="h-10 w-10 min-h-0 min-w-0 shrink-0 cursor-pointer rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 inline-flex items-center justify-center">
                  <Paperclip size={16} className="text-slate-700" />
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => setReplyAttachment(e.target.files?.[0] || null)}
                    disabled={!selectedSessionId || sendingReply}
                    accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.zip,.rar"
                  />
                </label>

                <input
                  value={replyText}
                  onChange={(e) => {
                    if (sendError) setSendError('');
                    setReplyText(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSendReply();
                    }
                  }}
                  placeholder={selectedSessionId ? 'Tulis pesan...' : 'Pilih sesi chat dulu'}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                  disabled={!selectedSessionId || sendingReply}
                />
                <button
                  onClick={() => void handleSendReply()}
                  disabled={!selectedSessionId || (!replyText.trim() && !replyAttachment) || sendingReply}
                  className="inline-flex items-center justify-center gap-2 bg-emerald-600 text-white rounded-xl px-4 py-2 text-sm font-black disabled:opacity-50"
                  type="button"
                >
                  <Send size={14} />
                  {sendingReply ? '...' : 'Kirim'}
                </button>
              </div>

              {sendError ? <p className="text-xs text-rose-600">{sendError}</p> : null}
            </div>
          </div>
        </div>
      </div>

      {zoomImageUrl ? (
        <div
          className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-[2px] p-4 flex items-center justify-center"
          onClick={() => setZoomImageUrl('')}
          role="dialog"
          aria-modal="true"
          aria-label="Preview gambar lampiran"
        >
          <button
            type="button"
            onClick={() => setZoomImageUrl('')}
            className="absolute top-4 right-4 h-10 w-10 min-h-0 min-w-0 rounded-full bg-white/20 border border-white/30 text-white inline-flex items-center justify-center"
            aria-label="Tutup preview"
          >
            <X size={18} />
          </button>
          <img
            src={zoomImageUrl}
            alt="Preview gambar lampiran"
            className="max-w-[95vw] max-h-[90vh] object-contain rounded-xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}
