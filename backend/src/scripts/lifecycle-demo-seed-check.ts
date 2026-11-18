/**
 * Proves the lifecycle demo seed on a scratch database: a "Sowaka Test" like production (an HR
 * dashboard admin, two managers with teams, colleagues, a hidden support admin) and another
 * company with the lifecycle on that must not be touched. Runs the seed, reads every person's
 * board card the way the dashboard does (onboardingBoard / offboardingBoard) and the portal home
 * of the pre-boarding ones, checks that nothing pre-existing changed, that nothing was sent and
 * that everything made is recorded or tagged; then `--undo`, and the database must be exactly as
 * before the seed. Also the refusals (wrong org, no company, a second run) and `--fresh`.
 *
 *   npm run lifecycle:demo-seed-check     (MONGODB_DB=el_demo_scratch on 127.0.0.1:27133 only)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const LOCAL_URI = 'mongodb://127.0.0.1:27133';
if (process.env.MONGODB_URI && process.env.MONGODB_URI !== LOCAL_URI) {
  console.error(`lifecycle:demo-seed-check refuses to run against ${process.env.MONGODB_URI}; it runs on ${LOCAL_URI} only`);
  process.exit(1);
}
process.env.MONGODB_URI = LOCAL_URI;
process.env.MONGODB_DB = process.env.MONGODB_DB ?? 'el_demo_scratch';
process.env.AWS_S3_BUCKET = '';
process.env.NODE_ENV = 'test';
process.env.EMAIL_ORGS = 'sowaka';
process.env.NOTIFY_ORGS = 'lifecycle-demo-seed-notifies-nobody';
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '';
process.env.ZOHO_SMTP_USER = '';
process.env.ZOHO_SMTP_PASS = ''; // what the seed sets when it is the entry point (it refuses otherwise) // as production allows; the seed must still send nothing
process.env.PORTAL_JWT_SECRET = process.env.PORTAL_JWT_SECRET || 'demo-seed-check-secret';

let passed = 0;
let failed = 0;
const failures: string[] = [];
function ok(label: string, condition: unknown, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; const line = `${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)?.slice(0, 1200)}`}`; failures.push(line); console.log(`  FAIL ${line}`); }
}
async function refusal(work: () => Promise<unknown>): Promise<string> {
  try { await work(); return '(no refusal)'; } catch (e) { return (e as Error).message; }
}

(async () => {
  const db = await import('../config/db');
  const { env } = await import('../config/env');
  if (env.mongoUri !== LOCAL_URI || !/^el_demo/.test(env.mongoDbName)) throw new Error(`refusing to run against ${env.mongoUri} / ${env.mongoDbName}`);
  await (await db.connectDb()).dropDatabase();
  const raw = db.getDb();
  const seedMod = await import('./lifecycle-demo-seed');
  const { seedLifecycleDemo, undoLifecycleDemo, PEOPLE, DEMO_TAG, MANIFEST_COLLECTION, placements } = seedMod;
  const { lifecycleOutbox } = await import('../services/lifecycle/emails');

  console.log('\nRefusals before anything exists');
  ok('no --org: refused', /--org sowaka/.test(await refusal(() => seedLifecycleDemo({ quiet: true }))));
  ok('--org convrse: refused', /--org sowaka/.test(await refusal(() => seedLifecycleDemo({ org: 'convrse', quiet: true }))));
  ok('no Sowaka Test company: refused', /no company/.test(await refusal(() => seedLifecycleDemo({ org: 'sowaka', quiet: true }))));
  ok('--undo with nothing seeded: refused', /Nothing to undo/.test(await refusal(() => undoLifecycleDemo({ org: 'sowaka', quiet: true }))));

  // ── The scratch company, as production has it ──────────────────────────────
  await db.companies().insertMany([
    { id: 'sowaka', name: 'Sowaka Test', features: { exits: true }, exitNoticeDays: 60, profile: { displayName: 'Sowaka Test', city: 'Bengaluru', replyToEmail: 'hr@sowaka.test' } },
    { id: 'othercorp', name: 'Other Corp', features: { exits: true, lifecycle: true }, exitNoticeDays: 30 },
  ] as never[]);
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4));
  await db.holidays().insertMany([
    { org: 'sowaka', state: '*', type: 'Public', date: new Date(`${year}-12-25T00:00:00Z`), name: 'Christmas' },
    { org: 'sowaka', state: '*', type: 'Public', date: new Date(`${year + 1}-01-26T00:00:00Z`), name: 'Republic Day' },
    { org: 'sowaka', state: '*', type: 'Public', date: new Date(`${year}-08-15T00:00:00Z`), name: 'Independence Day' },
  ] as never[]);
  const person = (userId: string, name: string, extra: Record<string, unknown> = {}) => ({
    userId, name, email: `${userId}@sowaka.test`, org: 'sowaka', lifecycleStatus: 'active', role: 'employee', employeeType: 'full_time',
    joiningDate: new Date('2021-04-05T00:00:00Z'), createdAt: 1_600_000_000_000, updatedAt: new Date('2025-01-01T00:00:00Z'), ...extra,
  });
  await db.users().insertMany([
    person('swt-hr', 'Asha Verma', { dashboardAccess: true, dashboardAdmin: true, employeeId: 'SWT-001', designation: 'HR Manager', department: 'People' }),
    person('swt-support', 'Sowaka Support', { email: 'support@getsowaka.com', dashboardAccess: true, dashboardAdmin: true, hiddenFromDirectory: true }),
    person('swt-mgr1', 'Rakesh Menon', { role: 'manager', employeeId: 'SWT-002', designation: 'Animation Director', department: 'Animation', managerUserId: 'swt-hr' }),
    person('swt-mgr2', 'Leela Fernandes', { role: 'manager', employeeId: 'SWT-003', designation: 'CG Supervisor', department: 'Lighting & Rendering', managerUserId: 'swt-hr' }),
    person('swt-e1', 'Imran Shaikh', { employeeId: 'SWT-004', designation: 'Senior Animator', department: 'Animation', managerUserId: 'swt-mgr1' }),
    person('swt-e2', 'Geeta Rao', { employeeId: 'SWT-005', designation: 'Lighting Artist', department: 'Lighting & Rendering', managerUserId: 'swt-mgr2' }),
    person('swt-e3', 'Joseph Mathew', { employeeId: 'SWT-006', designation: 'Compositor', department: 'Compositing', managerUserId: 'swt-mgr2' }),
    person('swt-e4', 'Pallavi Desai', { employeeId: 'SWT-007', designation: 'Modeller', department: 'Modelling', managerUserId: 'swt-mgr1' }),
    { ...person('oc-hr', 'Other HR', { dashboardAccess: true, dashboardAdmin: true }), org: 'othercorp', email: 'hr@other.test' },
    { ...person('oc-leaver', 'Other Leaver', { exit: { kind: 'resigned', lastWorkingDay: '2026-01-10', recordedAt: new Date('2025-12-01T00:00:00Z') } }), org: 'othercorp', email: 'leaver@other.test' },
  ] as never[]);
  await db.journeys().insertOne({ id: 'oc-journey', org: 'othercorp', kind: 'onboarding', status: 'offer_sent', candidate: { name: 'Other Candidate', personalEmail: 'other@other.test' }, tj: '2026-12-01', anchors: {}, templateSnapshot: { name: 'x', settings: { probationMonths: 6 }, tasks: [] }, createdAt: new Date('2025-11-01T00:00:00Z') } as never);
  await db.notifications().insertOne({ id: 'pre-n', userId: 'swt-mgr1', org: 'sowaka', scenario: 'leave_request', title: 'x', body: 'y', createdAt: new Date('2025-11-01T00:00:00Z') } as never);

  async function snapshot(): Promise<Map<string, Map<string, string>>> {
    const out = new Map<string, Map<string, string>>();
    for (const { name } of await raw.listCollections({}, { nameOnly: true }).toArray()) {
      if (name.startsWith('system.')) continue;
      const docs = await raw.collection(name).find({}).toArray();
      out.set(name, new Map(docs.map((d) => [String(d._id), JSON.stringify(d)])));
    }
    return out;
  }
  const count = (s: Map<string, Map<string, string>>) => [...s].filter(([, m]) => m.size).map(([n, m]) => `${n}:${m.size}`).sort();
  const before = await snapshot();
  console.log(`\nBefore the seed: ${count(before).join(', ')}`);

  // ── Seed ──────────────────────────────────────────────────────────────────
  const out = path.resolve(__dirname, '../../.local-uploads/el-demo-seed-check.json');
  const started = Date.now();
  const result = await seedLifecycleDemo({ org: 'sowaka', out });
  console.log(`\nSeeded in ${Math.round((Date.now() - started) / 1000)} s`);
  ok('the real clock is back after the seed', Math.abs(new Date().getTime() - Date.now()) < 1000 && (globalThis.Date as unknown as { name: string }).name === 'Date');

  console.log('\nEvery person lands where the stage says (board reads)');
  for (const row of result.people) ok(`${row.stage}: ${row.name} → ${row.where}`, row.ok, { expected: row.expected, actual: row.actual, error: row.error });
  // Independent re-read through the same board services, with a fresh scope (none set).
  const again = await placements({ org: 'sowaka', hrUserId: result.hr.userId, people: result.people.map((r) => ({ spec: PEOPLE.find((p) => p.key === r.key)!, journeyId: r.journeyId, userId: r.userId })) });
  ok('a second board read agrees for every person', again.every((r) => r.ok), again.filter((r) => !r.ok).map((r) => [r.key, r.actual]));
  ok('one person per stage, every stage present', result.people.length === PEOPLE.length && new Set(result.people.map((r) => r.stage)).size === PEOPLE.length);
  ok('HR is the visible dashboard admin, not the hidden support account', result.hr.userId === 'swt-hr', result.hr);
  ok('the managers are the existing ones', result.managers.length === 2 && result.managers.every((m) => !m.created && ['swt-mgr1', 'swt-mgr2'].includes(m.userId)), result.managers);

  console.log('\nThe details each stage is about');
  const jOf = async (key: string) => (await db.journeys().findOne({ id: result.people.find((p) => p.key === key)!.journeyId }))!;
  const uOf = async (key: string) => (await db.users().findOne({ userId: result.people.find((p) => p.key === key)!.userId }))!;
  const tOf = async (key: string, sk: string) => db.journeyTasks().findOne({ journeyId: (await jOf(key)).id, systemKey: sk as never, status: { $ne: 'cancelled' } });
  const offerOf = async (key: string) => (await db.offers().findOne({ journeyId: (await jOf(key)).id }))!;
  ok('offer draft: v1 draft, never sent', (await offerOf('draft')).versions.map((v) => v.status).join() === 'draft');
  ok('revised: v1 sent, v2 a draft waiting to send', (await offerOf('revised')).versions.map((v) => v.status).join() === 'sent,draft');
  ok('accepted: finalising is late for HR', (await tOf('accepted', 'finalise_offer'))?.status === 'todo' && result.people.find((p) => p.key === 'accepted')!.actual.flags?.includes('needs_you'));
  ok('finalised: a portal account, never signed in', !(await db.candidateAccounts().findOne({ journeyId: (await jOf('finalised')).id }))?.lastSignInAt);
  ok('in review: the uploads wait for HR', (await tOf('docs_review', 'upload_documents'))?.status === 'in_review');
  ok('sent back: one document sent back', (await db.candidateDocuments().countDocuments({ journeyId: (await jOf('sent_back')).id, status: 'sent_back' })) === 1);
  ok('ready to join: letters signed, the Day-1 pass done', (await tOf('ready', 'sign_letters'))?.status === 'done' && (await tOf('ready', 'day1_pass'))?.status === 'done');
  ok('date change: one pending request', (await db.dateChangeRequests().countDocuments({ journeyId: (await jOf('date_change')).id, status: 'pending' })) === 1);
  ok('day 1: joined today, the work email is .demo@sowaka.test', (await jOf('day1')).tj === today && (await uOf('day1')).email === 'aditya.narang.demo@sowaka.test');
  const w = (await jOf('week1_day4')).week1 ?? {};
  ok('week 1 day 4: 2 of 4 reels', [w.policies, w.taxRegime, w.bankPf, w.goalsReadAt].filter(Boolean).length === 2, w);
  ok('intro post: posted to Connect (tagged)', !!(await jOf('intro')).intro?.postedAt && (await db.connectPosts().countDocuments({ 'author.userId': (await uOf('intro')).userId, demoSeed: DEMO_TAG } as never)) === 1);
  ok('Day-7 survey open, not sent; week done: sent', (await tOf('day7_survey', 'day7_survey'))?.status === 'todo' && (await tOf('week_done', 'day7_survey'))?.status === 'done');
  ok('months 2–5: months 1 and 2 checked in and reviewed', (await db.journeyTasks().countDocuments({ journeyId: (await jOf('months_2_5')).id, systemKey: { $in: ['monthly_checkin', 'monthly_review'] } as never, month: { $in: [1, 2] }, status: 'done' })) === 4);
  ok('final month: Decide', result.people.find((p) => p.key === 'final_month')!.actual.flags?.includes('decide'));
  const conf = await jOf('confirmed');
  ok('confirmed: the decision, the letter done, the reveal not seen yet', conf.probation?.decision?.outcome === 'confirm' && !conf.probation.decision.revealedAt && (await tOf('confirmed', 'confirmation_letter'))?.status === 'done');
  ok('extended: by 2 months, the reveal seen', (await jOf('extended')).probation?.extendedBy === 2 && !!(await jOf('extended')).probation?.decision?.revealedAt);
  ok('settlement sent: emailed to the personal email', (await uOf('settlement_sent')).exit?.offboarding?.settlementEmail?.to === 'omkar.joshi@example.com');
  ok('closed: the offboarding journey is closed', (await db.journeys().findOne({ id: (await uOf('closed')).exit?.offboarding?.journeyId }))?.status === 'closed');
  ok('termination: the app page is off', (await uOf('termination')).exit?.offboarding?.showAppPage === false);
  ok('absconding: recorded as absconded, the case open', (await uOf('absconding')).exit?.kind === 'absconded' && !(await uOf('absconding')).exit?.caseClosedAt);
  ok('withdrawn: the resignation is withdrawn, no exit', (await db.resignations().findOne({ userId: (await uOf('withdrawn')).userId }))?.status === 'withdrawn' && !(await uOf('withdrawn')).exit);
  ok('no product errors were logged during the run', result.productErrors.length === 0, result.productErrors);

  console.log('\nThe portal, for the pre-boarding people with accounts');
  const portal = await import('../services/lifecycle/portal');
  const scope = await import('../services/lifecycle/scriptScope');
  scope.setScriptScope({ org: 'sowaka', journeyIds: new Set(), userIds: new Set() }); // the feature is off in this company: read as the seed did
  const home = async (key: string) => {
    const r = result.people.find((p) => p.key === key)!;
    return portal.portalHome((await db.journeys().findOne({ id: r.journeyId }, { projection: { _id: 0 } }))!);
  };
  const views: Record<string, string> = {};
  for (const key of ['finalised', 'signed_in', 'docs_review', 'sent_back', 'letters', 'ready', 'date_change', 'not_joining']) views[key] = (await home(key)).view;
  console.log(`  views: ${JSON.stringify(views)}`);
  ok('ready to join: the Day-1 pass is open', views.ready === 'pass_unlocked', views.ready);
  ok('letters: the letter is ready to sign', views.letters === 'letter_ready', views.letters);
  ok('sent back: Up next is the re-upload', /^Re-upload/.test((await home('sent_back')).upNext?.title ?? ''), (await home('sent_back')).upNext);
  ok('date change: the request shows as pending', !!(await home('date_change')).pendingDateRequest, (await home('date_change')).pendingDateRequest);
  ok('not joining: the portal is closed', views.not_joining === 'closed' && (await home('not_joining')).closedState === 'not_joining');
  ok('signed in / in review / finalised: an open portal', ['finalised', 'signed_in', 'docs_review'].every((k) => views[k] !== 'closed'), views);
  ok('portal logins for every pre-boarding person with an account (not the offer-only ones)', result.portalLogins.length === 8 && result.portalLogins.every((l) => /@example\.com$/.test(l.email) && l.password.length >= 8)
    && !result.portalLogins.some((l) => ['Aarav Kulkarni', 'Ishita Rao', 'Kabir Malhotra', 'Meera Pillai'].includes(l.name)), result.portalLogins.map((l) => l.name));
  const auth = await import('../services/lifecycle/portalAuth');
  const ready = result.portalLogins.find((l) => l.name === 'Nisha Agarwal')!;
  // The portal signs in with a code to the email now; a test address takes the fixed code.
  const { env: envCfg } = await import('../config/env');
  envCfg.otpTestEmails.push(ready.email);
  ok('a portal login signs in with a code to its email', 'token' in (await auth.signInWithCode(ready.email, '123456', '198.51.100.7')));
  scope.setScriptScope(null);
  const offMsg = await refusal(() => auth.signInWithCode(ready.email, '123456', '198.51.100.8'));
  envCfg.otpTestEmails.splice(envCfg.otpTestEmails.indexOf(ready.email), 1);
  ok(`outside the seed the portal stays off for Sowaka Test (the feature was not switched on): "${offMsg}"`, offMsg !== '(no refusal)');

  console.log('\nExit insights');
  ok('at least 6 anonymised exit answers, the overall view shown', result.exitInsights.answers >= 6 && !result.exitInsights.hidden, result.exitInsights);
  ok('a department group shows (5 or more answers)', result.exitInsights.groupsShown.some((g) => /^Animation/.test(g)), result.exitInsights.groupsShown);
  const exitRows = await db.surveyResponses().find({ org: 'sowaka', kind: 'exit' }).toArray();
  ok('the exit rows carry no person and are tagged', exitRows.every((r) => !('userId' in r) && !('journeyId' in r) && (r as { demoSeed?: string }).demoSeed === DEMO_TAG), exitRows.length);

  console.log('\nNothing sent, nothing else changed');
  ok('emails were intercepted, none reached the outbox or SMTP', result.intercepted.emails > 20 && lifecycleOutbox().length === 0, { intercepted: result.intercepted.emails, outbox: lifecycleOutbox().length });
  ok('no push went out', result.intercepted.pushes === 0);
  const notes = await db.notifications().find({ id: { $ne: 'pre-n' } }).toArray();
  ok('no notification rows except the tagged new-joiner marker on the Day-1 joiner', notes.length === 1 && notes[0].scenario === 'new_joiner' && (notes[0] as { demoSeed?: string }).demoSeed === DEMO_TAG, notes.map((n) => [n.scenario, n.userId]));
  const after = await snapshot();
  const changed: string[] = [];
  for (const [name, docs] of before) for (const [id, json] of docs) if (after.get(name)?.get(id) !== json) changed.push(`${name}/${id}`);
  ok('every document that was there before is unchanged (company, HR, managers, colleagues, Other Corp)', changed.length === 0, changed.slice(0, 10));
  const company = await db.companies().findOne({ id: 'sowaka' });
  ok('features.lifecycle is still not set on Sowaka Test', company?.features?.lifecycle === undefined);
  const manifest = (await raw.collection(MANIFEST_COLLECTION).findOne({}))! as unknown as { status: string; recorded: Record<string, unknown[]>; post: { counters: Array<{ _id: string }>; templates: Array<{ id: string }>; letterTemplates: Array<{ id: string }> } };
  ok('the manifest is done', manifest?.status === 'done');
  const recordedIds = new Map(Object.entries(manifest.recorded).map(([k, v]) => [k, new Set(v.map(String))]));
  const untracked: string[] = [];
  for (const [name, docs] of after) {
    if (name === MANIFEST_COLLECTION) continue;
    for (const [id, json] of docs) {
      if (before.get(name)?.has(id)) continue;
      const doc = JSON.parse(json) as { demoSeed?: string; id?: string; org?: string };
      const known = recordedIds.get(name)?.has(id) || doc.demoSeed === DEMO_TAG
        || (name === 'lifecycle_counters' && manifest.post.counters.some((c) => String(c._id) === id))
        || (name === 'lifecycle_templates' && manifest.post.templates.some((t) => t.id === doc.id))
        || (name === 'lifecycle_letter_templates' && manifest.post.letterTemplates.some((t) => t.id === doc.id));
      if (!known) untracked.push(`${name}/${id}`);
    }
  }
  ok('every new document is in the manifest or tagged demoSeed', untracked.length === 0, untracked.slice(0, 10));
  ok('everything new is in Sowaka Test (no other company got anything)', [...after].every(([name, docs]) => [...docs].every(([id, json]) => before.get(name)?.has(id) || !/"org":"othercorp"/.test(json))));
  const demoUsers = await db.users().find({ demoSeed: DEMO_TAG }).toArray();
  ok('fictional contacts only: work emails .demo@sowaka.test, personal @example.com, phones +91 98000', demoUsers.length > 25 && demoUsers.every((u) => /\.demo@sowaka\.test$/.test(u.email) && /@example\.com$/.test(u.personalEmail ?? '') && /^\+91 98000 \d{5}$/.test(u.phone ?? '')),
    demoUsers.filter((u) => !/\.demo@sowaka\.test$/.test(u.email) || !/^\+91 98000/.test(u.phone ?? '')).map((u) => [u.email, u.phone]));
  const candidates = await db.journeys().find({ org: 'sowaka', kind: 'onboarding' }).toArray();
  ok('every candidate’s personal email is @example.com', candidates.every((j) => /@example\.com$/.test(j.candidate?.personalEmail ?? '')));
  const json = JSON.parse(readFileSync(out, 'utf8')) as { people: unknown[]; portalLogins: unknown[] };
  ok('the --out JSON has the table and the portal logins', json.people.length === PEOPLE.length && json.portalLogins.length === result.portalLogins.length);
  ok('a second run refuses', /already ran/.test(await refusal(() => seedLifecycleDemo({ org: 'sowaka', quiet: true }))));

  // ── Undo ──────────────────────────────────────────────────────────────────
  console.log('\n--undo');
  const undone = await undoLifecycleDemo({ org: 'sowaka' });
  const restored = await snapshot();
  const diff: string[] = [];
  for (const name of new Set([...before.keys(), ...restored.keys()])) {
    const a = before.get(name) ?? new Map();
    const b = restored.get(name) ?? new Map();
    for (const [id, v] of a) if (b.get(id) !== v) diff.push(`changed or missing ${name}/${id}`);
    for (const id of b.keys()) if (!a.has(id)) diff.push(`left over ${name}/${id}`);
  }
  ok('after --undo the database is exactly as before the seed', diff.length === 0, diff.slice(0, 12));
  ok('the counts are the pre-seed counts', JSON.stringify(count(restored)) === JSON.stringify(count(before)), { before: count(before), after: count(restored) });
  ok('undo kept nothing back', undone.kept.length === 0, undone.kept);
  const uploads = path.resolve(__dirname, '../../.local-uploads/lifecycle/sowaka');
  const files = existsSync(uploads) ? readdirSync(uploads, { recursive: true }).filter((f) => /\.\w+$/.test(String(f))) : [];
  ok('the uploaded files are gone too', files.length === 0, files.slice(0, 5));

  // ── --fresh: seed, then seed again with --fresh, then undo ─────────────────
  console.log('\n--fresh');
  await seedLifecycleDemo({ org: 'sowaka', quiet: true });
  const fresh = await seedLifecycleDemo({ org: 'sowaka', fresh: true, quiet: true });
  ok('--fresh undoes the earlier seed and seeds again (all placed)', fresh.people.every((r) => r.ok), fresh.people.filter((r) => !r.ok).map((r) => [r.key, r.actual, r.error]));
  ok('…with one set of demo people, not two', (await db.users().countDocuments({ demoSeed: DEMO_TAG })) === demoUsers.length);
  await undoLifecycleDemo({ org: 'sowaka', quiet: true });
  const last = await snapshot();
  ok('undo after --fresh: back to the pre-seed counts', JSON.stringify(count(last)) === JSON.stringify(count(before)), { before: count(before), after: count(last) });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) console.log(`\nFailures:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  await db.closeDb();
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(String(error?.stack ?? error));
  process.exit(1);
});
