/**
 * AsymmFlow — Formatting Utilities
 *
 * Currency (BHD fils), timestamps, relative time,
 * Vedic digital root, and semantic color helpers.
 */

// ── Currency ─────────────────────────────────────────────────────────────────

/**
 * Format fils (smallest BHD unit, 1/1000 of a dinar) into a human-readable
 * BHD string with thousands separator and 3 decimal places.
 *
 * Examples:
 *   formatBHD(1500000n) → "1,500.000"
 *   formatBHD(500n)     → "0.500"
 *   formatBHD(0n)       → "0.000"
 */
export function formatBHD(fils: bigint): string {
  const negative = fils < 0n;
  const abs = negative ? -fils : fils;
  const dinars = abs / 1000n;
  const remainder = abs % 1000n;

  // Format integer part with thousands commas
  const dinarStr = dinars.toLocaleString('en-US');
  // Pad remainder to always 3 digits
  const filsStr = remainder.toString().padStart(3, '0');

  return `${negative ? '-' : ''}${dinarStr}.${filsStr}`;
}

/**
 * Format fils with BHD currency prefix.
 * Example: formatBHDFull(1500000n) → "BHD 1,500.000"
 */
export function formatBHDFull(fils: bigint): string {
  return `BHD ${formatBHD(fils)}`;
}

// ── Timestamps ───────────────────────────────────────────────────────────────

/** SpacetimeDB timestamp shape — microseconds since Unix epoch. */
export interface StdbTimestamp {
  microsSinceUnixEpoch: bigint;
}

/**
 * Format a SpacetimeDB timestamp into a locale date string.
 * Example: "08 Mar 2026"
 */
export function formatDate(timestamp: StdbTimestamp): string {
  const ms = Number(timestamp.microsSinceUnixEpoch / 1000n);
  return new Date(ms).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Format a SpacetimeDB timestamp into a short date+time string.
 * Example: "08 Mar 2026, 14:30"
 */
export function formatDateTime(timestamp: StdbTimestamp): string {
  const ms = Number(timestamp.microsSinceUnixEpoch / 1000n);
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a SpacetimeDB timestamp as a relative time string.
 * Examples: "just now", "2 minutes ago", "3 hours ago", "5 days ago"
 */
export function formatRelative(timestamp: StdbTimestamp): string {
  const ms = Number(timestamp.microsSinceUnixEpoch / 1000n);
  const diffMs = Date.now() - ms;

  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days !== 1 ? 's' : ''} ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months !== 1 ? 's' : ''} ago`;

  const years = Math.floor(months / 12);
  return `${years} year${years !== 1 ? 's' : ''} ago`;
}

// ── Vedic Math ────────────────────────────────────────────────────────────────

/**
 * Vedic Beejank (digital root) — reduces any positive integer to 1-9.
 * Uses the formula: 1 + ((n - 1) % 9)
 *
 * Properties:
 *   - O(1) — no iteration required
 *   - DR(n) = DR(sum of digits of n)
 *   - Eliminates 88.9% of candidates in one comparison
 *
 * Example: digitalRoot(999) → 9, digitalRoot(100) → 1
 */
export function digitalRoot(n: number): number {
  if (n <= 0) return 0;
  return 1 + ((n - 1) % 9);
}

// ── Semantic Colors ───────────────────────────────────────────────────────────

/** CSS variable name for a party/customer grade (A/B/C/D). */
export function gradeColor(grade: string): string {
  switch (grade.toUpperCase()) {
    case 'A': return 'var(--sage)';
    case 'B': return 'var(--blue)';
    case 'C': return 'var(--amber)';
    case 'D': return 'var(--coral)';
    default:  return 'var(--ink-30)';
  }
}

/** CSS variable name for a grade background (soft). */
export function gradeBackground(grade: string): string {
  switch (grade.toUpperCase()) {
    case 'A': return 'var(--sage-soft)';
    case 'B': return 'var(--blue-soft)';
    case 'C': return 'var(--amber-soft)';
    case 'D': return 'var(--coral-soft)';
    default:  return 'var(--ink-06)';
  }
}

/**
 * CSS variable name for a record status.
 * Covers order, invoice, pipeline, and PO states.
 */
export function statusColor(status: string): string {
  switch (status) {
    case 'Draft':       return 'var(--ink-30)';
    case 'Active':
    case 'Quoted':      return 'var(--blue)';
    case 'InProgress':
    case 'Ordered':
    case 'Shipped':     return 'var(--amber)';
    case 'Delivered':
    case 'Paid':
    case 'Won':
    case 'Closed':      return 'var(--sage)';
    case 'Overdue':
    case 'Lost':
    case 'Cancelled':
    case 'Blocked':     return 'var(--coral)';
    default:            return 'var(--ink-60)';
  }
}

/** CSS variable name for a status background (soft). */
export function statusBackground(status: string): string {
  const c = statusColor(status);
  // Map var(--X) → var(--X-soft) where applicable
  if (c === 'var(--blue)')  return 'var(--blue-soft)';
  if (c === 'var(--amber)') return 'var(--amber-soft)';
  if (c === 'var(--sage)')  return 'var(--sage-soft)';
  if (c === 'var(--coral)') return 'var(--coral-soft)';
  return 'var(--ink-06)';
}

/**
 * DISPLAY ONLY — Compact BHD formatting for dashboards and summaries.
 * Loses precision above 10,000 BHD (e.g., 12,345.678 BHD is shown as "12.3K").
 * NEVER use for invoices, statements, reconciliation, or any context
 * requiring fils-level accuracy. Use formatBHD() instead.
 *
 * Examples:
 *   formatBHDCompact(8566378924n) → "8.57M"
 *   formatBHDCompact(152900000n) → "152.9K"
 *   formatBHDCompact(4500000n) → "4,500"  (exact below 10K BHD)
 *   formatBHDCompact(500n) → "0.500"      (exact below 10K BHD)
 */
export function formatBHDCompact(fils: bigint): string {
  const bhd = Number(fils) / 1000;
  if (bhd >= 1_000_000) return (bhd / 1_000_000).toFixed(2) + 'M';
  if (bhd >= 10_000) return (bhd / 1_000).toFixed(1) + 'K';
  return formatBHD(fils);
}

/** Truncate a long string with ellipsis. */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + '\u2026';
}
