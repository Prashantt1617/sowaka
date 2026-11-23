/**
 * Teams › Joiners for ordinary teammates: the people who join (or have just joined) the viewer's
 * team or department, so everyone around a joiner sees them, not only the manager, the buddy and
 * the head of department (whose task pages are teamTasks.ts / teamApp.ts).
 *
 * Who is a teammate of a joiner, always in the viewer's own company (journeys and people are read
 * by org only):
 * - a peer: the viewer has the same manager as the joiner (journey.managerUserId);
 * - a department member: the viewer's department is the joiner's (the journey's department, else
 *   the joiner's account's), compared trimmed and case-blind;
 * - the joiner's manager and buddy, who are listed here too (the app shows them once).
 * Never the joiner themselves.
 *
 * When: from the day before joining (Tj − 1, "Joins tomorrow") to the end of their first month
 * (Tj + 30, "Joined Mon 30 Nov"), in the company's time zone, while the journey is open (not
 * closed, declined, expired or not joining, and past the offer: the same journeys Teams › Joiners
 * reads).
 *
 * The profile: the joiner's account (made at Mark joined, or earlier by "Generate app access")
 * when it is in the company's directory; without one the card says "Profile opens on their first day".
 *
 * Kept per company and day (readCache 'lc-new-joiners': the window's journeys and the joiners'
 * faces, dropped by every lifecycle write); who sees whom is worked out per request.
 */
import { journeys, users } from '../../config/db';
import type { Journey } from '../../models/lifecycle.model';
import { FACE_PROJECTION, faceUrlOf, type FaceFields } from '../face-photos';
import { initialsOf } from './designRows';
import { addDaysKey, companyTimeZone, daysBetween, todayKey } from './dueRules';
import { isJoined } from './engine';
import { cachedLifecycle } from './readCache';
import { OPEN_ONBOARDING } from './teamTasks';

type Me = { userId: string; name: string; org: string };

/** How long a joiner stays listed: from Tj − 1 to Tj + this many days. */
export const NEW_JOINER_DAYS = 30;

export type NewJoinerRelation = 'manager' | 'buddy' | 'peer' | 'department';

export interface NewJoinerCard {
  journeyId: string;
  /** Their account, to open the profile; absent before they have one. */
  userId?: string;
  name: string;
  initials: string;
  photoUrl?: string;
  designation?: string;
  department?: string;
  /** 'YYYY-MM-DD'. */
  tj: string;
  /** "Joins tomorrow", "Joins today", "Joined today", "Joined Mon 30 Nov". */
  joiningLine: string;
  relation: NewJoinerRelation;
  /** "Profile opens on their first day" when there is no account to open yet. */
  profileNote?: string;
}

type Face = Partial<FaceFields> & { userId: string; name?: string; designation?: string; department?: string; lifecycleStatus?: string; hiddenFromDirectory?: boolean; isCounsellor?: boolean };
type Kept = {
  journeys: Array<Pick<Journey, 'id' | 'userId' | 'managerUserId' | 'buddyUserId' | 'department' | 'designation' | 'tj' | 'status'> & { name: string; accountId?: string }>;
  faces: Face[];
};

