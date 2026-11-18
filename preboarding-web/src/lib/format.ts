import type { OfferFields } from '../api/types';

/** 'YYYY-MM-DD' → a local Date at midnight (no time-zone drift). */
export function parseDay(day: string): Date {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function toDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return toDay(d);
}

export function today(): string {
  return toDay(new Date());
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function asDate(v: string | Date): Date {
  if (v instanceof Date) return v;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? parseDay(v) : new Date(v);
}

/** "Mon 1 Dec" */
export function fmtWeekday(v: string | Date): string {
  const d = asDate(v);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "1 Dec" */
export function fmtShort(v: string | Date): string {
  const d = asDate(v);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "Mon 1 Dec 2026" */
export function fmtWeekdayYear(v: string | Date): string {
  const d = asDate(v);
  return `${fmtWeekday(d)} ${d.getFullYear()}`;
}

/** "Mon · 8 Dec" (date choice chips on P7a) */
export function fmtChip(v: string): string {
  const d = asDate(v);
  return `${WEEKDAYS[d.getDay()]} · ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** 'HH:mm' → "9:30 AM" */
export function fmtTime(hhmm?: string): string | undefined {
  if (!hhmm) return undefined;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return hhmm;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m || 0).padStart(2, '0')} ${suffix}`;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** "Kabir Mehta" → "Kabir M." (signature caption) */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** "₹14.0 L" */
export function fmtCtc(rupees: number): string {
  if (rupees >= 1_00_00_000) return `₹${(rupees / 1_00_00_000).toFixed(2)} Cr`;
  if (rupees >= 1_00_000) return `₹${(rupees / 1_00_000).toFixed(1)} L`;
  return `₹${rupees.toLocaleString('en-IN')}`;
}

const FIELD_NAMES: Partial<Record<keyof OfferFields, string>> = {
  designation: 'role',
  department: 'team',
  location: 'location',
  ctc: 'salary',
  tj: 'joining date',
  managerUserId: 'manager',
  probationMonths: 'probation',
  noticeDays: 'notice period',
  responsibilities: 'responsibilities',
  employeeType: 'employment type',
};

/** ['tj','ctc'] → "Joining date and salary" */
export function describeChanges(fields: Array<keyof OfferFields> | undefined): string {
  const names = (fields ?? []).filter((f) => f !== 'validTill').map((f) => FIELD_NAMES[f] ?? String(f));
  if (names.length === 0) return '';
  const joined = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

export function countChanges(fields: Array<keyof OfferFields> | undefined): number {
  return (fields ?? []).filter((f) => f !== 'validTill').length;
}

/** "ka***@gmail.com" */
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return email;
  return `${user.slice(0, 2)}***@${domain}`;
}
