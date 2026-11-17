/**
 * Suwi's two-step way to answer any question the instant answers and the planner don't know:
 *
 *   1. Router  — the small model, thinking off, reads the question and a compact catalogue of the
 *                read tools this person may use, and replies with JSON: which tools to call, with
 *                what inputs, and what kind of answer it is (lookup, draft, analysis, act).
 *   2. Tools   — every chosen tool runs at once, as the asker, each with a time limit (a slow one
 *                becomes "couldn't load X in time" instead of holding the answer up).
 *   3. Writer  — one call that sees only the question and the compact results (no tool catalogue),
 *                streamed from its first token. The small model with thinking at its least writes
 *                lookups; the main model writes drafts and open-ended analysis.
 *
 * If the writer finds something essential missing it replies "NEED: …"; the router then tops the
 * data up once and the writer answers with what it has. A request to change something ("act") goes
 * back to the full tool loop in agent.ts, which can prepare confirm cards.
 */
import { callModel, costUsd, LlmMessage, SUWI_MODEL } from './llm';
import { SUWI_SMALL_MODEL } from './digest';
import { SuwiContext, SuwiLink, SuwiTable, SuwiTool, toolAllowed, toolByName, toolsFor } from './tools';
import { LEVEL_LABEL } from './store';
import { SUWI_AREAS } from './tools';

export type RouteMode = 'lookup' | 'draft' | 'analysis' | 'act';
export interface RoutedCall { tool: string; args: Record<string, unknown> }
export interface RouterPlan { calls: RoutedCall[]; mode: RouteMode }
export interface Round { step: 'router' | 'writer' | 'model'; model: string; ms: number; input: number; output: number }
export interface ToolRun { name: string; label: string; ms: number; ok: boolean; memo?: true; timedOut?: true }

export interface OrchestratedAnswer {
  text: string;
  checked: string[];
  links: SuwiLink[];
  tables: SuwiTable[];
  live: boolean;
  tools: ToolRun[];
  rounds: Round[];
  costUsd: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  firstTextMs?: number;
  mode: RouteMode;
  writer: string;
}

/** A tool that takes longer than this is reported as not loaded in time (SUWI_TOOL_TIMEOUT_MS). */
const toolTimeoutMs = () => Number(process.env.SUWI_TOOL_TIMEOUT_MS ?? 3000);
const MAX_CALLS = 5;
const MAX_RESULT_CHARS = 8_000;

/** Words that ask Suwi to write something, or to reason beyond a lookup: the main model writes those. */
const DRAFT = /\b(draft|write|compose|letter|policy|announce|announcement|post (a|an|about)|email|message to|appraisal|review (comment|text|summary)|feedback for|job description|offer letter|caption|poll)\b/i;
const ANALYSIS = /\b(why|compare|comparison|trend|pattern|insight|analy[sz]e|analysis|recommend|suggest|should (i|we)|plan|forecast|risk|explain why|what if|root cause|improve)\b/i;
/** Asking for a change: the full loop (agent.ts) prepares confirm cards. */
const ACT = /\b(approve|reject|decline|assign|create|add|make|set up|move|delete|remove|remind|nudge|send|publish|post it|correct|fix (the|his|her|their)|mark|enable|disable|turn (on|off)|run payroll|bulk|change (the|his|her|their)|update (the|his|her|their))\b/i;

/** A question about something, not a request to do it ("how do I add a holiday?", "who should approve…"). */
const ASKING = /^\s*(how|where|what|which|who|whom|whose|when|why|is|are|was|were|do|does|did|has|have|should|list|show|tell me|explain)\b/i;
/** …unless it's phrased as a request: "can you approve…", "please add…". */
const REQUESTING = /^\s*(can you|could you|would you|will you|please|pls|kindly|go ahead)\b/i;

/** Would a change request go to the full loop? Only where some area lets Suwi prepare changes. */
export function asksForChange(ctx: SuwiContext, question: string): boolean {
  if (!Object.values(ctx.levels).some((l) => l === 'act')) return false;
  if (ASKING.test(question) && !REQUESTING.test(question)) return false;
  return ACT.test(question);
}

