/**
 * Demo data for the employee lifecycle: one fictional person at every stage of pre-boarding,
 * the first week, probation and offboarding, in the Sowaka Test company only (org `sowaka`),
 * plus enough anonymised exit answers for Exit insights to show its groups.
 *
 *   node --env-file=.env --import tsx src/scripts/lifecycle-demo-seed.ts --org sowaka --out /tmp/lifecycle-demo.json
 *   ... --org sowaka --dry-run       checks the target and prints the plan, writes nothing
 *   ... --org sowaka --undo          deletes exactly what a seed made (the manifest's ids)
 *   ... --org sowaka --fresh         undoes an earlier seed, then seeds again
 *
 * How: like scripts/lifecycle-timeline.ts, the global Date is replaced by a fake IST clock that
 * walks from about five months ago to now, and every person reaches their stage through the real
 * services (offer, portal accept, finalise, uploads, approvals, letters, signing, Mark joined,
 * week-1 reels, surveys, probation months, decisions; resign, manager, HR accept, handover,
 * clearance, interview, the last day, settlement). Three times a simulated day the scheduler's
 * jobs run (closeDueExits, runPortalJobs, runOffboardingJobs, runLifecycleJobs), limited by
 * services/lifecycle/scriptScope.ts to this script's own journeys and people: no other journey,
 * person or company is touched, and the company row is never written (features.lifecycle stays
 * as it is; the scope only lets this process's services act as if it were on).
 *
 * Safety:
 *  - Refuses without `--org sowaka`, unless company `sowaka` exists, and when it already ran
 *    (the manifest in `lifecycle_demo_seed`; `--fresh` undoes it first).
 *  - Nothing is sent: lifecycle mail goes to an in-process interceptor (kept only to read the
 *    offer link and the portal password), NOTIFY_ORGS names no company (no push, no inbox row,
 *    no notification email), Firebase and SMTP are blanked, and pushes go to a no-op sender.
 *  - Fictional contacts: personal emails @example.com, work emails <name>.demo@sowaka.test,
 *    phones +91 98000 xxxxx, IPs from 203.0.113.0/24 (documentation range).
 *  - Everything made is recorded in the manifest (collection → _ids) and tagged
 *    `demoSeed: 'lifecycle-2026-11'`; `--undo` deletes those ids (and the S3 objects of the
 *    lifecycle files among them), puts the reference counters and the default templates back
 *    as they were when nothing else used them since, and deletes the manifest.
 *
 * Stages are relative to the day it runs: run it on the day of the demo.
 */
// These flows start with the candidate accepting online, which the live server no longer allows.
process.env.OFFER_ONLINE_ACCEPT ??= '1';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

export const DEMO_TAG = 'lifecycle-2026-11';
export const MANIFEST_COLLECTION = 'lifecycle_demo_seed';
export const DEMO_ORG = 'sowaka';
const manifestId = (org: string) => `${DEMO_TAG}:${org}`;

// ─── Environment, before any product module loads: nothing may leave this process ──
export const NOTIFY_NOBODY = 'lifecycle-demo-seed-notifies-nobody';
process.env.NOTIFY_ORGS = NOTIFY_NOBODY;
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '';
process.env.ZOHO_SMTP_USER = '';
process.env.ZOHO_SMTP_PASS = '';

// ─── The fake clock ─────────────────────────────────────────────────────────
const RealDate = Date;
let fakeMs: number | null = null;
let realClockDepth = 0;
class FakeDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(fakeMs === null || realClockDepth > 0 ? RealDate.now() : fakeMs);
    else super(...(args as [number]));
  }
  static now() { return fakeMs === null || realClockDepth > 0 ? RealDate.now() : fakeMs; }
}
const installClock = () => { (globalThis as unknown as { Date: DateConstructor }).Date = FakeDate as unknown as DateConstructor; };
const removeClock = () => { fakeMs = null; (globalThis as unknown as { Date: DateConstructor }).Date = RealDate; };
const HOUR = 3_600_000;
const istKey = (ms: number) => new RealDate(ms + 5.5 * HOUR).toISOString().slice(0, 10);
const istAt = (day: string, time: string) => RealDate.parse(`${day}T${time}:00+05:30`);

// ─── People ─────────────────────────────────────────────────────────────────
export type Board = 'onboarding' | 'offboarding' | 'none';
export interface Expect { board: Board; tab?: string; column?: string; status?: string }
interface PersonSpec {
  key: string; stage: string; group: 'Pre-boarding' | 'First week' | 'Probation' | 'Offboarding' | 'Exit insights';
  name: string; designation: string; department: string; ctc: number; expect: Expect;
  /** Leavers: years and days at the company on the day they leave. */
  tenure?: [number, number]; employeeType?: 'full_time' | 'contract';
}
const P = (key: string, group: PersonSpec['group'], stage: string, name: string, designation: string, department: string, ctc: number, expect: Expect, extra: Partial<PersonSpec> = {}): PersonSpec =>
  ({ key, group, stage, name, designation, department, ctc, expect, ...extra });
const on = (tab: string, column: string): Expect => ({ board: 'onboarding', tab, column });
const off = (tab: string, column: string): Expect => ({ board: 'offboarding', tab, column });
const none = (status: string): Expect => ({ board: 'none', status });

export const PEOPLE: PersonSpec[] = [
  P('draft', 'Pre-boarding', 'Offer draft (not sent)', 'Aarav Kulkarni', 'Junior 3D Animator', 'Animation', 520_000, on('pre_boarding', 'offer_sent')),
  P('sent', 'Pre-boarding', 'Offer sent', 'Ishita Rao', 'Texture Artist', 'Surfacing', 780_000, on('pre_boarding', 'offer_sent')),
  P('revised', 'Pre-boarding', 'Offer revised (v2 draft waiting to send)', 'Kabir Malhotra', 'Rigging TD', 'Rigging', 1_150_000, on('pre_boarding', 'offer_sent')),
  P('accepted', 'Pre-boarding', 'Accepted, waiting for HR to finalise', 'Meera Pillai', 'Lighting Artist', 'Lighting & Rendering', 960_000, on('pre_boarding', 'accepted')),
  P('finalised', 'Pre-boarding', 'Finalised, not signed in', 'Rohan Deshpande', 'Compositor', 'Compositing', 840_000, on('pre_boarding', 'documents')),
  P('signed_in', 'Pre-boarding', 'Signed in, documents to upload', 'Sana Qureshi', 'Storyboard Artist', 'Story', 900_000, on('pre_boarding', 'documents')),
  P('docs_review', 'Pre-boarding', 'Documents in review', 'Vikram Sethi', 'Pipeline Developer', 'Pipeline & Technology', 1_600_000, on('pre_boarding', 'documents')),
  P('sent_back', 'Pre-boarding', 'A document sent back', 'Tara Menon', 'FX Artist', 'FX', 1_050_000, on('pre_boarding', 'documents')),
  P('letters', 'Pre-boarding', 'Documents approved, letters to sign', 'Arjun Bhatt', 'Character Modeller', 'Modelling', 980_000, on('pre_boarding', 'letters')),
  P('ready', 'Pre-boarding', 'Letters signed, ready to join (Day-1 pass open)', 'Nisha Agarwal', 'Production Coordinator', 'Production', 720_000, on('pre_boarding', 'ready_to_join')),
  P('date_change', 'Pre-boarding', 'Joining-date change request pending', 'Dev Choudhary', 'Layout Artist', 'Layout', 860_000, on('pre_boarding', 'documents')),
  P('declined', 'Pre-boarding', 'Declined', 'Pooja Venkatesh', 'Concept Artist', 'Art', 1_000_000, none('declined')),
  P('expired', 'Pre-boarding', 'Offer expired', 'Karan Gill', 'Render Wrangler', 'Lighting & Rendering', 650_000, none('expired')),
  P('not_joining', 'Pre-boarding', 'Not joining', 'Riya Thakkar', '3D Animator', 'Animation', 760_000, none('not_joining')),

  P('day1', 'First week', 'Day 1', 'Aditya Narang', '3D Animator', 'Animation', 820_000, on('first_week', 'day1')),
  P('week1_day4', 'First week', 'Week 1, day 4 (2 of 4 reels done)', 'Lavanya Krishnan', 'Lookdev Artist', 'Surfacing', 1_100_000, on('first_week', 'week1_tasks')),
  P('intro', 'First week', 'Intro post up', 'Farhan Siddiqui', 'Compositor', 'Compositing', 880_000, on('first_week', 'week1_tasks')),
  P('day7_survey', 'First week', 'Day-7 survey open', 'Neha Joshi', 'Matchmove Artist', 'Camera & Layout', 740_000, on('first_week', 'day7_survey')),
  P('week_done', 'First week', 'Week 1 done', 'Varun Reddy', 'Junior Rigger', 'Rigging', 600_000, on('first_week', 'week_done')),

  P('month1', 'Probation', 'Month 1', 'Ananya Bose', 'Editor', 'Editorial', 900_000, on('probation', 'month1')),
  P('months_2_5', 'Probation', 'Months 2–5, check-ins done (6-month probation)', 'Rahul Saxena', 'Senior Character Modeller', 'Modelling', 1_450_000, on('probation', 'months_2_5')),
  P('final_month', 'Probation', 'Final month, decision due (3-month probation)', 'Divya Nambiar', 'Production Assistant', 'Production', 560_000, on('probation', 'final_month')),
  P('confirmed', 'Probation', 'Confirmed, reveal pending', 'Manish Tiwari', 'Lighting TD', 'Lighting & Rendering', 1_300_000, on('probation', 'confirmed')),
  P('extended', 'Probation', 'Probation extended by 2 months', 'Sneha Patil', '3D Animator', 'Animation', 780_000, on('probation', 'months_2_5')),

  P('with_manager', 'Offboarding', 'Resignation with the manager', 'Gaurav Mehra', 'Senior 3D Animator', 'Animation', 1_400_000, off('resignations', 'with_manager'), { tenure: [3, 40] }),
  P('with_hr', 'Offboarding', 'Resignation with HR', 'Priya Raman', 'Texture Lead', 'Surfacing', 1_900_000, off('resignations', 'with_hr'), { tenure: [4, 110] }),
  P('off_accepted', 'Offboarding', 'Accepted, handover checklist due', 'Nikhil Chawla', 'Senior Compositor', 'Compositing', 1_500_000, off('resignations', 'accepted'), { tenure: [2, 200] }),
  P('handover', 'Offboarding', 'Handover in progress (1 of 3 uploaded)', 'Shreya Ghosh', '3D Animator', 'Animation', 950_000, off('notice', 'handover'), { tenure: [1, 250] }),
  P('clearance', 'Offboarding', 'Clearance (2 of 4 done)', 'Amit Jain', 'Pipeline TD', 'Pipeline & Technology', 2_100_000, off('notice', 'clearance'), { tenure: [3, 150] }),
  P('exit_interview', 'Offboarding', 'Exit interview open', 'Harsh Vora', '3D Animator', 'Animation', 900_000, off('notice', 'exit_interview'), { tenure: [2, 90] }),
  P('last_week', 'Offboarding', 'Last week, all clear', 'Kavya Shetty', 'Senior 3D Animator', 'Animation', 1_350_000, off('notice', 'last_week'), { tenure: [4, 60] }),
  P('last_day', 'Offboarding', 'Last day today', 'Yash Kapoor', 'Layout Artist', 'Animation', 1_000_000, off('exit', 'last_day'), { tenure: [3, 300] }),
  P('settlement_due', 'Offboarding', 'Settlement due', 'Ritu Bansal', '3D Animator', 'Animation', 880_000, off('exit', 'settlement_due'), { tenure: [2, 30] }),
  P('settlement_sent', 'Offboarding', 'Settlement sent (gratuity to pay)', 'Omkar Joshi', 'Lead Animator', 'Animation', 2_200_000, off('exit', 'settlement_sent'), { tenure: [6, 120] }),
  P('closed', 'Offboarding', 'Closed', 'Zoya Khan', 'Animation Supervisor', 'Animation', 2_800_000, off('exit', 'closed'), { tenure: [7, 200] }),
  P('withdrawn', 'Offboarding', 'Resignation withdrawn', 'Pranav Nair', 'FX Artist', 'FX', 1_200_000, none('withdrawn'), { tenure: [2, 180] }),
  P('retirement', 'Offboarding', 'HR-started: retirement', 'Suresh Iyengar', 'Head of Production', 'Production', 3_600_000, off('notice', 'handover'), { tenure: [18, 100] }),
  P('end_of_contract', 'Offboarding', 'HR-started: end of contract', 'Fatima Sheikh', 'Matte Painter (contract)', 'Art', 1_100_000, off('notice', 'clearance'), { tenure: [1, 0], employeeType: 'contract' }),
  P('termination', 'Offboarding', 'HR-started: termination (app page off)', 'Rajat Arora', 'Render Wrangler', 'Lighting & Rendering', 700_000, off('exit', 'settlement_due'), { tenure: [1, 200] }),
  P('absconding', 'Offboarding', 'HR-started: absconding', 'Deepak Yadav', 'Junior Compositor', 'Compositing', 480_000, off('exit', 'settlement_due'), { tenure: [0, 260] }),

  P('alumni1', 'Exit insights', 'Left 3 months ago (exit answer 1 of 3)', 'Ayesha Mirza', '3D Animator', 'Animation', 860_000, none('closed'), { tenure: [3, 20] }),
  P('alumni2', 'Exit insights', 'Left 3 months ago (exit answer 2 of 3)', 'Tanmay Kelkar', 'Hard-surface Modeller', 'Modelling', 920_000, none('closed'), { tenure: [2, 150] }),
  P('alumni3', 'Exit insights', 'Left 3 months ago (exit answer 3 of 3)', 'Bhavna Rathi', 'Line Producer', 'Production', 1_700_000, none('closed'), { tenure: [4, 10] }),
];

