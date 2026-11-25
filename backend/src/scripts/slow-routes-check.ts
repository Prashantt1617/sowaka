/**
 * The remaining slow routes, made fast (18 Nov): on a local scratch database seeded like Convrse
 * (slow-routes-seed.ts), what each route reads from the database cold and kept, and that nothing
 * changed in what it answers:
 *
 *  - each kept answer equals the one worked out live (the cache off, as scripts run), per viewer;
 *  - a person's payroll screens are kept for them alone (another person never gets them);
 *  - a write shows at once: the person's own (a punch, through a path that drops nothing company-wide),
 *    HR's (a salary change, a payslip, an employee renamed), a feed post; a like drops nothing;
 *  - the one-person attendance counts behind an estimate equal the company report's, for everyone;
 *  - payment details, earnings' period and a run's YTD equal what the old, heavier reads gave;
 *  - the Games list and the Games home page notice a new version and read only what changed;
 *  - a missing thumbnail is made once, stored, and not made again; the media headers let CloudFront keep them;
 *  - the background warm-up waits while live requests are in flight.
 *
 * Bytes are what the database sent (its profiler's responseLength); at the production tier's
 * ~100 KB/s that is roughly the time.
 *
 *   npm run slow-routes:check     (mongod on 127.0.0.1:27160, database slow_routes_scratch)
 */
import type { Request, Response } from 'express';

// Never the .env's cluster: a local mongod only.
process.env.MONGODB_URI = process.env.SLOW_ROUTES_MONGO_URI ?? 'mongodb://127.0.0.1:27160';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(process.env.MONGODB_URI)) throw new Error(`refusing ${process.env.MONGODB_URI}: a local mongod only`);
process.env.MONGODB_DB ??= 'slow_routes_scratch';

