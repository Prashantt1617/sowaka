/**
 * Reading what a manager types while writing a review with Suwi (reviewChat.ts), and the quick model's part in it
 * (25 Nov 2026, HR: "it talks like human; if I provide feedback directly, parameters and score and feedback, it
 * picks it and tells me the discrepancies for me to fill on chat itself; it should handle all cases").
 *
 * The model only does two things, at most once per message: it SPLITS free-form text into KPI, score and comment
 * (modelParse), or it REWORDS Suwi's short reply so it reads like a person (phrase). Every rule stays in code:
 * reviewChat.ts checks each score (whole, 1 to 5), each comment's length, which KPIs exist, who may be reviewed and
 * which cycle. A comment the model hands back must be the manager's own words, found in what they typed, or the
 * split is not used; a reworded reply must keep every number, bold word and name of the original, or the original
 * is used. Without a model (or when it fails, is slow, or answers badly) the deterministic reading and texts here
 * do the whole job.
 */
import { SUWI_SMALL_MODEL } from './digest';
import { callModel, costUsd, llmConfigured } from './llm';

/** Tests swap this for a stub so the check costs nothing; SUWI_REVIEW_CHAT_MODEL=0 keeps the model out altogether. */
export const reviewChatModel: { call: typeof callModel; configured: () => boolean; timeoutMs: number } = {
  call: callModel,
  configured: () => process.env.SUWI_REVIEW_CHAT_MODEL !== '0' && llmConfigured(),
  timeoutMs: 4000,
};

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** For comparing a model's copy of a comment with what was typed: case, spacing and quote marks aside. */
const loose = (s: string) => s.toLowerCase().replace(/[“”"‘’'`]/g, '').replace(/\s+/g, ' ').trim();

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const NUM = '([0-9]+(?:\\.[0-9]+)?|one|two|three|four|five)';
const OUT_OF = '(?:\\s*(?:\\/|out of|of)\\s*(5|10)\\b)?';

export interface ScoreRead { score?: number; bad?: string; rest: string }

function judge(raw: string, outOf?: string): { score?: number; bad?: string } {
  const n = WORDS[raw.toLowerCase()] ?? Number(raw);
  if (outOf === '10') return { bad: 'Scores here are out of 5, not 10: a whole number from 1 to 5.' };
  if (!Number.isInteger(n)) return { bad: `${raw} isn't a whole number; scores are 1, 2, 3, 4 or 5.` };
  if (n < 1 || n > 5) return { bad: `${raw} is outside the scale; scores go from 1 to 5.` };
  return { score: n };
}

/** A score at the start of a message ("4", "4/5", "four", "I'd give her a 4 - great quarter ...") and what follows it. */
export function scoreOf(text: string): ScoreRead {
  const t = text.trim();
  const m = new RegExp(`^(?:(?:(?:i(?:'d| would)?|let'?s)\\s+)?(?:give|rate|say|go with|put|score|rating|rated|scored|make it)(?:\\s+(?:him|her|them|it|this))?\\s*(?:is|of|at|as|:|-|=)?\\s*(?:a|an)?\\s*|(?:maybe|around|about|probably|a|an)\\s+)?${NUM}\\b${OUT_OF}[\\s,.:;!)\\-–—]*`, 'i').exec(t);
  if (!m) return { rest: t };
  const j = judge(m[1], m[2]);
  return { ...j, rest: j.score !== undefined ? t.slice(m[0].length).trim() : t };
}

/** A score said somewhere in a sentence ("she was solid, I'd say a 4"): the score and the sentence without it. */
export function scoreInside(text: string): ScoreRead {
  const re = new RegExp(`\\b(?:give|gave|rate|rated|score|scored|say|with|maybe|around|about|solid|strong|a|an|it'?s|is)\\s+(?:(?:him|her|them|it)\\s+)?(?:a\\s+)?${NUM}\\b${OUT_OF}|\\b([0-9](?:\\.[0-9]+)?)\\s*(?:\\/|out of)\\s*(5|10)\\b`, 'i');
  const m = re.exec(text);
  if (!m) return { rest: text.trim() };
  const j = judge(m[1] ?? m[3], m[2] ?? m[4]);
  const rest = `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`.replace(/\s+([,.;!?])/g, '$1').replace(/^[\s,.;:–—-]+|[\s,;:–—-]+$/g, '').replace(/\s{2,}/g, ' ').trim();
  return { ...j, rest };
}

/** Small typos ("Upskiling", "Hirng") still find their KPI. */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

const NOT_A_NAME = new Set(['the', 'and', 'for', 'with', 'kpi', 'kpis', 'score', 'comment', 'note', 'feedback', 'review', 'his', 'her', 'their', 'was', 'has', 'very', 'good', 'great', 'this', 'that', 'month', 'cycle']);
export const wordFits = (w: string, n: string) => w === n
  || (w.length >= 4 && n.length >= 4 && (n.startsWith(w) || w.startsWith(n.slice(0, Math.max(4, n.length - 3)))))
  || (w.length >= 5 && n.length >= 5 && editDistance(w, n) <= (n.length >= 8 ? 2 : 1));

/** Which of the KPIs a phrase names ("hiring", "upskill", "Quality of work"): its index, or -1. */
export function matchKpi(phrase: string, names: string[]): number {
  const p = norm(phrase);
  if (!p) return -1;
  const ns = names.map(norm);
  const exact = ns.indexOf(p);
  if (exact >= 0) return exact;
  const holds = ns.map((n, i) => (` ${p} `.includes(` ${n} `) ? i : -1)).filter((i) => i >= 0);
  if (holds.length) return holds.sort((a, b) => ns[b].length - ns[a].length)[0];
  if (p.length >= 4) {
    const within = ns.map((n, i) => (n.includes(p) ? i : -1)).filter((i) => i >= 0);
    if (within.length === 1) return within[0];
  }
  const words = p.split(' ').filter((w) => w.length >= 3 && !NOT_A_NAME.has(w));
  const fit = ns.map((n) => words.filter((w) => n.split(' ').some((x) => !NOT_A_NAME.has(x) && wordFits(w, x))).length);
  const best = Math.max(0, ...fit);
  if (!best || fit.filter((f) => f === best).length > 1) return -1;
  return fit.indexOf(best);
}

const FILLER = new Set(['the', 'my', 'his', 'her', 'their', 'score', 'scores', 'comment', 'note', 'kpi', 'for', 'on', 'of', 'one', 'part', 'bit', 'section', 'and', 'in']);
/**
 * A phrase that is nothing but a KPI's name ("hiring", "the upskill one", "quality of work"): its index, or -1. For
 * commands ("make hiring 3", "go to quality"), where a looser match would turn a comment into a command.
 */
export function kpiNamedExactly(phrase: string, names: string[]): number {
  const said = norm(phrase).split(' ').filter((w) => w && !FILLER.has(w));
  if (!said.length) return -1;
  const ns = names.map((n) => norm(n).split(' '));
  const fits = ns.map((n, i) => (said.every((w) => n.some((x) => wordFits(w, x) || (w.length < 3 && w === x))) ? i : -1)).filter((i) => i >= 0);
  if (fits.length === 1) return fits[0];
  const exact = fits.filter((i) => ns[i].filter((x) => !FILLER.has(x)).length === said.length);
  return exact.length === 1 ? exact[0] : -1;
}

/** Where a KPI is named in running text: its index and where the mention starts and ends. */
function mentions(text: string, names: string[]): { kpi: number; at: number; end: number }[] {
  const found: { kpi: number; at: number; end: number }[] = [];
  const re = /[A-Za-z][A-Za-z0-9&/'-]*/g;
  const tokens: { w: string; at: number; end: number }[] = [];
  for (let m = re.exec(text); m; m = re.exec(text)) tokens.push({ w: norm(m[0]), at: m.index, end: m.index + m[0].length });
  const named = names.map((n) => norm(n).split(' ').filter((x) => x.length >= 3 && !NOT_A_NAME.has(x)));
  for (let i = 0; i < tokens.length; i++) {
    // The longest run of words from here that names one KPI ("quality of work", "upskilling").
    let hit: { kpi: number; to: number } | null = null;
    for (let len = Math.min(4, tokens.length - i); len >= 1 && !hit; len--) {
      const run = tokens.slice(i, i + len);
      if (len === 1 && (tokens[i].w.length < 3 || NOT_A_NAME.has(tokens[i].w))) continue;
      // Words next to each other only ("Quality of work", not "Hiring 4 - hired").
      if (run.some((t, j) => j > 0 && !/^[\s&/-]*$/.test(text.slice(run[j - 1].end, t.at)))) continue;
      const k = matchKpi(run.map((t) => t.w).join(' '), names);
      if (k < 0) continue;
      const own = (t: { w: string }) => norm(names[k]).split(' ').some((x) => wordFits(t.w, x) || (t.w.length < 3 && t.w === x));
      // The run starts and ends on the KPI's own words, and every word in it is one of them.
      if (!run.every(own)) continue;
      // One word alone names a KPI only when it is that KPI's own, longer word ("quality"), not a common one ("work").
      const fits = named[k].filter((x) => run.some((t) => wordFits(t.w, x)));
      if (fits.length && (len > 1 || named[k].length === 1 || fits.some((x) => x.length >= 5))) hit = { kpi: k, to: i + len - 1 };
    }
    if (hit) { found.push({ kpi: hit.kpi, at: tokens[i].at, end: tokens[hit.to].end }); i = hit.to; }
  }
  return found;
}

/** Any KPI named anywhere in the text (for deciding whether a message is more than one answer). */
export const kpisNamed = (text: string, names: string[]) => [...new Set(mentions(text, names).map((m) => m.kpi))];

export interface Piece {
  /** The KPI's index; 'current' for the KPI Suwi was asking about; null when the name matches none. */
  kpi: number | 'current' | null;
  named: string;
  score?: number;
  bad?: string;
  comment?: string;
}

const BULLET = /^\s*(?:[-*•▪◦]+|\(?\d{1,2}[.)]|[a-h][.)])\s+/i;
const LEADS_IN = /^[\s:(\-–—=]*/;
/** Words that open a line of comment, not a KPI ("Note: ...", "Overall - ..."). */
const NOT_A_HEAD = /^(?:note|notes|also|overall|ps|p s|summary|general|comments?|feedback|extra|example|e g|eg|but|and|so)$/i;
const LEADS_OUT = /^[\s)\]:,.;\-–—]*/;

/** One line: "Hiring 4 - hired three ...", "Upskilling: 3, ...", "Quality (4/5) ...", "Teamwork - 5 - ...". */
function readLine(line: string, names: string[]): Piece | { continues: string } {
  const t = line.replace(BULLET, '').trim();
  const m = mentions(t, names)[0];
  let kpi: Piece['kpi'];
  let named: string;
  let rest: string;
  if (m && m.at <= 3) {
    kpi = m.kpi; named = t.slice(m.at, m.end); rest = t.slice(m.end).replace(LEADS_IN, '');
    // "Quality of work" when the KPI is "Quality": the rest of a head before its delimiter belongs to the name.
    const head = /^([A-Za-z][A-Za-z &/'-]{0,30}?)\s*(?=[:(=]|\s[-–—]\s|\s\d)/.exec(rest);
    if (head && matchKpi(`${named} ${head[1]}`, names) === m.kpi) { named = `${named} ${head[1]}`.trim(); rest = rest.slice(head[0].length).replace(LEADS_IN, ''); }
  } else {
    // A head before a delimiter that names no KPI ("Teamwork: 5, ..."), or the score first ("4 for hiring").
    const head = /^([A-Za-z][A-Za-z0-9 &/'-]{1,40}?)\s*(?::|\s[-–—]\s|\(|=|\s(?=\d\b|\d\s*\/))/.exec(t);
    if (!head || NOT_A_HEAD.test(head[1].trim())) return { continues: t };
    kpi = matchKpi(head[1], names);
    if (kpi < 0) kpi = null;
    named = head[1].trim(); rest = t.slice(head[0].length).replace(LEADS_IN, '');
    // "He closed 3 deals" is a sentence, not a KPI called "He closed": an unknown name needs a short head and a
    // score standing on its own ("Teamwork 5: ...", "Teamwork: 5").
    if (kpi === null && (named.split(/\s+/).length > 3 || (/^\d/.test(rest) && !/^\d+(?:\.\d+)?(?:\s*\/\s*\d+)?\s*(?:[:,.)\-–—]|$)/.test(rest)))) return { continues: t };
  }
  const s = scoreOf(rest);
  const comment = (s.score !== undefined ? s.rest : s.bad ? rest.replace(/^\S+\s*/, '') : rest).replace(LEADS_OUT, '').replace(/[\s,;:–—-]+$/, '').trim();
  return { kpi, named, ...(s.score !== undefined ? { score: s.score } : {}), ...(s.bad ? { bad: s.bad } : {}), ...(comment ? { comment } : {}) };
}

/**
 * A message with several KPIs in it, without the model: lines (or "; " parts, or a KPI named after a full stop
 * with its score next to it) each give a KPI, maybe a score and maybe a comment. Words before the first KPI
 * answer the one being asked; a line that names no KPI carries on the comment above it.
 */
export function parseMany(text: string, names: string[]): Piece[] {
  const lines = text.split(/\r?\n|;\s+|\s+\|\s+/).flatMap((line) => {
    // One long line: cut where a KPI is named after a full stop or comma with a score or a colon right after it.
    const cuts = mentions(line, names).filter((m) => m.at > 3 && /[.,!]\s*$/.test(line.slice(0, m.at)) && /^\s*(?:\(?\s*[0-9]|[:=]|[-–—]\s*[0-9]|(?:one|two|three|four|five)\b)/i.test(line.slice(m.end)));
    const parts: string[] = [];
    let from = 0;
    for (const c of cuts) { parts.push(line.slice(from, c.at)); from = c.at; }
    parts.push(line.slice(from));
    return parts;
  }).map((l) => l.trim()).filter(Boolean);
  const out: Piece[] = [];
  for (const [i, line] of lines.entries()) {
    const r = readLine(line, names);
    if ('continues' in r) {
      const prev = out.at(-1);
      if (prev) prev.comment = prev.comment ? `${prev.comment} ${r.continues}` : r.continues;
      else if (i === 0) {
        const s = scoreOf(r.continues);
        out.push({ kpi: 'current', named: '', ...(s.score !== undefined ? { score: s.score } : {}), ...(s.bad ? { bad: s.bad } : {}), ...((s.score !== undefined ? s.rest : r.continues) ? { comment: (s.score !== undefined ? s.rest : r.continues).replace(LEADS_OUT, '') } : {}) });
      }
      continue;
    }
    out.push(r);
  }
  return out.filter((p) => p.kpi !== 'current' || p.score !== undefined || p.bad || p.comment);
}

/** Two or more KPIs, or one other than the one being asked (or with a score while a comment was asked for). */
export function looksLikeMany(text: string, names: string[], current: number, step: 'score' | 'comment'): boolean {
  const pieces = parseMany(text, names);
  const known = pieces.filter((p) => typeof p.kpi === 'number');
  if (new Set(known.map((p) => p.kpi)).size >= 2) return true;
  if (known.some((p) => p.kpi !== current && (p.score !== undefined || p.bad || (p.comment ?? '').length > 0))) return true;
  if (step === 'comment' && known.some((p) => p.kpi === current && (p.score !== undefined || p.bad))) return true;
  return known.length > 0 && pieces.some((p) => p.kpi === null);
}

const QUESTION = /^(?:what|who|whom|whose|when|where|why|how|which|show|list|tell me|can you|could you|would you|will you|is|are|was|were|do|does|did|has|have|should i|any)\b/i;
/** A question rather than an answer (it goes to the rest of Suwi while the review waits). */
export const questionLike = (text: string) => /\?\s*$/.test(text.trim()) || QUESTION.test(text.trim());

// ---------------------------------------------------------------------------------------------------------------
// The model: splitting free-form text, and rewording a reply.

export interface ModelUse { costUsd: number; model?: string }

async function ask(system: string, content: string, maxTokens: number): Promise<{ text: string; use: ModelUse } | null> {
  if (!reviewChatModel.configured()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply = await Promise.race([
      reviewChatModel.call({ model: SUWI_SMALL_MODEL, system, maxTokens, thinking: 'minimal', messages: [{ role: 'user', content }] }),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), reviewChatModel.timeoutMs); }),
    ]);
    if (!reply) return null;
    const text = reply.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('');
    return { text, use: { costUsd: costUsd(reply.model || SUWI_SMALL_MODEL, reply.usage), model: reply.model || SUWI_SMALL_MODEL } };
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const jsonIn = (text: string) => JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Record<string, unknown>;

const PARSE_SYSTEM = `You read one chat message a manager sent while writing a performance review, and split it into parts per KPI.
You get the KPIs (id and name), the KPI and step being asked about now, and the message.
Rules:
- A part names a KPI from the list (match loosely: "upskill" is "Upskilling"); use its id. If the manager names something that is not on the list, kpi is "?" and named is the name they used. Words that answer the question being asked now, without naming a KPI, have kpi "current".
- score: only a number the manager actually gave for that KPI (digits or words), exactly as given, even if it is wrong (6, 4.5, 8/10 as 8 with outOf 10). Never infer a score from praise. null when none.
- comment: the manager's own words about that KPI, COPIED EXACTLY character for character from the message (no fixing, shortening, adding, or rewording). Leave out the KPI name and the score themselves. null when none.
- aside: true only when the whole message is not about this review at all (a different question or request).
Return only JSON: {"aside":false,"parts":[{"kpi":"<id>|current|?","named":"<name used>","score":<number|null>,"outOf":<5|10|null>,"comment":"<exact words>|null"}]}`;

/**
 * The model's split of a free-form message. Null when no answer came (no model, an error, too slow); no pieces when
 * the answer is unusable, for example a comment that is not the manager's own words. Either way the deterministic
 * reading is used instead, and the reply is not reworded as well (one call a message).
 */
export async function modelParse(message: string, kpis: { id: string; name: string }[], asking: { id: string; name: string; step: 'score' | 'comment' }): Promise<{ aside: boolean; pieces: Piece[]; use: ModelUse } | null> {
  const r = await ask(PARSE_SYSTEM, JSON.stringify({ kpis, askingNow: asking, message }), 900);
  if (!r) return null;
  const unusable = { aside: false, pieces: [] as Piece[], use: r.use };
  try {
    const j = jsonIn(r.text) as { aside?: unknown; parts?: { kpi?: unknown; named?: unknown; score?: unknown; outOf?: unknown; comment?: unknown }[] };
    if (j.aside === true) return { aside: true, pieces: [], use: r.use };
    const typed = loose(message);
    const pieces: Piece[] = [];
    for (const p of Array.isArray(j.parts) ? j.parts : []) {
      const id = String(p.kpi ?? '');
      const at = kpis.findIndex((k) => k.id === id);
      const kpi: Piece['kpi'] = id === 'current' ? 'current' : at >= 0 ? at : null;
      const named = typeof p.named === 'string' ? p.named.trim().slice(0, 60) : '';
      if (kpi === null && !named) continue;
      const comment = typeof p.comment === 'string' ? p.comment.trim() : '';
      // The words are the manager's or the split is not used: a model that tidies or adds to a comment is wrong.
      if (comment && !typed.includes(loose(comment))) return unusable;
      const piece: Piece = { kpi, named };
      if (p.score !== null && p.score !== undefined && String(p.score).trim() !== '') {
        const raw = String(p.score).trim();
        if (!typed.includes(raw.toLowerCase())) return unusable;
        const v = judge(raw, p.outOf === 10 || p.outOf === '10' ? '10' : undefined);
        if (v.score !== undefined) piece.score = v.score; else piece.bad = v.bad;
      }
      if (comment) piece.comment = comment;
      pieces.push(piece);
    }
    return { aside: false, pieces, use: r.use };
  } catch {
    return unusable;
  }
}

const PHRASE_SYSTEM = `You are Suwi, the HR assistant in a company dashboard, helping a manager write a performance review in a chat.
Rewrite DRAFT as your next chat message so it sounds like a friendly, natural colleague: brief, warm, plain English, not robotic. You may open by briefly acknowledging what the manager just said ("Got it", "Thanks", "Okay").
Rules:
- Keep every fact, number, name, KPI name and instruction in DRAFT, and keep every **bold** word exactly as written, bold.
- Add nothing new: no facts, numbers, advice, examples, or opinions. Never praise, judge or describe the employee or their work, and never suggest what the comment should say.
- No emojis, no headings, no lists. At most 3 short sentences.
Return only JSON: {"reply":"<message>"}`;

const numbersIn = (s: string) => (s.match(/\d+(?:\.\d+)?/g) ?? []).sort().join(',');
const boldIn = (s: string) => (s.match(/\*\*[^*]+\*\*/g) ?? []).map((b) => b.toLowerCase());

/**
 * A short reply reworded by the quick model, or the reply as it was. The rewording is used only when it keeps every
 * number, every bold word and every must-keep word (names, KPIs) of the original, and stays short.
 */
export async function phrase(draft: string, said: string, keep: string[]): Promise<{ text: string; use: ModelUse | null }> {
  if (!draft.trim() || draft.length > 360 || !reviewChatModel.configured()) return { text: draft, use: null };
  const r = await ask(PHRASE_SYSTEM, JSON.stringify({ managerJustSaid: said.slice(0, 300), DRAFT: draft }), 220);
  if (!r) return { text: draft, use: null };
  try {
    const reply = String(jsonIn(r.text).reply ?? '').trim();
    const lower = reply.toLowerCase();
    const ok = reply.length >= 10 && reply.length <= Math.max(320, draft.length * 1.6)
      && !/[|#`]|^\s*[-*]\s/m.test(reply)
      && numbersIn(reply) === numbersIn(draft)
      && boldIn(draft).every((b) => lower.includes(b))
      && keep.every((k) => lower.includes(k.toLowerCase()));
    return { text: ok ? reply : draft, use: r.use };
  } catch {
    return { text: draft, use: r.use };
  }
}
