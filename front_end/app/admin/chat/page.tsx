"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, FileText, Paperclip, RefreshCw, Search, ShoppingCart, Star, X } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/lib/api';
import getSocket from '@/lib/socket';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import AdminChatTabs from '@/components/chat/AdminChatTabs';

const getPersistApi = () => (useAuthStore as any).persist;

type ChatSessionRow = {
  id: string;
  user_id?: string | null;
  thread_type?: 'staff_dm' | 'staff_customer' | 'support_omni' | 'wa_lead' | string;
  platform?: 'web' | 'whatsapp' | string;
  unread_count?: number;
  whatsapp_number?: string;
  User?: { name?: string };
  Messages?: Array<{
    body?: string;
    attachment_url?: string;
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
  created_via?: 'system' | 'wa_mobile_sync' | 'admin_panel' | string;
  attachment_url?: string;
  created_at?: string;
  createdAt?: string;
  channel?: 'app' | 'whatsapp' | string;
  quoted_message?: {
    id?: string | number;
    body?: string;
    sender_type?: 'customer' | 'admin' | string;
  } | null;
};

type ChatContactRow = {
  id: string;
  name?: string;
  whatsapp_number?: string;
  role?: string;
};

function AdminChatInboxContent() {
  const { user, isAuthenticated } = useAuthStore();
  const [hydrated, setHydrated] = useState(() => {
    const persistApi = getPersistApi();
    return persistApi?.hasHydrated?.() ?? false;
  });
  const [sessions, setSessions] = useState<ChatSessionRow[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyAttachment, setReplyAttachment] = useState<File | null>(null);
  const [sendingReply, setSendingReply] = useState(false);
  const [sendError, setSendError] = useState('');
  const [replyChannel, setReplyChannel] = useState<'app' | 'whatsapp'>('app');
  const [quotedMessage, setQuotedMessage] = useState<ChatMessage | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [contactResults, setContactResults] = useState<ChatContactRow[]>([]);
  const [contactLoading, setContactLoading] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'list' | 'chat'>('list');
  const [zoomImageUrl, setZoomImageUrl] = useState<string>('');
  const router = useRouter();
  const searchParams = useSearchParams();
  const userIdParam = searchParams.get('userId');
  const phoneParam = searchParams.get('phone') || searchParams.get('whatsapp');
  const sessionIdParam = searchParams.get('sessionId') || '';
  const role = user?.role || '';
  const currentUserId = String(user?.id || '').trim();
  const isAppOnlyRole = ['admin_gudang', 'admin_finance', 'driver'].includes(role);
  const canSelectWhatsappChannel = ['super_admin', 'kasir'].includes(role);
  const canSearchInternalContacts = ['super_admin', 'admin_gudang', 'admin_finance', 'kasir', 'driver'].includes(role);

  useEffect(() => {
    const persistApi = getPersistApi();
    if (!persistApi) {
      setHydrated(true);
      return;
    }

    const unsub = persistApi.onFinishHydration?.(() => setHydrated(true));
    setHydrated(persistApi.hasHydrated?.() ?? true);

    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

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

  const doesPhoneMatchKeyword = (phone: string, keyword: string) => {
    const phoneCandidates = getPhoneSearchCandidates(phone);
    const keywordCandidates = getPhoneSearchCandidates(keyword);
    if (!phoneCandidates.length || !keywordCandidates.length) return false;

    return keywordCandidates.some((keywordPart) =>
      phoneCandidates.some((phonePart) => phonePart.includes(keywordPart) || keywordPart.includes(phonePart))
    );
  };

  const getSessionWhatsappNumber = (session: ChatSessionRow) => {
    const raw = (session.whatsapp_number || '').trim();
    if (!raw || raw.startsWith('web-')) return '-';
    return raw;
  };

  const getSessionName = (session: ChatSessionRow) =>
    session.User?.name || session.whatsapp_number || 'Guest Web';

  const getSessionUnreadCount = useCallback((session: ChatSessionRow): number => {
    const unread = Number(session.unread_count || 0);
    if (Number.isFinite(unread) && unread > 0) return unread;

    // Backward compatibility if backend still sends legacy shape without unread_count.
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

  const loadMessages = useCallback(async (sessionId: string) => {
    try {
      const res = await api.chat.getMessages(sessionId);
      setMessages(Array.isArray(res.data?.messages) ? res.data.messages : []);
    } catch (error) {
      console.error('Error loading chat messages:', error);
    }
  }, []);

  const loadSessions = useCallback(async (
    params?: { user_id?: string; platform?: 'web' | 'whatsapp' },
    preferredSessionId?: string
  ) => {
    try {
      setInboxLoading(true);
      const effectiveParams = params || {
        ...(isAppOnlyRole ? { platform: 'web' as const } : {}),
      };
      const res = await api.chat.getSessions(effectiveParams);
      const rows = Array.isArray(res.data?.sessions) ? res.data.sessions : [];
      setSessions(rows);

      const preferredFromUserId = userIdParam
        ? rows.find((item: any) => String(item?.user_id || '') === userIdParam)?.id
        : '';
      const preferredFromSessionId = sessionIdParam
        ? rows.find((item: ChatSessionRow) => String(item.id || '') === sessionIdParam)?.id
        : '';
      const normalizedTargetPhone = normalizeWhatsapp(phoneParam);
      const preferredFromPhone = normalizedTargetPhone
        ? rows.find((item: ChatSessionRow) => normalizeWhatsapp(item.whatsapp_number) === normalizedTargetPhone)?.id
        : '';
      const selectedStillExists = rows.some((item: ChatSessionRow) => item.id === selectedSessionId);
      const keepCurrent = selectedStillExists ? selectedSessionId : '';
      const deepLinkPreferred = keepCurrent ? '' : (preferredFromSessionId || preferredFromUserId || preferredFromPhone);
      const activeSessionId =
        preferredSessionId ||
        keepCurrent ||
        deepLinkPreferred ||
        '';

      if (activeSessionId) {
        if (activeSessionId !== selectedSessionId) {
          setSelectedSessionId(activeSessionId);
        }
        await loadMessages(activeSessionId);
      } else {
        setSelectedSessionId('');
        setMessages([]);
        setMobilePanel('list');
      }
    } catch (error) {
      console.error('Error loading chat sessions:', error);
    } finally {
      setInboxLoading(false);
    }
  }, [isAppOnlyRole, loadMessages, phoneParam, selectedSessionId, sessionIdParam, userIdParam]);

  useEffect(() => {
    if (!hydrated) return;

    if (!isAuthenticated) {
      router.push('/auth/login');
      return;
    }

    if (user && !['super_admin', 'admin_gudang', 'admin_finance', 'kasir', 'driver'].includes(user.role)) {
      router.push('/');
      return;
    }

    const initialParams: { user_id?: string; platform?: 'web' | 'whatsapp' } = {
      ...(isAppOnlyRole ? { platform: 'web' as const } : {}),
      ...(userIdParam ? { user_id: userIdParam } : {}),
    };
    void loadSessions(
      Object.keys(initialParams).length > 0 ? initialParams : undefined
    );

    const socket = getSocket();
    const onChatMessage = (payload: any) => {
      if (payload?.session_id && payload.session_id === selectedSessionId) {
        void loadMessages(payload.session_id);
      }
      void loadSessions();
    };

    socket.on('chat:message', onChatMessage);

    return () => {
      socket.off('chat:message', onChatMessage);
    };
  }, [hydrated, isAuthenticated, user, router, selectedSessionId, loadSessions, loadMessages, isAppOnlyRole, userIdParam]);

  useEffect(() => {
    if (!isAuthenticated || !canSearchInternalContacts) {
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
        console.error('Error searching app chat contacts:', error);
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
  }, [isAuthenticated, canSearchInternalContacts, searchQuery]);

  const handleSelectSession = async (sessionId: string) => {
    setSendError('');
    setQuotedMessage(null);
    setReplyChannel('app');
    setSelectedSessionId(sessionId);
    setMobilePanel('chat');
    await loadSessions(undefined, sessionId);
  };

  const handleSelectContact = async (contact: ChatContactRow) => {
    setSendError('');
    setQuotedMessage(null);
    setSearchQuery('');
    const res = await api.chat.getSessions({
      user_id: contact.id,
      platform: 'web',
    });
    const rows = Array.isArray(res.data?.sessions) ? res.data.sessions : [];
    const targetSessionId = rows[0]?.id ? String(rows[0].id) : '';
    await loadSessions(undefined, targetSessionId || undefined);
    setMobilePanel('chat');
  };

  const handleSendReply = async () => {
    if (!selectedSessionId) return;
    if (!replyText.trim() && !replyAttachment) return;

    try {
      setSendError('');
      setSendingReply(true);
      await api.chat.sendThreadMessage(selectedSessionId, {
        message: replyText,
        attachment: replyAttachment,
        quoted_message_id: quotedMessage?.id ? String(quotedMessage.id) : undefined,
        channel: canUseSelectedSessionWhatsapp ? replyChannel : undefined
      });
      setReplyText('');
      setReplyAttachment(null);
      setQuotedMessage(null);
      await loadMessages(selectedSessionId);
      await loadSessions(undefined, selectedSessionId);
    } catch (error: any) {
      const apiMessage = error?.response?.data?.message;
      setSendError(apiMessage || 'Gagal mengirim balasan.');
      console.error('Error sending reply:', error);
    } finally {
      setSendingReply(false);
    }
  };

  const isImageAttachment = (attachmentUrl?: string) => {
    if (!attachmentUrl) return false;
    return /\.(png|jpe?g|webp|gif)$/i.test(attachmentUrl);
  };

  const formatMessageTime = (message: ChatMessage) => {
    const value = message.created_at || message.createdAt;
    if (!value) return '';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    return new Intl.DateTimeFormat('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const getSourceTag = (message: ChatMessage) => {
    if (message.sender_type !== 'customer') return '';
    return message.created_via === 'wa_mobile_sync' ? 'WA' : 'WEB';
  };

  const filteredSessions = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) return sessions;

    return sessions.filter((session) => {
      const name = getSessionName(session).toLowerCase();
      const whatsappNumber = getSessionWhatsappNumber(session);
      const latestMessage = Array.isArray(session.Messages) && session.Messages.length > 0 ? session.Messages[0] : null;
      const preview = latestMessage?.body?.toLowerCase() || '';
      return (
        name.includes(keyword) ||
        preview.includes(keyword) ||
        doesPhoneMatchKeyword(whatsappNumber, keyword)
      );
    });
  }, [sessions, searchQuery, doesPhoneMatchKeyword]);

  const unreadSessionCount = useMemo(
    () => sessions.filter((session) => getSessionUnreadCount(session) > 0).length,
    [sessions, getSessionUnreadCount]
  );

  const selectedSession = sessions.find((session) => session.id === selectedSessionId) || null;
  const selectedSessionCustomerId = String(selectedSession?.user_id || '').trim();
  const selectedSessionIsCustomerContext = selectedSession
    ? String(selectedSession.thread_type || '') === 'support_omni'
    : false;
  const canUseSelectedSessionWhatsapp = canSelectWhatsappChannel && (
    selectedSession?.thread_type === 'support_omni' || selectedSession?.thread_type === 'wa_lead'
  );
  const canCreateOrderFromChat =
    ['super_admin', 'kasir'].includes(role) &&
    selectedSessionIsCustomerContext &&
    !!selectedSessionCustomerId;

  const handleOpenManualOrderFromChat = () => {
    if (!selectedSession?.id || !selectedSessionCustomerId) return;
    const url = `/admin/orders/create?customerId=${encodeURIComponent(selectedSessionCustomerId)}&chatSessionId=${encodeURIComponent(selectedSession.id)}`;
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  if (!hydrated || !isAuthenticated) return null;

  return (
    <div className="container mx-auto p-4 max-w-7xl pt-8 lg:pt-10 pb-0 -mb-24 min-h-[80vh] space-y-4">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 leading-tight">{isAppOnlyRole ? 'Inbox Chat Aplikasi' : 'Inbox Web + WhatsApp'}</h1>
        <p className="text-gray-500 mt-1">
          {isAppOnlyRole ? 'Balas pesan antar akun aplikasi tanpa kanal WhatsApp.' : 'Balas pesan customer dari web dan WhatsApp di satu tempat.'}
        </p>
      </div>

      <AdminChatTabs />

      <Card className="shadow-xl border border-slate-200 bg-white overflow-visible">
        <div className="bg-slate-50 py-3 px-6 border-b border-slate-200 flex items-center justify-between">
          <p className="text-xs font-bold text-slate-700 uppercase tracking-widest">Shared Inbox</p>
          <Button variant="ghost" onClick={() => loadSessions()} disabled={inboxLoading} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${inboxLoading ? 'animate-spin' : ''}`} />
            Refresh / Reset
          </Button>
        </div>

        <CardContent className="p-0">
          <div className="min-h-[620px] lg:grid lg:grid-cols-[360px_1fr]">
            <div className={`${mobilePanel === 'chat' ? 'hidden lg:flex' : 'flex'} flex-col border-r border-slate-200 bg-slate-50/60`}>
              <div className="p-4 border-b border-slate-200 bg-white/80 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-black text-slate-900">Daftar User</p>
                  <div className="flex items-center gap-2">
                    {unreadSessionCount > 0 && (
                      <span className="text-[11px] font-black px-2 py-1 rounded-full bg-rose-100 text-rose-700">
                        {unreadSessionCount} belum dibalas
                      </span>
                    )}
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
                    placeholder={canSearchInternalContacts ? 'Cari nama admin/driver atau nomor...' : 'Cari user atau isi chat...'}
                    className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {canSearchInternalContacts && searchQuery.trim().length >= 2 && (
                  <div className="border-b border-slate-200 bg-white/70">
                    <p className="px-4 pt-3 pb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Kontak Internal
                    </p>
                    {contactLoading ? (
                      <p className="px-4 pb-3 text-xs text-slate-500">Mencari akun...</p>
                    ) : contactResults.length === 0 ? (
                      <p className="px-4 pb-3 text-xs text-slate-500">Nama/nomor tidak ditemukan.</p>
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
                    {sessions.length === 0 ? 'Belum ada sesi chat.' : 'Tidak ada hasil yang cocok.'}
                  </p>
                ) : filteredSessions.map((session) => {
                  const latestMessage = Array.isArray(session.Messages) && session.Messages.length > 0 ? session.Messages[0] : null;
                  const lastMessageText = latestMessage?.body === '[Lampiran]'
                    ? 'Lampiran'
                    : (latestMessage?.body || 'Belum ada pesan');
                  const unreadCount = getSessionUnreadCount(session);
                  const isNew = unreadCount > 0;
                  const active = selectedSessionId === session.id;
                  return (
                    <button
                      key={session.id}
                      onClick={() => handleSelectSession(session.id)}
                      className={`w-full text-left px-4 py-3 border-b border-slate-200 transition-all active:scale-[0.99] active:brightness-95 ${active ? 'bg-white ring-1 ring-inset ring-emerald-200' : 'hover:bg-white'
                        } ${isNew && !active ? 'bg-rose-50/60 border-l-4 border-l-rose-400' : ''
                        }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {isNew && (
                            <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-emerald-500 shadow-sm shadow-emerald-300" />
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-900 truncate">{getSessionName(session)}</p>
                            <p className="text-[11px] text-slate-500 truncate">{getSessionWhatsappNumber(session)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {isNew && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
                              <Star size={10} className="fill-current" />
                              Belum dibalas
                              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-rose-600 text-white text-[9px] leading-none">
                                {unreadCount > 99 ? '99+' : unreadCount}
                              </span>
                            </span>
                          )}
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${session.platform === 'web' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                              }`}
                          >
                            {session.platform || 'web'}
                          </span>
                        </div>
                      </div>
                      <p className={`text-xs truncate mt-1 ${isNew ? 'text-rose-700 font-semibold' : 'text-slate-600'}`}>
                        {lastMessageText}
                      </p>
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
                      {selectedSession ? getSessionName(selectedSession) : 'Percakapan'}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {selectedSession
                        ? `WA: ${getSessionWhatsappNumber(selectedSession)} • ${selectedSession.platform || 'web'}`
                        : 'Pilih user dari daftar untuk mulai membalas.'}
                    </p>
                  </div>
                </div>
                {['super_admin', 'kasir'].includes(role) && selectedSessionId ? (
                  canCreateOrderFromChat ? (
                    <button
                      type="button"
                      onClick={handleOpenManualOrderFromChat}
                      className="inline-flex items-center gap-2 shrink-0 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-100"
                    >
                      <ShoppingCart size={14} />
                      Buat Order
                    </button>
                  ) : (
                    <span className="shrink-0 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700">
                      Sesi ini belum terhubung akun customer terdaftar
                    </span>
                  )
                ) : null}
              </div>

              <div className="flex-1 p-4 md:p-6 pb-28 md:pb-32 space-y-3 overflow-y-auto bg-gradient-to-b from-white to-slate-50/70">
                {!selectedSessionId ? (
                  <div className="h-full flex items-center justify-center">
                    <p className="text-sm text-slate-500">Pilih user di panel kiri untuk membuka percakapan.</p>
                  </div>
                ) : messages.length === 0 ? (
                  <p className="text-sm text-slate-500">Belum ada pesan di sesi ini.</p>
                ) : messages.map((message, idx) => {
                  const senderId = String(message.sender_id || '').trim();
                  const isOwnMessage = senderId
                    ? senderId === currentUserId
                    : message.sender_type === 'admin';
                  const hasAttachment = !!message.attachment_url;
                  const hasTextBody = !!message.body && message.body !== '[Lampiran]';
                  const sourceTag = getSourceTag(message);

                  return (
                    <div key={`${message.id || 'msg'}-${idx}`} className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                      <div
                        onDoubleClick={() => {
                          if (!message.id) return;
                          setQuotedMessage(message);
                        }}
                        className={`max-w-[84%] rounded-2xl px-3 py-2 text-sm ${isOwnMessage ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-800'
                          }`}
                      >
                        {message.quoted_message?.id ? (
                          <div className={`mb-2 rounded-lg border px-2 py-1 text-[11px] ${isOwnMessage ? 'border-emerald-300/60 bg-emerald-500/30 text-emerald-50' : 'border-slate-300 bg-white/80 text-slate-600'}`}>
                            <p className="font-semibold">
                              {message.quoted_message.sender_type === 'admin' ? 'Admin' : 'Customer'}
                            </p>
                            <p className="truncate">{message.quoted_message.body || '[Pesan]'}</p>
                          </div>
                        ) : null}
                        {hasTextBody && (
                          <p className="whitespace-pre-wrap break-words">{message.body}</p>
                        )}
                        {hasAttachment && (
                          <div className={hasTextBody ? 'mt-2' : ''}>
                            {isImageAttachment(message.attachment_url) ? (
                              <button
                                type="button"
                                onClick={() => setZoomImageUrl(message.attachment_url || '')}
                                className="block rounded-lg overflow-hidden"
                                aria-label="Perbesar gambar lampiran"
                              >
                                <img
                                  src={message.attachment_url}
                                  alt="Lampiran chat"
                                  className="max-h-44 max-w-[220px] rounded-lg border border-black/10 object-cover"
                                />
                              </button>
                            ) : (
                              <a
                                href={message.attachment_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`inline-flex items-center gap-2 rounded-lg px-2.5 py-2 border text-xs font-semibold ${isOwnMessage
                                  ? 'border-emerald-300/70 bg-emerald-500/30 text-white'
                                  : 'border-slate-300 bg-white text-slate-700'
                                  }`}
                              >
                                <FileText size={14} />
                                Lihat lampiran
                              </a>
                            )}
                          </div>
                        )}
                        <div className={`text-[10px] mt-1 flex items-center gap-1 ${isOwnMessage ? 'justify-end text-emerald-100' : 'justify-end text-slate-500'}`}>
                          {formatMessageTime(message) ? <span>{formatMessageTime(message)}</span> : null}
                          {sourceTag ? (
                            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${isOwnMessage ? 'bg-emerald-500/30 text-emerald-50' : 'bg-slate-200 text-slate-700'}`}>
                              {sourceTag}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 p-4 border-t border-slate-200 bg-white/95 backdrop-blur-sm space-y-2">
                {quotedMessage ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-blue-800">
                        Membalas {quotedMessage.sender_type === 'admin' ? 'Admin' : 'Customer'}
                      </p>
                      <p className="text-xs text-blue-700 truncate">
                        {quotedMessage.body || '[Lampiran]'}
                      </p>
                    </div>
                    <button
                      onClick={() => setQuotedMessage(null)}
                      className="h-7 w-7 min-h-0 min-w-0 inline-flex items-center justify-center rounded-md border border-blue-300 text-blue-700 hover:bg-blue-100"
                      aria-label="Hapus kutipan balasan"
                      type="button"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : null}

                {replyAttachment && (
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
                )}

                <div className="flex gap-2">
                  {canSelectWhatsappChannel ? (
                    <select
                      value={replyChannel}
                      onChange={(e) => setReplyChannel(e.target.value as 'app' | 'whatsapp')}
                      className="shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-700"
                      disabled={!selectedSessionId || sendingReply}
                    >
                      <option value="app">APP</option>
                      <option value="whatsapp" disabled={!canUseSelectedSessionWhatsapp}>WA</option>
                    </select>
                  ) : null}
                  <label className="h-10 w-10 min-h-0 min-w-0 shrink-0 cursor-pointer rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 inline-flex items-center justify-center">
                    <Paperclip size={16} className="text-slate-700" />
                    <input
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const selectedFile = e.target.files?.[0] || null;
                        setReplyAttachment(selectedFile);
                      }}
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
                    placeholder={selectedSessionId ? 'Tulis balasan...' : 'Pilih sesi chat dulu'}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                    disabled={!selectedSessionId || sendingReply}
                  />
                  <Button
                    onClick={handleSendReply}
                    disabled={!selectedSessionId || (!replyText.trim() && !replyAttachment) || sendingReply}
                  >
                    {sendingReply ? 'Mengirim...' : 'Kirim'}
                  </Button>
                </div>
                {sendError ? (
                  <p className="text-xs text-rose-600">{sendError}</p>
                ) : null}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {zoomImageUrl && (
        <div
          className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-[2px] p-4 flex items-center justify-center"
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
      )}
    </div>
  );
}

export default function AdminChatInboxPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading chat...</div>}>
      <AdminChatInboxContent />
    </Suspense>
  );
}
