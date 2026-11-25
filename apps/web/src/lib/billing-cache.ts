'use client';

import type { BillingSnapshot } from '@jobpilot/shared';

const BILLING_KEY = 'jobpilot_billing_snapshot_v1';
const EMAIL_KEY = 'jobpilot_user_email_v1';

let memorySnapshot: BillingSnapshot | null = null;
let memoryEmail: string | null = null;
const listeners = new Set<(snap: BillingSnapshot | null) => void>();

export function getCachedBillingSnapshot(): BillingSnapshot | null {
  if (memorySnapshot) return memorySnapshot;
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(BILLING_KEY);
    if (!raw) return null;
    memorySnapshot = JSON.parse(raw) as BillingSnapshot;
    return memorySnapshot;
  } catch {
    return null;
  }
}

export function setCachedBillingSnapshot(snapshot: BillingSnapshot | null): void {
  memorySnapshot = snapshot;
  if (typeof window !== 'undefined') {
    try {
      if (snapshot) {
        window.sessionStorage.setItem(BILLING_KEY, JSON.stringify(snapshot));
      } else {
        window.sessionStorage.removeItem(BILLING_KEY);
      }
    } catch {
      // Ignore storage quota or private-mode errors
    }
  }
  for (const listener of listeners) {
    listener(snapshot);
  }
}

export function subscribeBillingSnapshot(
  listener: (snap: BillingSnapshot | null) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCachedUserEmail(): string | null {
  if (memoryEmail) return memoryEmail;
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(EMAIL_KEY);
    if (!raw) return null;
    memoryEmail = raw;
    return memoryEmail;
  } catch {
    return null;
  }
}

export function setCachedUserEmail(email: string | null): void {
  memoryEmail = email;
  if (typeof window === 'undefined') return;
  try {
    if (email) {
      window.sessionStorage.setItem(EMAIL_KEY, email);
    } else {
      window.sessionStorage.removeItem(EMAIL_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export function clearBillingCache(): void {
  setCachedBillingSnapshot(null);
  setCachedUserEmail(null);
}
