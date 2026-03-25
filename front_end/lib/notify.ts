'use client';

import type { ReactNode } from 'react';

export type NotifyVariant = 'success' | 'warning' | 'error' | 'info';

export type NotifyOpenOptions = {
  variant?: NotifyVariant;
  title: string;
  message?: ReactNode;
  primaryLabel?: string;
  secondaryLabel?: string;
  onPrimary?: () => void;
  onSecondary?: () => void;
  autoCloseMs?: number;
};

const NOTIFY_EVENT = 'app:notify';
const NOTIFY_CLOSE_EVENT = 'app:notify:close';

export const emitNotify = (options: NotifyOpenOptions) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NOTIFY_EVENT, { detail: options }));
};

export const notifyClose = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(NOTIFY_CLOSE_EVENT));
};

export const notifyOpen = (options: NotifyOpenOptions) => emitNotify(options);

export const notifySuccess = (message: ReactNode, title = 'Berhasil', autoCloseMs?: number) =>
  emitNotify({ variant: 'success', title, message, ...(autoCloseMs ? { autoCloseMs } : {}) });

export const notifyError = (message: ReactNode, title = 'Gagal') =>
  emitNotify({ variant: 'error', title, message });

export const notifyWarning = (message: ReactNode, title = 'Perhatian') =>
  emitNotify({ variant: 'warning', title, message });

export const notifyInfo = (message: ReactNode, title = 'Info', autoCloseMs?: number) =>
  emitNotify({ variant: 'info', title, message, ...(autoCloseMs ? { autoCloseMs } : {}) });

const classifyAlertVariant = (message: string): NotifyVariant => {
  const normalized = message.toLowerCase();
  if (/\bberhasil\b/.test(normalized)) return 'success';
  if (/(wajib|pilih|minimal|tidak diizinkan|tidak boleh)/.test(normalized)) return 'warning';
  return 'error';
};

export const notifyFromAlertMessage = (messageRaw: unknown) => {
  const message = String(messageRaw ?? '').trim();
  if (!message) return;

  const variant = classifyAlertVariant(message);
  const title = variant === 'success' ? 'Berhasil' : variant === 'warning' ? 'Perhatian' : 'Gagal';
  emitNotify({ variant, title, message });
};

export const notifyAlert = notifyFromAlertMessage;
