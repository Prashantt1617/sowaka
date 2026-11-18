/**
 * Suwi's planner: questions it recognises skip the model's "which tools?" round.
 *
 *   attention  "What needs my attention today?" and its kin: the five checks the
 *              model itself picked for it (today's attendance, the review of the
 *              waiting pile, claims to check, missing details, the payroll run),
 *              run side by side as the asker, then ONE call to the small model,
 *              thinking at its least, to write a few lines. Prepared ahead for
 *              the people who use Suwi (`prepareAttention`), so it is usually
 *              served from Redis or memory in milliseconds.
 *   period     "Who was late / absent / missed a punch [N or more times] this week /
 *              this month / last month / in <month> / in the last N days": one
 *              attendance_summary call with the filter, the table from its rows and
 *              one sentence written here: no model at all.
 *
 * Anything else (a department, a comparison, a "why") goes to the model as before.
 * The tools run exactly as the model would run them, as the person asking, so
 * access rules and numbers are the same.
 */
import { addDays } from './tools/attendance';
import { contextFor, SuwiContext, SuwiLink, SuwiTable, toolAllowed, toolByName } from './tools';
import { hashOf, keptGet, keptSet, normalQuestion, suwiDataVersion } from './kept';
import { callModel, costUsd } from './llm';
import { SUWI_SMALL_MODEL } from './digest';
import { auditCol, settingsFor, spentThisMonthUsd } from './store';
import { users } from '../config/db';
import { User } from '../models/user.model';
import { yieldToLive } from '../services/background-pace';

export type PlanIntent = 'attention' | 'period';
type Call = { name: string; input: Record<string, unknown> };
export interface Plan { intent: PlanIntent; calls: Call[]; period?: { from: string; to: string; label: string; column: 'late' | 'absent' | 'missed' | 'early'; min: number; noun: string } }

export interface PlannedAnswer {
  text: string;
  checked: string[];
  links: SuwiLink[];
  tables: SuwiTable[];
  costUsd: number;
  live: boolean;
  tools: { name: string; label: string; ms: number; ok: boolean }[];
  writer?: { model: string; ms: number; input: number; output: number; firstTextMs?: number };
}