function firstSentence(s: string, max = 120): string {
  const one = s.replace(/\s+/g, ' ').split(/(?<=[.!?])\s/)[0] ?? s;
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** `name(a*:string, b:month YYYY-MM, c:late|absent) — purpose`: one line per read tool, required inputs starred. */
function catalogueLine(t: SuwiTool): string {
  const schema = t.input_schema as { properties?: Record<string, { type?: string; enum?: unknown[]; description?: string }>; required?: string[] };
  const req = new Set(schema.required ?? []);
  const params = Object.entries(schema.properties ?? {}).map(([k, p]) => {
    const kind = p.enum?.length ? p.enum.slice(0, 6).join('|') : (p.type ?? 'any');
    return `${k}${req.has(k) ? '*' : ''}:${kind}`;
  }).join(', ');
  return `${t.name}(${params}) — ${firstSentence(t.description)}`;
}

/** The read tools this person may use, in a fixed order (so the router's prompt caches). */
export function routerTools(ctx: SuwiContext): SuwiTool[] {
  return toolsFor(ctx).filter((t) => !t.acts).sort((a, b) => a.name.localeCompare(b.name));
}

function routerSystem(ctx: SuwiContext, tools: SuwiTool[]): string {
  // Fixed part first (cacheable), per-person part last.
  return `You choose the data lookups for Suwi, an HR assistant. Reply with JSON only, no prose:
{"calls":[{"tool":"<name>","args":{...}}],"mode":"lookup|draft|analysis|act"}
Rules:
- Pick every lookup needed in one go, at most ${MAX_CALLS}. Prefer one broad lookup over several narrow ones. Use only tools from the list, with their parameters (* = required). Dates are YYYY-MM-DD, months YYYY-MM.
- A person named in the question: use their name as the query/name argument the tool takes (search_people finds people by name).
- mode: "act" when they ask to change something (approve, assign, create, delete, remind, move, post…); "draft" when they ask you to write something (a letter, policy, post, review text); "analysis" for why/compare/trends/recommendations; otherwise "lookup".
- No data needed (a greeting, "what can you do", how-to questions answered by dashboard_help): use dashboard_help for how-to, else calls = [].
Tools:
${tools.map(catalogueLine).join('\n')}
Today: ${ctx.today} (India time).`;
}

function writerSystem(ctx: SuwiContext, companyName: string, mode: RouteMode): string {
  const levels = SUWI_AREAS.map((a) => `${a.label}: ${LEVEL_LABEL[ctx.levels[a.key]]}`).join('; ');
  return `You are Suwi, the HR assistant in Sowaka's HR dashboard. Answer from the data below only.
- Never invent names, numbers, dates, policies or tax rules; if the data doesn't have it, say so plainly. If a lookup says it isn't available to this person, say "you don't have access to that".
- Lead with the answer in one or two short sentences. Name the period or date the answer covers.
- Lists already shown as tables under your answer (their data says "HR sees them all in the table"): don't list those rows again; give the counts and anything notable.
- Otherwise, for a few items use a short pipe table (at most 8 rows, then say how many more).
- Only **bold**, lists, pipe tables, ### headings and links. Link people as [Name](emp:USER_ID) only with a userId from the data; never print raw ids. ₹ with lakh grouping, DD Mon YYYY dates.
- Never judge a person's ability, character or potential. Wellbeing only for groups of 10 or more.
${mode === 'draft' ? '- In a draft use only facts from the data; leave a [blank] for anything missing. In a policy draft leave "From when" empty unless a date was given.\n' : ''}- If something essential to answer is missing from the data, reply with exactly one line: NEED: <what is missing, in plain words>. Otherwise never write NEED.
What Suwi may do per area (set by the company): ${levels}. "Answer only" means facts with no next steps.
Company: ${companyName}. Today: ${ctx.today}. Asking: ${ctx.user.name}${ctx.user.dashboardAdmin ? ' (dashboard admin)' : ''}${ctx.payroll ? ', with payroll access' : ', without payroll access'}.`;
}

/** Parses the router's reply: the JSON object in it, tools checked against what this person may use. */
export function parsePlan(ctx: SuwiContext, text: string): RouterPlan | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw: { calls?: unknown; mode?: unknown };
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  const mode: RouteMode = raw.mode === 'draft' || raw.mode === 'analysis' || raw.mode === 'act' ? raw.mode : 'lookup';
  const calls: RoutedCall[] = [];
  for (const c of Array.isArray(raw.calls) ? raw.calls : []) {
    const name = typeof (c as { tool?: unknown }).tool === 'string' ? (c as { tool: string }).tool : '';
    const t = toolByName(name);
    if (!t || t.acts || !toolAllowed(ctx, t)) continue;
    const args = (c as { args?: unknown }).args;
    calls.push({ tool: name, args: args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {} });
    if (calls.length >= MAX_CALLS) break;
  }
  return { calls, mode };
}

