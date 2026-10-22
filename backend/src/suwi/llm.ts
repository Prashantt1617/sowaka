/**
 * Suwi's line to the language model, over plain fetch (no SDK). Two providers
 * behind one shape: Google Gemini (SUWI_PROVIDER=gemini, GEMINI_API_KEY) and
 * Anthropic Claude (SUWI_PROVIDER=claude, ANTHROPIC_API_KEY). The rest of Suwi
 * speaks one message format (Anthropic-style blocks); the Gemini adapter maps
 * to and from it. Keys live on the server only and never reach the dashboard.
 */
export type Provider = 'gemini' | 'claude';
export const SUWI_PROVIDER: Provider = (process.env.SUWI_PROVIDER === 'claude' ? 'claude' : process.env.SUWI_PROVIDER === 'gemini' ? 'gemini' : process.env.GEMINI_API_KEY ? 'gemini' : 'claude');
export const SUWI_MODEL = process.env.SUWI_MODEL || (SUWI_PROVIDER === 'gemini' ? 'gemini-3.8-flash' : 'claude-sonnet-5-5');

/** US$ per million tokens: input, output, cached input. Matched by model-name prefix. */
const PRICES: [string, [number, number, number]][] = [
  ['gemini-4-argon', [2, 10, 0.1]], // introductory until 30 Nov 2026, then 4 / 20 / 0.2
  ['gemini-3.8-flash', [0.75, 3.75, 0.075]], // until 31 Dec 2026, then 1.5 / 7.5 / 0.15
  ['gemini-3.5-flash-lite', [0.3, 2.5, 0.03]],
  ['claude-sonnet-5-5', [2, 10, 0.1]],
  ['claude-opus-5-5', [4, 20, 0.2]],
  ['claude-haiku-4-5', [1, 5, 0.1]],
];

export class SuwiLlmError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'SuwiLlmError';
  }
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

/** `raw` carries the provider's own form of an assistant turn (Gemini's thought signatures must go back unchanged). */
export interface LlmMessage { role: 'user' | 'assistant'; content: string | ContentBlock[]; raw?: unknown }
export interface LlmTool { name: string; description: string; input_schema: Record<string, unknown> }
export interface LlmUsage { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
export interface LlmReply { content: ContentBlock[]; stop_reason: 'tool_use' | 'end_turn' | string; usage: LlmUsage; model: string; raw?: unknown }

export function llmConfigured(): boolean {
  return Boolean(SUWI_PROVIDER === 'gemini' ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY);
}

/** What a reply cost, in US$ (for the per-company budget and the audit log). */
export function costUsd(model: string, u: LlmUsage): number {
  const [i, o, c] = PRICES.find(([p]) => model.startsWith(p))?.[1] ?? PRICES.find(([p]) => SUWI_MODEL.startsWith(p))?.[1] ?? [2, 10, 0.1];
  const cached = u.cache_read_input_tokens ?? 0;
  return ((Math.max(0, (u.input_tokens ?? 0)) * i) + cached * c + (u.cache_creation_input_tokens ?? 0) * i * 1.25 + (u.output_tokens ?? 0) * o) / 1e6;
}

export async function callModel(input: { model?: string; system: string; tools?: LlmTool[]; messages: LlmMessage[]; maxTokens?: number }): Promise<LlmReply> {
  return SUWI_PROVIDER === 'gemini' ? callGemini(input) : callClaude(input);
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) })
      .catch((e: Error) => { lastError = e.message; return null; });
    if (!res) continue;
    if (res.ok) return res.json();
    const text = await res.text();
    lastError = `${res.status}: ${text.slice(0, 300)}`;
    // Overloaded or rate limited: wait and try again. Anything else is final.
    if (res.status !== 429 && res.status !== 529 && res.status !== 503 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1) + Math.random() * 400));
  }
  throw new SuwiLlmError(502, `Suwi couldn't reach the AI service (${lastError || 'no response'})`);
}

// —— Anthropic Claude ——
async function callClaude(input: { model?: string; system: string; tools?: LlmTool[]; messages: LlmMessage[]; maxTokens?: number }): Promise<LlmReply> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new SuwiLlmError(503, 'Suwi is not set up on this server yet (no ANTHROPIC_API_KEY)');
  const model = input.model ?? SUWI_MODEL;
  // The fixed part (instructions, then tools) is cached: questions in the next few minutes read it at a tenth of the price.
  const tools = (input.tools ?? []).map((t, i, all) => (i === all.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t));
  const reply = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, {
    model, max_tokens: input.maxTokens ?? 1500,
    system: [{ type: 'text', text: input.system, cache_control: { type: 'ephemeral' } }],
    ...(tools.length ? { tools } : {}),
    messages: input.messages.map(({ role, content }) => ({ role, content })),
  }) as LlmReply;
  return reply;
}

