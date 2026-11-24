/**
 * One question to Suwi: build the instructions and the tools this person may
 * use, let Claude ask for data (tool calls run here, as the asker), and return
 * the answer with what was checked, buttons to open the records, and any
 * prepared action. Every question is written to the audit log.
 */
import { companies } from '../config/db';
import { asLlmTool, contextFor, SUWI_AREAS, SuwiArea, SuwiContext, SuwiLink, SuwiTable, SuwiTool, toolByName, toolAllowed, toolsFor } from './tools';
import { instantAnswer } from './instant';
import { keepAttention, planFor, preparedAttention, runPlan } from './planner';
import { asksForChange, routeAndWrite } from './orchestrator';
import { hashOf, keptGet, keptSet, normalQuestion, suwiVersion } from './kept';
import { callModel, ContentBlock, costUsd, LlmMessage, SuwiLlmError, SUWI_MODEL } from './llm';
import { auditCol, LEVEL_LABEL, settingsFor, spentThisMonthUsd } from './store';
import { cancelProposal, getProposal } from './proposals';
import { User } from '../models/user.model';
import './registry';
import { describeSheet, lastSheet, parseSheet, rememberSheet } from './sheet';

/** The full loop (changes, files, sheets) gets this many model rounds; everything else takes at most two steps (orchestrator.ts). */
const MAX_ROUNDS = 5;
const MAX_RESULT_CHARS = 14_000;

export interface SuwiAnswer {
  text: string;
  checked: string[];
  links: SuwiLink[];
  proposals: Awaited<ReturnType<typeof getProposal>>[];
  costUsd: number;
  /** Lists the panel draws as tables under the text (from the tools' data, never written by the model). */
  tables?: SuwiTable[];
  /** How it was answered: from the kept data with no model, the model, a kept answer to the same question, the planner (its checks + one short write), or an answer prepared ahead. */
  path?: SuwiPath;
}

export type SuwiPath = 'instant' | 'model' | 'cache' | 'planner' | 'prepared' | 'router';

/** What the audit row records about how long a question took. */
interface Timing { path: SuwiPath; totalMs: number; firstTextMs?: number; rounds?: { ms: number; input: number; output: number; model?: string; step?: string }[]; live?: boolean; writer?: string; mode?: string }

/** A kept answer lives this long; one that read today's attendance (punches change it with no write hook) a minute. */
const ANSWER_TTL_S = 10 * 60;
const LIVE_ANSWER_TTL_S = 60;

/**
 * Which areas a question is about, from its words and the page it was asked on: only those areas'
 * tools are offered, so the model reads a fraction of the tool list. Nothing recognised: every tool.
 */
const AREA_WORDS: [SuwiArea, RegExp][] = [
  ['payroll', /pay(roll|slip|run)?s?|salar|ctc|tax|tds|pf|esi|bonus|deduct|form ?16|gross|net pay|arrear|gratuity|settlement/],
  ['claims', /claim|reimburs|bills?|expense|receipt/],
  ['performance', /kpi|review|apprais|performanc|rating|goal|feedback/],
  ['connect', /posts?|poll|connect|engag|feed|survey|relay|games?|recogni|kudos|contest|tournament|report(ed)? content/],
  ['people', /people|employee|headcount|designation|department|profile|joined|joining|birthday|missing|document|reports? to|team|who is/],
  ['settings', /setting|polic|how do i|where (do|can)|shift|template|holiday|week ?off|help/],
  ['requests', /leave|overtime|correction|check-?in|pending|waiting|approv|request|decid|remind/],
  ['attendance', /late|absent|attend|punch|leave|present|missed|half day|wfh|work from home|in today|calendar|geotag|location/],
  ['people', /access|admin|exit|leaving|resign|offboard|import|joiner|new hire|export|download|spreadsheet|excel|csv/],
  ['settings', /organi[sz]ation|company (details|profile|address|name)|sender|reply-?to|registered (name|address)/],
];
const PAGE_AREAS: [RegExp, SuwiArea][] = [
  [/pay|salary|tax|fbp|form16|statutory/, 'payroll'], [/reimburs|claim|bill/, 'claims'], [/kpi|feedback|cycle|review/, 'performance'],
  [/connect|engage|game|post|poll|contest/, 'connect'], [/employee|people|access|designation|import|bulk/, 'people'],
  [/leave|overtime|attendance|regulari|oolcheck|request/, 'requests'], [/punch|calendar|attendance|shift|report/, 'attendance'], [/setting|setup|template|polic/, 'settings'],
];
/** Always offered: finding people and the help pages, which most answers lean on. */
const ALWAYS = new Set(['search_people', 'person_details', 'dashboard_help']);
function relevantTools(tools: SuwiTool[], question: string, page: string): SuwiTool[] {
  const q = question.toLowerCase();
  const areas = new Set<SuwiArea>(AREA_WORDS.filter(([, re]) => re.test(q)).map(([a]) => a));
  if (!areas.size) return tools;
  for (const [re, a] of PAGE_AREAS) if (re.test(page)) areas.add(a);
  // Requests and attendance answer each other's questions (approved leave is attendance).
  if (areas.has('requests') || areas.has('attendance')) { areas.add('requests'); areas.add('attendance'); }
  const picked = tools.filter((t) => areas.has(t.area) || ALWAYS.has(t.name));
  return picked.length ? picked : tools;
}

