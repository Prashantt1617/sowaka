import { randomBytes, randomUUID } from 'node:crypto';
import { pairQuizzes, users } from '../config/db';
import { PairQuiz, PairQuizKind } from '../models/care.model';
import { CareError, requireCareUser } from './care.service';

/**
 * The quizzes for two on Time for two of you: love languages and attachment
 * styles. A person answers in the app; their partner on a private link, with
 * no account. Each sees both results once both have answered. Nothing here is
 * ever shown to the company.
 */

const KINDS: PairQuizKind[] = ['love', 'attachment'];
const LINK_DAYS = 30;
const CODE_PATTERN = /^[A-Za-z0-9_-]{16}$/;

// Love languages: twenty questions, each setting two languages against each
// other; an answer is the letter of the one chosen.
const LOVE_PAIRS = [
  'WQ', 'AT', 'GW', 'QA', 'TG', 'WA', 'QT', 'GQ', 'AG', 'TW',
  'QW', 'TA', 'WG', 'AQ', 'GT', 'AW', 'TQ', 'QG', 'GA', 'WT',
];
const LANGUAGES = ['W', 'Q', 'A', 'T', 'G'];

// Attachment styles: ten statements rated 1 to 5. The odd ones feed anxiety,
// the even ones avoidance; the fourth and ninth are worded the other way round.
const ATTACHMENT_ANXIETY = [0, 2, 4, 6, 8];
const ATTACHMENT_REVERSED = [3, 8];

export type PairResult = Record<string, unknown>;

export interface PairView {
  kind: PairQuizKind;
  mine: PairResult | null;
  partner: (PairResult & { name: string }) | null;
  /** The partner's link, once shared and while it lasts. */
  link: { code: string; expiresAt: string } | null;
}

export interface PairPartnerView {
  kind: PairQuizKind;
  /** The first name of the person who sent the link. */
  from: string;
  /** Their result, once the partner has answered too. */
  theirs: PairResult | null;
  partner: (PairResult & { name: string }) | null;
}

function cleanKind(value: unknown): PairQuizKind {
  if (!KINDS.includes(value as PairQuizKind)) throw new CareError(404, 'There is no such quiz');
  return value as PairQuizKind;
}

function cleanAnswers(kind: PairQuizKind, value: unknown): string {
  const answers = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (kind === 'love') {
    if (answers.length !== LOVE_PAIRS.length) throw new CareError(400, 'Answer every question first');
    for (let i = 0; i < LOVE_PAIRS.length; i++) {
      if (!LOVE_PAIRS[i].includes(answers[i])) throw new CareError(400, 'That answer is not one of the choices');
    }
  } else if (!/^[1-5]{10}$/.test(answers)) {
    throw new CareError(400, 'Answer every statement from 1 to 5 first');
  }
  return answers;
}

function result(kind: PairQuizKind, answers: string): PairResult {
  if (kind === 'love') {
    const scores: Record<string, number> = Object.fromEntries(LANGUAGES.map((l) => [l, 0]));
    for (const a of answers) scores[a] += 1;
    const best = Math.max(...Object.values(scores));
    return { scores, top: LANGUAGES.filter((l) => scores[l] === best) };
  }
  let anxiety = 0;
  let avoidance = 0;
  [...answers].forEach((a, i) => {
    const n = ATTACHMENT_REVERSED.includes(i) ? 6 - Number(a) : Number(a);
    if (ATTACHMENT_ANXIETY.includes(i)) anxiety += n;
    else avoidance += n;
  });
  anxiety /= 5;
  avoidance /= 5;
  // Above the midpoint, 3, counts as high.
  const style =
    anxiety > 3 && avoidance > 3 ? 'fearful' : anxiety > 3 ? 'anxious' : avoidance > 3 ? 'avoidant' : 'secure';
  return { anxiety, avoidance, style };
}

function newCode(): string {
  return randomBytes(12).toString('base64url');
}

function linkLive(q: PairQuiz): boolean {
  return q.linkExpiresAt.getTime() > Date.now();
}

