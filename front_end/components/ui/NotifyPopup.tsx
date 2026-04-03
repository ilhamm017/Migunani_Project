'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

export type NotifyPopupVariant = 'success' | 'warning' | 'error' | 'info';

type Props = {
  open: boolean;
  title: string;
  message?: ReactNode;
  prompt?: {
    placeholder?: string;
    initialValue?: string;
    inputLabel?: string;
  };
  variant?: NotifyPopupVariant;
  primaryLabel?: string;
  secondaryLabel?: string;
  onPrimary?: () => void;
  onPrimaryValue?: (value: string) => void;
  onSecondary?: () => void;
  onClose: () => void;
};

const VARIANT_META: Record<NotifyPopupVariant, { icon: typeof CheckCircle2; tone: string; badge: string }> = {
  success: { icon: CheckCircle2, tone: 'border-emerald-200 bg-emerald-50', badge: 'text-emerald-700 bg-emerald-100' },
  warning: { icon: AlertTriangle, tone: 'border-amber-200 bg-amber-50', badge: 'text-amber-700 bg-amber-100' },
  error: { icon: XCircle, tone: 'border-rose-200 bg-rose-50', badge: 'text-rose-700 bg-rose-100' },
  info: { icon: Info, tone: 'border-sky-200 bg-sky-50', badge: 'text-sky-700 bg-sky-100' },
};

export default function NotifyPopup({
  open,
  title,
  message,
  prompt,
  variant = 'info',
  primaryLabel = 'OK',
  secondaryLabel,
  onPrimary,
  onPrimaryValue,
  onSecondary,
  onClose,
}: Props) {
  const [promptValue, setPromptValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Enter' && prompt) {
        event.preventDefault();
        if (onPrimaryValue) {
          onPrimaryValue(promptValue);
          onClose();
          return;
        }
        onPrimary?.();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, onPrimary, onPrimaryValue, open, prompt, promptValue]);

  useEffect(() => {
    if (!open) return;
    const initial = String(prompt?.initialValue ?? '').trim();
    setPromptValue(initial);
  }, [open, prompt?.initialValue]);

  useEffect(() => {
    if (!open) return;
    if (!prompt) return;
    queueMicrotask(() => inputRef.current?.focus());
  }, [open, prompt]);

  if (!open) return null;
  const meta = VARIANT_META[variant];
  const Icon = meta.icon;
  const resolvedLabel = String(prompt?.inputLabel || '').trim();

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className={`w-full max-w-sm rounded-3xl border p-4 shadow-2xl ${meta.tone}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-2xl ${meta.badge}`}>
              <Icon size={18} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Notifikasi</p>
              <h3 className="mt-1 text-base font-black text-slate-900">{title}</h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/60 text-slate-600 hover:bg-white"
            aria-label="Tutup"
          >
            <X size={16} />
          </button>
        </div>

        {message ? (
          <div className="mt-3 rounded-2xl bg-white/70 p-3 text-sm font-semibold text-slate-700">
            {message}
          </div>
        ) : null}

        {prompt ? (
          <div className="mt-3 space-y-2 rounded-2xl bg-white/70 p-3">
            {resolvedLabel ? (
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{resolvedLabel}</p>
            ) : null}
            <input
              ref={inputRef}
              type="text"
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              placeholder={prompt.placeholder || ''}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-emerald-300"
            />
          </div>
        ) : null}

        <div className="mt-4 flex gap-2">
          {secondaryLabel ? (
            <button
              type="button"
              onClick={() => {
                onSecondary?.();
                onClose();
              }}
              className="flex-1 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-50"
            >
              {secondaryLabel}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (prompt && onPrimaryValue) {
                onPrimaryValue(promptValue);
              } else {
                onPrimary?.();
              }
              onClose();
            }}
            className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-black"
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
