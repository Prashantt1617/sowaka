/**
 * Recent joiners get onboarding on their own (24 Nov, HR: "if anyone in the db has a joining date within
 * 30 days of today, since our onboarding is open till Month 1, they see the onboarding tab too and all the
 * tasks as per the onboarding template").
 *
 * Someone whose account says they joined within the last month (joining date from Tj − 30 to today, in the
 * company's time zone) and who has never had an onboarding journey gets one: the company's default
 * onboarding template, joined on that date, bound to their account, so the app shows the Onboarding tab
 * (until the end of Month 1) with the template's tasks, and HR sees them on the board. Only where the
 * company has the lifecycle switched on; never for someone offboarded, and never twice (any earlier
 * onboarding journey, open or closed, counts).
 *
 * `ensureRecentJoinerJourney` runs when HR adds someone through Add user with a joining date in that
 * window (POST /admin/employees, 24 Nov); `backfillRecentJoiners` does it for everyone at once.
 */
import { journeys, users } from '../../config/db';
import { logger } from '../../utils/logger';
import { addDaysKey, companyTimeZone, todayKey } from './dueRules';
import { createOnboardingJourney, lifecycleEnabled, refreshJourney } from './engine';
import { forgetLifecycleReads } from './readCache';

/** How far back a joining date makes someone a recent joiner: Month 1. */
export const RECENT_JOINER_DAYS = 30;

type Person = {
  userId: string; org: string; name?: string; email?: string; personalEmail?: string; phone?: string;
  joiningDate?: Date | string; managerUserId?: string; department?: string; designation?: string; location?: string;
  lifecycleStatus?: string;
};

const PERSON_FIELDS = {
  _id: 0, userId: 1, org: 1, name: 1, email: 1, personalEmail: 1, phone: 1, joiningDate: 1, managerUserId: 1,
  department: 1, designation: 1, location: 1, lifecycleStatus: 1,
} as const;

/** The joining day ('YYYY-MM-DD', company time zone) when it falls in the recent-joiner window today, else null. */
export function recentJoiningDay(p: Pick<Person, 'joiningDate' | 'org' | 'lifecycleStatus'>, now = new Date()): string | null {
  if (!p.joiningDate || ['offboarded', 'terminated'].includes(p.lifecycleStatus ?? '')) return null;
  const at = new Date(p.joiningDate);
  if (Number.isNaN(at.getTime())) return null;
  const tz = companyTimeZone(p.org);
  const tj = todayKey(at, tz);
  const today = todayKey(now, tz);
  return tj <= today && tj >= addDaysKey(today, -RECENT_JOINER_DAYS) ? tj : null;
}

/** Makes the joined onboarding journey for one recent joiner; the journey's id, or null when not due. */
async function makeJourney(p: Person, tj: string, now: Date, opts: { templateId?: string; byUserId?: string } = {}): Promise<string | null> {
  if (await journeys().findOne({ org: p.org, userId: p.userId, kind: 'onboarding' }, { projection: { _id: 1 } })) return null;
  const email = p.personalEmail || p.email;
  if (!p.name || !email) return null;
  // The manager only when they are someone at this company (a stale link would refuse the journey).
  const manager = p.managerUserId && p.managerUserId !== p.userId
    ? await users().findOne({ org: p.org, userId: p.managerUserId }, { projection: { _id: 1 } })
    : null;
  const j = await createOnboardingJourney(p.org, opts.byUserId ?? p.userId, {
    candidate: { name: p.name, personalEmail: email, ...(p.phone ? { phone: p.phone } : {}) } as never,
    tj,
    ...(manager ? { managerUserId: p.managerUserId } : {}),
    ...(p.department ? { department: p.department } : {}),
    ...(p.designation ? { designation: p.designation } : {}),
    ...(p.location ? { location: p.location } : {}),
    ...(opts.templateId ? { templateId: opts.templateId } : {}),
  });
  await journeys().updateOne({ id: j.id }, {
    $set: { status: 'joined', userId: p.userId, 'anchors.finalised': new Date(Date.parse(`${tj}T00:00:00Z`)), autoFromJoiningDate: true, updatedAt: now },
  } as never);
  await refreshJourney(j.id, now);
  forgetLifecycleReads(p.org);
  logger.info('Onboarding started for a recent joiner', { org: p.org, userId: p.userId, journeyId: j.id, tj });
  return j.id;
}

/** A recent joiner with no onboarding gets one: the new journey's id, else null. Never throws (adding them still works). */
export async function ensureRecentJoinerJourney(me: { userId: string; org: string }, now = new Date(), opts: { templateId?: string; byUserId?: string } = {}): Promise<string | null> {
  try {
    if (!(await lifecycleEnabled(me.org))) return null;
    const p = (await users().findOne({ org: me.org, userId: me.userId }, { projection: PERSON_FIELDS })) as Person | null;
    if (!p) return null;
    const tj = recentJoiningDay(p, now);
    return tj ? await makeJourney(p, tj, now, opts) : null;
  } catch (error) {
    logger.warn('Recent joiner onboarding not started', { org: me.org, userId: me.userId, error: (error as Error).message });
    return null;
  }
}

/** Everyone due at once, company by company (lifecycle on only). `apply: false` lists them and writes nothing. */
export async function backfillRecentJoiners(opts: { apply: boolean; org?: string; now?: Date }): Promise<Array<{ org: string; userId: string; name: string; tj: string; journeyId?: string }>> {
  const now = opts.now ?? new Date();
  const from = new Date(now.getTime() - (RECENT_JOINER_DAYS + 2) * 86_400_000);
  const people = (await users().find(
    { ...(opts.org ? { org: opts.org } : {}), joiningDate: { $gte: from, $lte: new Date(now.getTime() + 86_400_000) } } as never,
    { projection: PERSON_FIELDS },
  ).toArray()) as unknown as Person[];
  const out: Array<{ org: string; userId: string; name: string; tj: string; journeyId?: string }> = [];
  const enabled = new Map<string, boolean>();
  for (const p of people) {
    if (!enabled.has(p.org)) enabled.set(p.org, await lifecycleEnabled(p.org));
    if (!enabled.get(p.org)) continue;
    const tj = recentJoiningDay(p, now);
    if (!tj) continue;
    if (await journeys().findOne({ org: p.org, userId: p.userId, kind: 'onboarding' }, { projection: { _id: 1 } })) continue;
    if (!opts.apply) { out.push({ org: p.org, userId: p.userId, name: p.name ?? '', tj }); continue; }
    const journeyId = await makeJourney(p, tj, now);
    out.push({ org: p.org, userId: p.userId, name: p.name ?? '', tj, ...(journeyId ? { journeyId } : {}) });
  }
  return out;
}
