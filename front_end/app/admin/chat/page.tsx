"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileText, Paperclip, RefreshCw, Search, Star, X } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/lib/api';
import getSocket from '@/lib/socket';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import AdminChatTabs from '@/components/chat/AdminChatTabs';

type ChatSessionRow = {
  id: string;
  platform?: 'web' | 'whatsapp' | string;
  whatsapp_number?: string;
  User?: { name?: string };
  Messages?: Array<{
    body?: string;
    sender_type?: 'customer' | 'admin' | string;
    is_read?: boolean;
  }>;
};

type ChatMessage = {
  id?: string;
  body?: string;
  sender_type?: 'customer' | 'admin' | 'bot' | string;
  attachment_url?: string;
  created_at?: string;
  createdAt?: string;
};

export default function AdminChatInboxPage() {
  const { user, isAuthenticated } = useAuthStore();
  const [sessions, setSessions] = useState<ChatSessionRow[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyAttachment, setReplyAttachment] = useState<File | null>(null);
  const [sendingReply, setSendingReply] = useState(false);
  const [sendError, setSendError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [mobilePanel, setMobilePanel] = useState<'list' | 'chat'>('list');
  const [zoomImageUrl, setZoomImageUrl] = useState<string>('');
  const router = useRouter();

  const getSessionName = (session: ChatSessionRow) =>
    session.User?.name || session.whatsapp_number || 'Guest Web';

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/auth/login');
      return;
    }

    if (user && !['super_admin', 'admin_gudang', 'admin_finance', 'kasir'].includes(user.role)) {
      router.push('/');
      return;
    }

    void loadSessions();

    const socket = getSocket();
    const onChatMessage = (payload: any) => {
      void loadSessions();
      if (payload?.session_id && payload.session_id === selectedSessionId) {
        void loadMessages(payload.session_id);
      }
    };

    socket.on('chat:message', onChatMessage);

    return () => {
      socket.off('chat:message', onChatMessage);
    };
  }, [isAuthenticated, user, router, selectedSessionId]);

  const loadSessions = async () => {
    try {
      setInboxLoading(true);
      const res = await api.chat.getSessions();
      const rows = Array.isArray(res.data?.sessions) ? res.data.sessions : [];
      setSessions(rows);

      const selectedStillExists = rows.some((item: ChatSessionRow) => item.id === selectedSessionId);
      const activeSessionId = selectedStillExists ? selectedSessionId : rows[0]?.id;

      if (activeSessionId) {
        setSelectedSessionId(activeSessionId);
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
  };

  const loadMessages = async (sessionId: string) => {
    try {
      const res = await api.chat.getMessages(sessionId);
      setMessages(Array.isArray(res.data?.messages) ? res.data.messages : []);
      const sessionsRes = await api.chat.getSessions();
      const rows = Array.isArray(sessionsRes.data?.sessions) ? sessionsRes.data.sessions : [];
      setSessions(rows);
    } catch (error) {
      console.error('Error loading chat messages:', error);
    }
  };

  const handleSelectSession = async (sessionId: string) => {
    setSendError('');
    setSelectedSessionId(sessionId);
    setMobilePanel('chat');
    await loadMessages(sessionId);
  };

  const handleSendReply = async () => {
    if (!selectedSessionId) return;
    if (!replyText.trim() && !replyAttachment) return;

    try {
      setSendError('');
      setSendingReply(true);
      await api.chat.replyToChat(selectedSessionId, {
        message: replyText,
        attachment: replyAttachment
      });
      setReplyText('');
      setReplyAttachment(null);
      await loadMessages(selectedSessionId);
      await loadSessions();
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

  const filteredSessions = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) return sessions;

    return sessions.filter((session) => {
      const name = getSessionName(session).toLowerCase();
      const latestMessage = Array.isArray(session.Messages) && session.Messages.length > 0 ? session.Messages[0] : null;
      const preview = latestMessage?.body?.toLowerCase() || '';
      return name.includes(keyword) || preview.includes(keyword);
    });
  }, [sessions, searchQuery]);

  const selectedSession = sessions.find((session) => session.id === selectedSessionId) || null;

  if (!isAuthenticated) return null;

  return (
    <div className="container mx-auto p-4 max-w-7xl py-8 lg:py-10 min-h-[80vh] space-y-4">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 leading-tight">Inbox Web + WhatsApp</h1>
        <p className="text-gray-500 mt-1">Balas pesan customer dari web dan WhatsApp di satu tempat.</p>
      </div>

      <AdminChatTabs />

      <Card className="shadow-xl border border-slate-200 bg-white overflow-hidden">
        <div className="bg-slate-50 py-3 px-6 border-b border-slate-200 flex items-center justify-between">
          <p className="text-xs font-bold text-slate-700 uppercase tracking-widest">Shared Inbox</p>
          <Button variant="ghost" onClick={loadSessions} disabled={inboxLoading} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${inboxLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        <CardContent className="p-0">
          <div className="min-h-[620px] lg:grid lg:grid-cols-[360px_1fr]">
            <div className={`${mobilePanel === 'chat' ? 'hidden lg:flex' : 'flex'} flex-col border-r border-slate-200 bg-slate-50/60`}>
              <div className="p-4 border-b border-slate-200 bg-white/80 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-black text-slate-900">Daftar User</p>
                  <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-slate-200 text-slate-700">
                    {sessions.length} sesi
                  </span>
                </div>
                <div className="relative">
                  <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari user atau isi chat..."
                    className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {filteredSessions.length === 0 ? (
                  <p className="text-sm text-slate-500 p-4">
                    {sessions.length === 0 ? 'Belum ada sesi chat.' : 'Tidak ada hasil yang cocok.'}
                  </p>
                ) : filteredSessions.map((session) => {
                  const latestMessage = Array.isArray(session.Messages) && session.Messages.length > 0 ? session.Messages[0] : null;
                  const lastMessageText = latestMessage?.body === '[Lampiran]'
                    ? 'Lampiran'
                    : (latestMessage?.body || 'Belum ada pesan');
                  const isNew = latestMessage?.sender_type === 'customer' && latestMessage?.is_read === false;
                  const active = selectedSessionId === session.id;
                  return (
                    <button
                      key={session.id}
                      onClick={() => handleSelectSession(session.id)}
                      className={`w-full text-left px-4 py-3 border-b border-slate-200 transition-all active:scale-[0.99] active:brightness-95 ${
                        active ? 'bg-white ring-1 ring-inset ring-emerald-200' : 'hover:bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {isNew && (
                            <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-emerald-500 shadow-sm shadow-emerald-300" />
                          )}
                          <p className="text-sm font-bold text-slate-900 truncate">{getSessionName(session)}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {isNew && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                              <Star size={10} className="fill-current" />
                              Baru
                            </span>
                          )}
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              session.platform === 'web' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            {session.platform || 'web'}
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-slate-600 truncate mt-1">{lastMessageText}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={`${mobilePanel === 'list' ? 'hidden lg:flex' : 'flex'} min-h-[620px] flex-col`}>
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
                        ? `Sesi: ${selectedSession.id} • ${selectedSession.platform || 'web'}`
                        : 'Pilih user dari daftar untuk mulai membalas.'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex-1 p-4 md:p-6 space-y-3 overflow-y-auto bg-gradient-to-b from-white to-slate-50/70">
                {!selectedSessionId ? (
                  <div className="h-full flex items-center justify-center">
                    <p className="text-sm text-slate-500">Pilih user di panel kiri untuk membuka percakapan.</p>
                  </div>
                ) : messages.length === 0 ? (
                  <p className="text-sm text-slate-500">Belum ada pesan di sesi ini.</p>
                ) : messages.map((message, idx) => {
                  const isAdmin = message.sender_type === 'admin';
                  const hasAttachment = !!message.attachment_url;
                  const hasTextBody = !!message.body && message.body !== '[Lampiran]';

                  return (
                    <div key={`${message.id || 'msg'}-${idx}`} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[84%] rounded-2xl px-3 py-2 text-sm ${
                          isAdmin ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-800'
                        }`}
                      >
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
                                className={`inline-flex items-center gap-2 rounded-lg px-2.5 py-2 border text-xs font-semibold ${
                                  isAdmin
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
                        <p className={`text-[10px] mt-1 ${isAdmin ? 'text-emerald-100' : 'text-slate-500'}`}>
                          {message.sender_type}
                          {formatMessageTime(message) ? ` • ${formatMessageTime(message)}` : ''}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="p-4 border-t border-slate-200 bg-white space-y-2">
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
              </div>
              {sendError && (
                <div className="px-4 pb-4 bg-white">
                  <p className="text-xs text-rose-600">{sendError}</p>
                </div>
              )}
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
