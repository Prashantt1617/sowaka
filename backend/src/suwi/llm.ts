/**
 * Suwi's line to the language model, over plain fetch (no SDK). Two providers
 * behind one shape: Google Gemini (SUWI_PROVIDER=gemini, GEMINI_API_KEY) and
 * Anthropic Claude (SUWI_PROVIDER=claude, ANTHROPIC_API_KEY). The rest of Suwi
 * speaks one message format (Anthropic-style blocks); the Gemini adapter maps
 * to and from it. Keys live on the server only and never reach the dashboard.
 */
export type Provider = 'gemini' | 'claude' | 'openai';
const P = process.env.SUWI_PROVIDER;
export const SUWI_PROVIDER: Provider = P === 'claude' || P === 'gemini' || P === 'openai' ? P : process.env.GEMINI_API_KEY ? 'gemini' : process.env.OPENAI_API_KEY ? 'openai' : 'claude';
export const SUWI_MODEL = process.env.SUWI_MODEL || (SUWI_PROVIDER === 'gemini' ? 'gemini-3.8-flash' : SUWI_PROVIDER === 'openai' ? 'gpt-6-luna' : 'claude-sonnet-5-5');

/** US$ per million tokens: input, output, cached input. Matched by model-name prefix. */
const PRICES: [string, [number, number, number]][] = [
  ['gemini-4-argon', [2, 10, 0.1]], // introductory until 30 Nov 2026, then 4 / 20 / 0.2
  ['gemini-3.8-flash', [0.75, 3.75, 0.075]], // until 31 Dec 2026, then 1.5 / 7.5 / 0.15
  ['gemini-3.5-flash-lite', [0.3, 2.5, 0.03]],
  ['gpt-6-luna', [0.1, 0.5, 0.01]],
  ['gpt-5.6-luna', [0.2, 1.2, 0.02]],
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
/** `images`: files to show the model with a user message (a bill to read): base64, with its MIME type (image/* or application/pdf). */
export interface LlmMessage { role: 'user' | 'assistant'; content: string | ContentBlock[]; raw?: unknown; images?: { mimeType: string; data: string }[] }
export interface LlmTool { name: string; description: string; input_schema: Record<string, unknown> }
export interface LlmUsage { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
export interface LlmReply { content: ContentBlock[]; stop_reason: 'tool_use' | 'end_turn' | string; usage: LlmUsage; model: string; raw?: unknown }

export function llmConfigured(): boolean {
  return Boolean(SUWI_PROVIDER === 'gemini' ? process.env.GEMINI_API_KEY : SUWI_PROVIDER === 'openai' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY);
}

/** What a reply cost, in US$ (for the per-company budget and the audit log). */
export function costUsd(model: string, u: LlmUsage): number {
  const [i, o, c] = PRICES.find(([p]) => model.startsWith(p))?.[1] ?? PRICES.find(([p]) => SUWI_MODEL.startsWith(p))?.[1] ?? [2, 10, 0.1];
  const cached = u.cache_read_input_tokens ?? 0;
  return ((Math.max(0, (u.input_tokens ?? 0)) * i) + cached * c + (u.cache_creation_input_tokens ?? 0) * i * 1.25 + (u.output_tokens ?? 0) * o) / 1e6;
}

export async function callModel(input: { model?: string; system: string; tools?: LlmTool[]; messages: LlmMessage[]; maxTokens?: number }): Promise<LlmReply> {
  return SUWI_PROVIDER === 'gemini' ? callGemini(input) : SUWI_PROVIDER === 'openai' ? callOpenAI(input) : callClaude(input);
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
  if (lastError.startsWith('429')) throw new SuwiLlmError(429, "The AI service has run out of quota for now (its plan or billing needs a look). Try again in a few minutes.");
  throw new SuwiLlmError(502, `Suwi couldn't reach the AI service (${lastError.slice(0, 120) || 'no response'})`);
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
    messages: input.messages.map(({ role, content, images }) => ({
      role,
      content: images?.length
        ? [...images.map((im) => (im.mimeType === 'application/pdf' ? { type: 'document', source: { type: 'base64', media_type: im.mimeType, data: im.data } } : { type: 'image', source: { type: 'base64', media_type: im.mimeType, data: im.data } })), ...(typeof content === 'string' ? [{ type: 'text', text: content }] : content)]
        : content,
    })),
  }) as LlmReply;
  return reply;
}

