/**
 * Suwi speed check, on a scratch database only, with a stub model.
 *
 *   MONGODB_DB=suwi_speed_scratch npm run suwi-speed:check
 *
 * Seeds the engagement speed org (fifty people, a month of punches and leave)
 * plus waiting leave and corrections, then:
 *   - asks four questions through the real askSuwi loop and the real tools,
 *     with a stub model (fixed latency per round) that asks for the tools a
 *     scripted plan names, and prints rounds, tool ms and bytes read;
 *   - checks the per-question memo, the one-day lists, that a Suwi question
 *     does not drop the kept notices while a leave decision does, and that a
 *     second viewer's first notices use the company's shared copy.
 *
 * Bytes are what the database sent back (the profiler's responseLength), so
 * "on prod" adds them at the throttled link's ~100 KB/s.
 */
process.env.SUWI_PROVIDER = 'claude';
process.env.ANTHROPIC_API_KEY = 'stub-key';
process.env.GEMINI_API_KEY = 'stub-key';
// A local Redis for the kept copies and the answer cache (REDIS_URL from the caller, else none: those checks are skipped).
const REDIS = Boolean(process.env.REDIS_URL);

const STUB_ROUND_MS = Number(process.env.STUB_ROUND_MS ?? 900);
/** The small model writing a short answer with thinking at its least: quicker than a full round. */
const STUB_SMALL_MS = Number(process.env.STUB_SMALL_MS ?? 600);
/** Every model call the stub saw: which model, and whether it was offered tools. */
const stubCalls: { model: string; tools: boolean }[] = [];
const PROD_BYTES_PER_S = 100 * 1024;

type Call = { name: string; input: Record<string, unknown> };
type Step = { tools: Call[] } | { text: string };
let plan: Step[] = [];

