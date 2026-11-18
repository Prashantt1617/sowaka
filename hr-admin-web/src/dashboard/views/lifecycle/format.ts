// The employee lifecycle's helpers: dates as the boards word them, owner and
// flag labels, phase names, due rules in words, and the shared field styles.
import type { CSSProperties } from 'react';
import type { ConfirmationDecision, DueRule, JourneyFlag, LifecycleKind, LifecyclePhase, OfferFields, OwnerRole } from '../../../services/lifecycle';

// —— Dates ———————————————————————————————————————————————————————————————

const IST = 5.5 * 3_600_000;
/** Today in India, 'YYYY-MM-DD'. */
export const todayKey = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
/** The day an instant falls on in India. */
export const dayOf = (iso: string) => new Date(Date.parse(iso) + IST).toISOString().slice(0, 10);
const asDay = (key: string) => new Date(`${key.slice(0, 10)}T00:00:00Z`);
/** "Fri 5 Dec" from a day or an instant. */
export function shortDay(v?: string | null): string {
  if (!v) return '—';
  const key = v.length > 10 ? dayOf(v) : v;
  return asDay(key).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
/** "Fri 5 Dec 2026". */
export function longDay(v?: string | null): string {
  if (!v) return '—';
  const key = v.length > 10 ? dayOf(v) : v;
  return asDay(key).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
/** "Sun 30 Nov, 8:14 PM" for an instant. */
export function dayTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${shortDay(iso)}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).toUpperCase()}`;
}
/** Days from today to a day: 0 today, negative past. */
export const daysTo = (key: string) => Math.round((asDay(key).getTime() - asDay(todayKey()).getTime()) / 86_400_000);
export const addDays = (key: string, n: number) => new Date(asDay(key).getTime() + n * 86_400_000).toISOString().slice(0, 10);
/** A due date as the boards word it: Today, Overdue, or the day. */
export function dueText(iso?: string | null, late?: boolean): string {
  if (!iso) return '—';
  const d = daysTo(iso.length > 10 ? dayOf(iso) : iso);
  if (late || d < 0) return d < 0 ? (d === -1 ? '1 day late' : `${-d} days late`) : 'Overdue';
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  return shortDay(iso);
}

export const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
export const errText = (e: unknown, fallback = 'Something went wrong') => (e instanceof Error && e.message ? e.message : fallback);

// —— Labels ——————————————————————————————————————————————————————————————

export const OWNER_LABEL: Record<OwnerRole, string> = {
  employee: 'Employee', manager: 'Manager', hr: 'HR', it: 'IT', admin: 'Admin', finance: 'Finance',
  manager_employee: 'Manager + Employee', hr_manager: 'HR + Manager', automatic: 'Automatic',
};
export const OWNER_TONE: Record<OwnerRole, { bg: string; fg: string }> = {
  employee: { bg: 'var(--t-sky)', fg: 'var(--t-sky-i)' },
  manager: { bg: 'var(--t-lilac)', fg: 'var(--t-lilac-i)' },
  manager_employee: { bg: 'var(--t-lilac)', fg: 'var(--t-lilac-i)' },
  hr: { bg: 'var(--t-butter)', fg: 'var(--t-butter-i)' },
  hr_manager: { bg: 'var(--t-butter)', fg: 'var(--t-butter-i)' },
  it: { bg: 'var(--t-mint)', fg: 'var(--t-mint-i)' },
  admin: { bg: 'var(--t-mint)', fg: 'var(--t-mint-i)' },
  finance: { bg: 'var(--t-mint)', fg: 'var(--t-mint-i)' },
  automatic: { bg: 'var(--mute-bg)', fg: 'var(--ink-2)' },
};
const RISK = { bg: 'var(--bad-bg)', fg: 'var(--bad)' };
const WARN = { bg: 'var(--warn-bg)', fg: 'var(--warn)' };
const OK = { bg: 'var(--ok-bg)', fg: 'var(--ok)' };
export const FLAG: Record<JourneyFlag, { label: string; tone: { bg: string; fg: string } }> = {
  needs_you: { label: 'Needs you', tone: RISK },
  late: { label: 'Late', tone: RISK },
  quiet: { label: 'Quiet', tone: RISK },
  joining_risk: { label: 'Joining risk', tone: RISK },
  needs_attention: { label: 'Needs attention', tone: RISK },
  expires_soon: { label: 'Expires soon', tone: WARN },
  due_soon: { label: 'Due soon', tone: WARN },
  decide: { label: 'Decide', tone: WARN },
  all_set: { label: 'All set', tone: OK },
  done: { label: 'Done', tone: OK },
  confirmed: { label: 'Confirmed', tone: OK },
};
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
/** A flag's words on a card: "Quiet 4 days", "Expires in 4 days" / "Expires today", else the flag's label. */
export function flagLabel(flag: JourneyFlag, card?: { quietDays?: number; expiresInDays?: number }): string {
  if (flag === 'quiet' && card?.quietDays) return `Quiet ${days(card.quietDays)}`;
  if (flag === 'expires_soon' && card?.expiresInDays !== undefined) return card.expiresInDays <= 0 ? 'Expires today' : `Expires in ${days(card.expiresInDays)}`;
  return FLAG[flag]?.label ?? flag;
}
/** "Nudge Kabir" for the joiner or candidate, "Remind Neha" for their manager. */
export function nudgeLabel(role: OwnerRole, name?: string): string {
  const who = name ? firstName(name) : role === 'employee' || role === 'manager_employee' ? 'them' : 'the manager';
  return role === 'manager' || role === 'hr_manager' ? `Remind ${who}` : `Nudge ${who}`;
}
export const PHASES: Record<LifecycleKind, Array<{ key: LifecyclePhase; title: string; desc: string }>> = {
  onboarding: [
    { key: 'pre_boarding', title: 'Pre-boarding', desc: 'From the offer to the joining day' },
    { key: 'first_week', title: 'First week', desc: 'Tj to Tj + 7' },
    { key: 'probation', title: 'Probation', desc: 'Every month until confirmation' },
  ],
  offboarding: [
    { key: 'resignation', title: 'Resignation', desc: 'From the resignation to HR accepting it' },
    { key: 'when_accepted', title: 'When the resignation is accepted', desc: 'From acceptance' },
    { key: 'notice_period', title: 'Notice period', desc: 'Up to the last day' },
    { key: 'last_day', title: 'Last day', desc: 'Tl to Tl + 1' },
    { key: 'after_exit', title: 'After exit', desc: 'Settlement, letters, PF' },
  ],
};
export const phaseTitle = (p: LifecyclePhase) => [...PHASES.onboarding, ...PHASES.offboarding].find((x) => x.key === p)?.title ?? p;

// —— Due rules, in words ————————————————————————————————————————————————

const sign = (n: number) => (n < 0 ? ` − ${-n}` : ` + ${n}`);
const unitWord = (r: DueRule, n: number) => (r.unit === 'working_days' ? (Math.abs(n) === 1 ? ' working day' : ' working days') : '');
const monthWords = (m: DueRule['month']) => {
  if (m == null || m === 'each') return 'each month';
  if (m === 'last') return 'the last month';
  const list = Array.isArray(m) ? m : [m];
  return list.length === 1 ? `month ${list[0]}` : `month ${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
};
/** "Tj − 5", "Tl + 2 working days", "Start of each month", "On acceptance", or the template's own words. */
export function ruleText(rule?: DueRule | null, label?: string): string {
  if (label) return label;
  if (!rule) return '—';
  const n = rule.offset ?? 0;
  switch (rule.anchor) {
    case 'tj':
    case 'tl': {
      const base = rule.anchor === 'tj' ? 'Tj' : 'Tl';
      return n === 0 ? base : `${base}${sign(n)}${unitWord(rule, n)}`;
    }
    case 'offer_sent':
      return n === 0 ? 'When the offer is sent' : `${Math.abs(n)}${unitWord(rule, n) || (Math.abs(n) === 1 ? ' day' : ' days')} ${n < 0 ? 'before' : 'after'} the offer is sent`;
    case 'accepted':
      return n === 0 ? 'When accepted' : `${n}${unitWord(rule, n) || (n === 1 ? ' day' : ' days')} after acceptance`;
    case 'finalised':
      return n === 0 ? 'When HR finalises' : `${n}${unitWord(rule, n) || (n === 1 ? ' day' : ' days')} after HR finalises`;
    case 'exit_accepted':
      return n === 0 ? 'On acceptance' : `Within ${n}${unitWord(rule, n) || (n === 1 ? ' day' : ' days')}`;
    case 'month_start':
      return `Start of ${monthWords(rule.month)}${n ? `${sign(n)}${unitWord(rule, n) || ' days'}` : ''}`;
    case 'month_end':
      return rule.month === 'last' && !n ? 'End of probation' : `End of ${monthWords(rule.month)}${n ? `${sign(n)}${unitWord(rule, n) || ' days'}` : ''}`;
    default:
      return '—';
  }
}

