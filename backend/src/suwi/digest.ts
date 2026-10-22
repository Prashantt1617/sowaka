/**
 * Suwi's morning digest: for each HR person with dashboard access, "what
 * needs you today / coming up / got done", built from the notices and
 * yesterday's decisions, phrased by the small model in one short call and
 * kept in suwi_digests. Built nightly at 07:00 IST for every company with
 * Suwi on, or on demand the first time someone opens the Overview that day.
 * If the model is unavailable the plain version is stored instead.
 */
import { companies, getDb, holidays, users } from '../config/db';
import { User } from '../models/user.model';
import { listAllLeavesForAdmin } from '../services/leave.service';
import { listAllReimbursementsForAdmin } from '../services/reimbursement.service';
import { logger } from '../utils/logger';
import { callModel, costUsd, SUWI_PROVIDER } from './llm';
import { suwiNotices } from './notices';
import { auditCol, settingsFor, spentThisMonthUsd } from './store';
import { contextFor, SuwiContext } from './tools';

/** The cheap model for routine phrasing; never used for questions. */
export const SUWI_SMALL_MODEL = process.env.SUWI_SMALL_MODEL || (SUWI_PROVIDER === 'gemini' ? 'gemini-3.5-flash-lite' : 'claude-haiku-4-5');

export interface SuwiDigest {
  org: string;
  userId: string;
  /** YYYY-MM-DD in India time. */
  date: string;
  text: string;
  builtAt: Date;
  model?: string;
  costUsd?: number;
}
export const digestsCol = () => getDb().collection<SuwiDigest>('suwi_digests');

const DAY = 86_400_000;
export const istToday = (now = new Date()) => new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const nice = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayOf = (v: Date | string | undefined) => (v instanceof Date ? istToday(v) : typeof v === 'string' && v ? istToday(new Date(v)) : '');

export interface DigestFacts { needsYou: string[]; comingUp: string[]; gotDone: string[] }

async function quietly<T>(work: () => Promise<T>, dflt: T): Promise<T> {
  try { return await work(); } catch { return dflt; }
}

/** The three lists, from the notices and the request lists; no model involved. */
export async function digestFacts(ctx: SuwiContext): Promise<DigestFacts> {
  const today = ctx.today;
  const yesterday = addDays(today, -1);
  const weekEnd = addDays(today, 7);
  const [notices, leaves, hols, claims, actions] = await Promise.all([
    suwiNotices(ctx),
    quietly(() => listAllLeavesForAdmin(ctx.userId), []),
    quietly(() => holidays().find({ org: ctx.org, date: { $gte: new Date(`${today}T00:00:00Z`), $lte: new Date(`${weekEnd}T23:59:59Z`) } }).project<{ name: string; date: Date; state: string }>({ name: 1, date: 1, state: 1 }).toArray(), []),
    quietly(() => listAllReimbursementsForAdmin(ctx.userId), []),
    quietly(() => auditCol().find({ org: ctx.org, kind: 'action', at: { $gte: new Date(`${yesterday}T00:00:00+05:30`), $lt: new Date(`${today}T00:00:00+05:30`) }, 'action.result': 'done' }).limit(10).toArray(), []),
  ]);
  const needsYou = notices.map((n) => `${n.title}: ${n.why}`);
  const comingUp: string[] = [];
  const gotDone: string[] = [];
  const starting = leaves.filter((l) => l.status === 'approved' && l.startDate >= today && l.startDate <= weekEnd).sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (const l of starting.slice(0, 6)) comingUp.push(`${l.employee.name} on ${l.typeName.toLowerCase()} ${l.startDate === l.endDate ? `on ${nice(l.startDate)}` : `${nice(l.startDate)} to ${nice(l.endDate)}`}`);
  if (starting.length > 6) comingUp.push(`${starting.length - 6} more people on approved leave this week`);
  const seen = new Set<string>();
  for (const h of hols) { const k = `${h.name}|${dayOf(h.date)}`; if (seen.has(k)) continue; seen.add(k); comingUp.push(`${h.name} holiday on ${nice(dayOf(h.date))}${h.state && h.state !== '*' ? ` (${h.state})` : ''}`); }

  const decided = leaves.filter((l) => l.decidedAt && dayOf(l.decidedAt) === yesterday);
  if (decided.length) gotDone.push(`${decided.length} leave request${decided.length === 1 ? '' : 's'} decided (${decided.filter((l) => l.status === 'approved').length} approved)`);
  const claimsDone = claims.filter((c) => c.decidedAt && dayOf(c.decidedAt) === yesterday);
  if (claimsDone.length) gotDone.push(`${claimsDone.length} claim${claimsDone.length === 1 ? '' : 's'} decided`);
  for (const a of actions) gotDone.push(`Via Suwi: ${a.action!.title}`);
  return { needsYou, comingUp, gotDone };
}

/** The digest without a model: the same facts as short lines. */
export function plainDigest(facts: DigestFacts, firstName: string): string {
  const section = (title: string, lines: string[], empty: string) => `**${title}**\n${lines.length ? lines.map((l) => `- ${l}`).join('\n') : `- ${empty}`}`;
  return [
    `Good morning, ${firstName}.`,
    section('Needs you today', facts.needsYou, 'Nothing waiting on you.'),
    section('Coming up this week', facts.comingUp, 'Nothing on the calendar.'),
    section('Got done yesterday', facts.gotDone, 'No decisions recorded yesterday.'),
  ].join('\n\n');
}

