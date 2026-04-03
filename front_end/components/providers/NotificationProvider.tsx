'use client';

import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import NotifyPopup from '@/components/ui/NotifyPopup';
import {
  notifyClose,
  notifyConfirm,
  notifyError,
  notifyFromAlertMessage,
  notifyInfo,
  notifyOpen,
  notifyPrompt,
  notifySuccess,
  notifyWarning,
  type NotifyOpenOptions,
} from '@/lib/notify';

type NotifyApi = {
  open: (options: NotifyOpenOptions) => void;
  close: () => void;
  success: (message: ReactNode, title?: string, autoCloseMs?: number) => void;
  error: (message: ReactNode, title?: string) => void;
  warning: (message: ReactNode, title?: string) => void;
  info: (message: ReactNode, title?: string, autoCloseMs?: number) => void;
  confirm: (options: Parameters<typeof notifyConfirm>[0]) => Promise<boolean>;
  prompt: (options: Parameters<typeof notifyPrompt>[0]) => Promise<string | null>;
  fromAlertMessage: (message: unknown) => void;
};

const NotifyContext = createContext<NotifyApi | null>(null);

type ActivePopup = NotifyOpenOptions & { variant: NonNullable<NotifyOpenOptions['variant']> };

const toActivePopup = (options: NotifyOpenOptions): ActivePopup => ({
  variant: options.variant ?? 'info',
  ...options,
});

export function useNotify(): NotifyApi {
  const ctx = useContext(NotifyContext);
  if (ctx) return ctx;
  return {
    open: notifyOpen,
    close: notifyClose,
    success: notifySuccess,
    error: notifyError,
    warning: notifyWarning,
    info: notifyInfo,
    confirm: notifyConfirm,
    prompt: notifyPrompt,
    fromAlertMessage: notifyFromAlertMessage,
  };
}

export default function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(
    (
      prev: { active: ActivePopup | null; queue: ActivePopup[] },
      action:
        | { type: 'OPEN'; payload: ActivePopup }
        | { type: 'CLOSE' }
        | { type: 'SHIFT' },
    ) => {
      if (action.type === 'OPEN') {
        if (!prev.active) return { ...prev, active: action.payload };
        return { ...prev, queue: [...prev.queue, action.payload] };
      }
      if (action.type === 'CLOSE') {
        return { ...prev, active: null };
      }
      if (action.type === 'SHIFT') {
        if (prev.active) return prev;
        if (prev.queue.length === 0) return prev;
        const [next, ...rest] = prev.queue;
        return { active: next, queue: rest };
      }
      return prev;
    },
    { active: null, queue: [] },
  );
  const autoCloseTimerRef = useRef<number | null>(null);
  const active = state.active;
  const queue = state.queue;

  const clearAutoCloseTimer = useCallback(() => {
    if (autoCloseTimerRef.current) {
      window.clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
    clearAutoCloseTimer();
    active?.onClose?.();
    dispatch({ type: 'CLOSE' });
  }, [active, clearAutoCloseTimer]);

  const open = useCallback((options: NotifyOpenOptions) => {
    const next = toActivePopup(options);
    dispatch({ type: 'OPEN', payload: next });
  }, []);

  useEffect(() => {
    if (active || queue.length === 0) return;
    dispatch({ type: 'SHIFT' });
  }, [active, queue]);

  useEffect(() => {
    clearAutoCloseTimer();
    if (!active) return;
    const ttl = Number(active.autoCloseMs || 0);
    if (!Number.isFinite(ttl) || ttl <= 0) return;
    autoCloseTimerRef.current = window.setTimeout(() => close(), ttl);
  }, [active, clearAutoCloseTimer, close]);

  useEffect(() => {
    const onNotify = (event: Event) => {
      const detail = (event as CustomEvent<NotifyOpenOptions>).detail;
      if (!detail || typeof detail !== 'object') return;
      open(detail);
    };
    const onClose = () => close();

    window.addEventListener('app:notify', onNotify as EventListener);
    window.addEventListener('app:notify:close', onClose);
    return () => {
      window.removeEventListener('app:notify', onNotify as EventListener);
      window.removeEventListener('app:notify:close', onClose);
    };
  }, [close, open]);

  const api = useMemo<NotifyApi>(
    () => ({
      open,
      close,
      success: notifySuccess,
      error: notifyError,
      warning: notifyWarning,
      info: notifyInfo,
      confirm: notifyConfirm,
      prompt: notifyPrompt,
      fromAlertMessage: notifyFromAlertMessage,
    }),
    [close, open],
  );

  return (
    <NotifyContext.Provider value={api}>
      {children}
      <NotifyPopup
        open={Boolean(active)}
        title={active?.title || ''}
        message={active?.message}
        prompt={active?.prompt}
        variant={active?.variant || 'info'}
        primaryLabel={active?.primaryLabel}
        secondaryLabel={active?.secondaryLabel}
        onPrimary={active?.onPrimary}
        onPrimaryValue={active?.onPrimaryValue}
        onSecondary={active?.onSecondary}
        onClose={close}
      />
    </NotifyContext.Provider>
  );
}