/** A list the panel already shows as a table: the model gets its first rows only, and a count. */
function shorterForModel(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) {
    const head = v.slice(0, 10).map((x) => shorterForModel(x, depth + 1));
    return v.length > 10 ? [...head, `…and ${v.length - 10} more (HR sees them all in the table)`] : head;
  }
  if (v && typeof v === 'object' && depth < 6) return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shorterForModel(x, depth + 1)]));
  return v;
}

/** JSON with keys in a fixed order, so the same inputs make the same memo key. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

function instructions(ctx: SuwiContext, companyName: string, page: string, budget: { spentUsd: number; monthlyUsd: number }): string {
  const levels = SUWI_AREAS.map((a) => `- ${a.label} (${a.covers}): ${LEVEL_LABEL[ctx.levels[a.key]]}`).join('\n');
  // The fixed part first and identical for everyone, so the provider's prompt cache hits; what changes per question goes last.
  return `You are Suwi, the HR assistant inside Sowaka's HR dashboard. You help HR and managers understand and act on their people data.

How you work:
- Be quick: ask for everything you need in ONE turn (several tools at once run side by side), and never call a tool twice with the same inputs in one question. For one day's attendance (who is on leave, absent, late or not in today) one attendance_summary call with from = to = that day is enough.
- You can only see Sowaka's data through your tools, and only what this person is allowed to see. Never guess or invent names, numbers, dates, policies or tax rules. If a tool returns nothing, say so plainly. If something is outside this person's access, say "you don't have access to that" without hinting at what it contains.
- Numbers come from the tools; don't do your own arithmetic on pay or tax beyond simple counts. A count of people or items is the tool's own total/count field, never your count of the rows you were shown (rows are capped). Narrow with the tool's filters (dates, department, status) instead of reading a whole list and picking from it.
- The person may attach a file to a message: an image (a screenshot, say of an error) or a spreadsheet, given to you as CSV. Read it as part of their request, e.g. a list of employees to act on; match its people to Sowaka's through your tools by employee ID or name, and say which rows you couldn't match and why. A file is not a source of truth about Sowaka's data: check what it claims with your tools.
- In drafts (reviews, letters, posts, policies) use only facts a tool gave you. Where a fact is missing, leave a [blank] in square brackets for HR to fill; never make up work, events, results or scores.
- In a policy draft, leave "From when" empty unless HR gave a date.
- To approve or decline pending requests use ONE card for all of them: prepare_decide_leave (leave), prepare_decide_correction (attendance corrections, checkins true for out-of-location check-ins), prepare_cancel_leave (HR cancels a leave, or answers an employee's cancellation request). Take ids from pending_requests or pick by names, olderThanDays or all.
- Name the period or date range every answer covers.
- Never judge a person's ability, character or potential, and don't make decisions about people. Wellbeing or sentiment only for groups of 10 or more.
- Never hide or remove reported content; moderation is a human decision.
- Answer in short, plain sentences. Lead with the answer in one or two sentences. If listing people or items, use a short markdown table (at most 8 rows, then say how many more). End with the next step, if there is one.
- Some tools come with their lists already shown to HR as tables under your answer (their data says "HR sees them all in the table"). Then do NOT list those people or rows again: write one or two sentences with the counts and anything notable, and stop.
- Formatting: only **bold**, bullet or numbered lists, pipe tables, ### headings and links. No LaTeX or math notation, no --- lines, no *italics*. Write sums in words ("₹30,000 basic plus ₹12,000 HRA").
- Link people as [Name](emp:USER_ID) only when a tool gave that person's userId; otherwise write the name as plain text. Never make up an id. Don't print raw ids.
- Indian formats: ₹ with lakh grouping, DD Mon YYYY dates.

What you may do in each area (set by the company in Settings → Suwi):
${levels}
- "Answer only": give facts, no next steps.
- "Suggest": you may also point to the next step and where to do it.
- "Act after you confirm": when asked to change something, use the matching prepare_ tool. It does NOT change anything; it shows HR a "What will happen" card with Confirm. Never say a change is done: say it's ready for them to confirm. If no prepare_ tool fits, explain where they can do it in the dashboard.
- A holiday for everyone (or a location) is prepare_add_holiday (Holiday Bank; prepare_remove_holiday, holiday_bank to list), not day marks; a leave type's yearly total for one person is prepare_set_leave_total; new department or designation names are prepare_add_department_or_designation.
- The same change for two or more people is ONE call to a bulk tool, never one prepare_ call per person: prepare_bulk_mark_day for attendance marks (it can pick people by what their day was on another date, e.g. everyone present on 10 Nov), prepare_bulk_assign for assigning shifts, managers, departments and templates.
- Call a prepare_ tool once per change, with your best reading of the request. Never prepare alternatives; if the request could mean something else, prepare your best reading and mention the other reading in your answer.

If asked what you can do, describe your areas briefly with two or three example questions.

This question:
- Company: ${companyName}
- Today: ${ctx.today} (India time)
- Asking: ${ctx.user.name}${ctx.user.dashboardAdmin ? ', a dashboard admin' : ''}${ctx.payroll ? ', with payroll access' : ', without payroll access'}
- Page: ${page || 'overview'}${ctx.sheet ? `\n- Sheet loaded: ${describeSheet(ctx.sheet)}. To assign to the people in it, call prepare_bulk_assign with fromSheet: true; never copy IDs out of it. When the sheet has a column for what is being assigned, leave value empty and each row's own value is used (one card per value). Rows that can't be matched come back as skipped with their row number: tell HR each one.` : ''}${page.startsWith('bulk') ? `
- HR opened Bulk assign: use prepare_bulk_assign for any "assign X to Y" request, one card per thing assigned. If they attached a sheet, pass every Employee ID in it. If they haven't said what or who, ask in one short question.` : ''}${ctx.user.dashboardAdmin ? `
- Suwi budget this month: $${budget.spentUsd.toFixed(2)} of $${budget.monthlyUsd} used (only dashboard admins are told this)` : ''}`;
}

/** The most one image may be once decoded, and the most text a spreadsheet may bring (read in the browser). */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TABLE_CHARS = 150_000;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg']);