let failures = 0;
const ok = (name: string, pass: boolean, detail = '') => {
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!pass) failures += 1;
};
const IST_OFFSET_MS = 330 * 60_000;
const istToday = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Answers compared as JSON, presigned links' signatures aside (they carry the second they were made). */
const norm = (v: unknown) => JSON.stringify(v).replace(/X-Amz-[A-Za-z]+=[^&"]+/g, 'X');
const same = (a: unknown, b: unknown) => norm(a) === norm(b);

const main = async () => {
  const db = await import('../config/db');
  const { seedSlowRoutes, HR, ORG, SCRATCH_FIELD_KEY } = await import('./slow-routes-seed');
  const readCache = await import('../services/lifecycle/readCache');
  const swr = await import('../services/swr-cache');
  const { runAsRequestUser } = await import('../services/request-user');
  const { runAsViewer } = await import('../middleware/request-viewer');
  const { myPayrollHome, homePayPeriod } = await import('../services/employeePayroll.home');
  const { mySalarySummary } = await import('../services/employeePayroll.salary');
  const { myEarnings } = await import('../services/employeePayroll.earnings');
  const kept = await import('../services/employeePayroll.kept');
  const { getRun } = await import('../services/payrollRun.service');
  const { paymentDetails, salaryRegister } = await import('../services/payrollReports.service');
  const { listAllEmployeesForAdmin } = await import('../services/admin.service');
  const { getPersonProfile } = await import('../services/profile.service');
  const { getManagerWorkspace, workspaceRoster } = await import('../services/manager.service');
  const { catalogFor, forgetCatalogRows } = await import('../services/game-catalog.service');
  const { appPageFor, forgetAppPages } = await import('../services/app-page.service');
  const { attendanceCountsForPeriod } = await import('../services/deduction.service');
  const { getMyAttendance } = await import('../services/attendance.service');
  const { offboardingCount } = await import('../services/lifecycle/offboarding');
  const { payrollPeriodRange } = await import('../services/payroll-inputs.service');
  const media = await import('../services/media-copies');
  const { mediaCacheControl } = await import('../services/media-lookup');
  const pace = await import('../services/background-pace');

  await db.connectDb();
  if (!/scratch/.test(db.getDb().databaseName)) throw new Error(`refusing to run against ${db.getDb().databaseName}`);
  const { runIds, people } = await seedSlowRoutes();
  process.env.PAYROLL_FIELD_KEY = SCRATCH_FIELD_KEY;
  const raw = db.getDb();
  const lastRun = runIds[runIds.length - 1];
  const A = people[14]; // an older account with an inline photo, on the flexible template
  const B = people[20];
  const manager = people[2];

  // As requireAuth runs a request: the caller's record (bar the photo) in the request's scope, read
  // before anything is measured (the auth check keeps it in memory between requests).
  const records = new Map<string, Record<string, unknown>>();
  const signedIn = async (userId: string) => {
    if (!records.has(userId)) records.set(userId, (await db.users().findOne({ userId }, { projection: { _id: 0, profilePhotoUrl: 0 } })) as Record<string, unknown>);
    return records.get(userId)!;
  };
  for (const id of [A, B, HR, manager]) await signedIn(id);
  const as = async <T>(userId: string, fn: () => Promise<T>): Promise<T> => {
    const user = await signedIn(userId);
    return new Promise<T>((resolve, reject) => {
      runAsRequestUser({ userId, org: user.org as string }, () => runAsViewer(user as never, () => { fn().then(resolve, reject); }));
    });
  };
  /** The write hook as a request to `path` by `userId` runs it, then the response ends. */
  const writeThrough = (path: string, userId: string, method = 'POST') => {
    const req = { method, path, auth: { userId, user: { org: ORG } } } as unknown as Request;
    const res = { end: () => res, locals: {} } as unknown as Response;
    readCache.forgetReadsOnWrite(req, res, () => undefined);
    (res as unknown as { end: () => void }).end();
    return new Promise((r) => setTimeout(r, 350));
  };

  // Every operation profiled, none written to the server's log (at level 2 slowms only decides what is logged).
  await raw.command({ profile: 2, slowms: 60_000 } as never);
  const bytesOf = async <T>(fn: () => Promise<T>) => {
    // The profiler stamps an operation as it writes it, after the reply: the previous call's last reads settle first.
    await new Promise((r) => setTimeout(r, 80));
    const from = new Date();
    const t0 = Date.now();
    const value = await fn();
    const ms = Date.now() - t0;
    await new Promise((r) => setTimeout(r, 40));
    const rows = await raw.collection('system.profile').find({ ts: { $gte: from }, ns: { $not: /system\.profile/ } }).project({ responseLength: 1 }).toArray();
    return { value, ms, ops: rows.length, bytes: rows.reduce((t, r) => t + (Number(r.responseLength) || 0), 0) };
  };
  const est = (bytes: number) => `${(bytes / 102_400).toFixed(2)} s`;

  // —— 1. Each route: cold (live, as before the copy is kept) and kept, and the kept answer is the live one ——
  type Route = { name: string; who: string; live: () => Promise<unknown>; served: () => Promise<unknown>; keptUnder?: number };
  const routes: Route[] = [
    { name: 'GET /payroll/home', who: A, live: () => myPayrollHome(A, undefined), served: () => kept.keptPayrollHome(A, undefined) },
    { name: 'GET /payroll/me/salary', who: A, live: () => mySalarySummary(A, undefined, new Date(), undefined), served: () => kept.keptSalarySummary(A, undefined, undefined) },
    { name: 'GET /payroll/me/earnings', who: A, live: () => myEarnings(A, undefined), served: () => kept.keptEarnings(A, undefined) },
    { name: 'GET /admin/payroll/runs/:id', who: HR, live: () => getRun(HR, lastRun), served: () => getRun(HR, lastRun), keptUnder: 4_000 },
    { name: 'GET /admin/payroll/runs/:id/payment-details', who: HR, live: () => paymentDetails(HR, lastRun), served: () => paymentDetails(HR, lastRun), keptUnder: 40_000 },
    { name: 'GET /games/catalog', who: A, live: () => catalogFor({ userId: A, name: A, org: ORG }), served: () => catalogFor({ userId: A, name: A, org: ORG }) },
    { name: 'GET /app-pages/games-home', who: A, live: () => appPageFor(ORG, 'games-home'), served: () => appPageFor(ORG, 'games-home') },
    // Served from the workspace's kept roster, which the warm-up keeps (warmed here first).
    { name: 'GET /profile/people/:id', who: A, live: () => getPersonProfile(A, manager), served: async () => { await workspaceRoster(ORG); return getPersonProfile(A, manager); }, keptUnder: 2_000 },
    { name: 'GET /manager/workspace', who: manager, live: async () => getManagerWorkspace(manager, (await signedIn(manager)) as never), served: async () => getManagerWorkspace(manager, (await signedIn(manager)) as never), keptUnder: 90_000 },
    { name: 'GET /admin/employees', who: HR, live: () => listAllEmployeesForAdmin(HR), served: () => listAllEmployeesForAdmin(HR) },
    // Not kept: the month's own rows are read every time, the company's shift setup is (attendance-report orgSetup).
    { name: 'GET /attendance/mine', who: A, live: () => getMyAttendance(A, `${istToday().slice(0, 8)}01`, istToday()), served: () => getMyAttendance(A, `${istToday().slice(0, 8)}01`, istToday()), keptUnder: 12_000 },
    { name: 'GET /admin/lifecycle/offboarding/count', who: HR, live: () => offboardingCount(HR), served: () => offboardingCount(HR), keptUnder: 1_000 },
  ];
  console.log('\nroute                                         cold ops    cold bytes  ~prod   kept ops  kept bytes  ~prod');
  const table: string[] = [];
  for (const r of routes) {
    readCache.enableLifecycleReadCache(false);
    forgetCatalogRows();
    forgetAppPages();
    const cold = await bytesOf(() => as(r.who, r.live));
    readCache.enableLifecycleReadCache(true);
    await as(r.who, r.served);
    const warm = await bytesOf(() => as(r.who, r.served));
    const line = `${r.name.padEnd(45)} ${String(cold.ops).padStart(8)} ${String(cold.bytes).padStart(12)} ${est(cold.bytes).padStart(7)} ${String(warm.ops).padStart(9)} ${String(warm.bytes).padStart(11)} ${est(warm.bytes).padStart(7)}`;
    console.log(line);
    table.push(line);
    ok(`${r.name}: the kept answer is the live one`, same(warm.value, cold.value));
    ok(`${r.name}: kept, it reads ${r.keptUnder ? `under ${r.keptUnder} bytes (live parts only)` : 'nothing'} from the database`, warm.bytes <= (r.keptUnder ?? 600), `${warm.bytes} bytes`);
  }

  // —— 2. A person's payroll is theirs alone ——
  readCache.enableLifecycleReadCache(true);
  readCache.forgetLifecycleReads(ORG);
  const homeA = await as(A, () => kept.keptPayrollHome(A, undefined));
  const homeB = await as(B, () => kept.keptPayrollHome(B, undefined));
  // The services themselves always work it out live; only the API's kept* functions keep it.
  const liveB = await as(B, () => myPayrollHome(B, undefined));
  ok("another person's Payroll home is their own, never the kept copy of someone else's", same(homeB, liveB) && !same(homeA, homeB));
  ok('a person\'s kept copies are keyed by their userId', swr.keptOfKind<unknown>(ORG, 'pay-home').every((k) => typeof (k.params as { userId?: string }).userId === 'string')
    && new Set(swr.keptOfKind<unknown>(ORG, 'pay-home').map((k) => (k.params as { userId: string }).userId)).size === 2);

  // —— 3. Writes show at once ——
  // The person's own punch (a path that drops nothing company-wide): yesterday's missing punch-out now there.
  const yesterday = addDays(istToday(), -1);
  const aRow = await db.users().findOne({ userId: A }, { projection: { employeeId: 1 } });
  await db.attendanceRecords().deleteMany({ $or: [{ userId: A }, { employeeId: aRow?.employeeId }], workDate: yesterday });
  await db.attendanceRecords().insertOne({ userId: A, employeeId: aRow!.employeeId, workDate: yesterday, punchIn: new Date(`${yesterday}T09:10:00+05:30`), source: 'manual', sourceKey: `manual|${aRow!.employeeId}|${yesterday}`, importedAt: new Date(), updatedAt: new Date() } as never);
  readCache.forgetLifecycleReads(ORG);
  const beforePunch = (await as(A, () => kept.keptPayrollHome(A, undefined))) as { missingPunches: { count: number } };
  await as(B, () => kept.keptPayrollHome(B, undefined));
  await db.attendanceRecords().updateOne({ userId: A, workDate: yesterday }, { $set: { punchOut: new Date(`${yesterday}T18:30:00+05:30`) } });
  ok('a punch drops nothing company-wide', readCache.kindsChangedBy('/attendance/punch').length === 0);
  await writeThrough('/attendance/punch', A);
  const afterPunch = (await as(A, () => kept.keptPayrollHome(A, undefined))) as { missingPunches: { count: number } };
  const liveAfterPunch = (await as(A, () => myPayrollHome(A, undefined))) as { missingPunches: { count: number } };
  ok("the person's own punch shows on their next Home at once", same(afterPunch, liveAfterPunch) && afterPunch.missingPunches.count === beforePunch.missingPunches.count - 1, `${beforePunch.missingPunches.count} -> ${afterPunch.missingPunches.count}`);
  const bAfter = await bytesOf(() => as(B, () => kept.keptPayrollHome(B, undefined)));
  ok("someone else's punch leaves another person's kept Home alone", bAfter.bytes < 600, `${bAfter.bytes} bytes`);

  // HR changes a salary: every kept payroll screen at the company goes.
  const grossBefore = ((await as(A, () => kept.keptPayrollHome(A, undefined))) as { salary: { grossPaise: number } }).salary.grossPaise;
  await as(A, () => kept.keptSalarySummary(A, undefined, 'current'));
  await db.salaryStructures().updateOne({ org: ORG, userId: A }, { $set: { annualCtcPaise: 30_00_000_00 } });
  await writeThrough(`/admin/payroll/salary-structures/${A}`, HR, 'PUT');
  const raised = (await as(A, () => kept.keptPayrollHome(A, undefined))) as { salary: { grossPaise: number } };
  const raisedSalary = await as(A, () => kept.keptSalarySummary(A, undefined, 'current'));
  const liveRaised = (await as(A, () => myPayrollHome(A, undefined))) as { salary: { grossPaise: number } };
  const liveRaisedSalary = await as(A, () => mySalarySummary(A, undefined, new Date(), 'current'));
  ok("HR's salary change shows on the person's Home and Salary at once", same(raised, liveRaised) && same(raisedSalary, liveRaisedSalary) && raised.salary.grossPaise > grossBefore, `${grossBefore} -> ${raised.salary?.grossPaise}`);

  // A payslip corrected through a run write shows on the run at once.
  await getRun(HR, lastRun);
  await db.payslips().updateOne({ runId: lastRun, userId: B }, { $set: { netPayablePaise: 4_242_00 } });
  await writeThrough(`/admin/payroll/runs/${lastRun}/recompute`, HR);
  const runAfter = await getRun(HR, lastRun);
  ok('a payslip changed through a run write shows on the run at once', runAfter.payslips.find((p) => p.userId === B)?.netPayablePaise === 4_242_00);
  ok('…and on its payment details', (await paymentDetails(HR, lastRun)).rows.some((r) => r.netPayPaise === 4_242_00));

  // An employee renamed shows on Employees and on a colleague's profile.
  await listAllEmployeesForAdmin(HR);
  await as(A, () => getPersonProfile(A, manager));
  await db.users().updateOne({ userId: manager }, { $set: { name: 'Renamed Manager' } });
  await writeThrough(`/admin/employees/${manager}`, HR, 'PATCH');
  ok('a renamed employee shows on Employees at once', (await listAllEmployeesForAdmin(HR)).some((e) => e.name === 'Renamed Manager'));
  ok("…and on a colleague's profile of them", ((await as(A, () => getPersonProfile(A, manager))) as { name: string }).name === 'Renamed Manager');

  // The feed: a like or a comment drops nothing; a new post drops the boards, never the payroll copies.
  await listAllEmployeesForAdmin(HR);
  await as(A, () => kept.keptPayrollHome(A, undefined));
  await writeThrough('/connect/posts/post-1/reaction', B);
  await writeThrough('/connect/posts/post-1/comments', B);
  const afterLike = await bytesOf(() => listAllEmployeesForAdmin(HR));
  ok('a like and a comment keep the company\'s kept Employees', afterLike.bytes < 600, `${afterLike.bytes} bytes`);
  ok('a new post drops the boards only', same(readCache.kindsChangedBy('/connect/posts'), ['lc-board-data', 'off-board-data', 'mgr-roster', 'adm-regs', 'adm-leaves', 'adm-overtime', 'adm-feedback'])
    && readCache.kindsChangedBy('/connect/posts/post-1').length > 0 && readCache.kindsChangedBy('/connect/posts/post-1/reaction').length === 0);
  ok("another company's write keeps this company's copies", await (async () => {
    const req = { method: 'POST', path: '/leaves', auth: { userId: 'x', user: { org: 'speednoise' } } } as unknown as Request;
    const res = { end: () => res, locals: {} } as unknown as Response;
    readCache.forgetReadsOnWrite(req, res, () => undefined);
    (res as unknown as { end: () => void }).end();
    await new Promise((r) => setTimeout(r, 350));
    return (await bytesOf(() => listAllEmployeesForAdmin(HR))).bytes < 600;
  })());

  // —— 4. Lean reads give what the old ones gave ——
  // The estimate's attendance: one person's counts, graded alone, are the company report's, for everyone.
  const { period, range } = await homePayPeriod(ORG, undefined, new Date());
  const asOf = addDays(istToday(), -1);
  const org = await bytesOf(() => attendanceCountsForPeriod(HR, period, range!, asOf));
  let mismatched = 0;
  let oneBytes = 0;
  for (const userId of [HR, ...people]) {
    const one = await bytesOf(() => attendanceCountsForPeriod(HR, period, range!, asOf, userId));
    oneBytes = Math.max(oneBytes, one.bytes);
    if (!same(one.value.get(userId) ?? null, org.value.get(userId) ?? null) || one.value.size > 1) mismatched += 1;
  }
  ok(`one person's attendance counts equal the company report's, for all ${people.length + 1}`, mismatched === 0, `${mismatched} differ; company ${org.bytes} B, one person at most ${oneBytes} B`);

  // Payment details: what the salary register gave, from a fraction of the reads.
  const regRun = await db.payrollRuns().findOne({ _id: new (await import('mongodb')).ObjectId(lastRun) });
  const register = await bytesOf(() => salaryRegister(HR, regRun!.period, { includeDrafts: true }));
  const fromRegister = {
    period: regRun!.period,
    status: regRun!.status,
    rows: register.value.rows.filter((r) => !r.held).map((r) => ({ employeeId: r.employeeId, name: r.name, paymentMode: r.paymentMode || 'Not set', bankName: r.bankName, accountNumber: r.accountNumber, ifsc: r.ifsc, netPayPaise: r.netPayPaise })),
    held: register.value.rows.filter((r) => r.held).map((r) => ({ employeeId: r.employeeId, name: r.name, netPayPaise: r.netPayPaise })),
  };
  const lean = await bytesOf(() => paymentDetails(HR, lastRun));
  ok('payment details equal what the salary register gave', same(lean.value, fromRegister), `register ${register.bytes} B, now ${lean.bytes} B`);

  // Earnings' period: Home's, without working Home out.
  const homeNow = await as(A, () => myPayrollHome(A, undefined));
  const earningsNow = await as(A, () => myEarnings(A, undefined));
  ok("earnings' year is the year of Home's pay period", (earningsNow as { fy: string }).fy === (homeNow as { fy: string }).fy && (await payrollPeriodRange(ORG, period)).from === range!.from);

  // —— 5. The Games list and the Games home page by version ——
  readCache.enableLifecycleReadCache(true);
  forgetCatalogRows();
  forgetAppPages();
  swr.dropSwr(ORG, ['games-catalog', 'app-page']);
  await catalogFor({ userId: A, name: A, org: ORG });
  await appPageFor(ORG, 'games-home');
  swr.dropSwr(ORG, ['games-catalog', 'app-page']);
  const unchanged = await bytesOf(async () => [await catalogFor({ userId: A, name: A, org: ORG }), await appPageFor(ORG, 'games-home')]);
  ok('a refresh with nothing changed reads only versions', unchanged.bytes < 3_000, `${unchanged.bytes} bytes`);
  await db.gameCatalog().updateOne({ key: 'meow' }, { $set: { name: 'Meow v2', updatedAt: new Date() } });
  await db.appPages().updateOne({ key: 'games-home' }, { $set: { html: '<!doctype html><p>v13</p>', version: 13 } });
  swr.dropSwr(ORG, ['games-catalog', 'app-page']);
  const changed = await bytesOf(async () => [await catalogFor({ userId: A, name: A, org: ORG }), await appPageFor(ORG, 'games-home')]);
  const [games, page] = changed.value as [Awaited<ReturnType<typeof catalogFor>>, Awaited<ReturnType<typeof appPageFor>>];
  ok("a game's new version is read, and only that game", games.some((g) => g.name === 'Meow v2') && changed.bytes < 20_000, `${changed.bytes} bytes`);
  ok("the Games home page's new version is served", page?.version === '13' && page.html.includes('v13'));
  readCache.enableLifecycleReadCache(false);
  ok('the kept Games list equals a live read', same(games, await catalogFor({ userId: A, name: A, org: ORG })));
  readCache.enableLifecycleReadCache(true);
  forgetCatalogRows();
  await db.appPages().updateOne({ key: 'games-home' }, { $set: { enabledOrgs: ['otherco'] } });
  swr.dropSwr(ORG, ['app-page']);
  ok('a page switched off for the company is not served', (await appPageFor(ORG, 'games-home')) === null);

  // —— 6. Thumbnails: a missing copy made once, stored beside the original ——
  const sharp = (await import('sharp')).default;
  const photo = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg({ quality: 95 }).toBuffer();
  const stored = new Map<string, { bytes: Buffer; contentType: string }>([['connect/u/old.jpg', { bytes: photo, contentType: 'image/jpeg' }]]);
  let reads = 0;
  media.setMediaStoreForCheck({
    read: (async (key: string) => {
      reads += 1;
      const hit = stored.get(key);
      if (!hit) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
      const { Readable } = await import('node:stream');
      return { body: Readable.from([hit.bytes]), contentType: hit.contentType, contentLength: hit.bytes.length, contentRange: undefined, etag: '"e"' };
    }) as never,
    put: (async (key: string, file: { bytes: Buffer; contentType: string }) => { stored.set(key, { bytes: file.bytes, contentType: file.contentType }); }) as never,
  });
  const width = media.copyWidthFor(256);
  const [c1, c2, c3] = await Promise.all([1, 2, 3].map(() => media.copyMadeFor('connect/u/old.jpg', width)));
  const copy = stored.get(`connect/u/old.jpg@w${width}`);
  const dims = copy ? await sharp(copy.bytes).metadata() : null;
  ok('three asks at once make one copy, from one read of the original', reads === 1 && !!c1 && c1 === c2 && c2 === c3);
  ok(`the copy is stored beside the original, ${width} px wide and far smaller`, !!copy && dims?.width === width && copy.bytes.length < photo.length / 5, `${copy?.bytes.length} of ${photo.length} bytes`);
  const tiny = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#fff' } }).png().toBuffer();
  stored.set('connect/u/tiny.png', { bytes: tiny, contentType: 'image/png' });
  await media.copyMadeFor('connect/u/tiny.png', width);
  ok('a picture no larger than the copy is stored as its own copy (not tried again)', stored.has(`connect/u/tiny.png@w${width}`));
  stored.set('connect/u/film.gif', { bytes: Buffer.from('GIF89a'), contentType: 'image/gif' });
  const notPicture = await media.copyMadeFor('connect/u/film.gif', width);
  const readsBefore = reads;
  await media.copyMadeFor('connect/u/film.gif', width);
  ok('a file that cannot be resized is not read again for an hour', notPicture === null && reads === readsBefore);
  media.setMediaStoreForCheck(null);
  ok('copies and originals asked for are kept a year by CloudFront and the app', mediaCacheControl({ key: 'connect/a.jpg@w256', copy: true }, 256, 'connect/a.jpg') === 'public, max-age=31536000, immutable');
  ok('an original standing in for a missing copy is kept an hour', mediaCacheControl({ key: 'connect/a.jpg', copy: false }, 256, 'connect/a.jpg') === 'public, max-age=3600');

  // —— 7. The warm-up waits for live requests ——
  pace.enableBackgroundPace(true);
  const quiet0 = Date.now();
  await new Promise((r) => setTimeout(r, 300));
  await pace.yieldToLive(() => false, 3_000);
  const quietMs = Date.now() - quiet0 - 300;
  pace.__liveForCheck(1);
  const busy0 = Date.now();
  setTimeout(() => pace.__liveForCheck(-1), 1_200);
  await pace.yieldToLive(() => false, 3_000);
  const busyMs = Date.now() - busy0;
  pace.__liveForCheck(1);
  const capped0 = Date.now();
  await pace.yieldToLive(() => false, 1_000);
  const cappedMs = Date.now() - capped0;
  pace.__liveForCheck(-1);
  pace.enableBackgroundPace(false);
  ok('a quiet server: a step goes after its short gap', quietMs < 600, `${quietMs} ms`);
  ok('a live request in flight: the step waits until it is done', busyMs >= 1_200 && busyMs < 2_500, `${busyMs} ms`);
  ok('…but never longer than its limit', cappedMs >= 1_000 && cappedMs < 1_500, `${cappedMs} ms`);

  await raw.command({ profile: 0 } as never);
  console.log(`\n${table.length} routes measured`);
  console.log(failures ? `\n${failures} failed` : '\nall slow-route checks passed');
  await db.closeDb();
  process.exit(failures ? 1 : 0);
};

main().catch((error) => { console.error(error); process.exit(1); });
