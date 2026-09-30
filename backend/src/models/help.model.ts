/**
 * Help: the four-question intake and how it picks a counsellor.
 *
 * The option lists live here, not in the app, so the server can validate what
 * it is sent and so a counsellor's profile and a person's answers speak the
 * same ids. The app carries the same lists for its screens; a mismatch fails
 * loudly on save rather than silently matching nothing.
 */
import { CounsellorProfile, User } from './user.model';

export interface HelpOption {
  id: string;
  label: string;
}

/** Question 1: the part of life. */
export const HELP_TOPICS: HelpOption[] = [
  { id: 'work', label: 'Work & career' },
  { id: 'relationships', label: 'Relationships' },
  { id: 'family', label: 'Family' },
  { id: 'parenting', label: 'Parenting' },
  { id: 'money', label: 'Money' },
  { id: 'grief', label: 'Loss or grief' },
  { id: 'change', label: 'A life change' },
  { id: 'self', label: 'Myself & my feelings' },
  { id: 'other', label: 'Something else' },
  { id: 'unsure', label: 'I’m not sure yet' },
];

/** Question 2: what is hard about it. The general ones, offered to everyone. */
export const HELP_BASE_NEEDS: HelpOption[] = [
  { id: 'overwhelmed', label: 'Feeling overwhelmed' },
  { id: 'drained', label: 'Feeling drained' },
  { id: 'low', label: 'Feeling low' },
  { id: 'disconnected', label: 'Feeling disconnected' },
  { id: 'conflict', label: 'Handling conflict' },
  { id: 'decision', label: 'Making a decision' },
];

/** Question 2: the difficulties that follow from a chosen topic. */
export const HELP_CONTEXT_NEEDS: Record<string, HelpOption[]> = {
  work: [
    { id: 'switch-off', label: 'Switching off after work' },
    { id: 'expectations', label: 'Managing expectations' },
  ],
  relationships: [
    { id: 'express', label: 'Saying what I need' },
    { id: 'boundaries', label: 'Setting boundaries' },
  ],
  family: [
    { id: 'boundaries', label: 'Setting boundaries' },
    { id: 'express', label: 'Saying what I need' },
  ],
  parenting: [
    { id: 'me-time', label: 'Finding time for myself' },
    { id: 'responsibility', label: 'New responsibilities' },
  ],
  money: [{ id: 'uncertainty', label: 'Worrying about uncertainty' }],
  grief: [{ id: 'missing', label: 'Living with a loss' }],
  change: [{ id: 'adjusting', label: 'Finding my footing' }],
};

export const HELP_NEED_EXTRAS: HelpOption[] = [
  { id: 'other', label: 'Something else' },
  { id: 'unsure', label: 'I’m not sure yet' },
];

/** Question 3: the change hoped for. */
export const HELP_GOALS: HelpOption[] = [
  { id: 'heard', label: 'Feeling heard' },
  { id: 'understand', label: 'Understanding myself' },
  { id: 'settled', label: 'Feeling more settled' },
  { id: 'forward', label: 'Finding practical ways forward' },
  { id: 'relationship', label: 'Improving a relationship' },
  { id: 'unsure', label: 'Working it out together' },
];

/** Question 4: comfort. */
export const HELP_LANGUAGES = ['English', 'Hindi', 'Marathi', 'Tamil', 'Gujarati'];
export const HELP_AGE_RANGES: HelpOption[] = [
  { id: 'young', label: 'Under 35' },
  { id: 'mid', label: '35–49' },
  { id: 'older', label: '50+' },
];
export const HELP_GENDERS: HelpOption[] = [
  { id: 'woman', label: 'Woman' },
  { id: 'man', label: 'Man' },
  { id: 'nonbinary', label: 'Non-binary' },
];

const GOAL_REASONS: Record<string, string> = {
  heard: 'A reflective approach with space to talk things through',
  understand: 'An approach that explores feelings and patterns',
  settled: 'A focus on making everyday feelings more manageable',
  forward: 'A practical approach to finding next steps',
  relationship: 'Experience helping people explore their relationships',
};

export const HELP_ALL_NEEDS: HelpOption[] = [
  ...new Map(
    [...HELP_BASE_NEEDS, ...Object.values(HELP_CONTEXT_NEEDS).flat(), ...HELP_NEED_EXTRAS].map((n) => [n.id, n]),
  ).values(),
];

const label = (options: HelpOption[], id: string): string => options.find((o) => o.id === id)?.label ?? id;

/** What a person answered. Any question may be skipped: an empty list or ''. */
export interface HelpIntakeInput {
  topics: string[];
  needs: string[];
  goal: string;
  languages: string[];
  ageRange: string;
  gender: string;
}

export type MatchableCounsellor = Pick<User, 'userId' | 'name'> & { counsellor: CounsellorProfile };

const concrete = (ids: string[]) => ids.filter((id) => id !== 'other' && id !== 'unsure');