export const inputStyle: CSSProperties = { width: '100%', height: 42, padding: '0 12px', border: '1px solid var(--line-2)', borderRadius: 12, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box', outline: 'none' };
export const areaStyle: CSSProperties = { ...inputStyle, height: 'auto', minHeight: 84, padding: '10px 12px', resize: 'vertical', lineHeight: 1.5 };
export const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11.5, fontWeight: 400, lineHeight: 1.5, color: 'var(--ink-2)', minWidth: 0 };
export const linkBtn: CSSProperties = { background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 500, color: 'var(--accent-ink)', cursor: 'pointer', textAlign: 'left' };
export const sectionLabel: CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-3)', lineHeight: 1.5 };

export const fileSize = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export const OUTCOME_LABEL: Record<ConfirmationDecision['outcome'], string> = { confirm: 'Confirmed', extend: 'Probation extended', not_confirm: 'Not confirmed' };

/** The decision, once made, in a line. */
export function decisionLine(d: ConfirmationDecision, pay: boolean): string {
  const bits = [OUTCOME_LABEL[d.outcome]];
  if (d.outcome === 'extend' && d.extendMonths) bits.push(`by ${d.extendMonths} month${d.extendMonths === 1 ? '' : 's'}`);
  if (pay && d.salary) bits.push(`new CTC ${rupees(d.salary)}`);
  if (d.designation) bits.push(d.designation);
  if (d.decidedAt) bits.push(`on ${longDay(d.decidedAt)}${d.decidedByName ? ` by ${d.decidedByName}` : ''}`);
  return bits.join(' · ');
}

