/**
 * One question to Suwi: build the instructions and the tools this person may
 * use, let Claude ask for data (tool calls run here, as the asker), and return
 * the answer with what was checked, buttons to open the records, and any
 * prepared action. Every question is written to the audit log.
 */
import { companies } from '../config/db';
import { asLlmTool, contextFor, SUWI_AREAS, SuwiContext, SuwiLink, toolByName, toolAllowed, toolsFor } from './tools';
import { callModel, ContentBlock, costUsd, LlmMessage, SuwiLlmError, SUWI_MODEL } from './llm';
import { auditCol, LEVEL_LABEL, settingsFor, spentThisMonthUsd } from './store';
import { cancelProposal, getProposal } from './proposals';
import { User } from '../models/user.model';
import './registry';

const MAX_ROUNDS = 8;
const MAX_RESULT_CHARS = 14_000;

export interface SuwiAnswer {
  text: string;
  checked: string[];
  links: SuwiLink[];
  proposals: Awaited<ReturnType<typeof getProposal>>[];
  costUsd: number;
}

function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

function instructions(ctx: SuwiContext, companyName: string, page: string, budget: { spentUsd: number; monthlyUsd: number }): string {
  const levels = SUWI_AREAS.map((a) => `- ${a.label} (${a.covers}): ${LEVEL_LABEL[ctx.levels[a.key]]}`).join('\n');
  // The fixed part first and identical for everyone, so the provider's prompt cache hits; what changes per question goes last.
  return `You are Suwi, the HR assistant inside Sowaka's HR dashboard. You help HR and managers understand and act on their people data.

How you work:
- You can only see Sowaka's data through your tools, and only what this person is allowed to see. Never guess or invent names, numbers, dates, policies or tax rules. If a tool returns nothing, say so plainly. If something is outside this person's access, say "you don't have access to that" without hinting at what it contains.
- Numbers come from the tools; don't do your own arithmetic on pay or tax beyond simple counts.
- In drafts (reviews, letters, posts, policies) use only facts a tool gave you. Where a fact is missing, leave a [blank] in square brackets for HR to fill; never make up work, events, results or scores.
- In a policy draft, leave "From when" empty unless HR gave a date.
- Name the period or date range every answer covers.
- Never judge a person's ability, character or potential, and don't make decisions about people. Wellbeing or sentiment only for groups of 10 or more.
- Never hide or remove reported content; moderation is a human decision.
- Answer in short, plain sentences. Lead with the answer in one or two sentences. If listing people or items, use a short markdown table (at most 8 rows, then say how many more). End with the next step, if there is one.
- Formatting: only **bold**, bullet or numbered lists, pipe tables, ### headings and links. No LaTeX or math notation, no --- lines, no *italics*. Write sums in words ("₹30,000 basic plus ₹12,000 HRA").
- Link people as [Name](emp:USER_ID) only when a tool gave that person's userId; otherwise write the name as plain text. Never make up an id. Don't print raw ids.
- Indian formats: ₹ with lakh grouping, DD Mon YYYY dates.

What you may do in each area (set by the company in Settings → Suwi):
${levels}
- "Answer only": give facts, no next steps.
- "Suggest": you may also point to the next step and where to do it.
- "Act after you confirm": when asked to change something, use the matching prepare_ tool. It does NOT change anything; it shows HR a "What will happen" card with Confirm. Never say a change is done: say it's ready for them to confirm. If no prepare_ tool fits, explain where they can do it in the dashboard.
- Call a prepare_ tool once per change, with your best reading of the request. Never prepare alternatives; if the request could mean something else, prepare your best reading and mention the other reading in your answer.

If asked what you can do, describe your areas briefly with two or three example questions.

This question:
- Company: ${companyName}
- Today: ${ctx.today} (India time)
- Asking: ${ctx.user.name}${ctx.user.dashboardAdmin ? ', a dashboard admin' : ''}${ctx.payroll ? ', with payroll access' : ', without payroll access'}
- Page: ${page || 'overview'}${ctx.user.dashboardAdmin ? `
- Suwi budget this month: $${budget.spentUsd.toFixed(2)} of $${budget.monthlyUsd} used (only dashboard admins are told this)` : ''}`;
}