/** The hard preferences a counsellor does not meet, worded for the screen. */
export function unmetPreferences(intake: HelpIntakeInput, c: MatchableCounsellor): string[] {
  const p = c.counsellor;
  const unmet: string[] = [];
  if (intake.languages.length && !intake.languages.some((l) => (p.languages ?? []).includes(l))) {
    unmet.push(`Language: ${intake.languages.join(' or ')}`);
  }
  if (intake.ageRange && p.ageRange !== intake.ageRange) {
    unmet.push(`Counsellor’s age: ${label(HELP_AGE_RANGES, intake.ageRange)}`);
  }
  if (intake.gender && p.gender !== intake.gender) {
    unmet.push(`Counsellor’s gender: ${label(HELP_GENDERS, intake.gender)}`);
  }
  return unmet;
}

/** Whether a counsellor shares a support area, when the person named any. */
function sharesSupport(intake: HelpIntakeInput, c: MatchableCounsellor): boolean {
  const topics = concrete(intake.topics);
  const needs = concrete(intake.needs);
  if (topics.length === 0 && needs.length === 0) return true;
  const p = c.counsellor;
  return topics.some((t) => (p.focusAreas ?? []).includes(t)) || needs.some((n) => (p.supports ?? []).includes(n));
}

function score(intake: HelpIntakeInput, c: MatchableCounsellor): number {
  const p = c.counsellor;
  return (
    concrete(intake.needs).filter((n) => (p.supports ?? []).includes(n)).length * 3 +
    concrete(intake.topics).filter((t) => (p.focusAreas ?? []).includes(t)).length * 2 +
    ((p.goals ?? []).includes(intake.goal) ? 2 : 0)
  );
}

/** Why this counsellor, citing only real overlap. Never a percentage. */
export function matchReasons(intake: HelpIntakeInput, c: MatchableCounsellor): string[] {
  const p = c.counsellor;
  const reasons: string[] = [];
  const need = concrete(intake.needs).find((n) => (p.supports ?? []).includes(n));
  const topic = concrete(intake.topics).find((t) => (p.focusAreas ?? []).includes(t));
  if (need) reasons.push(`Experience supporting people with ${label(HELP_ALL_NEEDS, need).toLowerCase()}`);
  else if (topic) reasons.push(`Experience with ${label(HELP_TOPICS, topic).toLowerCase()}`);
  if ((p.goals ?? []).includes(intake.goal) && GOAL_REASONS[intake.goal]) reasons.push(GOAL_REASONS[intake.goal]);
  const languages = intake.languages.filter((l) => (p.languages ?? []).includes(l));
  if (languages.length) reasons.push(`Sessions in ${languages.join(' or ')}`);
  if (intake.gender && p.gender === intake.gender) {
    reasons.push(`${label(HELP_GENDERS, intake.gender)} counsellor, as you preferred`);
  }
  if (intake.ageRange && p.ageRange === intake.ageRange) {
    reasons.push(`In your preferred age range: ${label(HELP_AGE_RANGES, intake.ageRange)}`);
  }
  if (reasons.length === 0) reasons.push('A profile to explore while you decide what feels right');
  return reasons;
}

/**
 * The counsellors who fit, best first. Language, age and gender are hard
 * filters and are never relaxed here; among those who pass, a counsellor must
 * share a support area when one was named, then difficulties count most.
 */
export function rankMatches(intake: HelpIntakeInput, pool: MatchableCounsellor[]): MatchableCounsellor[] {
  return pool
    .filter((c) => unmetPreferences(intake, c).length === 0 && sharesSupport(intake, c))
    .map((c) => ({ c, score: score(intake, c) }))
    .sort((a, b) => b.score - a.score || a.c.userId.localeCompare(b.c.userId))
    .map((x) => x.c);
}

/**
 * When nobody fits: the closest, judged first by how few preferences go
 * unmet, then by the same score. The screen says which preference it is.
 */
export function closestMatch(intake: HelpIntakeInput, pool: MatchableCounsellor[]): MatchableCounsellor | null {
  const ranked = pool
    .map((c) => ({ c, unmet: unmetPreferences(intake, c).length, shares: sharesSupport(intake, c) ? 0 : 1, score: score(intake, c) }))
    .sort((a, b) => a.unmet - b.unmet || a.shares - b.shares || b.score - a.score || a.c.userId.localeCompare(b.c.userId));
  return ranked[0]?.c ?? null;
}

/** Accepts only known ids; drops the rest rather than refusing the save. */
export function normaliseIntake(raw: Partial<Record<keyof HelpIntakeInput, unknown>>): HelpIntakeInput {
  const list = (value: unknown, allowed: string[], limit: number): string[] =>
    Array.isArray(value)
      ? [...new Set(value.map(String).filter((id) => allowed.includes(id)))].slice(0, limit)
      : [];
  const one = (value: unknown, allowed: string[]): string => (typeof value === 'string' && allowed.includes(value) ? value : '');
  const topics = list(raw.topics, HELP_TOPICS.map((o) => o.id), 3);
  return {
    topics: topics.includes('unsure') ? ['unsure'] : topics,
    needs: list(raw.needs, HELP_ALL_NEEDS.map((o) => o.id), 2),
    goal: one(raw.goal, HELP_GOALS.map((o) => o.id)),
    languages: list(raw.languages, HELP_LANGUAGES, HELP_LANGUAGES.length),
    ageRange: one(raw.ageRange, HELP_AGE_RANGES.map((o) => o.id)),
    gender: one(raw.gender, HELP_GENDERS.map((o) => o.id)),
  };
}