/** A list the panel already shows as a table: the writer gets its first rows only, and a count. */
function shorter(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) {
    const head = v.slice(0, 10).map((x) => shorter(x, depth + 1));
    return v.length > 10 ? [...head, `…and ${v.length - 10} more (HR sees them all in the table)`] : head;
  }
  if (v && typeof v === 'object' && depth < 6) {
    // Drop empty fields: they cost tokens and say nothing.
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== null && x !== undefined && x !== '' && !(Array.isArray(x) && !x.length)).map(([k, x]) => [k, shorter(x, depth + 1)]));
  }
  return v;
}

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return Promise.race([p, new Promise<typeof TIMED_OUT>((r) => setTimeout(() => r(TIMED_OUT), ms).unref?.())]);
}
const TIMED_OUT = Symbol('timed out');

interface Gathered { blocks: string[]; checked: string[]; links: SuwiLink[]; tables: SuwiTable[]; live: boolean; tools: ToolRun[] }

/** Runs the chosen tools side by side, as the asker; a repeat of the same call in this question is answered from the memo. */
async function runCalls(ctx: SuwiContext, calls: RoutedCall[], into: Gathered, memo: Map<string, string>, onProgress?: (checking: string) => void): Promise<void> {
  await Promise.all(calls.map(async (c) => {
    const t = toolByName(c.tool)!;
    const label = t.label(c.args);
    const key = `${t.name}|${stableJson(c.args)}`;
    if (memo.has(key)) { into.tools.push({ name: t.name, label, ms: 0, ok: true, memo: true }); return; }
    onProgress?.(label);
    const started = Date.now();
    try {
      const out = await withTimeout(t.run(ctx, c.args), toolTimeoutMs());
      if (out === TIMED_OUT) {
        into.tools.push({ name: t.name, label, ms: Date.now() - started, ok: false, timedOut: true });
        const block = `### ${label} (${t.name})\nCouldn't load this in time; say so if it matters.`;
        memo.set(key, block); into.blocks.push(block);
        return;
      }
      into.tools.push({ name: t.name, label, ms: Date.now() - started, ok: true });
      if (!into.checked.includes(label)) into.checked.push(label);
      for (const l of out.links ?? []) if (!into.links.some((x) => x.label === l.label)) into.links.push(l);
      for (const tb of out.tables ?? []) if (!into.tables.some((x) => x.title === tb.title)) into.tables.push(tb);
      if (out.live) into.live = true;
      const json = JSON.stringify(out.tables?.length ? shorter(out.data) : shorter(out.data, 3)) ?? 'null';
      const block = `### ${label} (${t.name})\n${json.length > MAX_RESULT_CHARS ? `${json.slice(0, MAX_RESULT_CHARS)}… (cut)` : json}`;
      memo.set(key, block); into.blocks.push(block);
    } catch (e) {
      into.tools.push({ name: t.name, label, ms: Date.now() - started, ok: false });
      into.blocks.push(`### ${label} (${t.name})\nError: ${(e as Error).message}`);
    }
  }));
}

/** Which model writes: the small one for lookups, the main one for drafts and open-ended analysis. */
export function writerFor(mode: RouteMode, question: string): { model: string; thinking: string | undefined; maxTokens: number } {
  const big = mode === 'draft' || mode === 'analysis' || DRAFT.test(question) || ANALYSIS.test(question);
  return big
    ? { model: SUWI_MODEL, thinking: undefined, maxTokens: 1500 }
    : { model: SUWI_SMALL_MODEL, thinking: 'minimal', maxTokens: 500 };
}

/**
 * Answers a question in at most two model steps (router, writer), plus one top-up only when the
 * writer says data is missing. Null when the question should go to the full loop instead (a change,
 * or the router's reply couldn't be read).
 */