export async function askSuwi(user: Omit<User, 'profilePhotoUrl'>, input: { question?: unknown; page?: unknown; history?: unknown }): Promise<SuwiAnswer> {
  const question = typeof input.question === 'string' ? input.question.trim().slice(0, 2000) : '';
  if (!question) throw new SuwiLlmError(400, 'Ask Suwi a question');
  const page = typeof input.page === 'string' ? input.page.slice(0, 40) : '';
  const settings = await settingsFor(user.org!);
  if (!settings.enabled) throw new SuwiLlmError(403, 'Suwi is turned off for this company. An admin can turn it on in Settings → Suwi.');
  const spent = await spentThisMonthUsd(user.org!);
  if (spent >= settings.monthlyBudgetUsd) throw new SuwiLlmError(429, `Suwi has used this month's budget ($${settings.monthlyBudgetUsd}). An admin can raise it in Settings → Suwi.`);

  const ctx = contextFor(user, settings.levels, istToday());
  const company = await companies().findOne({ id: ctx.org });
  // A stable order keeps the tool list identical between questions, so it caches.
  const tools = toolsFor(ctx).sort((a, b) => a.name.localeCompare(b.name));
  // Earlier turns of this chat, text only (the panel keeps them).
  const history: LlmMessage[] = Array.isArray(input.history)
    ? (input.history as { role?: unknown; text?: unknown }[]).slice(-8)
        .filter((h) => (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string' && h.text.trim())
        .map((h) => ({ role: h.role as 'user' | 'assistant', content: String(h.text).slice(0, 4000) }))
    : [];
  while (history.length && history[0].role !== 'user') history.shift();
  const messages: LlmMessage[] = [...history, { role: 'user', content: question }];

  const checked: string[] = [];
  const links: SuwiLink[] = [];
  const proposalIds: string[] = [];
  const toolLog: { name: string; label: string; ms: number; ok: boolean }[] = [];
  let total = 0;
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let text = '';

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const reply = await callModel({ system: instructions(ctx, company?.name ?? ctx.org, page, { spentUsd: spent, monthlyUsd: settings.monthlyBudgetUsd }), tools: tools.map(asLlmTool), messages });
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
      try {
        const out = await t.run(ctx, c.input ?? {});
        toolLog.push({ name: t.name, label, ms: Date.now() - started, ok: true });
        if (!checked.includes(label)) checked.push(label);
        for (const l of out.links ?? []) if (!links.some((x) => x.label === l.label)) links.push(l);
        if (out.proposalId) proposalIds.push(out.proposalId);
        const json = JSON.stringify(out.data ?? null);
        return { type: 'tool_result', tool_use_id: c.id, content: json.length > MAX_RESULT_CHARS ? `${json.slice(0, MAX_RESULT_CHARS)}… (cut; ask a narrower question for the rest)` : json };
      } catch (e) {
        toolLog.push({ name: t.name, label, ms: Date.now() - started, ok: false });
        return { type: 'tool_result', tool_use_id: c.id, content: `Error: ${(e as Error).message}`, is_error: true };
      }
    }));
    messages.push({ role: 'user', content: results });
    if (round === MAX_ROUNDS - 1) text = text || 'That needed more steps than I can take at once. Try a narrower question.';
  }

  // One card per change: if the model prepared the same change more than once, only the last one stays; the others are cancelled.
  const prepared = await Promise.all(proposalIds.map((id) => getProposal(ctx.userId, ctx.org, id)));
  const lastOf = new Map(prepared.map((p) => [`${p.kind}|${p.title}`, p.id]));
  const proposals = prepared.filter((p) => lastOf.get(`${p.kind}|${p.title}`) === p.id);
  await Promise.all(prepared.filter((p) => !proposals.includes(p)).map((p) => cancelProposal(ctx.userId, ctx.org, p.id)));
  await auditCol().insertOne({
    org: ctx.org, userId: ctx.userId, kind: 'question', at: new Date(), page, question, answer: text.slice(0, 4000),
    tools: toolLog, model: SUWI_MODEL, costUsd: total, tokens,
  });
  return { text: text || "I couldn't find an answer to that.", checked, links: links.slice(0, 6), proposals, costUsd: total };
}
