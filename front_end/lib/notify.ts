'use client';

import type { ReactNode } from 'react';

export type NotifyVariant = 'success' | 'warning' | 'error' | 'info';

export type NotifyOpenOptions = {
  variant?: NotifyVariant;
  title: string;
  message?: ReactNode;
  prompt?: {
    placeholder?: string;
    initialValue?: string;
    inputLabel?: string;
  };
  primaryLabel?: string;
  secondaryLabel?: string;
  onPrimary?: () => void;
  onPrimaryValue?: (value: string) => void;
  onSecondary?: () => void;
  onClose?: () => void;
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

export const notifyConfirm = (options: {
  title: string;
  message?: ReactNode;
  variant?: NotifyVariant;
  confirmLabel?: string;
  cancelLabel?: string;
}): Promise<boolean> => {
  return new Promise((resolve) => {
    let settled = false;
    emitNotify({
      variant: options.variant ?? 'warning',
      title: options.title,
      message: options.message,
      primaryLabel: options.confirmLabel ?? 'Ya',
      secondaryLabel: options.cancelLabel ?? 'Batal',
      onPrimary: () => {
        if (settled) return;
        settled = true;
        resolve(true);
      },
      onSecondary: () => {
        if (settled) return;
        settled = true;
        resolve(false);
      },
      onClose: () => {
        if (settled) return;
        settled = true;
        resolve(false);
      },
    });
  });
};

export const notifyPrompt = (options: {
  title: string;
  message?: ReactNode;
  variant?: NotifyVariant;
  placeholder?: string;
  initialValue?: string;
  inputLabel?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}): Promise<string | null> => {
  return new Promise((resolve) => {
    let settled = false;
    emitNotify({
      variant: options.variant ?? 'info',
      title: options.title,
      message: options.message,
      prompt: {
        placeholder: options.placeholder,
        initialValue: options.initialValue,
        inputLabel: options.inputLabel,
      },
      primaryLabel: options.confirmLabel ?? 'OK',
      secondaryLabel: options.cancelLabel ?? 'Batal',
      onPrimaryValue: (value) => {
        if (settled) return;
        settled = true;
        resolve(String(value ?? ''));
      },
      onSecondary: () => {
        if (settled) return;
        settled = true;
        resolve(null);
      },
      onClose: () => {
        if (settled) return;
        settled = true;
        resolve(null);
      },
    });
  });
};

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