// —— Google Gemini ——
type GPart = { text?: string; thought?: boolean; inlineData?: { mimeType: string; data: string }; functionCall?: { name: string; args?: Record<string, unknown>; id?: string }; functionResponse?: { name: string; response: unknown; id?: string }; thoughtSignature?: string };

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
    const parts: GPart[] = [...(m.images ?? []).map((im): GPart => ({ inlineData: { mimeType: im.mimeType, data: im.data } })), ...(typeof m.content === 'string' ? [{ text: m.content }] : m.content.flatMap((b): GPart[] => {
      if (b.type === 'text') return [{ text: b.text }];
      if (b.type === 'tool_result') {
        let response: unknown;
        try { response = JSON.parse(b.content); } catch { response = { text: b.content }; }
        if (response === null || typeof response !== 'object' || Array.isArray(response)) response = { result: response };
        return [{ functionResponse: { name: nameOfCall.get(b.tool_use_id) ?? b.tool_use_id.split('#')[0], response: b.is_error ? { error: b.content } : response } }];
      }
      return [];
    }))];
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

// —— OpenAI (Chat Completions) ——
type OPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
type OMsg = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | OPart[] | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]; tool_call_id?: string };

async function callOpenAI(input: { model?: string; system: string; tools?: LlmTool[]; messages: LlmMessage[]; maxTokens?: number }): Promise<LlmReply> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new SuwiLlmError(503, 'Suwi is not set up on this server yet (no OPENAI_API_KEY)');
  const model = input.model ?? SUWI_MODEL;
  // The system prompt first and unchanged between questions: OpenAI caches a repeated prefix automatically.
  const messages: OMsg[] = [{ role: 'system', content: input.system }];
  for (const m of input.messages) {
    const images: OPart[] = (m.images ?? []).map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mimeType};base64,${im.data}` } }));
    if (typeof m.content === 'string') {
      messages.push({ role: m.role, content: images.length ? [...images, { type: 'text', text: m.content }] : m.content });
      continue;
    }
    if (m.role === 'assistant') {
      const text = m.content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n');
      const calls = m.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
      messages.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } })) } : {}) });
    } else {
      for (const b of m.content) {
        if (b.type === 'text') messages.push({ role: 'user', content: images.length ? [...images, { type: 'text', text: b.text }] : b.text });
        else if (b.type === 'tool_result') messages.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.content });
      }
    }
  }
  const tools = input.tools ?? [];
  const res = await post('https://api.openai.com/v1/chat/completions', { authorization: `Bearer ${key}` }, {
    model, messages, max_completion_tokens: (input.maxTokens ?? 1500) + 1500,
    ...(tools.length ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })) } : {}),
  }) as { choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }; model?: string };
  const msg = res.choices?.[0]?.message;
  const content: ContentBlock[] = [];
  if (msg?.content) content.push({ type: 'text', text: msg.content });
  for (const c of msg?.tool_calls ?? []) {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(c.function.arguments || '{}'); } catch { args = {}; }
    content.push({ type: 'tool_use', id: c.id, name: c.function.name, input: args });
  }
  const u = res.usage ?? {};
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    content,
    stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
    usage: { input_tokens: (u.prompt_tokens ?? 0) - cached, output_tokens: u.completion_tokens ?? 0, cache_read_input_tokens: cached },
    model: res.model ?? model,
  };
}