export async function routeAndWrite(ctx: SuwiContext, input: {
  question: string; page: string; companyName: string; history: LlmMessage[];
  started: number; onProgress?: (checking: string) => void; onPartial?: (soFar: string) => void;
}): Promise<OrchestratedAnswer | null> {
  const tools = routerTools(ctx);
  const rounds: Round[] = [];
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let cost = 0;
  const count = (step: Round['step'], model: string, ms: number, usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }) => {
    rounds.push({ step, model, ms, input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0 });
    tokens.input += usage.input_tokens ?? 0; tokens.output += usage.output_tokens ?? 0;
    tokens.cacheRead += usage.cache_read_input_tokens ?? 0; tokens.cacheWrite += usage.cache_creation_input_tokens ?? 0;
    cost += costUsd(model, usage as never);
  };
  const recent = input.history.slice(-4).map((h) => `${h.role === 'user' ? 'Q' : 'A'}: ${typeof h.content === 'string' ? h.content.slice(0, 600) : ''}`).join('\n');

  const route = async (extra = ''): Promise<RouterPlan | null> => {
    const started = Date.now();
    const asked = `${recent ? `Earlier in this chat:\n${recent}\n\n` : ''}Question: ${input.question}\nPage: ${input.page || 'overview'}${extra ? `\nAlso needed: ${extra}` : ''}`;
    const reply = await callModel({ model: SUWI_SMALL_MODEL, thinking: 'minimal', maxTokens: 400, system: routerSystem(ctx, tools), messages: [{ role: 'user', content: asked }] });
    count('router', reply.model || SUWI_SMALL_MODEL, Date.now() - started, reply.usage);
    const text = reply.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('');
    return parsePlan(ctx, text);
  };

  const plan = await route().catch(() => null);
  if (!plan || plan.mode === 'act') return null;

  const gathered: Gathered = { blocks: [], checked: [], links: [], tables: [], live: false, tools: [] };
  const memo = new Map<string, string>();
  await runCalls(ctx, plan.calls, gathered, memo, input.onProgress);

  const w = writerFor(plan.mode, input.question);
  let firstTextMs: number | undefined;
  const write = async (final: boolean): Promise<string> => {
    const started = Date.now();
    const data = gathered.blocks.length ? gathered.blocks.join('\n\n') : '(no data was needed)';
    const messages: LlmMessage[] = [
      ...input.history.slice(-4),
      { role: 'user', content: `${input.question}\n\nPage: ${input.page || 'overview'}\n\nData:\n${data}${final ? '\n\nAnswer with what you have; don\'t write NEED.' : ''}` },
    ];
    // NEED lines are for us, not the person: hold back what's streamed until it can't be one.
    let streaming = false;
    const onText = (soFar: string) => {
      const t = soFar.trimStart();
      if (!streaming && (t.length < 5 || /^NEED\b/i.test(t))) return;
      streaming = true;
      if (firstTextMs === undefined && t) firstTextMs = Date.now() - input.started;
      input.onPartial?.(soFar);
    };
    const reply = await callModel({ model: w.model, maxTokens: gathered.tables.length ? Math.min(w.maxTokens, 400) : w.maxTokens, system: writerSystem(ctx, input.companyName, plan.mode), messages, onText, ...(w.thinking ? { thinking: w.thinking } : {}) });
    count('writer', reply.model || w.model, Date.now() - started, reply.usage);
    return reply.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n').trim();
  };

  let text = await write(false);
  const need = /^NEED:\s*(.+)$/im.exec(text);
  if (need && text.trimStart().toUpperCase().startsWith('NEED')) {
    // One top-up: the router picks what's missing (new calls only), then the writer answers with what it has.
    const more = await route(need[1].trim()).catch(() => null);
    const fresh = (more?.calls ?? []).filter((c) => !memo.has(`${c.tool}|${stableJson(c.args)}`));
    if (fresh.length) await runCalls(ctx, fresh, gathered, memo, input.onProgress);
    text = await write(true);
    if (/^NEED:/i.test(text.trimStart())) text = "I couldn't find everything needed to answer that. Try naming the person, team or dates.";
  }
  if (!text) text = "I couldn't find an answer to that.";
  return {
    text, checked: gathered.checked, links: gathered.links.slice(0, 6), tables: gathered.tables, live: gathered.live,
    tools: gathered.tools, rounds, costUsd: cost, tokens, ...(firstTextMs !== undefined ? { firstTextMs } : {}), mode: plan.mode, writer: w.model,
  };
}
