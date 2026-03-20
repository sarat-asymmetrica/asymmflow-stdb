/**
 * AsymmFlow — Business Stores
 *
 * Derived stores for roles, navigation, and toast notifications.
 * All component state uses Svelte 5 $state runes;
 * these module-level stores remain writable/derived for cross-component sharing.
 */
import { writable, derived } from 'svelte/store';
import { currentMember } from './db';

// ── Navigation ──────────────────────────────────────────────────────────────

export type View =
  | 'chat'
  | 'dashboard'
  | 'sales'
  | 'operations'
  | 'finance'
  | 'crm'
  | 'settings'
  | 'showcase';

export const activeView = writable<View>('chat');

// ── Role Derivations ─────────────────────────────────────────────────────────

/**
 * The current user's role string (e.g. 'Admin', 'Manager', 'Staff').
 * Null when not yet connected or member record not found.
 */
export const currentRole = derived(currentMember, ($member) => {
  if (!$member) return null;
  // Role is stored as an enum tag on the member record
  // e.g. { tag: 'Admin' } | { tag: 'Manager' } | { tag: 'Staff' }
  const role = ($member as unknown as { role?: { tag?: string } }).role;
  return role?.tag ?? null;
});

/** True when the current user has Admin privileges. */
export const isAdmin = derived(currentRole, ($role) => $role === 'Admin');

/** True when the current user has Admin or Manager privileges. */
export const isManager = derived(
  currentRole,
  ($role) => $role === 'Admin' || $role === 'Manager'
);

// ── Toast Notifications ───────────────────────────────────────────────────────

export type ToastKind = 'success' | 'danger' | 'info' | 'warning';

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

let _toastId = 0;

export const toasts = writable<Toast[]>([]);

function addToast(message: string, kind: ToastKind, durationMs = 4000): void {
  const id = ++_toastId;
  toasts.update((ts) => [...ts, { id, message, kind }]);
  setTimeout(() => {
    toasts.update((ts) => ts.filter((t) => t.id !== id));
  }, durationMs);
}

export const toast = {
  success: (message: string, durationMs?: number) =>
    addToast(message, 'success', durationMs),
  danger: (message: string, durationMs?: number) =>
    addToast(message, 'danger', durationMs),
  info: (message: string, durationMs?: number) =>
    addToast(message, 'info', durationMs),
  warning: (message: string, durationMs?: number) =>
    addToast(message, 'warning', durationMs),
  dismiss: (id: number) => {
    toasts.update((ts) => ts.filter((t) => t.id !== id));
  },
};
