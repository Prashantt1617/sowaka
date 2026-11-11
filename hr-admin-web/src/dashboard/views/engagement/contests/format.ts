// What the Contests and Engagement plan pages share that is not a component:
// India-time formatting, contest labels, and the pages' CSS (grids that fold on narrow screens).
import type { ContestType } from '../../../../services/engagement-contests';

const IST_DT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const IST_D = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
const IST_PARTS = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/** "12 Nov, 5:30 pm" in India time. */
export const fmtWhen = (iso: string | null | undefined) => (iso ? IST_DT.format(new Date(iso)).replace(':00', '') : '—');
/** "12 Nov 2026". */
export const fmtDay = (iso: string | null | undefined) => (iso ? IST_D.format(new Date(iso)) : '—');
/** The weekday, day and month of a moment in India time, for a date block. */
export function dayParts(iso: string) {
  const p = Object.fromEntries(IST_PARTS.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { weekday: p.weekday ?? '', day: p.day ?? '', month: p.month ?? '', year: p.year ?? '' };
}
/** YYYY-MM-DD and YYYY-MM of a moment, in India time. */
export function istDay(iso: string | number | Date) {
  return new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export const CONTEST_LABEL: Record<ContestType, string> = {
  caption_challenge: 'Caption this',
  photo_story_challenge: 'Best photo',
  most_likely: 'Most likely',
};

/** "3 days left" / "5h left" / "Ended". */
export function timeLeft(closesAt: string | null) {
  if (!closesAt) return 'No closing time';
  const h = (Date.parse(closesAt) - Date.now()) / 3_600_000;
  if (h <= 0) return 'Ended';
  if (h < 24) return `${Math.max(1, Math.round(h))}h left`;
  return `${Math.round(h / 24)} days left`;
}

export const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

/** The two pages' layout rules, which inline styles cannot fold at a breakpoint. */
export const ENGAGEMENT_CSS = `
.en-grid{display:grid;grid-template-columns:minmax(280px,340px) minmax(0,1fr);gap:20px;align-items:start}
.en-dg{display:grid;grid-template-columns:minmax(260px,352px) minmax(0,1fr);gap:20px;align-items:start}
.en-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}
.en-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px}
.en-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
.en-row{display:flex;align-items:center;gap:10px;width:100%;border:1px solid transparent;background:none;border-radius:14px;padding:10px;text-align:left;cursor:pointer;font:inherit;color:inherit}
.en-row:hover{background:var(--surface-2)}
.en-row[aria-pressed="true"]{background:var(--accent-soft, var(--surface-2));border-color:var(--line)}
.en-plan{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:20px;align-items:start}
.en-pr{display:grid;grid-template-columns:64px minmax(0,1fr) auto;gap:16px;align-items:start;padding:16px 0;border-bottom:1px solid var(--line)}
.en-pr:last-child{border-bottom:0}
@media (max-width:1180px){.en-plan{grid-template-columns:minmax(0,1fr)}}
@media (max-width:1100px){.en-grid{grid-template-columns:minmax(0,1fr)}}
@media (max-width:900px){.en-dg,.en-two{grid-template-columns:minmax(0,1fr)}}
@media (max-width:760px){.en-pr{grid-template-columns:52px minmax(0,1fr)}.en-pr>.en-pa{grid-column:2;flex-direction:row!important}}
`;