/**
 * The file sent with a question, if any: an image (PNG or JPEG, base64) for the
 * model to look at, or a spreadsheet the dashboard has already read into CSV
 * text. One per message. Anything else is refused, and the question with it.
 */
function attachmentOf(raw: unknown): { name: string; image?: { mimeType: string; data: string }; table?: string } | null {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length === 0) return null;
  if (list.length > 1) throw new SuwiLlmError(400, 'Attach one file at a time.');
  const a = list[0] as { kind?: unknown; name?: unknown; mimeType?: unknown; data?: unknown; text?: unknown };
  const name = typeof a?.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 120) : 'attachment';
  if (a?.kind === 'image') {
    const mimeType = String(a.mimeType ?? '');
    const data = typeof a.data === 'string' ? a.data : '';
    if (!IMAGE_TYPES.has(mimeType) || !/^[A-Za-z0-9+/=]+$/.test(data.slice(0, 200))) throw new SuwiLlmError(400, 'Only images and Excel files can be attached.');
    if (Math.floor((data.length * 3) / 4) > MAX_IMAGE_BYTES) throw new SuwiLlmError(400, 'That file is too large. Attach one under 5 MB.');
    return { name, image: { mimeType, data } };
  }
  if (a?.kind === 'table') {
    const text = typeof a.text === 'string' ? a.text : '';
    if (!text.trim()) throw new SuwiLlmError(400, 'That spreadsheet looks empty.');
    if (text.length > MAX_TABLE_CHARS) throw new SuwiLlmError(400, 'That spreadsheet is too large. Attach one with fewer rows.');
    return { name, table: text };
  }
  throw new SuwiLlmError(400, 'Only images and Excel files can be attached.');
}

