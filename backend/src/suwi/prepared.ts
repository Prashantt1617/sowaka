/**
 * Answers made ahead for the questions people actually keep asking.
 *
 * For each person who used Suwi in the last three days, the questions they asked at least twice in
 * the last week (same words, same page) are answered in the background and kept in the answer cache
 * (agent.ts askSuwi, `prepare: true`) under the company's current data version and the person's own
 * key, so their next ask is served from it with no model call. Any change Suwi reads bumps the version
 * and the kept answer misses; the warm-up then makes it again.
 *
 * Kept cheap: at most three questions a person, each person at most once every five minutes, never
 * the ones already answered instantly, and nothing once the company has used 80% of its Suwi budget.
 */
import { askSuwi } from './agent';
import { normalQuestion } from './kept';
import { recentSuwiUsers } from './planner';
import { auditCol, settingsFor, spentThisMonthUsd } from './store';

const GAP_MS = 5 * 60_000;
const MAX_PER_PERSON = 3;
const MIN_ASKS = 2;
const lastMade = new Map<string, number>();

/** A person's most-asked questions this week that weren't already answered instantly. */
export async function frequentQuestions(org: string, userId: string): Promise<{ question: string; page: string; asks: number }[]> {
  const rows = await auditCol().find({ org, userId, kind: 'question', status: 'answered', at: { $gte: new Date(Date.now() - 7 * 86_400_000) }, attachment: { $exists: false } } as never)
    .project({ _id: 0, question: 1, page: 1, timing: 1 }).sort({ at: -1 }).limit(300).toArray() as { question?: string; page?: string; timing?: { path?: string } }[];
  const groups = new Map<string, { question: string; page: string; asks: number; lastPath?: string }>();
  for (const r of rows) {
    const question = String(r.question ?? '').trim();
    if (!question) continue;
    const key = `${normalQuestion(question)}|${r.page ?? ''}`;
    const g = groups.get(key);
    if (g) g.asks += 1;
    else groups.set(key, { question, page: r.page ?? '', asks: 1, lastPath: r.timing?.path });
  }
  return [...groups.values()]
    .filter((g) => g.asks >= MIN_ASKS && g.lastPath !== 'instant')
    .sort((a, b) => b.asks - a.asks)
    .slice(0, MAX_PER_PERSON)
    .map(({ question, page, asks }) => ({ question, page, asks }));
}

/** Makes the frequent answers for a company's recent Suwi users (the warm-up's way in). Returns how many it made or kept. */
export async function prepareFrequent(org: string, isStopping: () => boolean = () => false): Promise<number> {
  const settings = await settingsFor(org);
  if (!settings.enabled) return 0;
  if ((await spentThisMonthUsd(org)) >= settings.monthlyBudgetUsd * 0.8) return 0;
  let made = 0;
  for (const u of await recentSuwiUsers(org)) {
    if (isStopping()) break;
    const gapKey = `${org}|${u.userId}`;
    if (Date.now() - (lastMade.get(gapKey) ?? 0) < GAP_MS) continue;
    lastMade.set(gapKey, Date.now());
    for (const q of await frequentQuestions(org, u.userId)) {
      if (isStopping()) break;
      try { await askSuwi(u, { question: q.question, page: q.page }, undefined, undefined, { prepare: true }); made++; } catch { /* the next round tries again */ }
    }
  }
  return made;
}
