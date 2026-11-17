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
  const body = JSON.parse(String(init?.body ?? '{}')) as { messages: { role: string }[] };
  const round = body.messages.filter((m) => m.role === 'assistant').length;
  const step = plan[Math.min(round, plan.length - 1)];
  await new Promise((r) => setTimeout(r, STUB_ROUND_MS));
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

  await seed.seedSpeedOrg(50, 30);
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

  await raw.command({ profile: 0 } as never);
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  await raw.dropDatabase();
  process.exit(failures ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