const JOINERS = new Set(['day1', 'week1_day4', 'intro', 'day7_survey', 'week_done', 'month1', 'months_2_5', 'final_month', 'confirmed', 'extended']);
const slug = (name: string) => name.toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '.');
export const personalEmailOf = (name: string) => `${slug(name)}@example.com`;
export const workEmailOf = (name: string) => `${slug(name)}.demo@sowaka.test`;
const phoneOf = (i: number) => `+91 98000 ${String(10_001 + i)}`;
const ipOf = (i: number) => `203.0.113.${10 + i}`;

// ─── The result ─────────────────────────────────────────────────────────────
export interface PlacedRow {
  key: string; group: string; stage: string; name: string; designation: string;
  expected: Expect; actual: Expect & { flags?: string[]; nextStep?: string }; ok: boolean; where: string;
  journeyId?: string; userId?: string; error?: string;
}
export interface SeedResult {
  org: string; companyName: string; ranAt: string; today: string;
  hr: { userId: string; name: string }; managers: Array<{ userId: string; name: string; created: boolean }>;
  people: PlacedRow[]; portalLogins: Array<{ name: string; stage: string; email: string; password: string; portalView: string }>;
  exitInsights: { answers: number; hidden: boolean; groupsShown: string[] };
  intercepted: { emails: number; pushes: number }; productErrors: string[]; recorded: Record<string, number>;
}

interface Opts { org?: string; out?: string; fresh?: boolean; undo?: boolean; dryRun?: boolean; quiet?: boolean }

class Refusal extends Error {}

const ONB_LABEL: Record<string, string> = {
  pre_boarding: 'Pre-boarding', first_week: 'First week', probation: 'Probation', offer_sent: 'Offer sent', accepted: 'Accepted', documents: 'Documents',
  letters: 'Letters to sign', ready_to_join: 'Ready to join', day1: 'Day 1', week1_tasks: 'Week-1 tasks', day7_survey: 'Day-7 survey', week_done: 'Week done',
  month1: 'Month 1', months_2_5: 'Months 2–5', final_month: 'Final month', confirmed: 'Confirmed',
};
const OFF_LABEL: Record<string, string> = {
  resignations: 'Resignations', notice: 'Notice', exit: 'Exit', with_manager: 'With manager', with_hr: 'With HR', accepted: 'Accepted', handover: 'Handover',
  clearance: 'Clearance', exit_interview: 'Exit interview', last_week: 'Last week', last_day: 'Last day today', settlement_due: 'Settlement due',
  settlement_sent: 'Settlement sent', closed: 'Closed',
};
function whereOf(e: Expect): string {
  if (e.board === 'onboarding') return `Onboarding › ${ONB_LABEL[e.tab!] ?? e.tab} › ${ONB_LABEL[e.column!] ?? e.column}`;
  if (e.board === 'offboarding') return `Offboarding › ${OFF_LABEL[e.tab!] ?? e.tab} › ${OFF_LABEL[e.column!] ?? e.column}`;
  const why: Record<string, string> = {
    declined: 'Off the board (closed: declined); the journey panel and the offer link show it',
    expired: 'Off the board (closed: expired); the journey panel and the offer link show it',
    not_joining: 'Off the board (closed: not joining); the portal shows the closed screen',
    withdrawn: 'Off the board (withdrawn before HR accepted); the app’s Resignation tab is back to normal',
    closed: 'Closed over 90 days ago: Exit insights and the Closed column with a date range',
  };
  return why[e.status ?? ''] ?? `Off the board (${e.status})`;
}

