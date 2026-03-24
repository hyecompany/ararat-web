'use client';

import { useMemo } from 'react';

export type ToastVariant = 'default' | 'destructive';

export interface ToastOptions {
  title?: string;
  description?: string;
  duration?: number;
  variant?: ToastVariant;
}

export interface ToastPayload extends ToastOptions {
  id: string;
}

type ToastListener = (toast: ToastPayload) => void;

const listeners = new Set<ToastListener>();

function generateId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export function emitToast(toast: ToastPayload) {
  listeners.forEach((listener) => listener(toast));
}

export function subscribeToToast(listener: ToastListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useToast() {
  return useMemo(
    () => ({
      toast: (options: ToastOptions) => {
        const payload: ToastPayload = {
          id: generateId(),
          duration: 4000,
          variant: 'default',
          ...options,
        };
        emitToast(payload);
        return payload.id;
      },
    }),
    [],
  );
}