/** Documents opens on this letter kind and person once (set by the board's panel: { kind, journeyId | userId }). */
export const DOCS_OPEN_KEY = 'sowaka.lifecycle.docs.open';

/** Document templates opens this letter template once (Documents' Edit template link). */
export const LETTER_TEMPLATE_OPEN_KEY = 'sowaka.lifecycle.lettertemplate.open';

/**
 * A value another page left for this one to open on, read once. It is cleared
 * a moment later rather than at once, so a second render in development
 * (StrictMode) reads the same value.
 */
export function readHandoff(key: string): string | null {
  try {
    const v = sessionStorage.getItem(key);
    if (v != null) setTimeout(() => { try { sessionStorage.removeItem(key); } catch { /* gone with the session */ } }, 0);
    return v;
  } catch { return null; }
}

/** The offer form's field names, one place for the form and for "Changed in this version". */
export const OFFER_FIELD_LABEL: Record<keyof OfferFields, string> = {
  designation: 'Designation', department: 'Department', location: 'Work location', managerUserId: 'Reporting manager',
  tj: 'Joining date', validTill: 'Offer valid till', ctc: 'Yearly CTC', employeeType: 'Employment type',
  probationMonths: 'Probation', noticeDays: 'Notice period', responsibilities: 'Responsibilities',
};
/** "Yearly CTC, Offer valid till" for a revision's changed fields (an unknown key shows as it is). */
export const changedFieldsText = (keys: readonly string[]) =>
  keys.map((k) => OFFER_FIELD_LABEL[k as keyof OfferFields] ?? k).join(', ');