// The stub model: answers the Anthropic Messages API with the next step of the plan.
const realFetch = globalThis.fetch;
let geminiChunks: string[] = [];
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (String(url).includes('streamGenerateContent')) {
    // Gemini's server-sent events, one chunk at a time with a pause, as the service sends them.
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(c) {
        for (const chunk of geminiChunks) { c.enqueue(enc.encode(`data: ${chunk}\r\n\r\n`)); await new Promise((r) => setTimeout(r, 40)); }
        c.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }
  if (!String(url).includes('api.anthropic.com')) return realFetch(url as string, init);
  const body = JSON.parse(String(init?.body ?? '{}')) as { messages: { role: string }[]; model?: string; tools?: unknown[] };
  stubCalls.push({ model: String(body.model ?? ''), tools: Boolean(body.tools?.length) });
  const round = body.messages.filter((m) => m.role === 'assistant').length;
  const step = plan[Math.min(round, plan.length - 1)];
  await new Promise((r) => setTimeout(r, /haiku|lite/.test(String(body.model)) ? STUB_SMALL_MS : STUB_ROUND_MS));
  const content = 'tools' in step
    ? step.tools.map((t, i) => ({ type: 'tool_use', id: `${t.name}-${round}-${i}`, name: t.name, input: t.input }))
    : [{ type: 'text', text: step.text }];
  const reply = { content, stop_reason: 'tools' in step ? 'tool_use' : 'end_turn', usage: { input_tokens: 1000, output_tokens: 100 }, model: 'stub' };
  return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

let failures = 0;
function ok(label: string, pass: boolean, detail = ''): void {
  if (!pass) failures += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${!pass && detail ? `\n      ${detail}` : ''}`);
}

const IST = 330 * 60_000;
const istToday = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function main() {
  const db = await import('../config/db');
  const seed = await import('./engagement-speed-check');
  const { askSuwi } = await import('../suwi/agent');
  const { suwiNotices } = await import('../suwi/notices');
  const { contextFor } = await import('../suwi/tools');
  const { settingsFor } = await import('../suwi/store');
  const readCache = await import('../services/lifecycle/readCache');
  const { ObjectId } = await import('mongodb');

  // Convrse-sized when asked (SUWI_CHECK_PEOPLE=230); 50 keeps the routine run quick.
  await seed.seedSpeedOrg(Number(process.env.SUWI_CHECK_PEOPLE ?? 50), 30);
  const raw = db.getDb();
  if (!/scratch/.test(raw.databaseName)) throw new Error(`refusing to run against ${raw.databaseName}`);
  const ORG = seed.ORG;
  const today = istToday();

  // Suwi on for the scratch company; two full-access HR users (the seed's HR and a second one).
  await raw.collection('suwi_settings').updateOne({ org: ORG }, { $set: { org: ORG, enabled: true, monthlyBudgetUsd: 1000 } }, { upsert: true });
  await db.users().updateOne({ userId: seed.HR }, { $set: { dashboardAccess: true, dashboardAdmin: true } });
  await db.users().insertOne({ userId: 'speed-hr2', name: 'Second HR', email: 'hr2@speed.test', org: ORG, lifecycleStatus: 'active', role: 'employee', dashboardAccess: true, joiningDate: new Date('2025-01-01') } as never);
  // Waiting requests: leave from a few days ago, and attendance corrections.
  const people = (await db.users().find({ org: ORG, userId: /^speed-\d/ }).project({ _id: 0, userId: 1, managerUserId: 1 }).toArray()) as { userId: string; managerUserId?: string }[];
  const pendingLeave = people.slice(0, 8).map((p, i) => ({ _id: new ObjectId(), org: ORG, userId: p.userId, type: 'casual', startDate: new Date(`${addDays(today, 3 + i)}T00:00:00Z`), endDate: new Date(`${addDays(today, 3 + i)}T00:00:00Z`), reason: 'family', status: 'pending', halfDay: false, createdAt: Date.now() - (i + 1) * 86_400_000 }));
  await db.leaves().insertMany(pendingLeave as never);
  await raw.collection('attendance_regularizations').insertMany(people.slice(10, 13).map((p, i) => ({ userId: p.userId, managerUserId: p.managerUserId ?? seed.HR, workDate: addDays(today, -2 - i), requestedDayType: 'full_day', note: 'forgot to punch out', status: 'pending', createdAt: new Date(Date.now() - (i + 2) * 86_400_000) })) as never);
  // Approved leave today for two people, one of them a half day.
  await db.leaves().insertMany([
    { org: ORG, userId: people[20].userId, type: 'casual', startDate: new Date(`${today}T00:00:00Z`), endDate: new Date(`${today}T00:00:00Z`), reason: 'x', status: 'approved', halfDay: false, createdAt: Date.now() - 5 * 86_400_000 },
    { org: ORG, userId: people[21].userId, type: 'sick', startDate: new Date(`${today}T00:00:00Z`), endDate: new Date(`${today}T00:00:00Z`), reason: 'x', status: 'approved', halfDay: true, createdAt: Date.now() - 5 * 86_400_000 },
  ] as never);
  await db.attendanceRecords().deleteMany({ userId: { $in: [people[20].userId, people[21].userId] }, workDate: today });

  readCache.enableLifecycleReadCache(true);
  const kept = await import('../suwi/kept');
  if (REDIS) {
    const { redisClient } = await import('../config/redis');
    const r = redisClient()!;
    if (r.status !== 'ready') await new Promise((res) => r.once('ready', res));
    await r.flushdb();
  }
  const hr = (await db.users().findOne({ userId: seed.HR }))!;
  const hr2 = (await db.users().findOne({ userId: 'speed-hr2' }))!;
  const settings = await settingsFor(ORG);

  // The profiler counts what the database sends back.
  await raw.command({ profile: 2, slowms: 0 } as never);
  const bytesSince = async (from: Date) => {
    const rows = await raw.collection('system.profile').find({ ts: { $gt: from }, ns: { $not: /system\.profile/ } }).project({ responseLength: 1 }).toArray();
    return rows.reduce((t, r) => t + (Number(r.responseLength) || 0), 0);
  };

  const AS = (input: Record<string, unknown>): Call => ({ name: 'attendance_summary', input });
  const day = { from: today, to: today };
  const questions: { q: string; before: Step[]; after: Step[] }[] = [
    // Before: what prod's audit shows the model doing; after: what the new tool descriptions ask for.
    { q: 'who is on leave today?', before: [{ tools: [AS(day)] }, { tools: [{ name: 'pending_requests', input: {} }] }, { text: 'done' }], after: [{ tools: [AS(day)] }, { text: 'done' }] },
    { q: 'who is late today?', before: [{ tools: [AS(day)] }, { tools: [AS({ ...day, status: 'late' })] }, { text: 'done' }], after: [{ tools: [AS(day)] }, { text: 'done' }] },
    { q: 'what is waiting for approval?', before: [{ tools: [{ name: 'pending_requests', input: {} }] }, { text: 'done' }], after: [{ tools: [{ name: 'pending_requests', input: {} }] }, { text: 'done' }] },
    { q: `leave balance of ${people[3].userId}`, before: [{ tools: [{ name: 'leave_balance', input: { userId: people[3].userId } }] }, { text: 'done' }], after: [{ tools: [{ name: 'leave_balance', input: { userId: people[3].userId } }] }, { text: 'done' }] },
  ];
  // Modes: before = the model on every question, the old plan, no Redis; model = the new plan; instant =
  // the instant answers; repeat = the same question again (the answer cache, Redis only).
  const modes = [
    { name: 'before (model, old plan)', instant: false, redis: false, plan: 'before' as const },
    { name: 'model (new plan)', instant: false, redis: false, plan: 'after' as const },
    { name: 'instant', instant: true, redis: REDIS, plan: 'after' as const },
    ...(REDIS ? [{ name: 'repeat (answer cache)', instant: true, redis: true, plan: 'after' as const }] : []),
  ];
  console.log(`\nStub model ${STUB_ROUND_MS} ms per round${REDIS ? '; local Redis' : '; no Redis'}\n`);
  console.log('mode · question | path | tools (ms) | DB bytes | local ms | est. prod ms');
  const results: Record<string, Record<string, number>> = {};
  for (const m of modes) {
    process.env.SUWI_INSTANT = m.instant ? '1' : '0';
    kept.setSuwiRedisOff(!m.redis);
    // Each mode starts from warm in-memory copies (as prod after the warm-up), except the answer cache.
    for (const x of questions) {
      plan = x[m.plan];
      const started = new Date();
      const t0 = Date.now();
      const a = await askSuwi(hr as never, { question: x.q, page: 'punchlog' });
      const ms = Date.now() - t0;
      const bytes = await bytesSince(started);
      const audit = await raw.collection('suwi_audit').find({ org: ORG, question: x.q }).sort({ at: -1 }).limit(1).next();
      const tools = ((audit?.tools ?? []) as { name: string; ms: number; memo?: boolean }[]).map((t) => `${t.name} ${t.ms}${t.memo ? ' (memo)' : ''}`).join(', ');
      const prod = Math.round(ms + (bytes / PROD_BYTES_PER_S) * 1000);
      (results[x.q] ??= {})[m.name] = prod;
      console.log(`${m.name} · ${x.q} | ${a.path} | ${tools} | ${Math.round(bytes / 1024)} KB | ${ms} | ${prod}`);
    }
  }
  console.log('\nSummary, est. prod ms:');
  for (const [q, r] of Object.entries(results)) console.log(`${q}: ${Object.entries(r).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  process.env.SUWI_INSTANT = '1';
  kept.setSuwiRedisOff(false);

  // Notices: the first viewer, then a second viewer.
  readCache.forgetLifecycleReads(null);
  for (const [label, who] of [['notices, first viewer (cold)', hr], ['notices, second viewer\'s first look', hr2], ['notices, first viewer again', hr]] as const) {
    const started = new Date();
    const t0 = Date.now();
    const n = await suwiNotices(contextFor(who as never, settings.levels, today));
    const bytes = await bytesSince(started);
    console.log(`${label}: ${Date.now() - t0} ms, ${Math.round(bytes / 1024)} KB, est. prod ${Math.round(Date.now() - t0 + (bytes / PROD_BYTES_PER_S) * 1000)} ms, ${n.length} notices`);
  }

  if (process.env.SUWI_TESTS !== '0') {
    console.log('');
    // The memo: the same read asked twice in one question runs once.
    plan = [{ tools: [AS(day)] }, { tools: [AS(day)] }, { text: 'done' }];
    await askSuwi(hr as never, { question: 'memo check', page: 'punchlog' });
    const memoAudit = await raw.collection('suwi_audit').find({ org: ORG, question: 'memo check' }).sort({ at: -1 }).limit(1).next();
    const mt = (memoAudit?.tools ?? []) as { memo?: boolean; ms: number }[];
    ok('a repeated tool call in one question is answered from the memo', mt.length === 2 && !mt[0].memo && mt[1].memo === true && mt[1].ms === 0, JSON.stringify(mt));

    // The one-day lists.
    const { toolByName } = await import('../suwi/tools');
    const ctx = contextFor(hr as never, settings.levels, today);
    const out = await toolByName('attendance_summary')!.run(ctx, day) as { data: { day?: { onLeave: { userId: string; part: string; type: string }[]; counts: Record<string, number> }; rows?: unknown[] } };
    const onLeave = out.data.day?.onLeave ?? [];
    const full = onLeave.find((x) => x.userId === people[20].userId);
    const half = onLeave.find((x) => x.userId === people[21].userId);
    ok('one day lists who is on leave, with type and half or full day', Boolean(full && full.part === 'full' && half && half.part === 'half'), JSON.stringify(onLeave.slice(0, 5)));
    ok('one day leaves out the per-person rows (the lists say it all)', out.data.rows === undefined);
    const ranged = await toolByName('attendance_summary')!.run(ctx, { from: addDays(today, -6), to: today }) as { data: { day?: unknown; rows?: unknown[] } };
    ok('a range keeps the per-person rows and has no day lists', Array.isArray(ranged.data.rows) && ranged.data.day === undefined);

    // Notices and the write hook.
    ok('a Suwi question drops nothing', readCache.kindsChangedBy('/suwi/ask').length === 0 && readCache.kindsChangedBy('/suwi/people-search').length === 0);
    ok('a confirmed Suwi action still drops the Suwi copies', readCache.kindsChangedBy('/suwi/actions/x/confirm').includes('suwi-org-data' as never));
    ok('a leave decision drops the Suwi copies', readCache.kindsChangedBy('/admin/leaves/x/decision').includes('suwi-org-data' as never) && readCache.kindsChangedBy('/leaves/x/decision').includes('suwi-notices' as never));

    const fire = (method: string, path: string) => new Promise<void>((resolve) => {
      const req = { method, path, auth: { user: { org: ORG } } };
      const res = { end: () => { resolve(); return res; } };
      readCache.forgetReadsOnWrite(req as never, res as never, () => { (res as { end: () => unknown }).end(); });
    });
    const pendingNow = async () => ((await toolByName('pending_requests')!.run(ctx, { type: 'leave' })) as { data: { total: number } }).data.total;
    const before = await pendingNow();
    await fire('POST', '/suwi/ask');
    const t1 = Date.now(); await suwiNotices(ctx); const keptMs = Date.now() - t1;
    ok('after a Suwi question the notices are still served from memory', keptMs < 50, `${keptMs} ms`);
    const { adminDecideLeave } = await import('../services/leave.service');
    await adminDecideLeave(seed.HR, String(pendingLeave[0]._id), { decision: 'approved' });
    await fire('PATCH', '/admin/leaves/x/decision');
    const after = await pendingNow();
    ok('a leave approval shows at once in pending_requests', after === before - 1, `${before} → ${after}`);
    const overdue = (await suwiNotices(ctx)).find((n) => n.key === 'requests_overdue')?.count ?? 0;
    const pendingAll = ((await toolByName('pending_requests')!.run(ctx, {})) as { data: { rows: { daysWaiting: number }[]; total: number } }).data;
    ok('and in the notices (the overdue count agrees with pending_requests)', overdue === pendingAll.rows.filter((r) => r.daysWaiting >= 3).length, `${overdue}`);
  }

  if (process.env.SUWI_TESTS !== '0') {
    const { toolByName } = await import('../suwi/tools');
    const { instantAnswer } = await import('../suwi/instant');
    const ctx = contextFor(hr as never, settings.levels, today);
    const ctx2 = contextFor(hr2 as never, settings.levels, today);
    const fire = (method: string, path: string) => new Promise<void>((resolve) => {
      const req = { method, path, auth: { user: { org: ORG } } };
      const res = { end: () => { resolve(); return res; } };
      readCache.forgetReadsOnWrite(req as never, res as never, () => { (res as { end: () => unknown }).end(); });
    });
    const lastAudit = async (q: string) => raw.collection('suwi_audit').find({ org: ORG, question: q }).sort({ at: -1 }).limit(1).next() as Promise<{ timing?: { path: string; totalMs: number; firstTextMs?: number; rounds?: unknown[] } } | null>;

    // Instant answers say what the tools say.
    const inst = await instantAnswer(ctx, 'Who is on leave today?');
    const tool = (await toolByName('attendance_summary')!.run(ctx, { from: today, to: today })) as { data: { day: { onLeave: { name: string }[] } } };
    const names = (x: { rows: (string | number)[][] }[] | undefined) => (x?.[0]?.rows ?? []).map((r) => r[0]).sort().join('|');
    ok('instant "on leave today" lists exactly the tool\'s people', Boolean(inst) && names(inst!.tables) === tool.data.day.onLeave.map((p) => p.name).sort().join('|'), `${names(inst?.tables)} vs ${tool.data.day.onLeave.map((p) => p.name).join('|')}`);
    const instPending = await instantAnswer(ctx, 'What is pending?');
    const toolPending = (await toolByName('pending_requests')!.run(ctx, { limit: 200 })) as { data: { total: number } };
    ok('instant "what is pending" has the tool\'s count', (instPending?.tables?.[0]?.rows.length ?? 0) === toolPending.data.total, `${instPending?.tables?.[0]?.rows.length} vs ${toolPending.data.total}`);
    ok('a question with more in it is not instant', (await instantAnswer(ctx, 'who was late 3 or more times this month?')) === null && (await instantAnswer(ctx, 'which leave requests are safe to approve?')) === null);
    process.env.SUWI_INSTANT = '1';
    await askSuwi(hr as never, { question: 'Who is absent or on leave today?', page: 'overview' });
    const ia = await lastAudit('Who is absent or on leave today?');
    ok('an instant answer records its timing (path instant)', ia?.timing?.path === 'instant' && typeof ia.timing.totalMs === 'number', JSON.stringify(ia?.timing));

    // review_requests from the kept bundle equals the full read.
    const { orgSuwiData } = await import('../suwi/orgData');
    await orgSuwiData(ORG, today, seed.HR, true);
    const fast = (await toolByName('review_requests')!.run(ctx, {})) as { data: { total: number; waitingOnHr: number; overdue: { count: number } } };
    readCache.enableLifecycleReadCache(false);
    const slow = (await toolByName('review_requests')!.run(ctx, {})) as { data: { total: number; waitingOnHr: number; overdue: { count: number } } };
    readCache.enableLifecycleReadCache(true);
    ok('review_requests from the kept bundle matches the full read', fast.data.total === slow.data.total && fast.data.waitingOnHr === slow.data.waitingOnHr && fast.data.overdue.count === slow.data.overdue.count, `${JSON.stringify([fast.data.total, fast.data.waitingOnHr, fast.data.overdue.count])} vs ${JSON.stringify([slow.data.total, slow.data.waitingOnHr, slow.data.overdue.count])}`);

    // Model rounds record their timing; the panel's tables come with the answer.
    process.env.SUWI_INSTANT = '0';
    plan = [{ tools: [AS(day)] }, { text: 'Two people are on leave today.' }];
    const ma = await askSuwi(hr as never, { question: 'timing check', page: 'punchlog' });
    const mt = await lastAudit('timing check');
    ok('a model answer records total, first text and each round', mt?.timing?.path === 'model' && (mt.timing.rounds?.length ?? 0) === 2 && typeof mt.timing.firstTextMs === 'number', JSON.stringify(mt?.timing));
    ok('the tool\'s lists come back as tables, not written by the model', (ma.tables?.length ?? 0) > 0);

    // The answer cache (Redis).
    if (REDIS) {
      plan = [{ tools: [AS(day)] }, { text: 'cached answer text' }];
      const q = 'cache check: who is in office?';
      await askSuwi(hr as never, { question: q, page: 'punchlog' });
      const t0 = Date.now(); const hit = await askSuwi(hr as never, { question: q, page: 'punchlog' }); const hitMs = Date.now() - t0;
      ok('the same question on unchanged data comes from the answer cache', hit.path === 'cache' && hit.text === 'cached answer text', `${hit.path}, ${hitMs} ms`);
      console.log(`  answer cache hit: ${hitMs} ms`);
      const other = await askSuwi(hr2 as never, { question: q, page: 'punchlog' });
      ok('another viewer never gets someone else\'s kept answer', other.path !== 'cache');
      await fire('PATCH', '/admin/leaves/x/decision');
      const t1 = Date.now(); const miss = await askSuwi(hr as never, { question: q, page: 'punchlog' }); const missMs = Date.now() - t1;
      ok('after a leave decision the same question misses (data version bumped)', miss.path === 'model', `${miss.path}`);
      console.log(`  after a write: ${missMs} ms (model)`);
      // The company bundle survives losing the in-process copy (a restart).
      await orgSuwiData(ORG, today, seed.HR, true);
      const { dropSwr } = await import('../services/swr-cache');
      dropSwr(ORG, ['suwi-org-data'] as never);
      const { keptOrgSuwiDataAsync } = await import('../suwi/orgData');
      const fromRedis = await keptOrgSuwiDataAsync(ORG, today, seed.HR);
      ok('after losing the in-process copy, the bundle comes from Redis (a restart starts warm)', Boolean(fromRedis?.pending));
      // Redis down: still answers.
      kept.setSuwiRedisOff(true);
      const down = await askSuwi(hr as never, { question: q, page: 'punchlog' });
      ok('with Redis unavailable Suwi still answers', down.path === 'model' && Boolean(down.text));
      kept.setSuwiRedisOff(false);
    } else console.log('SKIP  answer cache and Redis checks (no REDIS_URL)');

    // Gemini streaming: partial text as it arrives, every part kept for the next round.
    const llm = await import('../suwi/llm');
    geminiChunks = [
      JSON.stringify({ candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }] } }] }),
      JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Two people ', thoughtSignature: 'sig1' }] } }] }),
      JSON.stringify({ candidates: [{ content: { parts: [{ text: 'are on leave.' }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 6 }, modelVersion: 'gemini-stub' }),
    ];
    const partials: string[] = [];
    const sr = await llm.callGeminiForCheck({ system: 'x', messages: [{ role: 'user', content: 'hi' }], onText: (t) => partials.push(t) });
    ok('Gemini streaming hands over the text as it arrives', partials.join(' / ') === 'Two people  / Two people are on leave.', partials.join(' / '));
    const st = sr.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    ok('the streamed reply is whole, thought hidden, signatures kept', st === 'Two people are on leave.' && (sr.raw as { thoughtSignature?: string }[]).some((p) => p.thoughtSignature === 'sig1') && sr.usage.output_tokens === 6, `${st} ${JSON.stringify(sr.raw)}`);
  }

  // —— Round three: the planner, prepared answers, the small writer, kept tools, boot warm ——
  if (process.env.SUWI_TESTS !== '0') {
    console.log('');
    const planner = await import('../suwi/planner');
    const { SUWI_SMALL_MODEL } = await import('../suwi/digest');
    const { toolByName } = await import('../suwi/tools');
    const { instantAnswer } = await import('../suwi/instant');
    const { orgSuwiData } = await import('../suwi/orgData');
    const { adminDecideLeave } = await import('../services/leave.service');
    const ctx = contextFor(hr as never, settings.levels, today);
    const fire = (method: string, path: string) => new Promise<void>((resolve) => {
      const req = { method, path, auth: { user: { org: ORG } } };
      const res = { end: () => { resolve(); return res; } };
      readCache.forgetReadsOnWrite(req as never, res as never, () => { (res as { end: () => unknown }).end(); });
    });
    const lastAudit = async (q: string) => raw.collection('suwi_audit').find({ org: ORG, question: q }).sort({ at: -1 }).limit(1).next() as Promise<{ timing?: { path: string; totalMs: number; rounds?: unknown[]; writer?: string } } | null>;
    process.env.SUWI_INSTANT = '1';
    const Q = 'What needs my attention today?';
    const FIVE: Call[] = [AS(day), { name: 'review_requests', input: {} }, { name: 'claims_to_check', input: {} }, { name: 'missing_details', input: {} }, { name: 'payroll_run_check', input: {} }];

    // Before (as prod's audit shows): the model picks the five checks, then writes. No Redis, so no answer cache.
    kept.setSuwiRedisOff(true);
    await orgSuwiData(ORG, today, seed.HR, true);
    process.env.SUWI_PLANNER = '0';
    plan = [{ tools: FIVE }, { text: 'Three requests are overdue and two people are absent today.' }];
    let t0 = Date.now(); await askSuwi(hr as never, { question: Q, page: 'overview' }); const beforeMs = Date.now() - t0;
    process.env.SUWI_PLANNER = '1';

    // The planner: one model call, the small model, no tools offered.
    await fire('PATCH', '/admin/leaves/x/decision'); // a fresh data version: nothing prepared yet
    await orgSuwiData(ORG, today, seed.HR, true);
    stubCalls.length = 0;
    plan = [{ text: 'Three requests are overdue and two people are absent today.' }];
    t0 = Date.now(); const a1 = await askSuwi(hr as never, { question: Q, page: 'overview' }); const plannerMs = Date.now() - t0;
    ok('"What needs my attention today?" takes the planner path', a1.path === 'planner', `${a1.path}`);
    ok('the planner makes exactly one model call: the small model, no tools offered', stubCalls.length === 1 && !stubCalls[0].tools && stubCalls[0].model === SUWI_SMALL_MODEL, JSON.stringify(stubCalls));
    const pa = await lastAudit(Q);
    ok('the planner records its path, one writer round and the writer model', pa?.timing?.path === 'planner' && (pa.timing.rounds?.length ?? 0) === 1 && Boolean(pa.timing.writer), JSON.stringify(pa?.timing));

    // Asked again (another page, so not the answer cache): served prepared.
    stubCalls.length = 0;
    t0 = Date.now(); const a2 = await askSuwi(hr as never, { question: Q, page: 'punchlog' }); const preparedMs = Date.now() - t0;
    ok('asked again it is served prepared, under 100 ms, with no model call', a2.path === 'prepared' && preparedMs < 100 && stubCalls.length === 0, `${a2.path}, ${preparedMs} ms, ${stubCalls.length} calls`);

    // A leave approval: the prepared answer isn't used again.
    await adminDecideLeave(seed.HR, String(pendingLeave[1]._id), { decision: 'approved' });
    await fire('PATCH', '/admin/leaves/x/decision');
    stubCalls.length = 0;
    const a3 = await askSuwi(hr as never, { question: Q, page: 'employees' });
    ok('after a leave approval the prepared answer is made again, not reused', a3.path === 'planner' && stubCalls.length === 1, `${a3.path}, ${stubCalls.length} calls`);

    // Prepared ahead, off the request path (the warm-up's way), for a second person.
    plan = [{ text: 'Prepared ahead.' }];
    const made = await planner.prepareAttention(hr2 as never, today);
    stubCalls.length = 0;
    t0 = Date.now(); const a4 = await askSuwi(hr2 as never, { question: Q, page: 'overview' }); const aheadMs = Date.now() - t0;
    ok('an answer prepared ahead is served under 100 ms with no model call', made && a4.path === 'prepared' && aheadMs < 100 && stubCalls.length === 0 && a4.text === 'Prepared ahead.', `${made}, ${a4.path}, ${aheadMs} ms`);

    // The writer unavailable: the plain lines, still an answer.
    await fire('PATCH', '/admin/leaves/x/decision');
    const realF = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => (String(url).includes('api.anthropic.com') ? new Response('down', { status: 400 }) : realF(url as string, init))) as typeof fetch;
    const a5 = await askSuwi(hr as never, { question: Q, page: 'leave' });
    globalThis.fetch = realF;
    ok('with the writer unavailable the attention answer falls back to plain lines', a5.path === 'planner' && /attention|waiting|Today|Nothing/.test(a5.text), a5.text.slice(0, 120));

    // A period question: the planner, no model at all; the table equals the tool's rows.
    stubCalls.length = 0;
    const from = `${today.slice(0, 7)}-01`;
    const pq = await askSuwi(hr as never, { question: 'Who was late 3 or more times this month?', page: 'attendance' });
    const tool = (await toolByName('attendance_summary')!.run(ctx, { from, to: today, status: 'late', minLate: 3, limit: 200 })) as { data: { rows?: { name: string }[] } };
    ok('"late 3 or more times this month" is answered by the planner with no model call', pq.path === 'planner' && stubCalls.length === 0, `${pq.path}, ${stubCalls.length} calls`);
    ok('its table lists exactly the tool\'s people', (pq.tables?.[0]?.rows.length ?? 0) === (tool.data.rows?.length ?? 0) && (pq.tables?.[0]?.rows ?? []).map((r) => r[0]).sort().join('|') === (tool.data.rows ?? []).map((r) => r.name).sort().join('|'), `${pq.tables?.[0]?.rows.length} vs ${tool.data.rows?.length}`);
    ok('questions with more in them are not planned', planner.planFor(ctx, 'Which department was late most this month?') === null && planner.planFor(ctx, 'Draft a note to people who were late this week') === null);
    ok('"on leave in the next 7 days" is no longer answered as today (goes to the model)', (await instantAnswer(ctx, 'Who is on leave in the next 7 days?')) === null);

    // missing_details and claims_to_check from the kept bundle equal the full read.
    await orgSuwiData(ORG, today, seed.HR, true);
    const mdKept = (await toolByName('missing_details')!.run(ctx, { limit: 200 })) as { data: { matching: number; countsByTask: Record<string, number> } };
    const ccKept = (await toolByName('claims_to_check')!.run(ctx, { bills: 'none' })) as { data: { pending: number; needsALook: { count: number } } };
    readCache.enableLifecycleReadCache(false);
    const mdFull = (await toolByName('missing_details')!.run(ctx, { limit: 200 })) as { data: { matching: number; countsByTask: Record<string, number> } };
    const ccFull = (await toolByName('claims_to_check')!.run(ctx, { bills: 'none' })) as { data: { pending: number; needsALook: { count: number } } };
    readCache.enableLifecycleReadCache(true);
    ok('missing_details from the kept bundle matches the full read', mdKept.data.matching === mdFull.data.matching && JSON.stringify(mdKept.data.countsByTask) === JSON.stringify(mdFull.data.countsByTask), `${mdKept.data.matching} vs ${mdFull.data.matching}`);
    ok('claims_to_check from the kept bundle matches the full read', ccKept.data.pending === ccFull.data.pending && ccKept.data.needsALook.count === ccFull.data.needsALook.count, `${JSON.stringify(ccKept.data.pending)} vs ${JSON.stringify(ccFull.data.pending)}`);

    console.log(`\n"${Q}" (stub ${STUB_ROUND_MS} ms per full round, ${STUB_SMALL_MS} ms small writer): before ${beforeMs} ms · planner ${plannerMs} ms · prepared ${preparedMs} ms · prepared ahead ${aheadMs} ms`);
    kept.setSuwiRedisOff(false);

    // Boot: the shared inputs and notices warm before the first look.
    const warm = await import('../services/lifecycle/warm');
    readCache.forgetLifecycleReads(null);
    plan = [{ text: 'Warm at boot.' }];
    await warm.warmSuwiAtBoot();
    t0 = Date.now(); await suwiNotices(ctx); const bootNoticeMs = Date.now() - t0;
    ok('after the boot warm the first notices come from memory', bootNoticeMs < 50, `${bootNoticeMs} ms`);
  }

  // ── Every tool kept (toolCache.ts): cold vs warm, same answer, invalidation ──
  {
    const { toolByName, toolsFor } = await import('../suwi/tools');
    const tc = await import('../suwi/toolCache');
    const ctx = contextFor(hr as never, settings.levels, today);
    const someone = (await db.users().findOne({ userId: people[5].userId }, { projection: { _id: 0, userId: 1, name: 1 } }))!;
    // Every read-only tool HR may use, with an input that works: none for the no-input tools, a person for the person tools.
    const personInput: Record<string, Record<string, unknown>> = {
      search_people: { text: String(someone.name).split(' ')[0] }, person_details: { person: someone.userId }, leave_balance: { userId: someone.userId },
      person_attendance: { userId: someone.userId }, person_policy_summary: { userId: someone.userId }, claims_by_person: { userId: someone.userId },
      payslip_explain: { userId: someone.userId }, kpi_trend: { userId: someone.userId }, review_material: { userId: someone.userId },
    };
    const readTools = toolsFor(ctx).filter((t) => !t.acts);
    const strip = (v: unknown) => JSON.stringify(v, (k, x) => (/^(generatedAt|at|asOf|now|checkedAt|ms)$/.test(k) ? undefined : x));
    const rows: string[] = [];
    let slowWarm = 0; let differ = 0; let ran = 0;
    for (const t of readTools) {
      const required = (t.input_schema as { required?: string[] }).required ?? [];
      const input = personInput[t.name] ?? (required.length ? null : {});
      if (!input) continue;
      readCache.forgetLifecycleReads(ORG);
      let started = new Date(); let t0 = Date.now(); let coldOut: unknown;
      try { coldOut = await t.run(ctx, input); } catch (e) { rows.push(`${t.name}: error ${(e as Error).message.slice(0, 60)}`); continue; }
      const coldMs = Date.now() - t0; const bytes = await bytesSince(started);
      started = new Date(); t0 = Date.now();
      const warmOut = await t.run(ctx, input);
      const warmMs = Date.now() - t0;
      ran++;
      if (warmMs >= 100) slowWarm++;
      // The same answer fresh: cache off for one run.
      tc.setSuwiToolCache(false);
      const freshOut = await t.run(ctx, input).catch(() => null);
      tc.setSuwiToolCache(null);
      if (strip(warmOut) !== strip(freshOut)) { differ++; rows.push(`${t.name}: kept answer differs from a fresh one`); }
      rows.push(`${t.name.padEnd(30)} cold ${String(coldMs).padStart(5)} ms ${String(Math.round(bytes / 1024)).padStart(5)} KB · est. prod ${String(Math.round(coldMs + (bytes / PROD_BYTES_PER_S) * 1000)).padStart(6)} ms · warm ${warmMs} ms`);
      void coldOut;
    }
    console.log(`\nEvery read-only tool (HR, ${people.length} people):\n${rows.join('\n')}`);
    ok(`every read-only tool answers warm in under 100 ms (${ran} tools)`, ran > 20 && slowWarm === 0, `${slowWarm} slow, ${ran} ran`);
    ok('a kept tool answer equals a fresh one', differ === 0, `${differ} differ`);

    // A change the write hook sees: a new person shows on the next search, the bundle re-read.
    const fire = (method: string, path: string) => new Promise<void>((resolve) => {
      const req = { method, path, auth: { user: { org: ORG } } };
      const res = { end: () => { resolve(); return res; } };
      readCache.forgetReadsOnWrite(req as never, res as never, () => { (res as { end: () => unknown }).end(); });
    });
    await toolByName('search_people')!.run(ctx, { text: 'Zebedee' });
    await db.users().insertOne({ userId: 'speed-new-person', org: ORG, name: 'Zebedee Quark', email: 'zq@speed.test', lifecycleStatus: 'active', department: 'Design' } as never);
    const stale = await toolByName('search_people')!.run(ctx, { text: 'Zebedee' }) as { data: unknown };
    await fire('PATCH', '/admin/employees/speed-new-person');
    const freshSearch = await toolByName('search_people')!.run(ctx, { text: 'Zebedee' }) as { data: unknown };
    ok('a person added shows on the next search after the change (bundle and tool answer re-read)', JSON.stringify(freshSearch.data).includes('Zebedee') && !JSON.stringify(stale.data).includes('Zebedee'), `${JSON.stringify(stale.data).slice(0, 80)} → ${JSON.stringify(freshSearch.data).slice(0, 80)}`);
    const rosterNow = await tc.peopleBundle(ORG);
    ok('the people bundle has the new person after the change', rosterNow.some((p) => p.userId === 'speed-new-person'));

    // People with different access never share a kept tool answer: the key is per person.
    const missBefore = tc.toolCacheStats.miss;
    await toolByName('headcount')!.run(contextFor(hr2 as never, settings.levels, today), {});
    ok('another person\'s first call is worked out for them, not served from HR\'s', tc.toolCacheStats.miss === missBefore + 1);

    // Changes are never kept: a prepare_* tool runs every time.
    const acts = [...toolsFor(ctx)].filter((t) => t.acts);
    ok('tools that prepare a change are not wrapped by the cache', acts.length > 0 && acts.every((t) => !String(t.run).includes('cachedToolRun')), acts.map((t) => t.name).join(','));

    // Redis down: tools still answer (memory only).
    kept.setSuwiRedisOff(true);
    readCache.forgetLifecycleReads(ORG);
    const down = await toolByName('headcount')!.run(ctx, {}).then(() => true, () => false);
    kept.setSuwiRedisOff(false);
    ok('with Redis down the tools still answer', down);

    // A restart: memory gone, the Redis copy answers.
    if (REDIS) {
      await toolByName('shift_templates')!.run(ctx, {});
      const r0 = tc.toolCacheStats.redis;
      (tc as unknown as { __clearMemoryForCheck?: () => void }).__clearMemoryForCheck?.();
      await toolByName('shift_templates')!.run(ctx, {});
      ok('after a restart (memory cleared) a kept tool answer comes from Redis', tc.toolCacheStats.redis === r0 + 1);
    }

    // The warm-up asks the no-input tools ahead for recent Suwi users.
    readCache.forgetLifecycleReads(ORG);
    tc.__resetPrerunForCheck();
    const ranAhead = await tc.prerunTools(ORG, [ctx], toolsFor);
    const t0 = Date.now(); await toolByName('review_progress')?.run(ctx, {}).catch(() => undefined); const afterAheadMs = Date.now() - t0;
    ok('tools asked ahead answer the next call from memory', ranAhead > 10 && afterAheadMs < 100, `${ranAhead} ran ahead, then ${afterAheadMs} ms`);
  }

  // ── A request write patches the company bundle (orgData.ts) instead of dropping it ──
  {
    const { toolByName } = await import('../suwi/tools');
    const od = await import('../suwi/orgData');
    const ctx = contextFor(hr as never, settings.levels, today);
    const byNs = async (from: Date) => {
      const rows = await raw.collection('system.profile').find({ ts: { $gt: from }, ns: { $not: /system\.profile/ } }).project({ ns: 1, responseLength: 1 }).toArray();
      const m = new Map<string, number>();
      for (const r of rows) m.set(String(r.ns).split('.').slice(1).join('.'), (m.get(String(r.ns).split('.').slice(1).join('.')) ?? 0) + (Number(r.responseLength) || 0));
      return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([ns, b]) => `${ns} ${Math.round(b / 1024)} KB`).join(', ');
    };
    const fire = (method: string, path: string) => new Promise<void>((resolve) => {
      const req = { method, path, auth: { user: { org: ORG } } };
      const res = { end: () => { resolve(); return res; } };
      readCache.forgetReadsOnWrite(req as never, res as never, () => { (res as { end: () => unknown }).end(); });
    });
    // Stable JSON without the time it was read: the patched bundle and a whole read must match exactly.
    const stable = (v: unknown): string => JSON.stringify(v, (k, x) => (k === 'at' ? undefined : x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
    const est = (ms: number, bytes: number) => Math.round(ms + (bytes / PROD_BYTES_PER_S) * 1000);
    const dump = async (from: Date, label: string) => {
      if (!process.env.SUWI_DUMP) return;
      const all = await raw.collection('system.profile').find({ ts: { $gt: from }, ns: { $not: /system\.profile/ } }).toArray();
      const by = new Map<string, [number, number]>();
      for (const r of all) { const k = `${String(r.ns).split('.').slice(1).join('.')} ${r.op} ${Object.keys(r.command?.filter ?? {}).join(',') || (r.command?.pipeline ? 'pipeline:' + JSON.stringify(r.command.pipeline[0]).slice(0, 60) : '')}`; const v = by.get(k) ?? [0, 0]; by.set(k, [v[0] + 1, v[1] + (Number(r.responseLength) || 0)]); }
      console.log(`  [${label}]\n` + [...by.entries()].sort((a, b) => b[1][1] - a[1][1]).slice(0, 12).map(([k, [n, b]]) => `    ${k}: ${n}× ${Math.round(b / 1024)} KB`).join('\n'));
    };
    // Measured alone: the debounced rebuild after earlier writes would read beside the patch (it is checked below).
    readCache.setLifecycleRewarm(null);
    await new Promise((r) => setTimeout(r, 3500));

    // The whole bundle, once, as the warm-up keeps it.
    let started = new Date(); let t0 = Date.now();
    await od.orgSuwiData(ORG, today, seed.HR, true);
    const wholeMs = Date.now() - t0; const wholeBytes = await bytesSince(started);
    console.log(`\nCompany bundle read whole: ${wholeMs} ms, ${Math.round(wholeBytes / 1024)} KB (est. prod ${est(wholeMs, wholeBytes)} ms) [${await byNs(started)}]`);

    const leaveIds = pendingLeave.map((l) => l._id);
    const regs = await raw.collection('attendance_regularizations').find({ status: 'pending' }).project({ _id: 1 }).toArray();
    const someone = people[30];
    const events: { name: string; method: string; path: string; change: () => Promise<unknown>; expect: (rows: { type: string; id: string }[]) => boolean }[] = [
      { name: 'leave approved', method: 'PATCH', path: `/admin/leaves/${leaveIds[0]}/decision`, change: () => db.leaves().updateOne({ _id: leaveIds[0] } as never, { $set: { status: 'approved', decidedAt: new Date() } }), expect: (r) => !r.some((x) => x.id === leaveIds[0].toHexString()) },
      { name: 'leave declined', method: 'PATCH', path: `/leaves/${leaveIds[1]}/decision`, change: () => db.leaves().updateOne({ _id: leaveIds[1] } as never, { $set: { status: 'declined', decidedAt: new Date() } }), expect: (r) => !r.some((x) => x.id === leaveIds[1].toHexString()) },
      { name: 'leave cancelled', method: 'POST', path: `/leaves/${leaveIds[2]}/cancel`, change: () => db.leaves().updateOne({ _id: leaveIds[2] } as never, { $set: { status: 'cancelled' } }), expect: (r) => !r.some((x) => x.id === leaveIds[2].toHexString()) },
      { name: 'leave requested', method: 'POST', path: '/leaves', change: () => db.leaves().insertOne({ _id: new ObjectId('6650000000000000000000aa'), org: ORG, userId: someone.userId, type: 'casual', startDate: new Date(`${addDays(today, 20)}T00:00:00Z`), endDate: new Date(`${addDays(today, 20)}T00:00:00Z`), reason: 'trip', status: 'pending', halfDay: false, createdAt: Date.now() } as never), expect: (r) => r.some((x) => x.id === '6650000000000000000000aa') },
      { name: 'correction approved', method: 'PATCH', path: `/admin/regularizations/${regs[0]._id}/decision`, change: () => raw.collection('attendance_regularizations').updateOne({ _id: regs[0]._id }, { $set: { status: 'approved' } }), expect: (r) => !r.some((x) => x.id === String(regs[0]._id)) },
      { name: 'correction requested', method: 'POST', path: '/attendance/regularizations', change: () => raw.collection('attendance_regularizations').insertOne({ _id: new ObjectId('6650000000000000000000bb'), userId: someone.userId, managerUserId: someone.managerUserId ?? seed.HR, workDate: addDays(today, -1), requestedDayType: 'full_day', note: 'missed', status: 'pending', createdAt: new Date() }), expect: (r) => r.some((x) => x.id === '6650000000000000000000bb') },
      { name: 'overtime requested', method: 'POST', path: '/overtime', change: () => db.overtimeRequests().insertOne({ _id: new ObjectId('6650000000000000000000cc'), userId: someone.userId, managerUserId: someone.managerUserId ?? seed.HR, workDate: new Date(`${addDays(today, -1)}T00:00:00Z`), startTime: new Date(), endTime: new Date(), hours: 4, duration: 'half_day', status: 'pending', createdAt: new Date() } as never), expect: (r) => r.some((x) => x.id === '6650000000000000000000cc') },
      { name: 'claim submitted', method: 'POST', path: '/reimbursements', change: () => db.reimbursementClaims().insertOne({ _id: new ObjectId('6650000000000000000000dd'), userId: someone.userId, managerUserId: someone.managerUserId ?? seed.HR, expenseDate: new Date(`${addDays(today, -1)}T00:00:00Z`), amount: 450, category: 'travel', status: 'pending', createdAt: new Date() } as never), expect: (r) => r.some((x) => x.id === '6650000000000000000000dd') },
      { name: 'claim declined', method: 'PATCH', path: '/admin/reimbursements/6650000000000000000000dd/decision', change: () => db.reimbursementClaims().updateOne({ _id: new ObjectId('6650000000000000000000dd') } as never, { $set: { status: 'declined' } }), expect: (r) => !r.some((x) => x.id === '6650000000000000000000dd') },
    ];
    const lines: string[] = [];
    let same = 0; let shown = 0; let slow = 0; let patchKb = 0;
    for (const e of events) {
      await e.change();
      started = new Date(); t0 = Date.now();
      await fire(e.method, e.path);
      // The next reader (any tool) waits for the patch, never for a whole read of its own.
      const patched = await od.keptOrgSuwiDataAsync(ORG, today, seed.HR);
      const ms = Date.now() - t0; const bytes = await bytesSince(started);
      patchKb = Math.max(patchKb, bytes / 1024);
      if (est(ms, bytes) > 1000) slow++;
      if (patched && e.expect(patched.pending ?? [])) shown++;
      const whole = await od.loadOrgSuwiData(ORG, today, seed.HR);
      if (patched && stable(patched) === stable(whole)) same++;
      else lines.push(`      ${e.name}: patched ≠ whole\n        ${stable(patched).slice(0, 300)}\n        ${stable(whole).slice(0, 300)}`);
      if (e === events[0]) await dump(started, `patch: ${e.name}`);
      lines.push(`  ${e.name.padEnd(22)} patch ${String(ms).padStart(4)} ms ${String(Math.round(bytes / 1024)).padStart(4)} KB · est. prod ${est(ms, bytes)} ms`);
    }
    console.log(`\nRequest writes, the bundle patched (vs whole ${Math.round(wholeBytes / 1024)} KB):\n${lines.join('\n')}`);
    ok(`after each request write the next read has the change (${events.length} kinds)`, shown === events.length, `${shown}/${events.length}`);
    ok('the patched bundle equals a whole read after every kind of request write', same === events.length, `${same}/${events.length}`);
    // Target 0.3 s; today the pending lists still read the users list (~40 KB), so 1 s is the bar until they read the kept people list.
    ok('a patch reads less than the whole bundle and is under 1 s on prod', slow === 0 && patchKb < wholeBytes / 1024, `${slow} slow, ${Math.round(patchKb)} KB vs ${Math.round(wholeBytes / 1024)} KB`);

    // A write the patch doesn't know (a shift template change) still drops the bundle whole.
    await fire('POST', '/admin/shift-templates');
    ok('any other write drops the bundle (no patch)', !(await import('../services/swr-cache')).peekSwr(ORG, 'suwi-org-data', { today }) && !(await import('../services/swr-cache')).pendingSwr(ORG, 'suwi-org-data', { today }));
    await od.orgSuwiData(ORG, today, seed.HR, true);

    // The attendance report patched for one person after a leave change (attendance-report.service).
    {
      const arsP = await import('../services/attendance-report.service');
      const ls = await import('../services/leave.service');
      const range = { from: addDays(today, -10), to: today };
      const who = people[50].userId;
      const leaveId = new ObjectId('6650000000000000000000ee');
      const day = addDays(today, -3);
      const steps: [string, () => Promise<unknown>][] = [
        ['approved', () => db.leaves().insertOne({ _id: leaveId, org: ORG, userId: who, type: 'casual', startDate: new Date(`${day}T00:00:00Z`), endDate: new Date(`${day}T00:00:00Z`), reason: 'x', status: 'approved', halfDay: false, days: 1, createdAt: Date.now() } as never)],
        ['cancelled', () => db.leaves().updateOne({ _id: leaveId } as never, { $set: { status: 'cancelled' } })],
        ['half day approved', () => db.leaves().updateOne({ _id: leaveId } as never, { $set: { status: 'approved', halfDay: true } })],
        ['declined', () => db.leaves().updateOne({ _id: leaveId } as never, { $set: { status: 'declined' } })],
      ];
      const r0 = await arsP.attendanceReport(seed.HR, range, { refresh: true });
      let equal = 0; let changedShown = 0; const rows: string[] = []; let maxKb = 0;
      let prevDay = JSON.stringify(r0.days.find((d) => d[0] === who && d[1] === day) ?? r0.offDays.find((d) => d[0] === who && d[1] === day));
      for (const [label, change] of steps) {
        await change();
        started = new Date(); t0 = Date.now();
        await (ls as unknown as { __leaveChangedForCheck: (u: string) => Promise<void> }).__leaveChangedForCheck(who);
        const patched = await arsP.attendanceReport(seed.HR, range);
        const ms = Date.now() - t0; const bytes = await bytesSince(started);
        maxKb = Math.max(maxKb, bytes / 1024);
        const whole = await arsP.attendanceReport(seed.HR, range, { refresh: true });
        if (stable(patched) === stable(whole)) equal++; else rows.push(`      ${label}: patched report ≠ whole`);
        const nowDay = JSON.stringify(patched.days.find((d) => d[0] === who && d[1] === day) ?? patched.offDays.find((d) => d[0] === who && d[1] === day));
        if (nowDay !== prevDay) changedShown++;
        prevDay = nowDay;
        rows.push(`  leave ${label.padEnd(18)} report patch ${String(ms).padStart(4)} ms ${String(Math.round(bytes / 1024)).padStart(4)} KB · est. prod ${est(ms, bytes)} ms`);
      }
      const wholeStart = new Date(); const wt0 = Date.now();
      arsP.invalidateAttendanceReport(ORG);
      await arsP.attendanceReport(seed.HR, range);
      console.log(`\nAttendance report, ${range.from}..${range.to} (whole: ${Date.now() - wt0} ms, ${Math.round((await bytesSince(wholeStart)) / 1024)} KB):\n${rows.join('\n')}`);
      ok('a patched attendance report equals a whole read after each leave change', equal === steps.length, `${equal}/${steps.length}`);
      ok('the patched report shows each change on that day', changedShown === steps.length, `${changedShown}/${steps.length}`);
      ok('a report patch reads a few KB', maxKb < 20, `${Math.round(maxKb)} KB`);
    }

    // The four tools the coordinator named: the first call right after a request write (a leave decided,
    // which also drops or patches the attendance report as leave.service's leaveChanged does; a claim
    // made, which touches no attendance), then cold (everything dropped).
    const ars = await import('../services/attendance-report.service');
    const leaveService = await import('../services/leave.service');
    const four = ['review_requests', 'pending_requests', 'shift_gaps', 'team_attendance_patterns'];
    const firstRows: string[] = [];
    const afterWrite: Record<string, number> = {};
    let flip = 0;
    for (const name of four) {
      for (const kind of ['leave decided', 'claim made'] as const) {
        await toolByName(name)!.run(ctx, {});
        if (kind === 'leave decided') {
          flip++;
          await db.leaves().updateOne({ _id: new ObjectId('6650000000000000000000aa') } as never, { $set: { status: flip % 2 ? 'approved' : 'pending' } });
          await (leaveService as unknown as { __leaveChangedForCheck: (u: string) => Promise<void> }).__leaveChangedForCheck(someone.userId);
          await fire('PATCH', '/admin/leaves/6650000000000000000000aa/decision');
        } else {
          await db.reimbursementClaims().insertOne({ userId: people[40].userId, managerUserId: seed.HR, expenseDate: new Date(`${addDays(today, -2)}T00:00:00Z`), amount: 100 + flip, category: 'travel', status: 'pending', createdAt: new Date() } as never);
          await fire('POST', '/reimbursements');
        }
        started = new Date(); t0 = Date.now();
        await toolByName(name)!.run(ctx, {});
        const ms = Date.now() - t0; const bytes = await bytesSince(started);
        afterWrite[`${name}|${kind}`] = est(ms, bytes);
        await dump(started, `${name} after ${kind}`);
        firstRows.push(`  ${name.padEnd(26)} after ${kind.padEnd(13)} ${String(ms).padStart(5)} ms ${String(Math.round(bytes / 1024)).padStart(4)} KB · est. prod ${String(est(ms, bytes)).padStart(5)} ms [${await byNs(started)}]`);
      }
      // Cold: everything dropped (the bundle, the report and its setup), no patch.
      readCache.forgetLifecycleReads(ORG);
      ars.invalidateAttendanceSetup(ORG);
      started = new Date(); t0 = Date.now();
      await toolByName(name)!.run(ctx, {});
      const cms = Date.now() - t0; const cbytes = await bytesSince(started);
      await dump(started, `${name} cold`);
      firstRows.push(`  ${''.padEnd(26)} cold (all dropped)  ${String(cms).padStart(5)} ms ${String(Math.round(cbytes / 1024)).padStart(4)} KB · est. prod ${String(est(cms, cbytes)).padStart(5)} ms [${await byNs(started)}]`);
      await od.orgSuwiData(ORG, today, seed.HR, true);
    }
    const reviewAfterWrite = Math.max(afterWrite['review_requests|leave decided'], afterWrite['review_requests|claim made']);
    console.log(`\nFirst calls:\n${firstRows.join('\n')}`);
    // Target 0.3 s (was 4.4 s before the patch); 1 s until the pending lists read the kept people list.
    ok('review_requests right after a request write is under 1 s on prod', reviewAfterWrite < 1000, `${reviewAfterWrite} ms`);

    // A request write leaves the people bundle kept (the people version); a person's change re-reads it.
    const tc = await import('../suwi/toolCache');
    const pb0 = await tc.peopleBundle(ORG);
    await fire('POST', '/leaves');
    const pb1 = await tc.peopleBundle(ORG);
    await fire('PATCH', '/admin/employees/speed-new-person');
    const pb2 = await tc.peopleBundle(ORG);
    ok('a request write keeps the people bundle; a person\'s change re-reads it', pb1 === pb0 && pb2 !== pb0);

    // Dropping other kinds (a leave's Time office lists) never throws away a bundle refresh under way.
    const swr = await import('../services/swr-cache');
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const inflight = swr.refreshSwr(ORG, 'suwi-org-data', { today }, async () => { await gate; return { marker: 1 }; });
    swr.forgetSwrExcept(ORG, ['suwi-org-data']);
    swr.dropSwr(ORG, ['adm-leaves']);
    release(); await inflight;
    ok('a bundle refresh under way survives drops of other kinds', (swr.peekSwr(ORG, 'suwi-org-data', { today }) as { marker?: number } | undefined)?.marker === 1);
    await od.orgSuwiData(ORG, today, seed.HR, true);

    // The debounced rebuild (3 s after a change) brings the bundle and review_requests back without a reader.
    const warmMod = await import('../services/lifecycle/warm');
    readCache.setLifecycleRewarm(async (org) => { await warmMod.warmLifecycle(org); });
    const settle = async () => {
      await new Promise((r) => setTimeout(r, 3_300));
      for (let i = 0; i < 100 && !swr.peekSwr(ORG, 'suwi-org-data', { today }); i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 1_500));
    };
    for (const [label, method, path] of [['a request write', 'POST', '/leaves'], ['any other write', 'POST', '/admin/shift-templates']] as const) {
      await fire(method, path);
      await settle();
      const hits = tc.toolCacheStats.memory + tc.toolCacheStats.redis;
      t0 = Date.now();
      await toolByName('review_requests')!.run(ctx, {});
      const ms = Date.now() - t0;
      ok(`after ${label}, the rebuild has review_requests ready (${ms} ms)`, ms < 100 && tc.toolCacheStats.memory + tc.toolCacheStats.redis > hits, `${ms} ms`);
    }
  }

  await raw.command({ profile: 0 } as never);
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  await raw.dropDatabase();
  process.exit(failures ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
