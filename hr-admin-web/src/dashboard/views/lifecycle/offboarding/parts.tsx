// Small pieces the Offboarding board, its drawer and the settlement page share.
import type { CSSProperties } from 'react';
import type { Flag, Owner, OwnerRole } from '../../../../services/lifecycleOffboarding';

/** "Mon 26 Jan" from "2026-01-26". */
export const shortDay = (key: string) => new Date(`${key.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');
/** "26 Jan 2026" */
export const longDay = (key: string) => new Date(`${key.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const todayKey = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
export const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const daysFromTo = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
export const istKey = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** "Today", "Tomorrow", "Wed 3 Dec", "2 days late". */
export function dueText(due: string | null, today: string, late: boolean): string {
  if (!due) return '—';
  const d = daysFromTo(today, due);
  if (late && d < 0) return `${-d} ${d === -1 ? 'day' : 'days'} late`;
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  return shortDay(due);
}

// Employee blue, manager violet, HR and Payroll yellow, IT/Admin/Finance green, Automatic grey.
const OWNER_TONE: Record<OwnerRole, { bg: string; fg: string }> = {
  employee: { bg: 'var(--t-sky)', fg: 'var(--t-sky-i)' },
  manager: { bg: 'var(--t-lilac)', fg: 'var(--t-lilac-i)' },
  hr: { bg: 'var(--t-butter)', fg: 'var(--t-butter-i)' },
  payroll: { bg: 'var(--t-butter)', fg: 'var(--t-butter-i)' },
  it: { bg: 'var(--t-mint)', fg: 'var(--t-mint-i)' },
  admin: { bg: 'var(--t-mint)', fg: 'var(--t-mint-i)' },
  finance: { bg: 'var(--t-mint)', fg: 'var(--t-mint-i)' },
  automatic: { bg: 'var(--surface-2)', fg: 'var(--ink-2)' },
  done: { bg: 'var(--surface-2)', fg: 'var(--ink-3)' },
};
const ROLE_LABEL: Record<OwnerRole, string> = { employee: 'Employee', manager: 'Manager', hr: 'HR', payroll: 'Payroll', it: 'IT', admin: 'Admin', finance: 'Finance', automatic: 'Automatic', done: 'Done' };
const TASK_ROLE_LABEL: Record<string, string> = { ...ROLE_LABEL, manager_employee: 'Manager and employee', hr_manager: 'HR and manager', it_admin: 'IT and Admin' };
/** A task's owner role as people read it: "HR", "Finance", "IT", "Automatic" (never the raw key). */
export const ownerRoleLabel = (role: string) => TASK_ROLE_LABEL[role] ?? role.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' and ');

export function OwnerChip({ owner }: { owner: Owner }) {
  const tone = OWNER_TONE[owner.role];
  const name = owner.name && owner.name !== ROLE_LABEL[owner.role] && !['automatic', 'done', 'payroll'].includes(owner.role)
    ? (owner.role === 'hr' ? owner.name : `${ROLE_LABEL[owner.role]} · ${owner.name}`)
    : ROLE_LABEL[owner.role];
  return <span className="ob-owner" style={{ background: tone.bg, color: tone.fg }}>{name}</span>;
}

const FLAG_TONE: Record<Flag['tone'], CSSProperties> = {
  risk: { background: 'var(--bad-bg)', color: 'var(--bad)' },
  warn: { background: 'var(--warn-bg)', color: 'var(--warn)' },
  ok: { background: 'var(--ok-bg)', color: 'var(--ok)' },
};
export function FlagPill({ flag }: { flag: Flag | null }) {
  if (!flag) return null;
  return <span className="ob-flag" style={FLAG_TONE[flag.tone]}>{flag.label}</span>;
}

export const TEAM_LABEL = { manager: 'Manager', admin: 'Admin', it: 'IT', finance: 'Finance' } as const;
export const inrPaise = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;

export function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  );
}
export function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden style={{ flex: 'none', marginTop: 2 }}>
      <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