const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mon 30 Nov" for a 'YYYY-MM-DD'. */
export function dayLabel(key: string): string {
  const at = new Date(`${key}T00:00:00Z`);
  return `${DAYS[at.getUTCDay()]} ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
}

/** The card's joining line, for a joiner joining on `tj` seen on `today`. */
export function joiningLine(tj: string, today: string, joined: boolean): string {
  const d = daysBetween(today, tj);
  if (d >= 1) return d === 1 ? 'Joins tomorrow' : `Joins ${dayLabel(tj)}`;
  if (d === 0) return joined ? 'Joined today' : 'Joins today';
  return `Joined ${dayLabel(tj)}`;
}

/** The company's journeys inside the window today, and their joiners' faces. */
async function keptFor(org: string, today: string): Promise<Kept> {
  return cachedLifecycle(org, 'lc-new-joiners', { today }, async () => {
    const rows = (await journeys().find(
      { org, ...OPEN_ONBOARDING, tj: { $gte: addDaysKey(today, -NEW_JOINER_DAYS), $lte: addDaysKey(today, 1) } } as never,
      { projection: { _id: 0, id: 1, userId: 1, managerUserId: 1, buddyUserId: 1, department: 1, designation: 1, tj: 1, status: 1, candidate: 1, appAccess: 1 } },
    ).toArray()) as Journey[];
    const accounts = [...new Set(rows.map((j) => j.userId ?? j.appAccess?.userId).filter((x): x is string => !!x))];
    const faces = accounts.length
      ? ((await users().find(
        { org, userId: { $in: accounts } },
        { projection: { _id: 0, name: 1, designation: 1, department: 1, lifecycleStatus: 1, hiddenFromDirectory: 1, isCounsellor: 1, ...FACE_PROJECTION } },
      ).toArray()) as unknown as Face[])
      : [];
    return {
      journeys: rows.map((j) => ({
        id: j.id, name: j.candidate?.name ?? '', tj: j.tj, status: j.status,
        ...(j.userId ? { userId: j.userId } : {}), ...(j.userId ?? j.appAccess?.userId ? { accountId: j.userId ?? j.appAccess?.userId } : {}),
        ...(j.managerUserId ? { managerUserId: j.managerUserId } : {}), ...(j.buddyUserId ? { buddyUserId: j.buddyUserId } : {}),
        ...(j.department ? { department: j.department } : {}), ...(j.designation ? { designation: j.designation } : {}),
      })),
      faces,
    };
  });
}

/** GET /lifecycle/team/new-joiners — the joiners new to my team or department, newest first. */
export async function newJoinersForTeammate(me: Me, now = new Date()): Promise<{ joiners: NewJoinerCard[] }> {
  const today = todayKey(now, companyTimeZone(me.org));
  const [kept, viewer] = await Promise.all([
    keptFor(me.org, today),
    users().findOne({ org: me.org, userId: me.userId }, { projection: { _id: 0, managerUserId: 1, department: 1 } }),
  ]);
  if (!viewer) return { joiners: [] };
  const myManager = viewer.managerUserId ?? '';
  const myDepartment = norm(viewer.department);
  const faces = new Map(kept.faces.map((f) => [f.userId, f]));
  const out: NewJoinerCard[] = [];
  for (const j of kept.journeys) {
    if (!j.tj) continue;
    const d = daysBetween(today, j.tj);
    if (d > 1 || d < -NEW_JOINER_DAYS) continue;
    if (j.userId === me.userId || j.accountId === me.userId) continue;
    const account = j.accountId ? faces.get(j.accountId) : undefined;
    const department = j.department ?? account?.department;
    const relation: NewJoinerRelation | null = j.managerUserId === me.userId ? 'manager'
      : j.buddyUserId === me.userId ? 'buddy'
        : myManager && j.managerUserId === myManager ? 'peer'
          : myDepartment && norm(department) === myDepartment ? 'department'
            : null;
    if (!relation) continue;
    // The profile opens only for an account the company's directory shows (profile.service.ts getPersonProfile).
    const listed = !!account && !['offboarded', 'terminated'].includes(account.lifecycleStatus ?? '') && !account.hiddenFromDirectory && !account.isCounsellor;
    const name = account?.name ?? (j.name || '—');
    const photoUrl = account ? faceUrlOf(account as FaceFields) : null;
    const designation = j.designation ?? account?.designation;
    out.push({
      journeyId: j.id, ...(listed ? { userId: account!.userId } : {}), name, initials: initialsOf(name),
      ...(photoUrl ? { photoUrl } : {}), ...(designation ? { designation } : {}), ...(department ? { department } : {}),
      tj: j.tj, joiningLine: joiningLine(j.tj, today, isJoined(j)), relation,
      ...(listed ? {} : { profileNote: 'Profile opens on their first day' }),
    });
  }
  // Joining tomorrow first, then the most recent joiners.
  out.sort((a, b) => b.tj.localeCompare(a.tj) || a.name.localeCompare(b.name));
  return { joiners: out };
}
