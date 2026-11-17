/**
 * Suwi orchestration check, on a scratch database only, with a stand-in model.
 *
 *   npm run suwi-orch:check      (MONGODB_URI = a local mongod; REDIS_URL = a local Redis for the prepared checks)
 *
 * The stand-in answers like the live models take: the main model STUB_MAIN_MS per step (2.5 s), the small
 * one STUB_SMALL_MS (0.6 s). It plays the router (a JSON plan per question), the writer, and the full loop
 * (the old way: the main model asking for tools round after round, as prod's audit shows).
 *
 * Checks: at most two model steps for anything that isn't a change; the router's plan is checked against
 * what the person may use; drafts and analysis are written by the main model, lookups by the small one;
 * a "NEED:" from the writer tops the data up once and is never shown; a slow lookup becomes "not loaded in
 * time"; a change goes to the full loop; timings are recorded with each step's model; answers prepared
 * ahead are served with no model call, per person and per data version. Then before/after for 15 questions.
 */
process.env.SUWI_PROVIDER = 'claude';
process.env.ANTHROPIC_API_KEY = 'stub-key';
const REDIS = Boolean(process.env.REDIS_URL);
const STUB_MAIN_MS = Number(process.env.STUB_MAIN_MS ?? 2500);
const STUB_SMALL_MS = Number(process.env.STUB_SMALL_MS ?? 600);

type Call = { name: string; input: Record<string, unknown> };
type Step = { tools: Call[] } | { text: string };
interface Q { q: string; area: string; plan: { calls: { tool: string; args: Record<string, unknown> }[]; mode: string }; legacy: Step[] }

