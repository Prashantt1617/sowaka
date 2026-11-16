/**
 * A people search in plain words, read by Suwi into filters on profile fields:
 * "everyone in Gurgaon who joined after March and reports to Ravi". The
 * dashboard reads simple queries itself (peopleQuery.ts); it asks here only
 * for what it could not place. Suwi gets this company's own values to choose
 * from (teams, designations, locations, managers), so it can only answer with
 * filters that exist; it never sees anyone's pay or contact details.
 *
 * Follows Suwi's company switch and monthly budget, and is written to its
 * audit log like any other question.
 */
import { users } from '../config/db';
import { auditCol, settingsFor, spentThisMonthUsd } from './store';
import { callModel, costUsd, llmConfigured, SuwiLlmError, SUWI_MODEL } from './llm';

export type PeopleSearchFilter = {
  departments: string[]; designations: string[]; locations: string[]; managerIds: string[];
  types: string[]; genders: string[]; ids: string[]; joinedFrom?: string; joinedTo?: string; on?: 'yes' | 'no';
};

const ACTIVE = { lifecycleStatus: { $nin: ['offboarded', 'terminated'] } };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function searchPeople(user: { userId: string; org?: string }, input: { q?: unknown }) {
  const org = user.org;
  if (!org) throw new SuwiLlmError(403, 'No organisation on this account');
  const q = typeof input.q === 'string' ? input.q.trim().slice(0, 300) : '';
  if (!q) throw new SuwiLlmError(400, 'Type who you are looking for');
  if (!llmConfigured()) throw new SuwiLlmError(503, 'Suwi is not set up on this server');
  const settings = await settingsFor(org);
  if (!settings.enabled) throw new SuwiLlmError(403, 'Suwi is turned off for this company');
  if ((await spentThisMonthUsd(org)) >= settings.monthlyBudgetUsd) throw new SuwiLlmError(429, "Suwi has used this month's budget");

  const roster = await users().find({ org, ...ACTIVE } as never, { projection: { _id: 0, userId: 1, name: 1, department: 1, designation: 1, location: 1, branch: 1, managerUserId: 1 } }).toArray();
  const distinct = (xs: (string | undefined)[]) => [...new Set(xs.map((x) => (x ?? '').trim()).filter(Boolean))].sort();
  const managerIds = new Set(roster.map((u) => u.managerUserId).filter(Boolean));
  const people = roster.map((u) => ({ id: u.userId, name: u.name, manager: managerIds.has(u.userId) }));
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const vocab = {
    departments: distinct(roster.map((u) => u.department)),
    designations: distinct(roster.map((u) => u.designation)),
    locations: distinct(roster.flatMap((u) => [u.location, u.branch])),
    types: ['Full-time', 'Contract', 'Intern'],
    genders: ['Female', 'Male'],
    people,
  };
  const system = [
    'You turn an HR person\'s search for employees into filters. Reply with one JSON object and nothing else.',
    'Keys (all optional): departments, designations, locations, types, genders: arrays of values copied exactly from the lists given;',
    'managerIds: ids of the managers they report to; ids: ids of people named outright; joinedFrom, joinedTo: YYYY-MM-DD, both counted;',
    'on: "yes" when they want people already on the template, "no" when not on it.',
    'Use only values from the lists. A general word ("artists", "developers") means every designation that contains it. Leave out anything the search does not ask for. Today is ' + today + '.',
  ].join(' ');
  const reply = await callModel({ system, messages: [{ role: 'user', content: `Lists: ${JSON.stringify(vocab)}\n\nSearch: ${q}` }], maxTokens: 400 });
  const text = reply.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
  const cost = costUsd(reply.model, reply.usage);
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as Record<string, unknown>; } catch { raw = {}; }

  // Only what exists here survives.
  const keep = (key: string, allowed: string[]) => {
    const v = raw[key];
    if (!Array.isArray(v)) return [];
    return v.map((x) => String(x)).map((x) => allowed.find((a) => a.toLowerCase() === x.toLowerCase())).filter((x): x is string => !!x);
  };
  const ids = new Set(roster.map((u) => u.userId));
  // "Artists" means every artist: a word of the search that a chosen designation contains brings in every designation with it.
  const words = q.toLowerCase().split(/[^a-z0-9]+/).map((w) => w.replace(/s$/, '')).filter((w) => w.length >= 4);
  const broaden = (picked: string[]) => {
    const out = new Set(picked);
    for (const w of words) if (picked.some((d) => d.toLowerCase().includes(w))) for (const d of vocab.designations) if (d.toLowerCase().includes(w)) out.add(d);
    return [...out];
  };
  const filter: PeopleSearchFilter = {
    departments: keep('departments', vocab.departments),
    designations: broaden(keep('designations', vocab.designations)),
    locations: keep('locations', vocab.locations),
    types: keep('types', vocab.types),
    genders: keep('genders', vocab.genders),
    managerIds: (Array.isArray(raw.managerIds) ? raw.managerIds.map(String) : []).filter((id) => managerIds.has(id)),
    ids: (Array.isArray(raw.ids) ? raw.ids.map(String) : []).filter((id) => ids.has(id)),
    ...(typeof raw.joinedFrom === 'string' && DAY.test(raw.joinedFrom) ? { joinedFrom: raw.joinedFrom } : {}),
    ...(typeof raw.joinedTo === 'string' && DAY.test(raw.joinedTo) ? { joinedTo: raw.joinedTo } : {}),
    ...(raw.on === 'yes' || raw.on === 'no' ? { on: raw.on } : {}),
  };
  await auditCol().insertOne({
    org, userId: user.userId, kind: 'question', at: new Date(), page: 'people-search', question: q,
    answer: JSON.stringify(filter).slice(0, 5000), status: 'answered', tools: [], model: SUWI_MODEL, costUsd: cost,
    tokens: { input: reply.usage.input_tokens, output: reply.usage.output_tokens },
  } as never).catch(() => undefined);
  return { filter };
}
