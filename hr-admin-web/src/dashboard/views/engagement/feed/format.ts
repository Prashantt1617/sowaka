// Times as the feed reads them.

export function ago(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  const d = Math.round(m / 1440);
  return d < 7 ? `${d}d ago` : shortDate(iso, false);
}

export function shortDate(iso: string, withTime = true): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}

/** A date input's YYYY-MM-DD, `days` from today, in local time. */
export function dayInput(days: number, from = new Date()): string {
  const d = new Date(from.getTime() + days * 86400000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