// —— Google Gemini ——
type GPart = { text?: string; thought?: boolean; functionCall?: { name: string; args?: Record<string, unknown>; id?: string }; functionResponse?: { name: string; response: unknown; id?: string }; thoughtSignature?: string };

/** JSON Schema as Gemini's function declarations accept it (a subset of OpenAPI). */
function geminiSchema(s: unknown): unknown {
  if (!s || typeof s !== 'object') return s;
  if (Array.isArray(s)) return s.map(geminiSchema);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (k === 'additionalProperties' || k === '$schema') continue;
    out[k] = k === 'properties' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, geminiSchema(pv)])) : geminiSchema(v);
  }
  return out;
}

async function callGemini(input: { model?: string; system: string; tools?: LlmTool[]; messages: LlmMessage[]; maxTokens?: number }): Promise<LlmReply> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new SuwiLlmError(503, 'Suwi is not set up on this server yet (no GEMINI_API_KEY)');
  const model = input.model ?? SUWI_MODEL;
  // Tool results name the function they answer; Gemini has no call ids of its own on older models.
  const nameOfCall = new Map<string, string>();
  const contents = input.messages.map((m) => {
    if (m.role === 'assistant') {
      if (Array.isArray(m.raw)) return { role: 'model', parts: m.raw as GPart[] };
      const parts: GPart[] = typeof m.content === 'string' ? [{ text: m.content }] : m.content.flatMap((b): GPart[] => {
        if (b.type === 'text') return [{ text: b.text }];
        if (b.type === 'tool_use') { nameOfCall.set(b.id, b.name); return [{ functionCall: { name: b.name, args: b.input } }]; }
        return [];
      });
      return { role: 'model', parts };
    }
    const parts: GPart[] = typeof m.content === 'string' ? [{ text: m.content }] : m.content.flatMap((b): GPart[] => {
      if (b.type === 'text') return [{ text: b.text }];
      if (b.type === 'tool_result') {
        let response: unknown;
        try { response = JSON.parse(b.content); } catch { response = { text: b.content }; }
        if (response === null || typeof response !== 'object' || Array.isArray(response)) response = { result: response };
        return [{ functionResponse: { name: nameOfCall.get(b.tool_use_id) ?? b.tool_use_id.split('#')[0], response: b.is_error ? { error: b.content } : response } }];
      }
      return [];
    });
    return { role: 'user', parts };
  });
  const tools = input.tools ?? [];
  const body = {
    systemInstruction: { parts: [{ text: input.system }] },
    contents,
    ...(tools.length ? { tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: geminiSchema(t.input_schema) })) }] } : {}),
    // Thinking tokens count as output on Gemini, so leave room beyond the answer itself.
    generationConfig: { maxOutputTokens: (input.maxTokens ?? 1500) + 2500 },
  };
  const res = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key }, body) as {
    candidates?: { content?: { parts?: GPart[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number; thoughtsTokenCount?: number };
    modelVersion?: string;
    promptFeedback?: { blockReason?: string };
  };
  if (res.promptFeedback?.blockReason) throw new SuwiLlmError(400, `The AI service declined this question (${res.promptFeedback.blockReason})`);
  const parts = res.candidates?.[0]?.content?.parts ?? [];
  const content: ContentBlock[] = [];
  parts.forEach((p, i) => {
    if (p.functionCall) {
      const id = `${p.functionCall.name}#${i}#${Math.random().toString(36).slice(2, 8)}`;
      content.push({ type: 'tool_use', id, name: p.functionCall.name, input: p.functionCall.args ?? {} });
    } else if (p.text && !p.thought) content.push({ type: 'text', text: p.text });
  });
  const u = res.usageMetadata ?? {};
  const cached = u.cachedContentTokenCount ?? 0;
  return {
    content,
    stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
    // Gemini bills thinking tokens as output.
    usage: { input_tokens: (u.promptTokenCount ?? 0) - cached, output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), cache_read_input_tokens: cached },
    model: res.modelVersion ?? model,
    raw: parts,
  };
}