/** What the stand-in does per question: the router's plan, and the old loop's rounds. */
const QUESTIONS: Q[] = [];
let writerScript: string[] = [];
let routerOverride: string | null = null;
const calls: { kind: 'router' | 'writer' | 'loop'; model: string; tools: boolean }[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (!String(url).includes('api.anthropic.com')) return realFetch(url as string, init);
  const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string; system?: { text: string }[] | string; tools?: unknown[]; messages: { role: string; content: unknown }[] };
  const system = Array.isArray(body.system) ? body.system.map((s) => s.text).join('') : String(body.system ?? '');
  const model = String(body.model ?? '');
  const small = /haiku|lite/.test(model);
  await new Promise((r) => setTimeout(r, small ? STUB_SMALL_MS : STUB_MAIN_MS));
  const lastUser = [...body.messages].reverse().find((m) => m.role === 'user');
  const firstUser = body.messages.find((m) => m.role === 'user');
  const asText = (c: unknown) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b as { text?: string }).text ?? '').join('') : '');
  let content: unknown[]; let stop = 'end_turn';
  if (system.startsWith('You choose the data lookups')) {
    calls.push({ kind: 'router', model, tools: Boolean(body.tools?.length) });
    const asked = asText(lastUser?.content);
    const q = QUESTIONS.find((x) => asked.includes(`Question: ${x.q}`));
    const also = /Also needed: (.+)/.exec(asked)?.[1];
    const plan = routerOverride ?? JSON.stringify(also ? { calls: [{ tool: 'headcount', args: { by: 'department' } }], mode: 'lookup' } : q?.plan ?? { calls: [], mode: 'lookup' });
    content = [{ type: 'text', text: plan }];
  } else if (system.startsWith('You are Suwi, the HR assistant in Sowaka\'s HR dashboard. Answer from the data')) {
    calls.push({ kind: 'writer', model, tools: Boolean(body.tools?.length) });
    content = [{ type: 'text', text: writerScript.shift() ?? 'Here is the answer.' }];
  } else {
    calls.push({ kind: 'loop', model, tools: Boolean(body.tools?.length) });
    const asked = asText(firstUser?.content);
    const q = QUESTIONS.find((x) => asked.startsWith(x.q));
    const round = body.messages.filter((m) => m.role === 'assistant').length;
    const steps = q?.legacy ?? [{ text: 'done' }];
    const step = steps[Math.min(round, steps.length - 1)];
    content = 'tools' in step ? step.tools.map((t, i) => ({ type: 'tool_use', id: `${t.name}-${round}-${i}`, name: t.name, input: t.input })) : [{ type: 'text', text: step.text }];
    stop = 'tools' in step ? 'tool_use' : 'end_turn';
  }
  return new Response(JSON.stringify({ content, stop_reason: stop, usage: { input_tokens: 1000, output_tokens: 100 }, model }), { status: 200, headers: { 'content-type': 'application/json' } });
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
  const { SUWI_SMALL_MODEL } = await import('../suwi/digest');
  const { SUWI_MODEL } = await import('../suwi/llm');
  const { prepareFrequent } = await import('../suwi/prepared');
  const kept = await import('../suwi/kept');
  const readCache = await import('../services/lifecycle/readCache');

  await seed.seedSpeedOrg(50, 30);
  const raw = db.getDb();
  if (!/scratch/.test(raw.databaseName)) throw new Error(`refusing to run against ${raw.databaseName}`);
  const ORG = seed.ORG;
  const today = istToday();
  await raw.collection('suwi_settings').updateOne({ org: ORG }, { $set: { org: ORG, enabled: true, monthlyBudgetUsd: 1000, levels: { requests: 'act', attendance: 'suggest', people: 'suggest', payroll: 'suggest', claims: 'suggest', performance: 'suggest', connect: 'suggest', settings: 'suggest' } } }, { upsert: true });
  await db.users().updateOne({ userId: seed.HR }, { $set: { dashboardAccess: true, dashboardAdmin: true } });
  await db.users().insertOne({ userId: 'orch-hr2', name: 'Second HR', email: 'hr2@orch.test', org: ORG, lifecycleStatus: 'active', role: 'employee', dashboardAccess: true, dashboardAdmin: true, joiningDate: new Date('2025-01-01') } as never);
  readCache.enableLifecycleReadCache(true);
  if (REDIS) {
    const { redisClient } = await import('../config/redis');
    const r = redisClient()!;
    if (r.status !== 'ready') await new Promise((res) => r.once('ready', res));
    await r.flushdb();
  }
  const hr = (await db.users().findOne({ userId: seed.HR }))!;
  const hr2 = (await db.users().findOne({ userId: 'orch-hr2' }))!;
  const audit = () => raw.collection('suwi_audit');
  const lastAudit = async () => (await audit().find({ kind: 'question' }).sort({ at: -1 }).limit(1).toArray())[0] as Record<string, unknown> & { timing?: { path?: string; rounds?: { step?: string; model?: string }[]; writer?: string } };

  const P = (tool: string, args: Record<string, unknown> = {}) => ({ tool, args });
  const T = (name: string, input: Record<string, unknown> = {}): Call => ({ name, input });
  const mon = addDays(today, 7 - ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  QUESTIONS.push(
    { q: 'Who has no manager?', area: 'people', plan: { calls: [P('search_people', { limit: 200 })], mode: 'lookup' }, legacy: [{ tools: [T('search_people', { limit: 200 })] }, { text: 'x' }] },
    { q: 'Who reports to whom in Engineering?', area: 'people', plan: { calls: [P('headcount', { by: 'manager' }), P('search_people', { limit: 200 })], mode: 'lookup' }, legacy: [{ tools: [T('search_people')] }, { tools: [T('headcount', { by: 'manager' })] }, { tools: [T('search_people', { limit: 200 })] }, { text: 'x' }] },
    { q: 'How many people are in each department?', area: 'people', plan: { calls: [P('headcount', { by: 'department' })], mode: 'lookup' }, legacy: [{ tools: [T('headcount', { by: 'department' })] }, { text: 'x' }] },
    { q: 'Show me the profile of Speed Person 3', area: 'people', plan: { calls: [P('person_details', { person: 'Speed Person 3' })], mode: 'lookup' }, legacy: [{ tools: [T('search_people')] }, { tools: [T('person_details', { person: 'Speed Person 3' })] }, { text: 'x' }] },
    { q: 'Who is on leave next week?', area: 'attendance', plan: { calls: [P('attendance_summary', { from: mon, to: addDays(mon, 4) })], mode: 'lookup' }, legacy: [{ tools: [T('attendance_summary', { from: mon, to: addDays(mon, 4) })] }, { tools: [T('pending_requests')] }, { text: 'x' }] },
    { q: 'Which teams had the most late arrivals in the last two weeks?', area: 'attendance', plan: { calls: [P('attendance_summary', { from: addDays(today, -14), to: today })], mode: 'lookup' }, legacy: [{ tools: [T('attendance_summary', { from: addDays(today, -14), to: today })] }, { tools: [T('headcount', { by: 'department' })] }, { text: 'x' }] },
    { q: 'Which leave requests have been waiting more than 3 days?', area: 'leave', plan: { calls: [P('pending_requests', { type: 'leave', minDaysWaiting: 3 })], mode: 'lookup' }, legacy: [{ tools: [T('pending_requests', { type: 'leave', minDaysWaiting: 3 })] }, { text: 'x' }] },
    { q: 'Which claims need a closer look?', area: 'claims', plan: { calls: [P('claims_to_check', { bills: 'none' })], mode: 'lookup' }, legacy: [{ tools: [T('claims_to_check', { bills: 'none' })] }, { text: 'x' }] },
    { q: 'Which managers still have reviews pending?', area: 'reviews', plan: { calls: [P('review_progress', { onlyPending: true })], mode: 'lookup' }, legacy: [{ tools: [T('review_progress', { onlyPending: true })] }, { text: 'x' }] },
    { q: 'Who is missing basic details?', area: 'people', plan: { calls: [P('missing_details')], mode: 'lookup' }, legacy: [{ tools: [T('missing_details')] }, { text: 'x' }] },
    { q: 'How active were teams on Connect this month?', area: 'engagement', plan: { calls: [P('engagement_summary', { by: 'team' })], mode: 'lookup' }, legacy: [{ tools: [T('engagement_summary', { by: 'team' })] }, { text: 'x' }] },
    { q: 'How do I add a holiday?', area: 'help', plan: { calls: [P('dashboard_help', { question: 'add a holiday' })], mode: 'lookup' }, legacy: [{ tools: [T('dashboard_help', { question: 'add a holiday' })] }, { text: 'x' }] },
    { q: 'Draft a welcome post for this month\'s new joiners', area: 'drafting', plan: { calls: [P('search_people', { limit: 50 })], mode: 'draft' }, legacy: [{ tools: [T('search_people', { limit: 50 })] }, { text: 'x' }] },
    { q: 'Write a reminder to managers about pending reviews', area: 'drafting', plan: { calls: [P('review_progress', { onlyPending: true })], mode: 'draft' }, legacy: [{ tools: [T('review_progress', { onlyPending: true })] }, { text: 'x' }] },
    { q: 'Why are more people late this month than last month?', area: 'analysis', plan: { calls: [P('attendance_summary', { from: `${today.slice(0, 7)}-01`, to: today })], mode: 'analysis' }, legacy: [{ tools: [T('attendance_summary', {})] }, { tools: [T('attendance_summary', { from: addDays(today, -60), to: addDays(today, -30) })] }, { text: 'x' }] },
  );
  const ask = (u: typeof hr, q: string, page = 'overview', partials?: string[]) => askSuwi(u, { question: q, page }, undefined, partials ? (t) => partials.push(t) : undefined);
  const flush = async () => { if (REDIS) { const { redisClient } = await import('../config/redis'); await redisClient()!.flushdb(); } };

  // —— Behaviour ——
  calls.length = 0;
  const a1 = await ask(hr, 'Who has no manager?');
  const r1 = await lastAudit();
  ok('a lookup takes two model steps: the small router, then the small writer, no tools offered to either', a1.path === 'router' && calls.length === 2 && calls[0].kind === 'router' && calls[1].kind === 'writer' && calls.every((c) => c.model === SUWI_SMALL_MODEL && !c.tools), JSON.stringify(calls));
  ok('its timing is recorded: path router, each step with its model, the lookup with its time', r1.timing?.path === 'router' && r1.timing.rounds?.map((x) => `${x.step}:${x.model}`).join() === `router:${SUWI_SMALL_MODEL},writer:${SUWI_SMALL_MODEL}` && Array.isArray(r1.tools) && (r1.tools as { name: string; ms: number }[]).some((t) => t.name === 'search_people' && typeof t.ms === 'number'), JSON.stringify(r1.timing));

  await flush(); calls.length = 0;
  const a2 = await ask(hr, 'Draft a welcome post for this month\'s new joiners');
  ok('a draft is written by the main model (router still small): two steps', a2.path === 'router' && calls.length === 2 && calls[0].model === SUWI_SMALL_MODEL && calls[1].kind === 'writer' && calls[1].model === SUWI_MODEL, JSON.stringify(calls));
  await flush(); calls.length = 0;
  await ask(hr, 'Why are more people late this month than last month?');
  ok('an analysis question is written by the main model', calls.length === 2 && calls[1].model === SUWI_MODEL, JSON.stringify(calls));

  await flush(); calls.length = 0; writerScript = ['NEED: headcount by department', 'Done with everything.'];
  const partials: string[] = [];
  const a3 = await ask(hr, 'How many people are in each department?', 'overview', partials);
  ok('a writer that says NEED gets one top-up (router again, then the writer): four steps, the final answer, NEED never shown', a3.text === 'Done with everything.' && calls.map((c) => c.kind).join() === 'router,writer,router,writer' && !partials.some((p) => /NEED/.test(p)), `${JSON.stringify(calls.map((c) => c.kind))} ${a3.text} ${JSON.stringify(partials)}`);
  writerScript = [];

  await flush(); calls.length = 0; process.env.SUWI_TOOL_TIMEOUT_MS = '1';
  const a4 = await ask(hr, 'Which teams had the most late arrivals in the last two weeks?');
  const r4 = await lastAudit();
  ok('a lookup slower than its time limit is reported as not loaded in time, and the answer still comes', a4.path === 'router' && (r4.tools as { timedOut?: boolean }[]).some((t) => t.timedOut), JSON.stringify(r4.tools));
  delete process.env.SUWI_TOOL_TIMEOUT_MS;

  await flush(); calls.length = 0; routerOverride = JSON.stringify({ calls: [{ tool: 'no_such_tool', args: {} }, { tool: 'prepare_change_manager', args: {} }, { tool: 'headcount', args: { by: 'department' } }], mode: 'lookup' });
  await ask(hr, 'How many people are in each department?');
  const r5 = await lastAudit();
  ok('the router\'s plan is checked: unknown tools and prepare_ (change) tools are dropped, the rest run', JSON.stringify((r5.tools as { name: string }[]).map((t) => t.name)) === '["headcount"]', JSON.stringify(r5.tools));
  await flush(); calls.length = 0; routerOverride = 'not json at all';
  const a6 = await ask(hr, 'How many people are in each department?');
  ok('an unreadable router reply falls back to the full loop', a6.path === 'model' && calls.some((c) => c.kind === 'loop'), `${a6.path} ${JSON.stringify(calls.map((c) => c.kind))}`);
  routerOverride = null;

  await flush(); calls.length = 0;
  QUESTIONS.push({ q: 'Approve all pending leave requests', area: 'act', plan: { calls: [], mode: 'act' }, legacy: [{ tools: [T('pending_requests', { type: 'leave' })] }, { text: 'Ready for you to confirm.' }] });
  const a7 = await ask(hr, 'Approve all pending leave requests');
  ok('a change goes to the full loop (which can prepare confirm cards), not the router', a7.path === 'model' && !calls.some((c) => c.kind === 'router'), `${a7.path} ${JSON.stringify(calls.map((c) => c.kind))}`);

  // —— Prepared ahead (needs Redis: the answer cache lives there) ——
  if (REDIS) {
    await flush();
    const Q2 = 'Which managers still have reviews pending?';
    await ask(hr, Q2); await ask(hr, `${Q2} `);
    await audit().updateMany({ question: { $regex: '^Which managers' } }, { $set: { 'timing.path': 'router' } });
    await flush();
    calls.length = 0;
    const made = await prepareFrequent(ORG);
    const preparedCalls = calls.length;
    calls.length = 0;
    const t0 = Date.now();
    const a8 = await ask(hr, Q2);
    const preparedMs = Date.now() - t0;
    ok('a question asked twice this week is prepared ahead, and served with no model call', made >= 1 && preparedCalls >= 2 && a8.path === 'prepared' && calls.length === 0 && preparedMs < 200, `made ${made}, prep calls ${preparedCalls}, ${a8.path}, ${preparedMs} ms, ${calls.length} calls`);
    calls.length = 0;
    const a9 = await ask(hr2, Q2);
    ok('another person asking the same is not served the first person\'s prepared answer', a9.path !== 'prepared' && a9.path !== 'cache' && calls.length >= 1, `${a9.path}`);
    await kept.bumpSuwiVersion(ORG);
    calls.length = 0;
    const a10 = await ask(hr, Q2);
    ok('after a change (new data version) the prepared answer is not used', a10.path === 'router' && calls.length === 2, `${a10.path} ${calls.length}`);
  } else console.log('SKIP  prepared-answer checks (no REDIS_URL)');

  // —— Before / after, 15 questions ——
  console.log('\nBefore (the old loop: main model each round) vs after (instant / planner / router + writer), stand-in model main ' + STUB_MAIN_MS + ' ms, small ' + STUB_SMALL_MS + ' ms:');
  console.log('| Question | Area | Before | After | How | Steps before → after |');
  console.log('|---|---|---|---|---|---|');
  let beforeSum = 0; let afterSum = 0;
  for (const x of QUESTIONS.filter((q) => q.area !== 'act')) {
    await flush();
    process.env.SUWI_ROUTER = '0'; process.env.SUWI_INSTANT = '0'; process.env.SUWI_PLANNER = '0';
    calls.length = 0;
    let t = Date.now(); await ask(hr, x.q); const before = Date.now() - t; const stepsBefore = calls.length;
    delete process.env.SUWI_ROUTER; delete process.env.SUWI_INSTANT; delete process.env.SUWI_PLANNER;
    await flush(); calls.length = 0;
    t = Date.now(); const a = await ask(hr, x.q); const after = Date.now() - t;
    beforeSum += before; afterSum += after;
    console.log(`| ${x.q} | ${x.area} | ${(before / 1000).toFixed(1)} s | ${(after / 1000).toFixed(1)} s | ${a.path} | ${stepsBefore} → ${calls.length} |`);
  }
  console.log(`| **All ${QUESTIONS.length - 1}** | | **${(beforeSum / 1000).toFixed(1)} s** | **${(afterSum / 1000).toFixed(1)} s** | | |`);

  console.log(failures ? `\n${failures} orchestration check(s) failed` : '\nall orchestration checks passed');
  await db.closeDb?.();
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
