'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { FileText, Paperclip, Send, X } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import getSocket from '@/lib/socket';
import { api } from '@/lib/api';

type ChatEventPayload = {
  session_id?: string;
  sender?: 'customer' | 'admin' | 'bot';
  body?: string;
  attachment_url?: string;
  timestamp?: string;
};

type LocalChatMessage = {
  id: string;
  sender: 'customer' | 'admin';
  body: string;
  attachmentUrl?: string;
};

type WebHistoryMessage = {
  id?: string | number;
  body?: string;
  attachment_url?: string;
  sender_type?: 'customer' | 'admin' | 'bot' | string;
};

const SESSION_KEY = 'web_chat_session_id';
const GUEST_KEY = 'web_chat_guest_id';
const ATTACHMENT_FALLBACK_BODY = '[Lampiran]';

const isImageAttachment = (attachmentUrl?: string) => {
  if (!attachmentUrl) return false;
  return /\.(png|jpe?g|webp|gif)$/i.test(attachmentUrl);
};

export default function WebChatWidget() {
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const previousAuthUserIdRef = useRef<string | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [guestId, setGuestId] = useState('');
  const [messages, setMessages] = useState<LocalChatMessage[]>([]);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sendError, setSendError] = useState('');
  const [zoomImageUrl, setZoomImageUrl] = useState('');

  const hidden = useMemo(() => {
    return pathname?.startsWith('/admin') || pathname?.startsWith('/auth');
  }, [pathname]);

  useEffect(() => {
    if (hidden && open) {
      setOpen(false);
    }
  }, [hidden, open]);

  useEffect(() => {
    const currentUserId = user?.id || null;
    if (previousAuthUserIdRef.current === undefined) {
      previousAuthUserIdRef.current = currentUserId;
      return;
    }

    if (previousAuthUserIdRef.current !== currentUserId) {
      setOpen(false);
      setMessages([]);
      setSessionId('');
      setAttachment(null);
      setSendError('');
      setHistoryLoading(false);

      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(SESSION_KEY);

        if (!currentUserId) {
          const nextGuestId = `guest-${Math.random().toString(36).slice(2, 10)}`;
          window.localStorage.setItem(GUEST_KEY, nextGuestId);
          setGuestId(nextGuestId);
        }
      }
    }

    previousAuthUserIdRef.current = currentUserId;
  }, [user?.id]);

  useEffect(() => {
    if (hidden || typeof window === 'undefined') return;

    const savedSession = window.localStorage.getItem(SESSION_KEY) || '';
    const savedGuest = window.localStorage.getItem(GUEST_KEY) || `guest-${Math.random().toString(36).slice(2, 10)}`;
    if (!window.localStorage.getItem(GUEST_KEY)) {
      window.localStorage.setItem(GUEST_KEY, savedGuest);
    }

    setSessionId(savedSession);
    setGuestId(savedGuest);

    const socket = getSocket();

    const onSession = (payload: { session_id?: string }) => {
      if (!payload?.session_id) return;
      setSessionId(payload.session_id);
      window.localStorage.setItem(SESSION_KEY, payload.session_id);
    };

    const onChatMessage = (payload: ChatEventPayload) => {
      if (!payload?.session_id || !sessionId) return;
      if (payload.session_id !== sessionId) return;
      if (payload.sender !== 'admin') return;
      if (!payload.body && !payload.attachment_url) return;

      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          sender: 'admin',
          body: payload.body || '',
          attachmentUrl: payload.attachment_url,
        }
      ]);
    };

    socket.on('client:session', onSession);
    socket.on('chat:message', onChatMessage);

    return () => {
      socket.off('client:session', onSession);
      socket.off('chat:message', onChatMessage);
    };
  }, [hidden, sessionId]);

  useEffect(() => {
    if (hidden || typeof window === 'undefined') return;

    const onToggle = () => setOpen((prev) => !prev);
    const onOpen = () => setOpen(true);
    const onClose = () => setOpen(false);

    window.addEventListener('webchat:toggle', onToggle as EventListener);
    window.addEventListener('webchat:open', onOpen as EventListener);
    window.addEventListener('webchat:close', onClose as EventListener);

    return () => {
      window.removeEventListener('webchat:toggle', onToggle as EventListener);
      window.removeEventListener('webchat:open', onOpen as EventListener);
      window.removeEventListener('webchat:close', onClose as EventListener);
    };
  }, [hidden]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('webchat:state', {
        detail: { open: !hidden && open },
      })
    );
  }, [open, hidden]);

  useEffect(() => {
    if (hidden || !sessionId) return;

    let isMounted = true;
    const loadHistory = async () => {
      try {
        setHistoryLoading(true);
        const res = await api.chat.getWebMessages(sessionId, guestId, user?.id);
        const rows: WebHistoryMessage[] = Array.isArray(res.data?.messages) ? res.data.messages : [];
        const mapped: LocalChatMessage[] = rows
          .filter((row) => row.sender_type === 'customer' || row.sender_type === 'admin')
          .map((row, index) => ({
            id: row.id ? String(row.id) : `hist-${index}`,
            sender: row.sender_type === 'admin' ? 'admin' : 'customer',
            body: row.body || '',
            attachmentUrl: row.attachment_url,
          }));

        if (isMounted) {
          setMessages(mapped);
        }
      } catch (error: any) {
        const status = Number(error?.response?.status || 0);
        if (status === 403 || status === 404) {
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem(SESSION_KEY);
          }
          if (isMounted) {
            setSessionId('');
            setMessages([]);
          }
        } else {
          console.error('Error loading web chat history:', error);
        }
      } finally {
        if (isMounted) {
          setHistoryLoading(false);
        }
      }
    };

    void loadHistory();

    return () => {
      isMounted = false;
    };
  }, [hidden, sessionId, guestId, user?.id]);

  if (hidden) return null;

  const sendMessage = async () => {
    const text = input.trim();
    if (!text && !attachment) return;

    try {
      setSending(true);
      setSendError('');

      let uploadedAttachmentUrl: string | undefined;
      if (attachment) {
        const uploadRes = await api.chat.uploadWebAttachment(attachment);
        uploadedAttachmentUrl = uploadRes.data?.attachment_url;
        if (!uploadedAttachmentUrl) {
          throw new Error('Lampiran gagal diunggah.');
        }
      }

      const socket = getSocket();
      socket.emit('client:message', {
        session_id: sessionId || undefined,
        guest_id: guestId || undefined,
        user_id: user?.id || undefined,
        whatsapp_number: user?.phone || undefined,
        message: text || undefined,
        attachment_url: uploadedAttachmentUrl,
      });

      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          sender: 'customer',
          body: text || ATTACHMENT_FALLBACK_BODY,
          attachmentUrl: uploadedAttachmentUrl,
        }
      ]);

      setInput('');
      setAttachment(null);
    } catch (error: any) {
      const apiMessage = error?.response?.data?.message;
      setSendError(apiMessage || 'Gagal mengirim pesan.');
      console.error('Error sending web chat message:', error);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed right-4 bottom-28 z-50">
      {open && (
        <div className="w-80 bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden mb-3">
          <div className="bg-emerald-600 text-white px-4 py-3 flex items-center justify-between">
            <p className="text-sm font-bold">Chat Bantuan</p>
            <button onClick={() => setOpen(false)} className="text-white/90 hover:text-white">
              <X size={16} />
            </button>
          </div>

          <div className="h-64 overflow-auto p-3 bg-slate-50 space-y-2">
            {historyLoading && messages.length === 0 ? (
              <p className="text-xs text-slate-500">Memuat riwayat chat...</p>
            ) : messages.length === 0 ? (
              <p className="text-xs text-slate-500">Halo, ada yang bisa kami bantu?</p>
            ) : messages.map((message) => {
              const isCustomer = message.sender === 'customer';
              const hasAttachment = !!message.attachmentUrl;
              const hasText = !!message.body && message.body !== ATTACHMENT_FALLBACK_BODY;

              return (
                <div key={message.id} className={`flex ${isCustomer ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[82%] rounded-xl px-3 py-2 text-xs ${isCustomer ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-800'}`}>
                    {hasText && (
                      <p className="whitespace-pre-wrap break-words">{message.body}</p>
                    )}
                    {hasAttachment && (
                      <div className={hasText ? 'mt-2' : ''}>
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
                              className="max-h-40 max-w-[190px] rounded-lg border border-black/10 object-cover"
                            />
                          </button>
                        ) : (
                          <a
                            href={message.attachmentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${
                              isCustomer ? 'bg-emerald-500/40 text-white' : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            <FileText size={12} />
                            Lihat lampiran
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-3 border-t border-slate-200 space-y-2">
            {attachment && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5">
                <p className="text-[11px] font-semibold text-emerald-800 truncate">{attachment.name}</p>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  className="h-6 w-6 min-h-0 min-w-0 inline-flex items-center justify-center rounded-md border border-emerald-300 text-emerald-700"
                  aria-label="Hapus lampiran"
                >
                  <X size={12} />
                </button>
              </div>
            )}

            <div className="flex gap-2">
              <label className="h-9 w-9 min-h-0 min-w-0 cursor-pointer rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 inline-flex items-center justify-center shrink-0">
                <Paperclip size={14} className="text-slate-700" />
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const selected = e.target.files?.[0] || null;
                    if (sendError) setSendError('');
                    setAttachment(selected);
                  }}
                  disabled={sending}
                  accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.zip,.rar"
                />
              </label>

              <input
                value={input}
                onChange={(e) => {
                  if (sendError) setSendError('');
                  setInput(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder="Tulis pesan..."
                className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs"
                disabled={sending}
              />
              <button
                onClick={() => void sendMessage()}
                disabled={sending || (!input.trim() && !attachment)}
                className="px-3 py-2 bg-emerald-600 text-white rounded-lg disabled:opacity-50"
                type="button"
              >
                <Send size={14} />
              </button>
            </div>

            {sendError && (
              <p className="text-[11px] text-rose-600">{sendError}</p>
            )}
          </div>
        </div>
      )}

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