export async function askSuwi(
  user: Omit<User, 'profilePhotoUrl'>,
  input: { question?: unknown; page?: unknown; history?: unknown; attachments?: unknown },
  onProgress?: (checking: string) => void,
  onPartial?: (textSoFar: string) => void,
  opts: { prepare?: boolean } = {},
): Promise<SuwiAnswer> {
  const started = Date.now();
  const attachment = attachmentOf(input.attachments);
  const typed = typeof input.question === 'string' ? input.question.trim().slice(0, 2000) : '';
  // A file alone is a question too: Suwi is asked to look at it.
  const question = typed || (attachment?.image ? 'Have a look at the attached image.' : attachment ? 'Have a look at the attached spreadsheet.' : '');
  if (!question) throw new SuwiLlmError(400, 'Ask Suwi a question');
  const page = typeof input.page === 'string' ? input.page.slice(0, 40) : '';
  // A kept answer to the same question, by the same person, on the same data (suwi/kept.ts): the data
  // version changes with every write Suwi reads from, so a change always misses. Never for a file or a
  // follow-up (the history changes what the question means), and only while Suwi is on.
  const history = Array.isArray(input.history) ? input.history : [];
  const cacheable = !attachment && history.length === 0;
  const version = cacheable ? await suwiVersion(user.org!) : null;
  const today = istToday();
  const cacheKey = version ? `ans:${user.org}:${version}:${hashOf(user.userId, normalQuestion(question), page, today)}` : '';
  if (cacheKey) {
    const kept = await keptGet<SuwiAnswer & { prepared?: boolean }>(cacheKey);
    if (kept && opts.prepare) return { ...kept, proposals: [] };
    if (kept && (await settingsFor(user.org!)).enabled) {
      // Made ahead by the warm-up (prepared.ts) or kept from an earlier ask: either way no model call now.
      const path: SuwiPath = kept.prepared ? 'prepared' : 'cache';
      await auditCol().insertOne({ org: user.org!, userId: user.userId, kind: 'question', at: new Date(), page, question, answer: kept.text.slice(0, 50_000), status: 'answered', tools: [], model: SUWI_MODEL, costUsd: 0, timing: { path, totalMs: Date.now() - started } } as never).catch(() => undefined);
      const { prepared: _p, ...answerOnly } = kept;
      return { ...answerOnly, path, proposals: [] };
    }
  }
  // Every question is kept, with what Suwi answered and whether it worked; a failure too.
  try {
    const { answer: done, live } = await answer(user, question, page, attachment, input, started, onProgress, onPartial, Boolean(opts.prepare));
    if (cacheKey && !done.proposals.length) await keptSet(cacheKey, opts.prepare ? { ...done, prepared: true } : done, live ? LIVE_ANSWER_TTL_S : ANSWER_TTL_S);
    return done;
  } catch (e) {
    if (opts.prepare) throw e;
    await auditCol().insertOne({
      org: user.org!, userId: user.userId, kind: 'question', at: new Date(), page, question, status: 'failed',
      error: (e as Error).message?.slice(0, 1000) || 'Something went wrong',
      ...(attachment ? { attachment: { name: attachment.name, kind: attachment.image ? 'image' : 'spreadsheet' } } : {}),
    }).catch(() => undefined);
    throw e;
  }
}