// ═════════════════════════════════════════════════════════════════════════════ seed
export async function seedLifecycleDemo(opts: Opts): Promise<SeedResult> {
  const say = opts.quiet ? () => {} : console.log.bind(console);
  if (opts.org !== DEMO_ORG) throw new Refusal(`Refusing: pass --org ${DEMO_ORG} (this script only seeds Sowaka Test)`);
  const org = DEMO_ORG;
  const db = await import('../config/db');
  const { env } = await import('../config/env');
  if (env.notifyOrgs.join(',') !== NOTIFY_NOBODY || env.firebaseServiceAccountJson || env.zohoSmtp.user || env.zohoSmtp.pass) {
    throw new Refusal('Refusing: notifications or mail could go out (load this script before any other module, so it can switch them off)');
  }
  const target = `${env.mongoUri.replace(/\/\/[^@/]*@/, '//***@').split('?')[0]} / ${env.mongoDbName}`;
  await db.connectDb();
  const raw = db.getDb();
  const company = await db.companies().findOne({ id: org }, { projection: { _id: 0, id: 1, name: 1, maxUsers: 1, features: 1, exitNoticeDays: 1, profile: 1 } });
  if (!company) throw new Refusal(`Refusing: there is no company with id "${org}" in ${target}`);
  if (company.name !== 'Sowaka Test' && company.id !== DEMO_ORG) throw new Refusal(`Refusing: company "${company.name}" is not Sowaka Test`);
  say(`Target: ${target}\nCompany: ${company.name} (${company.id}); features.lifecycle=${company.features?.lifecycle === true}, features.exits=${company.features?.exits === true} (neither is changed)`);

  const existing = await raw.collection(MANIFEST_COLLECTION).findOne({ _id: manifestId(org) as never });
  if (existing && !opts.fresh) throw new Refusal(`Refusing: the demo seed already ran for ${org} (${(existing as { status?: string }).status ?? 'unknown'}, ${(existing as { startedAt?: Date }).startedAt?.toISOString?.()}). Run with --undo, or --fresh to undo and seed again.`);
  if (existing && opts.fresh) {
    say('--fresh: undoing the earlier seed first');
    await undoLifecycleDemo({ org, quiet: opts.quiet });
  }

  // ── The people already there: HR (a dashboard admin) and managers ─────────
  const LEFT: Array<'offboarded' | 'terminated'> = ['offboarded', 'terminated'];
  const staff = await db.users().find(
    { org, lifecycleStatus: { $nin: LEFT }, exit: { $exists: false }, hiddenFromDirectory: { $ne: true }, demoSeed: { $exists: false } } as never,
    { projection: { _id: 0, userId: 1, name: 1, email: 1, role: 1, managerUserId: 1, dashboardAdmin: 1, dashboardAccess: 1, designation: 1, department: 1, location: 1 } },
  ).toArray();
  const hrUser = staff.filter((u) => u.dashboardAdmin === true && u.dashboardAccess === true)
    .sort((a, b) => Number(/^support@/i.test(a.email)) - Number(/^support@/i.test(b.email)))[0];
  if (!hrUser) throw new Refusal(`Refusing: ${company.name} has no dashboard admin to act as HR`);
  const reports = new Map<string, number>();
  for (const u of staff) if (u.managerUserId) reports.set(u.managerUserId, (reports.get(u.managerUserId) ?? 0) + 1);
  let managerPool = staff.filter((u) => u.userId !== hrUser.userId && (u.role === 'manager' || (reports.get(u.userId) ?? 0) > 0))
    .sort((a, b) => (reports.get(b.userId) ?? 0) - (reports.get(a.userId) ?? 0)).slice(0, 3)
    .map((u) => ({ userId: u.userId, name: u.name, created: false }));
  const colleagues = staff.filter((u) => u.userId !== hrUser.userId).map((u) => u.userId);

  // ── Fictional contacts must be free ───────────────────────────────────────
  const personal = PEOPLE.map((p) => personalEmailOf(p.name));
  const work = PEOPLE.map((p) => workEmailOf(p.name));
  const clash = [
    ...(await db.users().find({ $or: [{ email: { $in: [...work, ...personal] } }, { personalEmail: { $in: personal } }] }, { projection: { _id: 0, email: 1 } }).toArray()).map((u) => u.email),
    ...(await db.candidateAccounts().find({ email: { $in: personal } }, { projection: { _id: 0, email: 1 } }).toArray()).map((a) => a.email),
    ...(await db.journeys().find({ 'candidate.personalEmail': { $in: personal } }, { projection: { _id: 0, candidate: 1 } }).toArray()).map((j) => j.candidate?.personalEmail),
  ];
  if (clash.length) throw new Refusal(`Refusing: these demo addresses are already in use: ${[...new Set(clash)].join(', ')}`);
  const newAccounts = PEOPLE.filter((p) => JOINERS.has(p.key) || p.group === 'Offboarding' || p.group === 'Exit insights').length + (managerPool.length ? 0 : 2);
  const active = await db.users().countDocuments({ org, lifecycleStatus: { $nin: LEFT } });
  if (typeof company.maxUsers === 'number' && active + newAccounts > company.maxUsers) {
    throw new Refusal(`Refusing: ${company.name} allows ${company.maxUsers} accounts; ${active} are used and the demo adds ${newAccounts}`);
  }
  let idBase = 101;
  for (;;) {
    const ids = PEOPLE.map((_, i) => `SWT-D${idBase + i}`);
    if (!(await db.users().countDocuments({ org, employeeId: { $in: ids } }))) break;
    idBase += 100;
  }
  const employeeIdOf = (p: PersonSpec) => `SWT-D${idBase + PEOPLE.indexOf(p)}`;

  const realStart = RealDate.now();
  const D0 = istKey(realStart);
  const rules = await import('../services/lifecycle/dueRules');
  const D = (n: number) => rules.addDaysKey(D0, n);
  if (opts.dryRun) {
    say(`\nDry run (${D0}): HR would be ${hrUser.name}; managers ${managerPool.map((m) => m.name).join(', ') || '(none found: two fictional managers would be made)'}; ${newAccounts} new accounts.`);
    for (const p of PEOPLE) say(`  ${p.group.padEnd(13)} ${p.stage.padEnd(48)} ${p.name.padEnd(18)} ${whereOf(p.expect)}`);
    await db.closeDb();
    return { org, companyName: company.name, ranAt: new RealDate(realStart).toISOString(), today: D0, hr: { userId: hrUser.userId, name: hrUser.name }, managers: managerPool, people: [], portalLogins: [], exitInsights: { answers: 0, hidden: true, groupsShown: [] }, intercepted: { emails: 0, pushes: 0 }, productErrors: [], recorded: {} };
  }

  // ── Before: what the company already had, to put back on undo ─────────────
  const preCounters = await raw.collection('lifecycle_counters').find({ _id: { $regex: `^${org}:` } as never }).toArray();
  const preTemplates = await db.lifecycleTemplates().find({ org }, { projection: { _id: 1, id: 1, isDefault: 1 } }).toArray();
  const preLetterTemplates = await db.letterTemplates().find({ org }, { projection: { _id: 1, id: 1, isDefault: 1 } }).toArray();
  const preSurveyIds = (await db.surveyResponses().find({ org }, { projection: { _id: 1 } }).toArray()).map((r) => r._id);
  const prePortalJobs = (await raw.collection('lifecycle_portal_jobs').find({ org }, { projection: { _id: 1 } }).toArray()).map((r) => r._id);
  const manifest = raw.collection(MANIFEST_COLLECTION);
  await manifest.insertOne({
    _id: manifestId(org) as never, tag: DEMO_TAG, org, status: 'seeding', startedAt: new RealDate(), today: D0, journeyIds: [], userIds: [],
    pre: { counters: preCounters, templates: preTemplates, letterTemplates: preLetterTemplates },
  });
  const journeyIds = new Set<string>();
  const userIds = new Set<string>();
  const track = async (what: { journeyId?: string; userId?: string }) => {
    if (what.journeyId) journeyIds.add(what.journeyId);
    if (what.userId) userIds.add(what.userId);
    await manifest.updateOne({ _id: manifestId(org) as never }, { $addToSet: { ...(what.journeyId ? { journeyIds: what.journeyId } : {}), ...(what.userId ? { userIds: what.userId } : {}) } });
  };

  // ── Product modules; the interceptors and the scope ───────────────────────
  const emails = await import('../services/lifecycle/emails');
  const notif = await import('../services/notification.service');
  const scope = await import('../services/lifecycle/scriptScope');
  const jobs = await import('../services/lifecycle/jobs');
  const board = await import('../services/lifecycle/board');
  const app = await import('../services/lifecycle/appOnboarding');
  const probation = await import('../services/lifecycle/probation');
  const offersSvc = await import('../services/lifecycle/offers');
  const docsSvc = await import('../services/lifecycle/documents');
  const lettersSvc = await import('../services/lifecycle/letters');
  const portalSvc = await import('../services/lifecycle/portal');
  const auth = await import('../services/lifecycle/portalAuth');
  const offSvc = await import('../services/lifecycle/offboarding');
  const resig = await import('../services/lifecycle/resignations');
  const insights = await import('../services/lifecycle/insights');
  const exitSvc = await import('../services/exit.service');
  const settle = await import('../services/exitSettlement.service');
  const { S3Client } = await import('@aws-sdk/client-s3');
  type Journey = import('../models/lifecycle.model').Journey;
  type JourneyTask = import('../models/lifecycle.model').JourneyTask;

  interface Mail { to: string; subject: string; html: string }
  const mails: Mail[] = [];
  emails.interceptLifecycleEmails((m) => { mails.push({ to: m.to, subject: m.subject, html: m.html }); });
  let pushes = 0;
  notif.capturePushesForCheck({ async sendEachForMulticast(message) { pushes += message.tokens.length; return { responses: [], successCount: 0, failureCount: 0 }; } });
  scope.setScriptScope({ org, journeyIds, userIds });
  // S3 signs requests with the time: uploads use the real clock.
  const realSend = S3Client.prototype.send;
  (S3Client.prototype as unknown as { send: (...a: unknown[]) => Promise<unknown> }).send = async function patched(this: unknown, ...a: unknown[]) {
    realClockDepth += 1;
    try { return await (realSend as unknown as (...x: unknown[]) => Promise<unknown>).apply(this, a); } finally { realClockDepth -= 1; }
  };
  const productErrors: string[] = [];
  const saved = { info: console.info, warn: console.warn, error: console.error };
  console.info = () => {};
  console.warn = () => {};
  console.error = (...a: unknown[]) => { productErrors.push(a.map(String).join(' ').slice(0, 400)); };

  const tokenIn = (html: string) => /\/o\/([A-Za-z0-9_-]+)/.exec(html)?.[1] ?? '';
  const lastMailTo = (to: string) => [...mails].reverse().find((m) => m.to === to);

  const HR = { userId: hrUser.userId, name: hrUser.name, org, seesPay: true };
  const HRME = { userId: hrUser.userId, name: hrUser.name };
  const HRO = { ...HRME, org };

  let pdfLib: typeof import('pdf-lib') | null = null;
  try { pdfLib = await import('pdf-lib'); } catch { pdfLib = null; }
  async function pdf(title: string, lines: string[]): Promise<Buffer> {
    const footer = 'DEMO DOCUMENT - fictional person - lifecycle demo seed';
    if (!pdfLib) return Buffer.from(`%PDF-1.4\n% ${title} ${lines.join(' ')} ${footer}\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);
    const doc = await pdfLib.PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
    const bold = await doc.embedFont(pdfLib.StandardFonts.HelveticaBold);
    const ascii = (s: string) => s.replace(/[^\x20-\x7e]/g, '-');
    page.drawText(ascii(company!.name ?? 'Sowaka Test'), { x: 56, y: 790, size: 10, font, color: pdfLib.rgb(0.4, 0.4, 0.4) });
    page.drawText(ascii(title), { x: 56, y: 750, size: 18, font: bold });
    lines.forEach((l, i) => page.drawText(ascii(l), { x: 56, y: 715 - i * 18, size: 11, font }));
    page.drawText(footer, { x: 56, y: 48, size: 8, font, color: pdfLib.rgb(0.55, 0.55, 0.55) });
    return Buffer.from(await doc.save());
  }

  // Fictional managers only when the company has none to lend.
  if (!managerPool.length) {
    for (const [i, name] of ['Rhea Kapadia', 'Sameer Dutta'].entries()) {
      const userId = randomUUID();
      await db.users().insertOne({
        userId, name, email: workEmailOf(name), personalEmail: personalEmailOf(name), org, employeeId: `SWT-D${idBase + 90 + i}`, phone: phoneOf(90 + i),
        designation: i ? 'CG Supervisor' : 'Animation Director', department: i ? 'Lighting & Rendering' : 'Animation', role: 'manager',
        joiningDate: new Date(`${D(-2400 - i * 300)}T00:00:00Z`), lifecycleStatus: 'active', onboardingStatus: 'completed', noticeStatus: 'none',
        employeeType: 'full_time', dashboardAccess: false, isLeadership: false, overtimeEligible: true, createdAt: RealDate.now(), updatedAt: new RealDate(), demoSeed: DEMO_TAG,
      } as never);
      await track({ userId });
      managerPool.push({ userId, name, created: true });
    }
  }
  managerPool = managerPool.slice(0, 3);
  const managerFor = (i: number) => managerPool[i % managerPool.length];
  const mgrMe = (m: { userId: string; name: string }) => ({ userId: m.userId, name: m.name, org });
  const location = company.profile?.city?.trim() || hrUser.location || 'Bengaluru';
  const cal = await rules.workCalendar(org, { location });
  const workingOnOrAfter = (day: string) => { let d = day; for (let i = 0; i < 14 && !rules.isWorkingDay(d, cal); i += 1) d = rules.addDaysKey(d, 1); return d; };

  // ── The plan: steps on the fake clock ─────────────────────────────────────
  interface State { journeyId?: string; userId?: string; token?: string; password?: string; error?: string; ip: string; manager: { userId: string; name: string }; i: number }
  const state = new Map<string, State>();
  interface Step { at: number; seq: number; key: string; label: string; run: () => Promise<void> }
  const steps: Step[] = [];
  let seq = 0;
  const add = (p: PersonSpec, day: string, time: string, label: string, run: (s: State) => Promise<void>) => {
    steps.push({ at: istAt(day, time), seq: seq++, key: p.key, label, run: () => run(state.get(p.key)!) });
  };
  const journey = async (id: string) => (await db.journeys().findOne({ id }, { projection: { _id: 0 } })) as Journey;
  const tasksOf = async (id: string) => (await db.journeyTasks().find({ journeyId: id }, { projection: { _id: 0 } }).toArray()) as JourneyTask[];
  const task = async (id: string, key: string, month?: number) => (await tasksOf(id)).find((t) => t.systemKey === key && (!month || t.month === month) && t.status !== 'cancelled');
  const joinerMe = (p: PersonSpec, s: State) => ({ userId: s.userId!, name: p.name, org });

  // Offer → accept → finalise → sign in → set-up → documents → letters → sign → join.
  const S = {
    offer: (p: PersonSpec, day: string, tj: string, extra: Record<string, unknown> = {}) => add(p, day, '10:30', 'offer drafted', async (s) => {
      const firstName = p.name.split(' ')[0];
      const { journeyId } = await offersSvc.createOffer(HR, {
        candidate: { name: p.name, personalEmail: personalEmailOf(p.name), phone: phoneOf(s.i) },
        fields: { designation: p.designation, department: p.department, location, ctc: p.ctc, tj, managerUserId: s.manager.userId, noticeDays: 60,
          validTill: rules.addDaysKey(day, 7), responsibilities: `${firstName} will work on feature-film and series shots in the ${p.department} team.`,
          // The story's dates are fixed relative days; some fall on a week-off or holiday.
          allowNonWorkingDay: true, ...extra },
      });
      s.journeyId = journeyId;
      await track({ journeyId });
    }),
    send: (p: PersonSpec, day: string) => add(p, day, '11:00', 'offer sent', async (s) => {
      const j = await journey(s.journeyId!);
      const v = (await db.offers().findOne({ journeyId: s.journeyId }))!.versions.at(-1)!;
      await offersSvc.uploadOfferPdf(HR, s.journeyId!, { originalname: `Offer letter - ${p.name}.pdf`, buffer: await pdf(`Offer letter: ${p.name}`, [
        `Designation: ${p.designation}`, `Department: ${p.department}`, `Location: ${location}`, `Yearly CTC: Rs ${p.ctc.toLocaleString('en-IN')}`,
        `Joining date: ${j.tj}`, `Probation: ${v.fields.probationMonths} months`, `Valid till: ${v.fields.validTill}`, `Ref: ${v.refNo}`]) });
      await offersSvc.sendOffer(HR, s.journeyId!, {});
      s.token = tokenIn(lastMailTo(personalEmailOf(p.name))?.html ?? '');
    }),
    accept: (p: PersonSpec, day: string, time = '19:15') => add(p, day, time, 'accepted in the portal', async (s) => {
      await offersSvc.acceptOffer(s.token!, { ip: s.ip, userAgent: 'Mozilla/5.0 (Linux; Android 14) demo' });
    }),
    finalise: (p: PersonSpec, day: string) => add(p, day, '11:30', 'finalised by HR', async (s) => {
      await offersSvc.finaliseOffer(HR, s.journeyId!);
      // The portal is a code to their email now (no password): the login list says so.
      s.password = 'code by email';
    }),
    signIn: (p: PersonSpec, day: string) => add(p, day, '20:10', 'signed in to the portal', async (s) => {
      const email = personalEmailOf(p.name);
      await auth.requestSignInCode(email, s.ip);
      // A test address gets no mail and takes the fixed code; any other reads the code off the email.
      const code = /^(\d{6}) is your/.exec(lastMailTo(email)?.subject ?? '')?.[1] ?? '123456';
      await auth.signInWithCode(email, code, s.ip);
    }),
    setup: (p: PersonSpec, day: string) => add(p, day, '12:00', 'manager set-up', async (s) => {
      const people = colleagues.filter((c) => c !== s.manager.userId).slice(s.i % 3, (s.i % 3) + 2).map((userId, k) => ({ userId, why: k ? 'Sits next to you and knows the pipeline' : 'Reviews your shots in dailies' }));
      await app.saveSetup(mgrMe(s.manager), s.journeyId!, { people, welcomeNote: { kind: 'text', text: `Welcome aboard, ${p.name.split(' ')[0]}! Your first shots are lined up.` }, goals: ['Learn the studio pipeline and review process', `Deliver first approved shots in ${p.department}`] });
    }),
    about: (p: PersonSpec, day: string) => add(p, day, '20:30', 'About you', async (s) => {
      await portalSvc.saveAboutYou(await journey(s.journeyId!), { emergencyContact: { name: `${['Sunita', 'Ramesh', 'Anjali', 'Prakash'][s.i % 4]} ${p.name.split(' ').at(-1)}`, relation: 'Parent', phone: phoneOf(60 + s.i) }, pf: { firstJob: true } });
    }),
    upload: (p: PersonSpec, day: string) => add(p, day, '21:00', 'documents uploaded', async (s) => {
      const j = await journey(s.journeyId!);
      for (const d of (await portalSvc.portalDocuments(j)).filter((x) => x.required)) {
        await docsSvc.uploadDocumentFiles(j, d.id, [{ originalname: `${d.docKey}.pdf`, buffer: await pdf(`${d.label}`, [`Candidate: ${p.name}`, 'Sample scan for the demo. Not a real document.']) }]);
      }
    }),
    review: (p: PersonSpec, day: string, sendBack?: string) => add(p, day, '14:30', sendBack ? 'documents reviewed, one sent back' : 'documents approved', async (s) => {
      for (const d of (await portalSvc.portalDocuments(await journey(s.journeyId!))).filter((x) => x.required && x.status === 'in_review')) {
        if (d.docKey === sendBack) await docsSvc.reviewDocument(HRO, d.id, { decision: 'send_back', note: 'The scan is cut off at the edge. Please upload both sides clearly.' });
        else await docsSvc.reviewDocument(HRO, d.id, { decision: 'approve' });
      }
    }),
    pass: (p: PersonSpec, day: string) => add(p, day, '15:00', 'Day-1 pass details', async (s) => {
      await board.updateJourneyByHr(org, s.journeyId!, { day1Pass: {
        reportingTime: '09:30', place: `${company!.name} studio, reception (3rd floor)`, askFor: { name: hrUser.name },
        agenda: [{ time: '11:30', title: 'Meet your manager', with: s.manager.name.split(' ')[0] }, { time: '14:30', title: 'Meet your team' }],
      } });
    }),
    letters: (p: PersonSpec, day: string) => add(p, day, '16:00', 'letters ready to sign', async (s) => {
      for (const l of await db.letters().find({ journeyId: s.journeyId }).toArray()) {
        await lettersSvc.uploadLetterPdf({ org }, l.id, { originalname: `${l.kind}.pdf`, buffer: await pdf(l.kind === 'nda' ? `Non-disclosure agreement: ${p.name}` : `Appointment letter: ${p.name}`, [`Designation: ${p.designation}`, `Department: ${p.department}`, `Joining date: ${(await journey(s.journeyId!)).tj}`]) });
      }
    }),
    meet: (p: PersonSpec, day: string) => add(p, day, '21:15', 'Meet us seen', async (s) => {
      for (const item of await portalSvc.meetItems(await journey(s.journeyId!))) await portalSvc.markMeetSeen(await journey(s.journeyId!), item.id);
    }),
    sign: (p: PersonSpec, day: string) => add(p, day, '21:30', 'letters signed', async (s) => {
      for (const l of await lettersSvc.portalLetters(await journey(s.journeyId!))) {
        await lettersSvc.openLetter(await journey(s.journeyId!), l.id);
        await lettersSvc.signLetter(await journey(s.journeyId!), l.id, { method: 'type', typedName: p.name }, { ip: s.ip, userAgent: 'Mozilla/5.0 (Linux; Android 14) demo' });
      }
    }),
    /** HR's, the manager's and the joiner's own open tasks due on or before `upTo`, done the way each would (the ones a stage is about are left). */
    tidy: (p: PersonSpec, day: string, upTo: string, keep: string[] = []) => add(p, day, '17:45', `tasks due by ${upTo} done`, async (s) => {
      for (const t of await tasksOf(s.journeyId!)) {
        if (!['todo', 'sent_back'].includes(t.status) || !t.dueAt || rules.keyOfDay(t.dueAt) > upTo || keep.includes(String(t.systemKey))) continue;
        if (['mark_joined', 'upload_documents', 'sign_letters', 'accept_offer', 'finalise_offer', 'send_offer', 'review_documents'].includes(String(t.systemKey))) continue;
        try {
          if (t.ownerRole === 'hr' || t.ownerRole === 'hr_manager') await board.actOnTaskByHr(org, s.journeyId!, t.id, { action: 'done' }, HRME);
          else if ((t.ownerRole === 'manager' || t.ownerRole === 'manager_employee') && s.userId) await app.managerTaskDone(mgrMe(s.manager), s.journeyId!, t.id, { action: 'done' });
          else if (t.ownerRole === 'employee' && s.userId) await app.actOnOwnTask(joinerMe(p, s), t.id, { action: 'done' });
        } catch { /* a task with its own screen stays for that screen */ }
      }
    }),
    join: (p: PersonSpec, day: string) => add(p, day, '09:40', 'Mark joined', async (s) => {
      const r = await offersSvc.markJoined(HR, s.journeyId!, { workEmail: workEmailOf(p.name), employeeId: employeeIdOf(p) });
      s.userId = r.userId;
      await track({ userId: r.userId });
      // The live server's 10:00 "new joiner" push looks for this row first: the demo joiner's team is never told.
      if (day === D0) await db.notifications().insertOne({ id: randomUUID(), userId: r.userId, org, scenario: 'new_joiner', title: `${p.name} joined today`, body: 'Demo joiner', data: { dateKey: day, employeeUserId: r.userId }, pushed: false, createdAt: new Date(), demoSeed: DEMO_TAG } as never);
      await app.managerProbationMonth(mgrMe(s.manager), s.journeyId!, 1, { goals: ['Finish the pipeline onboarding', `Deliver two approved ${p.department.toLowerCase()} shots`] });
    }),
    day1: (p: PersonSpec, day: string) => add(p, day, '15:30', 'Day 1 meetings', async (s) => {
      const home = await app.onboardingHome(joinerMe(p, s));
      const meet = home.meetings.find((m) => m.title === 'Meet your manager');
      if (meet) await app.actOnMeeting(joinerMe(p, s), meet.id, { met: 'yes' });
      const team = await task(s.journeyId!, 'meet_team');
      if (team && team.status === 'todo') await app.managerTaskDone(mgrMe(s.manager), s.journeyId!, team.id, { action: 'done' });
    }),
    reels: (p: PersonSpec, day: string, n: number) => add(p, day, '18:30', `${n} week-1 reels`, async (s) => {
      const all: Array<Record<string, unknown>> = [{ step: 'policies', value: { agreed: true } }, { step: 'tax', value: 'new' }, { step: 'bank_pf', value: { confirm: true } }, { step: 'goals', value: { read: true } }];
      for (const step of all.slice(0, n)) {
        try { await app.saveWeek1Step(joinerMe(p, s), step); } catch (e) { if (step.step === 'tax') await app.saveWeek1Step(joinerMe(p, s), { step: 'tax', value: 'old' }).catch(() => { throw e; }); else throw e; }
      }
    }),
    intro: (p: PersonSpec, day: string, line: string, facts: string[]) => add(p, day, '13:15', 'intro posted', async (s) => {
      await app.saveIntro(joinerMe(p, s), { line, funFacts: facts });
      await app.postIntro(joinerMe(p, s));
    }),
    survey: (p: PersonSpec, day: string, answers: Record<string, unknown>) => add(p, day, '17:00', 'survey sent', async (s) => {
      await app.sendSurvey(joinerMe(p, s), { answers });
    }),
    people: (p: PersonSpec, day: string) => add(p, day, '16:00', 'people met', async (s) => {
      for (const x of (await app.peopleView(joinerMe(p, s))).people) await app.actOnPerson(joinerMe(p, s), x.id, { action: 'met' });
    }),
    month: (p: PersonSpec, tj: string, m: number, nextGoals: boolean) => {
      const end = rules.probationMonthEnd(tj, m);
      add(p, rules.addDaysKey(end, -4), '18:00', `month-${m} check-in`, async (s) => {
        await app.checkinForMe(joinerMe(p, s), m, { text: ['Settled into the shot pipeline and finished my first sequence.', 'Took on more complex shots; dailies feedback is getting shorter.', 'Owned a full sequence end to end this month.', 'Helped a new joiner with the review tools.', 'Delivered on the festival trailer.'][(m - 1) % 5], rating: 4 });
      });
      add(p, rules.addDaysKey(end, -3), '12:30', `month-${m} review`, async (s) => {
        await app.managerProbationMonth(mgrMe(s.manager), s.journeyId!, m, { checkin: { text: 'Good month: quality is consistent and turnarounds are quick.', rating: m === 1 ? 3 : 4 } });
        await app.managerProbationMonth(mgrMe(s.manager), s.journeyId!, m, { review: { text: m === 1 ? 'Great start' : 'Keep going', ...(nextGoals ? { nextGoals: [`Month ${m + 1}: own a sequence with minimal notes`, 'Mentor the next joiner on the review tools'] } : {}) } });
      });
    },
  };

  // ── Each person's story, relative to today (D0) ───────────────────────────
  const plan: Record<string, (p: PersonSpec) => void> = {};
  const preJoin = (p: PersonSpec, tj: string, upTo: 'signed' | 'all', probationMonths?: number) => {
    S.offer(p, rules.addDaysKey(tj, -26), tj, probationMonths ? { probationMonths } : {});
    S.send(p, rules.addDaysKey(tj, -26));
    S.accept(p, rules.addDaysKey(tj, -25));
    S.finalise(p, rules.addDaysKey(tj, -24));
    S.signIn(p, rules.addDaysKey(tj, -24));
    S.setup(p, rules.addDaysKey(tj, -22));
    S.about(p, rules.addDaysKey(tj, -21));
    S.upload(p, rules.addDaysKey(tj, -20));
    S.review(p, rules.addDaysKey(tj, -19));
    S.pass(p, rules.addDaysKey(tj, -19));
    S.letters(p, rules.addDaysKey(tj, -18));
    S.meet(p, rules.addDaysKey(tj, -17));
    S.sign(p, rules.addDaysKey(tj, -16));
    if (upTo === 'all') S.tidy(p, rules.addDaysKey(tj, -2), rules.addDaysKey(tj, -1));
  };
  const joined = (p: PersonSpec, tj: string, o: { reels: number; intro: boolean; survey: boolean; tidyTo?: string; people?: boolean; months?: number[]; total?: number }) => {
    preJoin(p, tj, 'all', o.total);
    S.join(p, tj);
    if (tj < D0 || o.reels > 0) S.day1(p, tj);
    if (tj < D0) S.tidy(p, tj, tj, ['week1_reels', 'intro_post', 'day7_survey']);
    if (o.reels) S.reels(p, rules.addDaysKey(tj, Math.min(2, rules.daysBetween(tj, D0))), o.reels);
    if (o.intro) S.intro(p, rules.addDaysKey(tj, Math.min(3, rules.daysBetween(tj, D0) - 1)), ['Animator who storyboards on train rides', 'Lookdev nerd who collects old film cameras', 'Compositor and weekend trekker', 'Matchmove artist and amateur astronomer', 'Rigger who builds mechanical keyboards', 'Editor and Carnatic violinist', 'Modeller who sculpts in clay first', 'Production person who loves a good spreadsheet', 'Lighting TD and street photographer', 'Animator and stand-up comedy fan'][PEOPLE.indexOf(p) % 10], ['Chai over coffee', 'Can quote every Pixar short']);
    if (o.survey) S.survey(p, rules.addDaysKey(tj, 6), { q1: 4, q2: 'mostly', q3: 5, q4: 'More time with my mentor in the first two days' });
    if (o.tidyTo) S.tidy(p, rules.addDaysKey(o.tidyTo, 0), o.tidyTo, ['monthly_checkin', 'monthly_review', 'confirmation_discussion', 'confirmation_letter', 'confirmation_reveal', 'pulse_survey']);
    if (o.people) S.people(p, rules.addDaysKey(tj, 12));
    for (const m of o.months ?? []) S.month(p, tj, m, m < (o.total ?? 6));
  };

  plan.draft = (p) => { S.offer(p, D(-1), workingOnOrAfter(D(30))); };
  plan.sent = (p) => { S.offer(p, D(-2), workingOnOrAfter(D(28))); S.send(p, D(-2)); };
  plan.revised = (p) => {
    S.offer(p, D(-6), workingOnOrAfter(D(24))); S.send(p, D(-6));
    add(p, D(-1), '16:20', 'offer revised (v2 draft)', async (s) => { await offersSvc.reviseOffer(HR, s.journeyId!, { ctc: p.ctc + 100_000, validTill: D(6) }); });
  };
  plan.accepted = (p) => { const tj = workingOnOrAfter(D(21)); S.offer(p, D(-4), tj); S.send(p, D(-4)); S.accept(p, D(-2)); };
  plan.finalised = (p) => { const tj = workingOnOrAfter(D(20)); S.offer(p, D(-8), tj); S.send(p, D(-8)); S.accept(p, D(-7)); S.finalise(p, D(-6)); };
  plan.signed_in = (p) => { const tj = workingOnOrAfter(D(18)); S.offer(p, D(-9), tj); S.send(p, D(-9)); S.accept(p, D(-8)); S.finalise(p, D(-7)); S.signIn(p, D(-6)); S.about(p, D(-5)); };
  plan.docs_review = (p) => { const tj = workingOnOrAfter(D(16)); S.offer(p, D(-10), tj); S.send(p, D(-10)); S.accept(p, D(-9)); S.finalise(p, D(-8)); S.signIn(p, D(-8)); S.setup(p, D(-6)); S.about(p, D(-3)); S.upload(p, D(-1)); };
  plan.sent_back = (p) => { const tj = workingOnOrAfter(D(15)); S.offer(p, D(-11), tj); S.send(p, D(-11)); S.accept(p, D(-10)); S.finalise(p, D(-9)); S.signIn(p, D(-9)); S.setup(p, D(-7)); S.upload(p, D(-4)); S.review(p, D(-2), 'id_proof'); };
  plan.letters = (p) => { const tj = workingOnOrAfter(D(12)); S.offer(p, D(-14), tj); S.send(p, D(-14)); S.accept(p, D(-13)); S.finalise(p, D(-12)); S.signIn(p, D(-12)); S.setup(p, D(-10)); S.about(p, D(-8)); S.upload(p, D(-6)); S.review(p, D(-3)); S.letters(p, D(-1)); };
  plan.ready = (p) => {
    const tj = workingOnOrAfter(D(4));
    S.offer(p, D(-20), tj); S.send(p, D(-20)); S.accept(p, D(-19)); S.finalise(p, D(-18)); S.signIn(p, D(-18)); S.setup(p, D(-16)); S.about(p, D(-15));
    S.upload(p, D(-14)); S.review(p, D(-12)); S.pass(p, D(-12)); S.letters(p, D(-10)); S.meet(p, D(-9)); S.sign(p, D(-2)); S.tidy(p, D(-1), tj);
  };
  plan.date_change = (p) => {
    const tj = workingOnOrAfter(D(10));
    S.offer(p, D(-12), tj); S.send(p, D(-12)); S.accept(p, D(-11)); S.finalise(p, D(-10)); S.signIn(p, D(-10)); S.about(p, D(-9));
    add(p, D(-1), '19:40', 'asked for a new joining date', async (s) => {
      await offersSvc.createDateRequest(await journey(s.journeyId!), { requestedTj: workingOnOrAfter(rules.addDaysKey(tj, 14)), reason: 'Notice period', note: 'My current studio needs me for two more weeks to wrap a delivery.' });
    });
  };
  plan.declined = (p) => {
    S.offer(p, D(-10), workingOnOrAfter(D(20))); S.send(p, D(-10));
    add(p, D(-7), '12:10', 'declined by email', async (s) => { await offersSvc.declineOffer(HR, s.journeyId!, 'Replied by email: accepted a counter-offer from the current studio'); });
  };
  plan.expired = (p) => { S.offer(p, D(-12), workingOnOrAfter(D(14))); S.send(p, D(-12)); };
  plan.not_joining = (p) => {
    S.offer(p, D(-14), workingOnOrAfter(D(12))); S.send(p, D(-14)); S.accept(p, D(-13)); S.finalise(p, D(-12)); S.signIn(p, D(-12));
    add(p, D(-3), '15:40', 'marked not joining', async (s) => { await offersSvc.markNotJoining(HR, s.journeyId!, 'Relocating to Pune for family reasons'); });
  };

  plan.day1 = (p) => joined(p, D0, { reels: 0, intro: false, survey: false });
  plan.week1_day4 = (p) => joined(p, D(-3), { reels: 2, intro: false, survey: false });
  plan.intro = (p) => joined(p, D(-4), { reels: 3, intro: true, survey: false });
  plan.day7_survey = (p) => joined(p, D(-6), { reels: 4, intro: true, survey: false });
  plan.week_done = (p) => joined(p, D(-7), { reels: 4, intro: true, survey: true }); // "Week done" is the day Tj + 7 (board and app share the rule); a day later it is Probation › Month 1
  plan.month1 = (p) => joined(p, D(-14), { reels: 4, intro: true, survey: true, tidyTo: D(-2) });
  plan.months_2_5 = (p) => { const tj = D(-75); joined(p, tj, { reels: 4, intro: true, survey: true, people: true, tidyTo: D(-2), months: [1, 2], total: 6 }); };
  plan.final_month = (p) => { const tj = D(-70); joined(p, tj, { reels: 4, intro: true, survey: true, people: true, tidyTo: D(-2), months: [1, 2], total: 3 }); };
  // The decision letter the product's way (Documents: make it, attach the PDF, email it), which closes
  // the confirmation_letter task and gives the reveal its letter; HR can't tick that task by hand.
  const sendDecisionLetter = async (p: PersonSpec, s: State, kind: 'confirmation' | 'extension') => {
    const merged = await lettersSvc.mergeValues(org, { kind, journeyId: s.journeyId! }, hrUser.name);
    const fill: Record<string, string> = {};
    for (const k of lettersSvc.missingFields(kind, merged.values)) fill[k] = k === 'managerName' ? s.manager.name : `[${k}]`;
    const letter = await lettersSvc.createLetter({ org, name: hrUser.name }, { kind, journeyId: s.journeyId!, values: fill });
    const title = kind === 'confirmation' ? `Confirmation of employment: ${p.name}` : `Extension of probation: ${p.name}`;
    await lettersSvc.uploadLetterPdf({ org }, letter.id, { originalname: `${kind}.pdf`, buffer: await pdf(title, [`Designation: ${letter.values.designation ?? p.designation}`, `Department: ${p.department}`, `Reference: ${letter.refNo}`]) });
    await lettersSvc.sendLetter(HR, letter.id, { to: workEmailOf(p.name), subject: kind === 'confirmation' ? 'Your confirmation letter' : 'Your probation extension letter', body: `Dear ${p.name.split(' ')[0]},\n\nPlease find your letter attached.\n\nRegards,\n${hrUser.name}` });
  };
  plan.confirmed = (p) => {
    const tj = D(-95);
    joined(p, tj, { reels: 4, intro: true, survey: true, people: true, tidyTo: D(-4), months: [1, 2, 3], total: 3 });
    add(p, rules.addDaysKey(rules.probationMonthStart(tj, 3), 1), '11:00', 'M3 pulse', async (s) => { await app.sendSurvey(joinerMe(p, s), { answers: { q1: 5, q2: 'yes', q3: 5 } }); });
    add(p, D(-3), '11:00', 'HR confirms', async (s) => { await probation.recordDecision(s.journeyId!, { ...HRME, seesPay: true }, { outcome: 'confirm', salary: p.ctc + 150_000, designation: `Senior ${p.designation}`, reportingToUserId: s.manager.userId }); });
    add(p, D(-2), '12:00', 'confirmation letter sent', async (s) => { await sendDecisionLetter(p, s, 'confirmation'); });
  };
  plan.extended = (p) => {
    const tj = D(-100);
    joined(p, tj, { reels: 4, intro: true, survey: true, people: true, tidyTo: D(-31), months: [1, 2], total: 3 });
    add(p, D(-30), '11:00', 'HR extends probation by 2 months', async (s) => { await probation.recordDecision(s.journeyId!, { ...HRME, seesPay: true }, { outcome: 'extend', extendMonths: 2 }); });
    add(p, D(-29), '12:00', 'extension letter sent', async (s) => { await sendDecisionLetter(p, s, 'extension'); });
    add(p, D(-28), '19:00', 'reveal seen', async (s) => { await app.revealSeenForMe(joinerMe(p, s)); });
    S.month(p, tj, 3, true);
  };

  // Leavers: existing (fictional) employees, then the exit the product way.
  const leaverUsers = new Map<string, string>();
  const ensureLeaver = async (p: PersonSpec, s: State, tl: string) => {
    const [years, days] = p.tenure ?? [2, 0];
    const joining = rules.addDaysKey(rules.addMonthsKey(tl, -12 * years), -days);
    const userId = randomUUID();
    await db.users().insertOne({
      userId, name: p.name, email: workEmailOf(p.name), personalEmail: personalEmailOf(p.name), org, employeeId: employeeIdOf(p), phone: phoneOf(s.i),
      designation: p.designation, department: p.department, location, managerUserId: s.manager.userId, role: 'employee',
      joiningDate: new Date(`${joining}T00:00:00Z`), lifecycleStatus: 'active', onboardingStatus: 'completed', noticeStatus: 'none',
      employeeType: p.employeeType ?? 'full_time', dashboardAccess: false, isLeadership: false, overtimeEligible: true,
      createdAt: Date.now(), updatedAt: new Date(), demoSeed: DEMO_TAG,
    } as never);
    s.userId = userId;
    leaverUsers.set(p.key, userId);
    await track({ userId });
  };
  const L = {
    resign: (p: PersonSpec, day: string, tl: string, reason: string, note?: string) => add(p, day, '18:20', 'resigned in the app', async (s) => {
      await ensureLeaver(p, s, tl);
      await resig.resign(s.userId!, { reason, ...(note ? { note } : {}) });
    }),
    managerAccepts: (p: PersonSpec, day: string) => add(p, day, '11:40', 'manager accepted', async (s) => {
      const r = (await db.resignations().findOne({ userId: s.userId, status: 'with_manager' }))!;
      await resig.managerResignationAction(s.manager.userId, r.id, { action: 'accept', note: 'Discussed; agreed to the notice period.' });
    }),
    hrAccepts: (p: PersonSpec, day: string, tl: string) => add(p, day, '15:10', 'HR accepted', async (s) => {
      const r = (await db.resignations().findOne({ userId: s.userId, status: { $in: ['with_manager', 'with_hr'] } }))!;
      const res = await resig.acceptResignation(HR.userId, r.id, { lastWorkingDay: tl });
      await track({ journeyId: res.journeyId });
    }),
    start: (p: PersonSpec, day: string, tl: string, body: Record<string, unknown>) => add(p, day, '12:30', `HR started: ${String(body.exitType)}`, async (s) => {
      await ensureLeaver(p, s, tl);
      const res = await offSvc.startExit(HR.userId, s.userId!, { lastWorkingDay: tl, ...body } as never);
      await track({ journeyId: res.journeyId });
    }),
    checklist: (p: PersonSpec, day: string, items: string[]) => add(p, day, '12:00', 'handover checklist shared', async (s) => {
      await offSvc.setHandoverChecklist(s.manager.userId, s.userId!, { items, note: 'Please share these before your last week. Thanks!' });
    }),
    uploads: (p: PersonSpec, day: string, n: number) => add(p, day, '17:30', `${n} handover uploads`, async (s) => {
      const page = await offSvc.myOffboarding(s.userId!);
      for (const item of page.handover.slice(0, n)) await offSvc.uploadHandover(s.userId!, item.id, { url: `https://docs.example.com/handover/${slug(p.name)}/${item.id.slice(0, 8)}` });
    }),
    handoverDone: (p: PersonSpec, day: string) => add(p, day, '12:15', 'manager marked the handover done', async (s) => { await offSvc.markHandoverDone(s.manager.userId, s.userId!); }),
    clearance: (p: PersonSpec, day: string, keys: string[]) => add(p, day, '16:10', `clearance: ${keys.join(', ')}`, async (s) => {
      for (const key of keys) await offSvc.setOffboardingClearance(HR.userId, s.userId!, { key, done: true });
    }),
    interview: (p: PersonSpec, day: string, a: Record<string, unknown>) => add(p, day, '19:00', 'exit interview sent', async (s) => { await offSvc.sendExitInterview(s.userId!, a); }),
    settlementSent: (p: PersonSpec, day: string) => add(p, day, '14:00', 'settlement approved and emailed', async (s) => {
      const user = (await db.users().findOne({ userId: s.userId }))!;
      try {
        await settle.approveSettlement(org, user, { clearanceOverrideReason: 'Demo data' }, HRME);
      } catch {
        // No payroll for a fictional person, so the product cannot work the statement out: a small
        // stand-in (tagged), approved, so the settlement can be emailed and the exit closed.
        const paise = Math.round(p.ctc / 12) * 100;
        await db.exitSettlements().updateOne({ org, userId: s.userId! }, { $set: {
          status: 'approved', approvedAt: new Date(), approvedByUserId: HR.userId, approvedByName: HR.name,
          lines: [{ key: 'leave_encashment', side: 'earning', label: 'Leave encashment (demo)', computedPaise: paise, amountPaise: paise }],
          earningsPaise: paise, deductionsPaise: 0, payablePaise: paise, updatedAt: new Date(), demoSeed: DEMO_TAG,
        }, $setOnInsert: { createdAt: new Date() } } as never, { upsert: true });
      }
      await offSvc.emailSettlement(HR.userId, s.userId!, {
        pdfBase64: (await pdf(`Full and final settlement: ${p.name}`, [`Employee ID: ${employeeIdOf(p)}`, `Last working day: ${user.exit?.lastWorkingDay}`, 'Statement for the demo. Not a real settlement.'])).toString('base64'),
        to: personalEmailOf(p.name), overrideReason: 'Demo data: no payroll run for this person',
      });
    }),
    finishAndClose: (p: PersonSpec, day: string) => add(p, day, '15:30', 'gratuity, relieving letter, closed', async (s) => {
      for (const key of ['gratuity', 'relieving_letter']) { try { await offSvc.offboardingTaskDone(HR.userId, s.userId!, key, {}); } catch { /* not on this exit */ } }
      await offSvc.closeOffboarding(HR.userId, s.userId!, { note: 'Settlement paid, relieving letter sent, PF transfer started' });
    }),
  };
  const answer = (reason: string, w: number, m: number, comeBack: string, change: string) => ({ reason, workingHere: w, manager: m, comeBack, change });
  const fullExit = (p: PersonSpec, tl: string, a: ReturnType<typeof answer> | null, until: 'last_week' | 'last_day' | 'left') => {
    const r = rules.addDaysKey(tl, -32);
    L.resign(p, r, tl, a?.reason === 'Growth' ? 'Growth' : 'Better opportunity');
    L.managerAccepts(p, rules.addDaysKey(r, 1));
    L.hrAccepts(p, rules.addDaysKey(r, 2), tl);
    L.checklist(p, rules.addDaysKey(r, 3), ['Shot files and scene versions on the server', 'Notes on open retakes', 'Rig and asset hand-off to the team']);
    L.uploads(p, rules.addDaysKey(tl, -10), 3);
    L.handoverDone(p, rules.addDaysKey(tl, -8));
    L.clearance(p, rules.addDaysKey(tl, -6), ['laptop', 'id_card', 'advances']);
    if (a) L.interview(p, rules.addDaysKey(tl, until === 'last_week' ? Math.max(-4, -rules.daysBetween(D0, tl) - 1) : -2), a);
  };

  plan.with_manager = (p) => L.resign(p, D(-1), D(59), 'Better opportunity', 'Thank you for three great years. I have accepted an offer abroad.');
  plan.with_hr = (p) => { L.resign(p, D(-3), D(57), 'Relocation'); L.managerAccepts(p, D(-2)); };
  plan.off_accepted = (p) => { L.resign(p, D(-6), D(40), 'Growth'); L.managerAccepts(p, D(-5)); L.hrAccepts(p, D(-4), D(40)); };
  plan.handover = (p) => { L.resign(p, D(-15), D(25), 'Higher studies'); L.managerAccepts(p, D(-14)); L.hrAccepts(p, D(-13), D(25)); L.checklist(p, D(-12), ['Scene files for sequence 12', 'Notes on open retakes', 'Reference library']); L.uploads(p, D(-8), 1); };
  plan.clearance = (p) => { L.resign(p, D(-20), D(14), 'Pay'); L.managerAccepts(p, D(-19)); L.hrAccepts(p, D(-18), D(14)); L.checklist(p, D(-17), ['Pipeline tool docs', 'Render farm scripts']); L.uploads(p, D(-6), 2); L.handoverDone(p, D(-5)); L.clearance(p, D(-2), ['laptop']); };
  plan.exit_interview = (p) => fullExit(p, D(3), null, 'last_week');
  plan.last_week = (p) => fullExit(p, D(4), answer('Growth', 4, 4, 'maybe', 'Clearer growth paths from artist to lead'), 'last_week');
  plan.last_day = (p) => fullExit(p, D0, answer('Pay', 3, 4, 'yes', 'Pay reviews every year, not every two'), 'last_day');
  plan.settlement_due = (p) => fullExit(p, D(-3), answer('Growth', 4, 3, 'maybe', 'A clear path to lead roles'), 'left');
  plan.settlement_sent = (p) => { fullExit(p, D(-12), answer('Growth', 4, 5, 'yes', 'Clearer growth paths and a mentoring track'), 'left'); L.settlementSent(p, D(-8)); };
  plan.closed = (p) => { fullExit(p, D(-40), answer('Work-life balance', 3, 4, 'maybe', 'Fewer weekend crunches before deliveries'), 'left'); L.settlementSent(p, D(-36)); L.finishAndClose(p, D(-8)); };
  plan.withdrawn = (p) => { L.resign(p, D(-6), D(54), 'Personal'); add(p, D(-5), '10:15', 'withdrew the resignation', async (s) => { await resig.withdrawResignation(s.userId!); }); };
  plan.retirement = (p) => { L.start(p, D(-10), D(25), { exitType: 'retirement', noticeHandling: 'served', hrNote: 'Retiring after eighteen years; farewell planned for the last Friday.' }); L.checklist(p, D(-8), ['Production schedules for next quarter', 'Vendor contacts', 'Budget sheets']); };
  plan.end_of_contract = (p) => { L.start(p, D(-12), D(12), { exitType: 'end_of_contract', noticeHandling: 'not_applicable', hrNote: 'Contract for the feature ends; not renewed.' }); L.checklist(p, D(-10), ['Matte paintings for reels 3 and 4', 'Layered PSDs']); L.uploads(p, D(-4), 2); L.handoverDone(p, D(-3)); };
  plan.termination = (p) => { L.start(p, D(-1), D(1), { exitType: 'termination', noticeHandling: 'paid_in_lieu', hrNote: 'Repeated breach of the data policy (demo).' }); };
  plan.absconding = (p) => { L.start(p, D(-8), D(-12), { exitType: 'absconding', noticeHandling: 'not_applicable', hrNote: 'No contact since the 12th; two emails and calls unanswered (demo).' }); };
  plan.alumni1 = (p) => { fullExit(p, D(-95), answer('Growth', 4, 4, 'yes', 'Clearer growth paths for animators'), 'left'); L.settlementSent(p, D(-91)); L.finishAndClose(p, D(-89)); };
  plan.alumni2 = (p) => { fullExit(p, D(-100), answer('Pay', 3, 3, 'no', 'Pay closer to the market for modellers'), 'left'); L.settlementSent(p, D(-96)); L.finishAndClose(p, D(-94)); };
  plan.alumni3 = (p) => { fullExit(p, D(-105), answer('Personal', 5, 4, 'yes', 'Nothing to change'), 'left'); L.settlementSent(p, D(-101)); L.finishAndClose(p, D(-99)); };

  // Exit insights: HR tags the open answers with themes at the end.
  const extraKeys = ['Clearer growth paths', 'Pay and pay reviews', 'Work-life balance', 'Nothing to change'];

  PEOPLE.forEach((p, i) => {
    const manager = managerFor(i);
    state.set(p.key, { i, ip: ipOf(i), manager });
    plan[p.key](p);
  });

  // ── Run: the steps and the scheduler, in time order ───────────────────────
  const cap = RealDate.now() - 60_000;
  steps.sort((a, b) => a.at - b.at || a.seq - b.seq);
  const first = steps[0].at;
  const ticks: number[] = [];
  for (let day = istKey(first); day <= D0; day = rules.addDaysKey(day, 1)) {
    for (const t of ['00:30', '09:30', '16:30']) { const at = istAt(day, t); if (at >= first && at <= cap) ticks.push(at); }
  }
  ticks.push(cap);
  type Event = { at: number; tick: boolean; step?: Step };
  const events: Event[] = [...steps.map((s): Event => ({ at: Math.min(s.at, cap - 1), tick: false, step: s })), ...ticks.map((at): Event => ({ at, tick: true }))]
    .sort((a, b) => a.at - b.at || Number(a.tick) - Number(b.tick) || (a.step?.seq ?? 0) - (b.step?.seq ?? 0));
  installClock();
  say(`\nSeeding ${PEOPLE.length} people: ${steps.length} steps and ${ticks.length} scheduler runs from ${istKey(first)} to now (${D0})…`);
  try {
    for (const ev of events) {
      fakeMs = Math.max(fakeMs ?? 0, ev.at);
      if (ev.tick) {
        const now = new Date();
        for (const job of [() => exitSvc.closeDueExits(now), () => portalSvc.runPortalJobs(now), () => offSvc.runOffboardingJobs(now), () => jobs.runLifecycleJobs(now, { full: true })]) {
          try { await job(); } catch (e) { productErrors.push(`job: ${(e as Error).message}`); }
        }
        continue;
      }
      const st = state.get(ev.step!.key)!;
      if (st.error) continue;
      try { await ev.step!.run(); } catch (e) {
        st.error = `${ev.step!.label} (${istKey(fakeMs!)}): ${(e as Error).message}`;
        say(`  ! ${PEOPLE.find((x) => x.key === ev.step!.key)!.name}: ${st.error}`);
      }
    }
    fakeMs = null;

    // HR tags the exit answers with themes (only the ones this seed made).
    const ours = new Set((await db.surveyResponses().find({ org, kind: 'exit', _id: { $nin: preSurveyIds } }, { projection: { _id: 0, id: 1 } }).toArray()).map((r) => r.id));
    const themeOf = (text: string) => (/growth|lead|mentor/i.test(text) ? extraKeys[0] : /pay/i.test(text) ? extraKeys[1] : /weekend|crunch/i.test(text) ? extraKeys[2] : extraKeys[3]);
    for (const a of (await insights.exitAnswers(HR.userId, {})).answers.filter((x) => ours.has(x.id))) await insights.tagExitAnswer(HR.userId, a.id, { theme: themeOf(a.text) });
  } finally {
    fakeMs = null;
    removeClock();
    console.info = saved.info; console.warn = saved.warn; console.error = saved.error;
  }

  // ── Where everyone is now (real time) ─────────────────────────────────────
  const result = await placements({ org, hrUserId: hrUser.userId, people: PEOPLE.map((p) => ({ spec: p, journeyId: state.get(p.key)!.journeyId, userId: state.get(p.key)!.userId ?? leaverUsers.get(p.key), error: state.get(p.key)!.error })) });
  const portalLogins: SeedResult['portalLogins'] = [];
  for (const p of PEOPLE.filter((x) => x.group === 'Pre-boarding')) {
    const s = state.get(p.key)!;
    if (!s.password || !s.journeyId) continue;
    const view = (await portalSvc.portalHome(await journey(s.journeyId))).view;
    portalLogins.push({ name: p.name, stage: p.stage, email: personalEmailOf(p.name), password: s.password, portalView: view });
  }
  const ins = await insights.exitInsights(HR.userId, {});
  // ── Record and tag everything made (after the reads: a first portal read makes its document rows) ──
  const recorded = await sweepDemo(raw, [...journeyIds], [...userIds]);
  const newSurveys = (await db.surveyResponses().find({ org, _id: { $nin: preSurveyIds } }, { projection: { _id: 1 } }).toArray()).map((r) => r._id);
  if (newSurveys.length) recorded.lifecycle_survey_responses = [...new Set([...(recorded.lifecycle_survey_responses ?? []), ...newSurveys])];
  const newJobs = (await raw.collection('lifecycle_portal_jobs').find({ org, _id: { $nin: prePortalJobs } }, { projection: { _id: 1 } }).toArray()).map((r) => r._id);
  if (newJobs.length) recorded.lifecycle_portal_jobs = [...new Set([...(recorded.lifecycle_portal_jobs ?? []), ...newJobs])];
  for (const [name, ids] of Object.entries(recorded)) if (name !== 'lifecycle_portal_jobs') await raw.collection(name).updateMany({ _id: { $in: ids } as never }, { $set: { demoSeed: DEMO_TAG } });
  const postCounters = await raw.collection('lifecycle_counters').find({ _id: { $regex: `^${org}:` } as never }).toArray();
  const postTemplates = await db.lifecycleTemplates().find({ org }, { projection: { _id: 1, id: 1, isDefault: 1 } }).toArray();
  const postLetterTemplates = await db.letterTemplates().find({ org }, { projection: { _id: 1, id: 1, isDefault: 1 } }).toArray();
  await manifest.updateOne({ _id: manifestId(org) as never }, { $set: {
    status: 'done', finishedAt: new RealDate(), recorded: Object.fromEntries(Object.entries(recorded).map(([k, v]) => [k, v])),
    post: { counters: postCounters, templates: postTemplates, letterTemplates: postLetterTemplates },
    hr: { userId: hrUser.userId, name: hrUser.name }, managers: managerPool,
  } });

  scope.setScriptScope(null);
  emails.interceptLifecycleEmails(null);
  notif.capturePushesForCheck(undefined);
  S3Client.prototype.send = realSend;

  const out: SeedResult = {
    org, companyName: company.name, ranAt: new RealDate(realStart).toISOString(), today: D0,
    hr: { userId: hrUser.userId, name: hrUser.name }, managers: managerPool, people: result, portalLogins,
    exitInsights: { answers: ins.answered.count, hidden: ins.hidden, groupsShown: ins.groups.filter((g) => !g.hidden).map((g) => `${g.label} (${g.answers})`) },
    intercepted: { emails: mails.length, pushes }, productErrors: [...new Set(productErrors)].slice(0, 20),
    recorded: Object.fromEntries(Object.entries(recorded).map(([k, v]) => [k, v.length])),
  };
  printResult(out, say);
  if (opts.out) { writeFileSync(opts.out, JSON.stringify(out, null, 2)); say(`\nWritten to ${opts.out}`); }
  return out;
}