/** One short call to the small model; the plain version if it is unavailable or the budget is used. */
async function phrase(ctx: SuwiContext, facts: DigestFacts, firstName: string): Promise<{ text: string; model?: string; costUsd: number }> {
  const plain = plainDigest(facts, firstName);
  const empty = !facts.needsYou.length && !facts.comingUp.length && !facts.gotDone.length;
  if (empty) return { text: plain, costUsd: 0 };
  try {
    const s = await settingsFor(ctx.org);
    if ((await spentThisMonthUsd(ctx.org)) >= s.monthlyBudgetUsd) return { text: plain, costUsd: 0 };
    const reply = await callModel({
      model: SUWI_SMALL_MODEL, maxTokens: 350,
      system: `You write Suwi's morning digest for an HR person at a company using Sowaka. Rewrite the facts below as a warm, brief note in markdown: a one-line greeting using their first name, then the headings **Needs you today**, **Coming up this week**, **Got done yesterday**, each with short bullet points. Keep every number and name exactly as given; add nothing that is not in the facts; if a section is empty say so in one short line. No sign-off. Under 120 words.`,
      messages: [{ role: 'user', content: `First name: ${firstName}\nToday: ${ctx.today}\n\nFacts:\n${JSON.stringify(facts, null, 1)}` }],
    });
    const text = reply.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n').trim();
    const cost = costUsd(reply.model || SUWI_SMALL_MODEL, reply.usage);
    if (!text) return { text: plain, costUsd: cost };
    // The budget counts it; the activity page shows it as the digest, not a question.
    await auditCol().insertOne({ org: ctx.org, userId: ctx.userId, kind: 'question', at: new Date(), page: 'digest', question: 'Morning digest', answer: text.slice(0, 2000), model: reply.model || SUWI_SMALL_MODEL, costUsd: cost });
    return { text, model: reply.model || SUWI_SMALL_MODEL, costUsd: cost };
  } catch (e) {
    logger.warn('Suwi digest: model unavailable, stored the plain version', { org: ctx.org, error: (e as Error).message });
    return { text: plain, costUsd: 0 };
  }
}

/** Builds and stores today's digest for one person (replacing any earlier one for the day). */
export async function buildDigest(user: Omit<User, 'profilePhotoUrl'>, date = istToday()): Promise<SuwiDigest> {
  const settings = await settingsFor(user.org!);
  const ctx = contextFor(user, settings.levels, date);
  const facts = await digestFacts(ctx);
  const firstName = (user.name ?? '').trim().split(/\s+/)[0] || 'there';
  const { text, model, costUsd: cost } = await phrase(ctx, facts, firstName);
  const row: SuwiDigest = { org: ctx.org, userId: ctx.userId, date, text, builtAt: new Date(), ...(model ? { model } : {}), costUsd: cost };
  await digestsCol().updateOne({ org: ctx.org, userId: ctx.userId, date }, { $set: row }, { upsert: true });
  return row;
}

/** Today's digest for this person: the stored one, or built now when Suwi is on and none exists yet. */
export async function digestFor(user: Omit<User, 'profilePhotoUrl'>): Promise<SuwiDigest | null> {
  const settings = await settingsFor(user.org!);
  if (!settings.enabled) return null;
  const date = istToday();
  const existing = await digestsCol().findOne({ org: user.org!, userId: user.userId, date });
  return existing ?? buildDigest(user, date);
}

/** The nightly run: every HR person with dashboard access, in every company with Suwi on. */
export async function runDailyDigests(now = new Date()): Promise<{ built: number; skipped: number }> {
  const date = istToday(now);
  let built = 0, skipped = 0;
  const orgs = await companies().find({}, { projection: { _id: 0, id: 1 } }).toArray();
  for (const { id: org } of orgs) {
    if (!org) continue;
    const settings = await settingsFor(org);
    if (!settings.enabled) continue;
    const hr = await users().find({ org, dashboardAccess: true, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as never).toArray();
    for (const u of hr) {
      if (await digestsCol().findOne({ org, userId: u.userId, date }, { projection: { _id: 1 } })) { skipped++; continue; }
      try { await buildDigest(u, date); built++; }
      catch (e) { logger.error('Suwi digest failed', { org, userId: u.userId }, e); }
    }
  }
  return { built, skipped };
}

// —— Scheduler: 07:00 IST daily. Not started in api-only mode (server.ts alone starts it). ——
let timer: NodeJS.Timeout | undefined;
function msToNextSevenIst(now = new Date()): number {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  let next = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 7, 0, 0, 0);
  if (next <= ist.getTime()) next += DAY;
  return next - ist.getTime();
}
export function startSuwiDigestScheduler() {
  const schedule = () => {
    timer = setTimeout(async () => {
      try { const r = await runDailyDigests(); logger.info('Suwi digests built', r); }
      catch (e) { logger.error('Suwi digest run failed', {}, e); }
      finally { schedule(); }
    }, msToNextSevenIst());
    timer.unref();
  };
  schedule();
  logger.info('Suwi digest scheduler started', { time: '07:00', timeZone: 'Asia/Kolkata', model: SUWI_SMALL_MODEL });
}
export function stopSuwiDigestScheduler() {
  if (timer) clearTimeout(timer);
  timer = undefined;
}