function toView(kind: PairQuizKind, q: PairQuiz | null): PairView {
  if (!q) return { kind, mine: null, partner: null, link: null };
  return {
    kind,
    mine: q.mine ? result(kind, q.mine.answers) : null,
    partner: q.partner ? { ...result(kind, q.partner.answers), name: q.partner.name } : null,
    link: linkLive(q) ? { code: q.code, expiresAt: q.linkExpiresAt.toISOString() } : null,
  };
}

/** The person's quiz of this kind, or a fresh one with a link not yet shared. */
async function quizFor(userId: string, org: string, kind: PairQuizKind): Promise<PairQuiz> {
  const now = new Date();
  const found = await pairQuizzes().findOneAndUpdate(
    { userId, kind },
    {
      $setOnInsert: { id: randomUUID(), userId, org, kind, code: newCode(), linkExpiresAt: now, createdAt: now },
      $set: { updatedAt: now },
    },
    { upsert: true, returnDocument: 'after' },
  );
  if (!found) throw new CareError(500, 'Could not open your quiz');
  return found;
}

export async function getPairQuiz(userId: string, rawKind: unknown): Promise<PairView> {
  const kind = cleanKind(rawKind);
  await requireCareUser(userId);
  return toView(kind, await pairQuizzes().findOne({ userId, kind }));
}

/** Saves the person's answers; a retake replaces them. */
export async function saveMyAnswers(userId: string, rawKind: unknown, answers: unknown): Promise<PairView> {
  const kind = cleanKind(rawKind);
  const user = await requireCareUser(userId);
  const clean = cleanAnswers(kind, answers);
  await quizFor(userId, user.org, kind);
  const updated = await pairQuizzes().findOneAndUpdate(
    { userId, kind },
    { $set: { mine: { answers: clean, at: new Date() }, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  return toView(kind, updated);
}

/**
 * The partner's link: the same one while it lasts, renewed for another
 * thirty days each time it is shared; a new one once it has lapsed.
 */
export async function sharePairLink(userId: string, rawKind: unknown): Promise<PairView> {
  const kind = cleanKind(rawKind);
  const user = await requireCareUser(userId);
  const q = await quizFor(userId, user.org, kind);
  const expires = new Date(Date.now() + LINK_DAYS * 24 * 60 * 60 * 1000);
  const updated = await pairQuizzes().findOneAndUpdate(
    { userId, kind },
    { $set: { code: linkLive(q) ? q.code : newCode(), linkExpiresAt: expires, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  return toView(kind, updated);
}

/** Removes both results and the link. */
export async function removePairQuiz(userId: string, rawKind: unknown): Promise<void> {
  const kind = cleanKind(rawKind);
  await requireCareUser(userId);
  await pairQuizzes().deleteOne({ userId, kind });
}

async function byCode(code: unknown): Promise<PairQuiz> {
  const c = typeof code === 'string' ? code : '';
  const q = CODE_PATTERN.test(c) ? await pairQuizzes().findOne({ code: c }) : null;
  if (!q || !linkLive(q)) throw new CareError(404, 'This link has expired. Ask for a new one.');
  return q;
}

async function partnerView(q: PairQuiz): Promise<PairPartnerView> {
  const from = await users().findOne({ userId: q.userId }, { projection: { _id: 0, name: 1 } });
  const first = String(from?.name ?? '').trim().split(/\s+/)[0] || 'Your partner';
  return {
    kind: q.kind,
    from: first,
    // Their result only once the partner has answered: the link alone shows
    // nothing about them.
    theirs: q.mine && q.partner ? result(q.kind, q.mine.answers) : null,
    partner: q.partner ? { ...result(q.kind, q.partner.answers), name: q.partner.name } : null,
  };
}

/** What the partner sees on the link. */
export async function getPartnerQuiz(code: unknown): Promise<PairPartnerView> {
  return partnerView(await byCode(code));
}

/** The partner's answers; a retake replaces them. */
export async function savePartnerAnswers(code: unknown, answers: unknown, name: unknown): Promise<PairPartnerView> {
  const q = await byCode(code);
  const clean = cleanAnswers(q.kind, answers);
  const cleanName = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  const updated = await pairQuizzes().findOneAndUpdate(
    { id: q.id },
    { $set: { partner: { answers: clean, name: cleanName, at: new Date() }, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!updated) throw new CareError(404, 'This link has expired. Ask for a new one.');
  return partnerView(updated);
}