/** Every document that belongs to the demo: by its journey or person, or its tag. */
export async function sweepDemo(raw: import('mongodb').Db, journeyIds: string[], userIds: string[]): Promise<Record<string, unknown[]>> {
  const names = (await raw.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.') && n !== MANIFEST_COLLECTION);
  const out: Record<string, unknown[]> = {};
  for (const name of names) {
    const or: Record<string, unknown>[] = [{ demoSeed: DEMO_TAG }];
    if (userIds.length) or.push({ userId: { $in: userIds } }, { 'author.userId': { $in: userIds } }, { 'data.employeeUserId': { $in: userIds } }, { 'data.userId': { $in: userIds } });
    if (journeyIds.length) or.push({ journeyId: { $in: journeyIds } }, { 'data.journeyId': { $in: journeyIds } });
    if (name === 'lifecycle_journeys' && journeyIds.length) or.push({ id: { $in: journeyIds } });
    if (name === 'lifecycle_portal_jobs' && journeyIds.length) or.push({ _id: { $regex: journeyIds.join('|') } });
    const ids = (await raw.collection(name).find({ $or: or } as never, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
    if (ids.length) out[name] = ids;
  }
  return out;
}

/** Each person's board card (or why there is none), read the way the dashboard reads it. */
export async function placements(input: { org: string; hrUserId: string; people: Array<{ spec: PersonSpec; journeyId?: string; userId?: string; error?: string }> }): Promise<PlacedRow[]> {
  const db = await import('../config/db');
  const board = await import('../services/lifecycle/board');
  const offSvc = await import('../services/lifecycle/offboarding');
  const scope = await import('../services/lifecycle/scriptScope');
  const had = scope.scriptScope();
  if (!had) scope.setScriptScope({ org: input.org, journeyIds: new Set(), userIds: new Set() });
  try {
    const onb = new Map<string, { tab: string; column: string; flags: string[] }>();
    for (const tab of ['pre_boarding', 'first_week', 'probation']) {
      const b = await board.onboardingBoard(input.org, input.hrUserId, { tab });
      for (const col of b.columns) for (const c of col.cards) onb.set(c.journeyId, { tab, column: col.key, flags: c.flags });
    }
    const offb = new Map<string, { tab: string; column: string; nextStep: string }>();
    for (const tab of ['resignations', 'notice', 'exit']) {
      const b = await offSvc.offboardingBoard(input.hrUserId, { tab, from: '2000-01-01' });
      for (const col of b.columns) for (const c of col.cards) offb.set(c.userId, { tab, column: col.key, nextStep: c.nextStep });
    }
    const rows: PlacedRow[] = [];
    for (const { spec, journeyId, userId, error } of input.people) {
      let actual: PlacedRow['actual'] = { board: 'none' };
      if (spec.expect.board === 'onboarding' || (spec.group !== 'Offboarding' && spec.group !== 'Exit insights')) {
        const c = journeyId ? onb.get(journeyId) : undefined;
        if (c) actual = { board: 'onboarding', tab: c.tab, column: c.column, flags: c.flags };
        else if (journeyId) actual = { board: 'none', status: String((await db.journeys().findOne({ id: journeyId }))?.status) };
      } else {
        const c = userId ? offb.get(userId) : undefined;
        if (c && !(spec.expect.board === 'none' && c.column === 'closed')) actual = { board: 'offboarding', tab: c.tab, column: c.column, nextStep: c.nextStep };
        else if (userId) {
          const r = await db.resignations().findOne({ userId }, { sort: { submittedAt: -1 } });
          const u = await db.users().findOne({ userId }, { projection: { _id: 0, exit: 1 } });
          const j = u?.exit?.offboarding?.journeyId ? await db.journeys().findOne({ id: u.exit.offboarding.journeyId }) : null;
          actual = { board: 'none', status: j ? String(j.status) : r ? String(r.status) : 'none' };
        }
      }
      const e = spec.expect;
      const ok = !error && actual.board === e.board && (e.board === 'none' ? actual.status === e.status : actual.tab === e.tab && actual.column === e.column);
      rows.push({ key: spec.key, group: spec.group, stage: spec.stage, name: spec.name, designation: spec.designation, expected: e, actual, ok, where: whereOf(ok ? e : actual), ...(journeyId ? { journeyId } : {}), ...(userId ? { userId } : {}), ...(error ? { error } : {}) });
    }
    return rows;
  } finally {
    if (!had) scope.setScriptScope(null);
  }
}

function printResult(r: SeedResult, say: (...a: unknown[]) => void) {
  say(`\n${r.companyName} (${r.org}) on ${r.today}. HR: ${r.hr.name}. Managers: ${r.managers.map((m) => `${m.name}${m.created ? ' (fictional)' : ''}`).join(', ')}`);
  say(`\n${'Stage'.padEnd(50)} ${'Name'.padEnd(18)} Where to look`);
  let group = '';
  for (const p of r.people) {
    if (p.group !== group) { group = p.group; say(`\n${group}`); }
    say(`  ${p.ok ? '✓' : '✗'} ${p.stage.padEnd(47)} ${p.name.padEnd(18)} ${p.where}${p.ok ? '' : `   (expected ${whereOf(p.expected)})${p.error ? ` — ${p.error}` : ''}`}`);
  }
  say('\nPortal logins (pre-boarding):');
  for (const l of r.portalLogins) say(`  ${l.name.padEnd(18)} ${l.email.padEnd(34)} ${l.password.padEnd(18)} ${l.portalView}`);
  say(`\nExit insights: ${r.exitInsights.answers} answers, ${r.exitInsights.hidden ? 'hidden' : 'shown'}; groups shown: ${r.exitInsights.groupsShown.join(', ') || 'none'}`);
  say(`Intercepted (never sent): ${r.intercepted.emails} emails, ${r.intercepted.pushes} pushes. Placed: ${r.people.filter((p) => p.ok).length}/${r.people.length}.`);
  if (r.productErrors.length) say(`Product errors logged during the run (${r.productErrors.length}):\n  ${r.productErrors.join('\n  ')}`);
}

// ═════════════════════════════════════════════════════════════════════════════ undo
export async function undoLifecycleDemo(opts: Opts): Promise<{ deleted: Record<string, number>; kept: string[] }> {
  const say = opts.quiet ? () => {} : console.log.bind(console);
  if (opts.org !== DEMO_ORG) throw new Refusal(`Refusing: pass --org ${DEMO_ORG}`);
  const org = DEMO_ORG;
  const db = await import('../config/db');
  await db.connectDb();
  const raw = db.getDb();
  const manifest = raw.collection(MANIFEST_COLLECTION);
  const m = await manifest.findOne({ _id: manifestId(org) as never }) as unknown as {
    org: string; journeyIds: string[]; userIds: string[]; recorded?: Record<string, unknown[]>;
    pre: { counters: Array<{ _id: string; seq: number }>; templates: Array<{ id: string; isDefault?: boolean }>; letterTemplates: Array<{ id: string; isDefault?: boolean }> };
    post?: { counters: Array<{ _id: string; seq: number }>; templates: Array<{ id: string; isDefault?: boolean }>; letterTemplates: Array<{ id: string; isDefault?: boolean }> };
  } | null;
  if (!m) throw new Refusal(`Nothing to undo: no demo seed manifest for ${org}`);
  if (m.org !== org) throw new Refusal('Refusing: the manifest is for another company');
  const { removeFile } = await import('../services/lifecycle/files');
  // What the manifest recorded, and anything since made for the same fictional people and journeys.
  const fresh = await sweepDemo(raw, m.journeyIds ?? [], m.userIds ?? []);
  const all: Record<string, unknown[]> = {};
  for (const src of [m.recorded ?? {}, fresh]) for (const [name, ids] of Object.entries(src)) all[name] = [...(all[name] ?? []), ...ids];
  const deleted: Record<string, number> = {};
  const files = await db.lifecycleFiles().find({ _id: { $in: (all.lifecycle_files ?? []) as never[] } }, { projection: { _id: 0, id: 1 } }).toArray();
  for (const f of files) { try { await removeFile(f.id); } catch (e) { say(`  could not remove file ${f.id}: ${(e as Error).message}`); } }
  for (const [name, ids] of Object.entries(all)) {
    const res = await raw.collection(name).deleteMany({ _id: { $in: ids } as never });
    if (res.deletedCount) deleted[name] = (deleted[name] ?? 0) + res.deletedCount;
  }
  if (files.length) deleted.lifecycle_files = (deleted.lifecycle_files ?? 0) + files.length;
  const kept: string[] = [];
  // Reference counters: back to where they were, unless an offer or letter has used them since.
  for (const after of m.post?.counters ?? []) {
    const now = await raw.collection('lifecycle_counters').findOne({ _id: after._id as never });
    const before = m.pre.counters.find((c) => c._id === after._id);
    if (!now || now.seq !== after.seq) { kept.push(`counter ${after._id} (used since the seed)`); continue; }
    if (before) await raw.collection('lifecycle_counters').updateOne({ _id: after._id as never }, { $set: { seq: before.seq } });
    else await raw.collection('lifecycle_counters').deleteOne({ _id: after._id as never });
  }
  // Templates the seed's first offer made (the product's "Standard" ones): removed unless a real journey or letter uses them.
  for (const [coll, pre, post, used] of [
    ['lifecycle_templates', m.pre.templates, m.post?.templates ?? [], async (id: string) => db.journeys().countDocuments({ templateId: id })],
    ['lifecycle_letter_templates', m.pre.letterTemplates, m.post?.letterTemplates ?? [], async (id: string) => db.letters().countDocuments({ templateId: id })],
  ] as const) {
    for (const t of post) {
      const was = pre.find((x) => x.id === t.id);
      if (was) {
        if (!!was.isDefault !== !!t.isDefault) await raw.collection(coll).updateOne({ id: t.id, isDefault: t.isDefault }, { $set: { isDefault: !!was.isDefault } });
        continue;
      }
      if (await used(t.id)) { kept.push(`${coll} ${t.id} (in use)`); continue; }
      const res = await raw.collection(coll).deleteOne({ id: t.id, org });
      if (res.deletedCount) deleted[coll] = (deleted[coll] ?? 0) + 1;
    }
  }
  await manifest.deleteOne({ _id: manifestId(org) as never });
  say(`Undone for ${org}: ${Object.entries(deleted).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing to delete'}`);
  if (kept.length) say(`Kept: ${kept.join('; ')}`);
  return { deleted, kept };
}

// ═════════════════════════════════════════════════════════════════════════════ CLI
function parseArgs(argv: string[]): Opts {
  const opts: Opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--org') opts.org = argv[++i];
    else if (a.startsWith('--org=')) opts.org = a.slice(6);
    else if (a === '--out') opts.out = argv[++i];
    else if (a.startsWith('--out=')) opts.out = a.slice(6);
    else if (a === '--undo') opts.undo = true;
    else if (a === '--fresh') opts.fresh = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else throw new Refusal(`Unknown argument ${a}. Use --org sowaka [--out file.json] [--undo | --fresh | --dry-run]`);
  }
  return opts;
}

if (require.main === module) {
  (async () => {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.undo) await undoLifecycleDemo(opts);
    else {
      const r = await seedLifecycleDemo(opts);
      if (r.people.some((p) => !p.ok)) process.exitCode = 2;
    }
    const db = await import('../config/db');
    await db.closeDb();
    process.exit(process.exitCode ?? 0);
  })().catch((error) => {
    removeClock();
    console.error(error instanceof Refusal ? error.message : String((error as Error)?.stack ?? error));
    process.exit(1);
  });
}
