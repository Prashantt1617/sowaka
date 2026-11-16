/**
 * Exit insights (O4): why people leave, from the exits and the exit interviews.
 *
 * The exit interviews are read only from the anonymised survey rows (kind
 * 'exit': department, tenure band, month; no person). Any group with fewer than
 * five answers shows no ratings, reasons or themes; the free-text answers are
 * never returned (themes are counted from the theme HR gave an answer).
 */
import { surveyResponses, users } from '../../config/db';
import type { SurveyResponse } from '../../models/lifecycle.model';
import { LifecycleError, addDays, isDateKey, keyOfInstant, requireLifecycleOrg, todayKey } from './offboarding';

export const MIN_GROUP = 5;
const REASON_LABEL: Record<string, string> = {
  growth: 'Growth', pay: 'Pay', manager: 'Manager', work_life: 'Work-life balance', the_work: 'The work itself', personal: 'Personal',
  relocation: 'Relocation', studies: 'Higher studies', other: 'Other',
};
const BAND_LABEL: Record<string, string> = { '<1y': 'Under 1 year', '1-2y': '1–2 years', '2-5y': '2–5 years', '5y+': '5 years or more' };
const BANDS = ['<1y', '1-2y', '2-5y', '5y+'];

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
const num = (v: unknown) => (typeof v === 'number' && v >= 1 && v <= 5 ? v : null);

function bandOf(joined: Date | undefined, to: string): string | null {
  if (!joined) return null;
  const years = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${keyOfInstant(joined)}T00:00:00Z`)) / (365.25 * 86_400_000);
  return years < 1 ? '<1y' : years < 2 ? '1-2y' : years < 5 ? '2-5y' : '5y+';
}

/** GET /admin/lifecycle/exit-insights?from=&to=&groupBy=department|tenure */
export async function exitInsights(actorUserId: string, query: { from?: string; to?: string; groupBy?: string } = {}, now = new Date()) {
  const actor = await users().findOne({ userId: actorUserId }, { projection: { _id: 0, org: 1, dashboardAccess: 1 } });
  if (!actor?.org || actor.dashboardAccess !== true) throw new LifecycleError(403, 'You do not have HR dashboard access');
  const org = await requireLifecycleOrg(actor.org);
  const today = todayKey(now);
  const to = isDateKey(query.to) ? query.to : today;
  const from = isDateKey(query.from) ? query.from : addDays(to, -365);
  if (from > to) throw new LifecycleError(400, 'From is before To');
  const groupBy = query.groupBy === 'tenure' ? 'tenure' : 'department';

  const leavers = await users().find(
    { org, 'exit.lastWorkingDay': { $gte: from, $lte: to < today ? to : today } },
    { projection: { _id: 0, department: 1, joiningDate: 1, 'exit.kind': 1, 'exit.lastWorkingDay': 1 } },
  ).toArray();
  const rows = await surveyResponses().find({ org, kind: 'exit', month: { $gte: from.slice(0, 7), $lte: to.slice(0, 7) } }, { projection: { _id: 0, department: 1, tenureBand: 1, answers: 1, theme: 1 } }).toArray() as Array<Pick<SurveyResponse, 'department' | 'tenureBand' | 'answers' | 'theme'>>;

  const resigned = leavers.filter((u) => u.exit?.kind === 'resigned').length;
  const n = rows.length;
  const hidden = n < MIN_GROUP;
  const work = rows.map((r) => num(r.answers.workingHere)).filter((x): x is number => x !== null);
  const mgr = rows.map((r) => num(r.answers.manager)).filter((x): x is number => x !== null);
  const reasons = new Map<string, number>();
  const comeBack = { yes: 0, maybe: 0, no: 0 };
  const themes = new Map<string, number>();
  let untagged = 0;
  for (const r of rows) {
    const reason = typeof r.answers.reason === 'string' ? r.answers.reason : null;
    if (reason) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    const cb = r.answers.comeBack;
    if (cb === 'yes' || cb === 'maybe' || cb === 'no') comeBack[cb]++;
    if (r.theme) themes.set(r.theme, (themes.get(r.theme) ?? 0) + 1);
    else if (typeof r.answers.change === 'string' && r.answers.change.trim()) untagged++;
  }
  const reasonTotal = [...reasons.values()].reduce((a, b) => a + b, 0);
  const themeTotal = [...themes.values()].reduce((a, b) => a + b, 0);

  // By department or tenure band: who left (from the exits) and the answers (anonymised), ratings only from 5 answers.
  const keyOfLeaver = (u: (typeof leavers)[number]) => (groupBy === 'tenure' ? bandOf(u.joiningDate, u.exit!.lastWorkingDay) : u.department?.trim() || null) ?? 'Not set';
  const keyOfRow = (r: (typeof rows)[number]) => (groupBy === 'tenure' ? r.tenureBand : r.department?.trim()) || 'Not set';
  const keys = new Set<string>([...leavers.map(keyOfLeaver), ...rows.map(keyOfRow)]);
  const ordered = groupBy === 'tenure' ? [...BANDS, 'Not set'].filter((k) => keys.has(k)) : [...keys];
  const groups = ordered.map((key) => {
    const answers = rows.filter((r) => keyOfRow(r) === key);
    const shown = answers.length >= MIN_GROUP;
    return {
      key, label: groupBy === 'tenure' ? BAND_LABEL[key] ?? key : key,
      left: leavers.filter((u) => keyOfLeaver(u) === key).length,
      answers: answers.length,
      workingHere: shown ? avg(answers.map((r) => num(r.answers.workingHere)).filter((x): x is number => x !== null)) : null,
      manager: shown ? avg(answers.map((r) => num(r.answers.manager)).filter((x): x is number => x !== null)) : null,
      hidden: !shown,
    };
  }).sort((a, b) => (groupBy === 'tenure' ? 0 : b.left - a.left || b.answers - a.answers));

  return {
    from, to, groupBy, minGroup: MIN_GROUP,
    left: { total: leavers.length, resigned, hrStarted: leavers.length - resigned },
    answered: { count: n, resignations: resigned, percent: pct(n, resigned) },
    hidden,
    workingHere: hidden ? null : { average: avg(work), answers: work.length },
    manager: hidden ? null : { average: avg(mgr), answers: mgr.length },
    comeBack: hidden ? null : { ...comeBack, answered: comeBack.yes + comeBack.maybe + comeBack.no },
    reasons: hidden ? [] : [...reasons.entries()].map(([key, count]) => ({ key, label: REASON_LABEL[key] ?? key, count, percent: pct(count, reasonTotal) })).sort((a, b) => b.count - a.count),
    reasonAnswers: hidden ? 0 : reasonTotal,
    themes: hidden ? [] : [...themes.entries()].map(([label, count]) => ({ label, count, percent: pct(count, n) })).sort((a, b) => b.count - a.count),
    themeAnswers: hidden ? 0 : themeTotal,
    untaggedAnswers: hidden ? 0 : untagged,
    groups,
  };
}