async function answer(
  user: Omit<User, 'profilePhotoUrl'>, question: string, page: string,
  attachment: ReturnType<typeof attachmentOf>, input: { history?: unknown },
  started: number,
  onProgress?: (checking: string) => void,
  onPartial?: (textSoFar: string) => void,
  prepare = false,
): Promise<{ answer: SuwiAnswer; live: boolean }> {
  // An answer made ahead (prepared.ts) isn't a question anyone asked: only its cost is recorded, as 'prepared'.
  const record = (row: Record<string, unknown>) => (prepare
    ? (Number(row.costUsd) > 0 ? auditCol().insertOne({ org: user.org!, userId: user.userId, kind: 'prepared', at: new Date(), page: 'prepared', question: `Prepared: ${question}`, model: row.model, costUsd: row.costUsd } as never) : Promise.resolve())
    : auditCol().insertOne(row as never));
  const settings = await settingsFor(user.org!);
  if (!settings.enabled) throw new SuwiLlmError(403, 'Suwi is turned off for this company. An admin can turn it on in Settings → Suwi.');
  const spent = await spentThisMonthUsd(user.org!);
  if (spent >= settings.monthlyBudgetUsd) throw new SuwiLlmError(429, `Suwi has used this month's budget ($${settings.monthlyBudgetUsd}). An admin can raise it in Settings → Suwi.`);

  const ctx = contextFor(user, settings.levels, istToday());
  // A sheet that names people is read here, so Bulk assign uses its rows exactly; it stays for follow-ups.
  const parsedSheet = attachment?.table ? parseSheet(attachment.name, attachment.table) : null;
  if (parsedSheet) rememberSheet(ctx.userId, parsedSheet);
  const sheet = parsedSheet ?? (attachment ? undefined : lastSheet(ctx.userId));
  if (sheet) ctx.sheet = sheet;
  // The common lookups straight from the kept data, no model (instant.ts); anything else goes on below.
  if (!attachment && process.env.SUWI_INSTANT !== '0') {
    const quick = await instantAnswer(ctx, question).catch(() => null);
    if (quick) {
      const timing: Timing = { path: 'instant', totalMs: Date.now() - started, live: quick.live };
      await record({
        org: ctx.org, userId: ctx.userId, kind: 'question', at: new Date(), page, question, answer: quick.text, status: 'answered',
        tools: quick.checked.map((label) => ({ name: `instant:${quick.kind}`, label, ms: timing.totalMs, ok: true })), model: 'none', costUsd: 0, timing,
      } as never);
      return { answer: { text: quick.text, checked: quick.checked, links: quick.links.slice(0, 6), proposals: [], costUsd: 0, tables: quick.tables, path: 'instant' }, live: quick.live };
    }
  }
  // Questions the planner knows (planner.ts): no "which tools?" round. "What needs my attention" is usually
  // prepared already for this person; else its checks run side by side and the small model writes once.
  const followUp = Array.isArray(input.history) && input.history.length > 0;
  if (!attachment && !followUp && process.env.SUWI_PLANNER !== '0') {
    const plan = planFor(ctx, question);
    if (plan) {
      const prepared = plan.intent === 'attention' ? await preparedAttention(ctx) : null;
      let firstTextMs: number | undefined;
      const done = prepared ?? await runPlan(ctx, plan, onProgress, (soFar) => { if (firstTextMs === undefined && soFar.trim()) firstTextMs = Date.now() - started; onPartial?.(soFar); }, { spentUsd: spent, budgetUsd: settings.monthlyBudgetUsd });
      if (!prepared && plan.intent === 'attention') await keepAttention(ctx, done);
      const path = prepared ? 'prepared' : 'planner';
      const timing: Timing = {
        path, totalMs: Date.now() - started, live: done.live,
        ...(firstTextMs !== undefined ? { firstTextMs } : {}),
        ...(!prepared && done.writer ? { rounds: [{ ms: done.writer.ms, input: done.writer.input, output: done.writer.output, model: done.writer.model, step: 'writer' }], writer: done.writer.model } : {}),
      };
      await record({
        org: ctx.org, userId: ctx.userId, kind: 'question', at: new Date(), page, question, answer: done.text.slice(0, 50_000), status: 'answered',
        tools: prepared ? [] : done.tools, model: done.writer?.model ?? 'none', costUsd: prepared ? 0 : done.costUsd, timing,
      });
      return { answer: { text: done.text, checked: done.checked, links: done.links, proposals: [], costUsd: prepared ? 0 : done.costUsd, ...(done.tables.length ? { tables: done.tables } : {}), path }, live: done.live };
    }
  }
  const company = await companies().findOne({ id: ctx.org });
  // Earlier turns of this chat, text only (the panel keeps them).
  const history: LlmMessage[] = Array.isArray(input.history)
    ? (input.history as { role?: unknown; text?: unknown }[]).slice(-8)
        .filter((h) => (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string' && h.text.trim())
        .map((h) => ({ role: h.role as 'user' | 'assistant', content: String(h.text).slice(0, 4000) }))
    : [];
  while (history.length && history[0].role !== 'user') history.shift();
  // Everything else that isn't a change, a file or a sheet: two steps (orchestrator.ts): the small model picks
  // the lookups, they run side by side, one writer answers, streamed. A change goes on to the full loop below.
  const sheetWork = Boolean(ctx.sheet) || page.startsWith('bulk');
  if (!attachment && !sheetWork && process.env.SUWI_ROUTER !== '0' && !asksForChange(ctx, question)) {
    const routed = await routeAndWrite(ctx, { question, page, companyName: company?.name ?? ctx.org, history, started, onProgress, onPartial }).catch(() => null);
    if (routed) {
      const timing: Timing = { path: 'router', totalMs: Date.now() - started, ...(routed.firstTextMs !== undefined ? { firstTextMs: routed.firstTextMs } : {}), rounds: routed.rounds, live: routed.live, writer: routed.writer, mode: routed.mode };
      await record({
        org: ctx.org, userId: ctx.userId, kind: 'question', at: new Date(), page, question, answer: routed.text.slice(0, 50_000), status: 'answered',
        tools: routed.tools, model: routed.writer, costUsd: routed.costUsd, tokens: routed.tokens, timing,
      });
      return { answer: { text: routed.text, checked: routed.checked, links: routed.links, proposals: [], costUsd: routed.costUsd, ...(routed.tables.length ? { tables: routed.tables } : {}), path: 'router' }, live: routed.live };
    }
  }
  // A stable order keeps the tool list identical between questions, so it caches; only the areas the
  // question is about are offered (relevantTools), so the model reads a fraction of the list.
  const tools = relevantTools(toolsFor(ctx), question, page).sort((a, b) => a.name.localeCompare(b.name));
  // The file goes with this message only: an image for the model to see, a spreadsheet as its rows.
  // A people sheet is read on the server, so the model sees its first rows only; Bulk assign reads them all.
  const tableLines = attachment?.table?.split('\n') ?? [];
  const tableShown = parsedSheet && tableLines.length > 41 ? `${tableLines.slice(0, 41).join('\n')}\n… ${tableLines.length - 41} more rows, not shown here; Bulk assign with fromSheet uses every row.` : attachment?.table;
  const asked = attachment?.table
    ? `${question}\n\n[Attached spreadsheet "${attachment.name}", as CSV, one block per sheet]\n${tableShown}`
    : attachment?.image ? `${question}\n\n[Attached image "${attachment.name}"]` : question;
  const messages: LlmMessage[] = [...history, { role: 'user', content: asked, ...(attachment?.image ? { images: [attachment.image] } : {}) }];

  const checked: string[] = [];
  const links: SuwiLink[] = [];
  const proposalIds: string[] = [];
  const toolLog: { name: string; label: string; ms: number; ok: boolean; memo?: true }[] = [];
  // A read already made in this question is answered from here: models sometimes ask again with the
  // same inputs. Prepared changes (`acts`) always run, so each one makes its own card.
  const memo = new Map<string, string>();
  let total = 0;
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let text = '';
  let incomplete = false;
  const tables: SuwiTable[] = [];
  let live = false;
  const rounds: { ms: number; input: number; output: number; model?: string; step?: string }[] = [];
  let firstTextMs: number | undefined;
  const onText = (soFar: string) => {
    if (firstTextMs === undefined && soFar.trim()) firstTextMs = Date.now() - started;
    onPartial?.(soFar);
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const roundStarted = Date.now();
    // Once the lists are on screen as tables, the answer is a sentence or two: no room to write them out.
    const reply = await callModel({ system: instructions(ctx, company?.name ?? ctx.org, page, { spentUsd: spent, monthlyUsd: settings.monthlyBudgetUsd }), tools: tools.map(asLlmTool), messages, onText, ...(tables.length ? { maxTokens: 400 } : {}) });
    rounds.push({ ms: Date.now() - roundStarted, input: reply.usage.input_tokens ?? 0, output: reply.usage.output_tokens ?? 0, model: reply.model || SUWI_MODEL, step: 'model' });
    total += costUsd(reply.model || SUWI_MODEL, reply.usage);
    tokens.input += reply.usage.input_tokens ?? 0; tokens.output += reply.usage.output_tokens ?? 0;
    tokens.cacheRead += reply.usage.cache_read_input_tokens ?? 0; tokens.cacheWrite += reply.usage.cache_creation_input_tokens ?? 0;
    messages.push({ role: 'assistant', content: reply.content, raw: reply.raw });
    const calls = reply.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    text = reply.content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!calls.length || reply.stop_reason !== 'tool_use') break;
    const results = await Promise.all(calls.map(async (c): Promise<ContentBlock> => {
      const t = toolByName(c.name);
      const started = Date.now();
      if (!t || !toolAllowed(ctx, t)) return { type: 'tool_result', tool_use_id: c.id, content: 'Not available to this person.', is_error: true };
      const label = t.label(c.input ?? {});
      const memoKey = t.acts ? '' : `${t.name}|${stableJson(c.input ?? {})}`;
      const seen = memoKey ? memo.get(memoKey) : undefined;
      if (seen !== undefined) { toolLog.push({ name: t.name, label, ms: 0, ok: true, memo: true }); return { type: 'tool_result', tool_use_id: c.id, content: seen }; }
      onProgress?.(label);
      try {
        const out = await t.run(ctx, c.input ?? {});
        toolLog.push({ name: t.name, label, ms: Date.now() - started, ok: true });
        if (!checked.includes(label)) checked.push(label);
        for (const l of out.links ?? []) if (!links.some((x) => x.label === l.label)) links.push(l);
        if (out.proposalId) proposalIds.push(out.proposalId);
        for (const id of out.proposalIds ?? []) if (!proposalIds.includes(id)) proposalIds.push(id);
        if (out.live) live = true;
        for (const tb of out.tables ?? []) if (!tables.some((x) => x.title === tb.title)) tables.push(tb);
        const json = JSON.stringify((out.tables?.length ? shorterForModel(out.data) : out.data) ?? null);
        const content = json.length > MAX_RESULT_CHARS ? `${json.slice(0, MAX_RESULT_CHARS)}… (cut; ask a narrower question for the rest)` : json;
        if (memoKey) memo.set(memoKey, content);
        return { type: 'tool_result', tool_use_id: c.id, content };
      } catch (e) {
        toolLog.push({ name: t.name, label, ms: Date.now() - started, ok: false });
        return { type: 'tool_result', tool_use_id: c.id, content: `Error: ${(e as Error).message}`, is_error: true };
      }
    }));
    messages.push({ role: 'user', content: results });
    if (round === MAX_ROUNDS - 1) { incomplete = true; text = text || 'That needed more steps than I can take at once. Try a narrower question.'; }
  }

  // One card per change: if the model prepared the same change more than once, only the last one stays; the others are cancelled.
  const prepared = await Promise.all(proposalIds.map((id) => getProposal(ctx.userId, ctx.org, id)));
  const lastOf = new Map(prepared.map((p) => [`${p.kind}|${p.title}`, p.id]));
  const proposals = prepared.filter((p) => lastOf.get(`${p.kind}|${p.title}`) === p.id);
  await Promise.all(prepared.filter((p) => !proposals.includes(p)).map((p) => cancelProposal(ctx.userId, ctx.org, p.id)));
  await record({
    org: ctx.org, userId: ctx.userId, kind: 'question', at: new Date(), page, question,
    answer: (text || "I couldn't find an answer to that.").slice(0, 50_000),
    status: incomplete ? 'incomplete' : 'answered',
    ...(proposals.length ? { proposalIds: proposals.map((p) => p.id) } : {}),
    ...(attachment ? { attachment: { name: attachment.name, kind: attachment.image ? 'image' : 'spreadsheet' } } : {}),
    tools: toolLog, model: SUWI_MODEL, costUsd: total, tokens,
    timing: { path: 'model', totalMs: Date.now() - started, ...(firstTextMs !== undefined ? { firstTextMs } : {}), rounds, live } satisfies Timing,
  });
  return { answer: { text: text || "I couldn't find an answer to that.", checked, links: links.slice(0, 6), proposals, costUsd: total, ...(tables.length ? { tables } : {}), path: 'model' }, live };
}