const ATTENTION = /\b(needs?|need) (my )?attention\b|\bwhat should i (focus|look|work) on\b|\banything urgent\b|\bwhat('s| is) (urgent|on my plate)\b|\bwhat do i need to (do|look at|check)( today)?\b|\bwhat needs (doing|me)\b/;
const NOT_PLAIN = /\bdepartment|\bteam\b|\bmanager|\bcompare|\bwhy\b|\btrend|\bweekday|\bmonday|\btuesday|\bwednesday|\bthursday|\bfriday|\bsaturday|\bsunday|\bexcept\b|\bbut not\b|\band not\b|\bpercent|\bratio|\bremind|\bapprove|\bdraft|\bwrite|\bsend\b|\bemail|\bmessage|\bwho is not\b|\bnot on leave/;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const fmt = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}`; };
const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

const PERIOD_KIND: [RegExp, 'late' | 'absent' | 'missed' | 'early', string, string, string][] = [
  // [words, row column, attendance_summary status, its min… input, noun (for the table title)]
  [/\blate\b/, 'late', 'late', 'minLate', 'late'],
  [/\babsent\b|\babsences?\b/, 'absent', 'absent', 'minAbsent', 'absent'],
  [/missed (a |their |the )?punch(es)?|missing punch(es)?/, 'missed', 'missed_punch', 'minMissed', 'with a missed punch'],
  [/left early|leaving early|early exits?|leave early/, 'early', 'early', 'minEarly', 'leaving early'],
];

/** The range a period question names, or null. */
function rangeOf(q: string, today: string): { from: string; to: string; label: string } | null {
  if (/\bthis week\b/.test(q)) {
    const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
    return { from: addDays(today, -dow), to: today, label: 'this week' };
  }
  if (/\blast week\b/.test(q)) {
    const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    const mon = addDays(today, -dow - 7);
    return { from: mon, to: addDays(mon, 6), label: 'last week' };
  }
  if (/\bthis month\b/.test(q)) return { from: `${today.slice(0, 7)}-01`, to: today, label: 'this month' };
  if (/\blast month\b/.test(q)) {
    const [y, m] = today.split('-').map(Number);
    const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
    return { from: `${py}-${String(pm).padStart(2, '0')}-01`, to: monthEnd(py, pm), label: 'last month' };
  }
  const days = q.match(/\b(?:last|past) (\d{1,3}) days\b/);
  if (days) { const n = Number(days[1]); if (n >= 1 && n <= 366) return { from: addDays(today, -(n - 1)), to: today, label: `the last ${n} days` }; }
  const inMonth = q.match(/\bin (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
  if (inMonth) {
    const m = MONTHS.indexOf(inMonth[1]) + 1;
    const [ty, tm] = today.split('-').map(Number);
    const y = m > tm ? ty - 1 : ty;
    const to = monthEnd(y, m) > today ? today : monthEnd(y, m);
    return { from: `${y}-${String(m).padStart(2, '0')}-01`, to, label: `in ${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}` };
  }
  return null;
}

/** The plan for a question it recognises, or null (the model's way). */
export function planFor(ctx: SuwiContext, question: string): Plan | null {
  const q = normalQuestion(question);
  if (q.length > 140 || NOT_PLAIN.test(q)) return null;
  if (ATTENTION.test(q) && q.length <= 80) {
    const calls: Call[] = [
      { name: 'attendance_summary', input: { from: ctx.today, to: ctx.today } },
      { name: 'review_requests', input: {} },
      { name: 'claims_to_check', input: { bills: 'none', limit: 5 } },
      { name: 'missing_details', input: { limit: 5 } },
      { name: 'payroll_run_check', input: {} },
    ].filter((c) => { const t = toolByName(c.name); return Boolean(t && toolAllowed(ctx, t)); });
    return calls.length ? { intent: 'attention', calls } : null;
  }
  if (!/^(who|which|list|show|give|tell)\b/.test(q)) return null;
  const kinds = PERIOD_KIND.filter(([re]) => re.test(q));
  if (kinds.length !== 1) return null;
  const range = rangeOf(q, ctx.today);
  if (!range) return null;
  const [, column, status, minKey, noun] = kinds[0];
  const at = q.match(/\b(\d{1,2})\s*(?:\+|or more|times or more|or more times|\+ times)|\bat least (\d{1,2})\b|\bmore than (\d{1,2})\b/);
  const min = at ? (at[1] ? Number(at[1]) : at[2] ? Number(at[2]) : Number(at[3]) + 1) : 1;
  const t = toolByName('attendance_summary');
  if (!t || !toolAllowed(ctx, t)) return null;
  return { intent: 'period', calls: [{ name: 'attendance_summary', input: { from: range.from, to: range.to, status, [minKey]: min, limit: 200 } }], period: { ...range, column, min, noun } };
}

/** Runs the plan's calls side by side, as the asker. */
async function runCalls(ctx: SuwiContext, calls: Call[], onProgress?: (checking: string) => void) {
  const checked: string[] = [];
  const links: SuwiLink[] = [];
  const tables: SuwiTable[] = [];
  const tools: PlannedAnswer['tools'] = [];
  let live = false;
  const data: Record<string, unknown> = {};
  await Promise.all(calls.map(async (c) => {
    const t = toolByName(c.name);
    if (!t || !toolAllowed(ctx, t)) return;
    const label = t.label(c.input);
    onProgress?.(label);
    const started = Date.now();
    try {
      const out = await t.run(ctx, c.input);
      tools.push({ name: t.name, label, ms: Date.now() - started, ok: true });
      checked.push(label);
      for (const l of out.links ?? []) if (!links.some((x) => x.label === l.label)) links.push(l);
      for (const tb of out.tables ?? []) if (!tables.some((x) => x.title === tb.title)) tables.push(tb);
      if (out.live) live = true;
      data[t.name] = out.data;
    } catch (e) {
      tools.push({ name: t.name, label, ms: Date.now() - started, ok: false });
      data[t.name] = { error: (e as Error).message };
    }
  }));
  return { checked, links, tables, tools, live, data };
}

/** Lists cut to their first few rows: the writer needs the counts and the top names, never every row. */
function compact(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) return v.length > 5 ? [...v.slice(0, 5).map((x) => compact(x, depth + 1)), `…${v.length - 5} more`] : v.map((x) => compact(x, depth + 1));
  if (v && typeof v === 'object' && depth < 5) return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => k !== 'userId' && k !== 'links').map(([k, x]) => [k, compact(x, depth + 1)]));
  return v;
}

/** The attention answer with no model: the counts as short lines. Used when the writer is unavailable. */
function plainAttention(data: Record<string, unknown>): string {
  const lines: string[] = [];
  const day = (data.attendance_summary as { day?: { counts?: Record<string, number> } } | undefined)?.day?.counts;
  const review = data.review_requests as { total?: number; waitingOnHr?: number; overdue?: { count?: number } } | undefined;
  const claims = data.claims_to_check as { pending?: number; needsALook?: { count?: number } } | undefined;
  const tasks = data.missing_details as { peopleWithTasks?: number } | undefined;
  if (review?.total) lines.push(`${review.total} requests waiting on a decision${review.overdue?.count ? `, ${review.overdue.count} overdue` : ''}${review.waitingOnHr ? `, ${review.waitingOnHr} on HR` : ''}.`);
  if (claims?.needsALook?.count) lines.push(`${claims.needsALook.count} of ${claims.pending} pending claims need a closer look.`);
  if (day) lines.push(`Today: ${day.absent ?? 0} absent, ${day.late ?? 0} late, ${day.onLeave ?? 0} on leave${day.notPunchedInYet ? `, ${day.notPunchedInYet} not punched in yet` : ''}.`);
  if (tasks?.peopleWithTasks) lines.push(`${tasks.peopleWithTasks} people still need setting up (People › Tasks).`);
  return lines.length ? `**What needs your attention today**\n${lines.map((l) => `- ${l}`).join('\n')}` : 'Nothing needs your attention today.';
}

const WRITER = `You are Suwi, an HR assistant. From the facts below, tell this HR person what needs their attention today, most urgent first: a one-line lead, then at most 5 short bullets, each with its number. Use only the facts given; never invent names, numbers or causes; skip anything that is zero or fine. No tables, no headings, no sign-off. Under 90 words. Indian formats (₹, DD Mon YYYY).`;

/** One question answered by its plan. `onText` hears the writer's text as it streams. */
export async function runPlan(ctx: SuwiContext, plan: Plan, onProgress?: (checking: string) => void, onText?: (soFar: string) => void, opts: { spentUsd?: number; budgetUsd?: number } = {}): Promise<PlannedAnswer> {
  const r = await runCalls(ctx, plan.calls, onProgress);
  if (plan.intent === 'period' && plan.period) {
    const p = plan.period;
    const rows = ((r.data.attendance_summary as { rows?: Record<string, unknown>[] } | undefined)?.rows ?? []);
    const col = { late: 'Late', absent: 'Absent', missed: 'Missed punches', early: 'Early exits' }[p.column];
    const n = rows.length;
    const range = `${fmt(p.from)} to ${fmt(p.to)}`;
    // "12 people were late", "1 person missed a punch", "Nobody left early".
    const verb = { late: ['was late', 'were late'], absent: ['was absent', 'were absent'], missed: ['missed a punch', 'missed a punch'], early: ['left early', 'left early'] }[p.column];
    const times = p.min > 1 ? ` ${p.min} or more times` : '';
    const text = n
      ? `${n} ${n === 1 ? `person ${verb[0]}` : `people ${verb[1]}`}${times} ${p.label} (${range}).`
      : `Nobody ${verb[0]}${times} ${p.label} (${range}).`;
    const table: SuwiTable | null = n ? { title: `${col} · ${p.label} · ${range} (${n})`, columns: ['Name', 'Department', col, 'Manager'], rows: rows.map((x) => [String(x.name ?? ''), String(x.department ?? ''), Number(x[p.column] ?? 0), String(x.manager ?? '')]) } : null;
    return { text, checked: r.checked, links: r.links, tables: table ? [table] : [], costUsd: 0, live: r.live || p.to >= ctx.today, tools: r.tools };
  }
  // attention: one write by the small model, thinking at its least; the plain lines if it can't.
  const facts = JSON.stringify(compact(r.data));
  const overBudget = opts.budgetUsd !== undefined && (opts.spentUsd ?? 0) >= opts.budgetUsd;
  let text = '';
  let cost = 0;
  let writer: PlannedAnswer['writer'];
  if (!overBudget) {
    const started = Date.now();
    let firstTextMs: number | undefined;
    try {
      const reply = await callModel({
        model: SUWI_SMALL_MODEL, maxTokens: 300, thinking: 'minimal', system: WRITER,
        messages: [{ role: 'user', content: `Today: ${ctx.today}\nAsked by: ${ctx.user.name}\n\nFacts:\n${facts}` }],
        onText: (soFar) => { if (firstTextMs === undefined && soFar.trim()) firstTextMs = Date.now() - started; onText?.(soFar); },
      });
      text = reply.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n').trim();
      cost = costUsd(reply.model || SUWI_SMALL_MODEL, reply.usage);
      writer = { model: reply.model || SUWI_SMALL_MODEL, ms: Date.now() - started, input: reply.usage.input_tokens ?? 0, output: reply.usage.output_tokens ?? 0, ...(firstTextMs !== undefined ? { firstTextMs } : {}) };
    } catch { text = ''; }
  }
  if (!text) { text = plainAttention(r.data); onText?.(text); }
  return { text, checked: r.checked, links: r.links.slice(0, 6), tables: r.tables.filter((t) => /overdue|need a closer look|waiting/i.test(t.title)).slice(0, 2), costUsd: cost, live: true, tools: r.tools, ...(writer ? { writer } : {}) };
}

// —— Prepared answers: "What needs my attention today?" made ahead, per person ——

/** A prepared answer lives this long: today's attendance moves with punches, which bump no version; the warm-up remakes it every few minutes. */
const PREPARED_TTL_MS = 5 * 60_000;
/** Remade at most this often per person, however many changes come in. */
const PREPARE_GAP_MS = 60_000;
const memory = new Map<string, { at: number; answer: PlannedAnswer }>();
const lastPrepared = new Map<string, number>();

async function preparedKey(org: string, userId: string, today: string): Promise<string> {
  return `prep:${org}:${await suwiDataVersion(org)}:${hashOf(userId, 'attention', today)}`;
}

/** The prepared attention answer for this person, on this data version, or null. */
export async function preparedAttention(ctx: SuwiContext): Promise<PlannedAnswer | null> {
  const key = await preparedKey(ctx.org, ctx.userId, ctx.today);
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < PREPARED_TTL_MS) return hit.answer;
  const kept = await keptGet<{ at: number; answer: PlannedAnswer }>(key);
  if (kept && Date.now() - kept.at < PREPARED_TTL_MS) { memory.set(key, kept); return kept.answer; }
  return null;
}

/** Keeps an attention answer made on the request path, so the next ask is instant. */
export async function keepAttention(ctx: SuwiContext, answer: PlannedAnswer): Promise<void> {
  const key = await preparedKey(ctx.org, ctx.userId, ctx.today);
  const row = { at: Date.now(), answer };
  memory.set(key, row);
  for (const [k, v] of memory) if (Date.now() - v.at > PREPARED_TTL_MS) memory.delete(k);
  await keptSet(key, row, Math.ceil(PREPARED_TTL_MS / 1000));
}

/** Makes (or keeps) one person's attention answer, off the request path. Returns whether it made one. */
export async function prepareAttention(user: Omit<User, 'profilePhotoUrl'>, today: string): Promise<boolean> {
  const settings = await settingsFor(user.org!);
  if (!settings.enabled) return false;
  const ctx = contextFor(user, settings.levels, today);
  if (await preparedAttention(ctx)) return false;
  const gapKey = `${user.org}|${user.userId}`;
  if (Date.now() - (lastPrepared.get(gapKey) ?? 0) < PREPARE_GAP_MS) return false;
  lastPrepared.set(gapKey, Date.now());
  const plan = planFor(ctx, 'What needs my attention today?');
  if (!plan) return false;
  const spent = await spentThisMonthUsd(ctx.org);
  const answer = await runPlan(ctx, plan, undefined, undefined, { spentUsd: spent, budgetUsd: settings.monthlyBudgetUsd });
  await keepAttention(ctx, answer);
  // The budget counts it; the activity list (questions only) doesn't show it.
  if (answer.costUsd > 0) await auditCol().insertOne({ org: ctx.org, userId: ctx.userId, kind: 'prepared', at: new Date(), page: 'prepared', question: 'Prepared: What needs my attention today?', model: answer.writer?.model, costUsd: answer.costUsd } as never).catch(() => undefined);
  return true;
}

/** The people in a company who asked Suwi something in the last three days (dashboard access, still here). */
export async function recentSuwiUsers(org: string, limit = 20): Promise<Omit<User, 'profilePhotoUrl'>[]> {
  const ids = await auditCol().distinct('userId', { org, kind: 'question', at: { $gte: new Date(Date.now() - 3 * 86_400_000) } } as never) as string[];
  if (!ids.length) return [];
  return users().find({ org, userId: { $in: ids.slice(0, limit) }, dashboardAccess: true, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as never).toArray() as Promise<Omit<User, 'profilePhotoUrl'>[]>;
}

/** Prepares the attention answer for a company's recent Suwi users (the warm-up's and the boot's way in). */
export async function prepareRecent(org: string, today: string, isStopping: () => boolean = () => false): Promise<number> {
  let made = 0;
  for (const u of await recentSuwiUsers(org)) {
    if (isStopping()) break;
    await yieldToLive(isStopping);
    try { if (await prepareAttention(u, today)) made++; } catch { /* the next round tries again */ }
  }
  return made;
}
