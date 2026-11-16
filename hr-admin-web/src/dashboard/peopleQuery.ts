// "People on the 3D team under Ravi": a search in plain words, read into
// filters on what an employee's profile has (team, designation, location,
// manager, employment type, gender, joining date, names). The words are matched
// against this company's own values, so "3d team" finds the department "3D".
// What it can't place is left over; the page may ask Suwi to read it
// (smartPeopleSearch) and lays Suwi's filters over these.
import type { Emp } from './seed';

export type PeopleFilter = {
  departments: string[];
  designations: string[];
  locations: string[];
  managerIds: string[];
  types: string[];
  genders: string[];
  /** YYYY-MM-DD, both counted. */
  joinedFrom?: string;
  joinedTo?: string;
  /** People named in it (ids). */
  ids: string[];
  /** On this template, or not. */
  on?: 'yes' | 'no';
  /** Words matched against name, employee ID and email. */
  text: string;
};

export const EMPTY_FILTER: PeopleFilter = { departments: [], designations: [], locations: [], managerIds: [], types: [], genders: [], ids: [], text: '' };

/** One understood piece, as a removable chip. */
export type FilterChip = { key: string; label: string; without: (f: PeopleFilter) => PeopleFilter };

const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
const distinct = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const STOP = new Set(('people person employee employees everyone everybody all show me list find give get who whose that which are is was were be '
  + 'in on at of from the a an and or with for to into by team teams department dept depts office based working work works staff member members '
  + 'those these them they their under reporting report reports managed manager managers lead led s please also only just').split(' '));

const iso = (d: Date) => d.toISOString().slice(0, 10);
const startOfMonth = (y: number, m: number) => iso(new Date(Date.UTC(y, m, 1)));
const endOfMonth = (y: number, m: number) => iso(new Date(Date.UTC(y, m + 1, 0)));

/** Reads a query into filters, given the roster it searches. */
export function parsePeopleQuery(query: string, emps: Emp[], now = new Date()): { filter: PeopleFilter; chips: FilterChip[]; leftover: string } {
  let q = norm(query);
  const f: PeopleFilter = { ...EMPTY_FILTER, departments: [], designations: [], locations: [], managerIds: [], types: [], genders: [], ids: [] };
  const chips: FilterChip[] = [];
  const take = (pattern: RegExp) => { q = q.replace(pattern, ' '); };
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const phrase = (value: string) => new RegExp(`\\s${escape(norm(value).trim()).replace(/\s+/g, '\\s+')}(?:s)?\\s`);

  // —— Not on / already on this template.
  if (/\s(not|isn t|aren t|without)\s(yet\s)?(on|in)\s(this|the)?\s?(template|shift)?/.test(q) || /\snot\s(yet\s)?(added|assigned)\s/.test(q)) {
    f.on = 'no'; take(/\s(not|isn t|aren t|without)\s(yet\s)?(on|in|added|assigned)(\s(to\s)?(this|the|it))?(\s(template|shift))?/g);
    chips.push({ key: 'on', label: 'Not on this template', without: (x) => ({ ...x, on: undefined }) });
  } else if (/\s(already\s(on|in)|on\sthis\s(template|shift)|currently\son)\s/.test(q)) {
    f.on = 'yes'; take(/\s(already|currently)?\s?(on|in)\sthis\s(template|shift)|\salready\s(on|in)(\sit)?/g);
    chips.push({ key: 'on', label: 'On this template', without: (x) => ({ ...x, on: undefined }) });
  }

  // —— Their manager: "under Ravi", "reporting to Ravi Kumar", "Ravi's team", "managed by Ravi".
  const managers = new Map<string, Emp>();
  for (const e of emps) if (e.managerId) { const m = emps.find((x) => x.id === e.managerId); if (m) managers.set(m.id, m); }
  const byLength = [...managers.values()].flatMap((m) => [{ m, key: m.name }, { m, key: m.name.split(/\s+/)[0] }]).sort((a, b) => b.key.length - a.key.length);
  for (const { m, key } of byLength) {
    if (f.managerIds.includes(m.id)) continue;
    const k = escape(norm(key).trim()).replace(/\s+/g, '\\s+');
    const re = new RegExp(`\\s(?:under|reporting\\s+to|reports\\s+to|report\\s+to|managed\\s+by|led\\s+by|manager\\s+is|manager)\\s+${k}(?:\\s+s)?\\s|\\s${k}\\s+s\\s+(?:team|reports|people)\\s|\\s${k}\\s+(?:team|reports)\\s|\\s(?:that\\s+|who\\s+)?${k}\\s+(?:manages|leads|looks\\s+after)\\s`);
    if (re.test(q)) {
      f.managerIds.push(m.id); take(new RegExp(re.source, 'g'));
      chips.push({ key: `mgr:${m.id}`, label: `Reports to ${m.name}`, without: (x) => ({ ...x, managerIds: x.managerIds.filter((id) => id !== m.id) }) });
    }
  }

  // —— Values the company has: teams, designations, locations (longest first, so "Senior 3D Artist" wins over "3D").
  const facet = (values: string[], into: string[], label: (v: string) => string, key: string) => {
    for (const v of distinct(values).sort((a, b) => b.length - a.length)) {
      // A value that is only common words ("Employee", "Manager") would match every query that says them.
      if (norm(v).trim().split(' ').every((w) => STOP.has(w) || STOP.has(w.replace(/s$/, '')))) continue;
      const re = phrase(v);
      if (!re.test(q)) continue;
      into.push(v); take(new RegExp(re.source, 'g'));
      chips.push({ key: `${key}:${v}`, label: label(v), without: (x) => ({ ...x, [key]: (x[key as keyof PeopleFilter] as string[]).filter((y) => y !== v) }) });
    }
  };
  facet(emps.map((e) => e.role), f.designations, (v) => v, 'designations');
  facet(emps.map((e) => e.team), f.departments, (v) => `${v} team`, 'departments');
  facet(emps.flatMap((e) => [e.location, e.branch]), f.locations, (v) => `In ${v}`, 'locations');

  // —— Employment type and gender.
  const kinds: [RegExp, string][] = [[/\sinterns?\s|\sinternship\s/, 'Intern'], [/\scontract(ors?|ual)?\s|\sconsultants?\s/, 'Contract'], [/\sfull\s?time(rs?)?\s|\spermanent\s/, 'Full-time']];
  for (const [re, t] of kinds) if (re.test(q)) { f.types.push(t); take(new RegExp(re.source, 'g')); chips.push({ key: `type:${t}`, label: t, without: (x) => ({ ...x, types: x.types.filter((y) => y !== t) }) }); }
  const sexes: [RegExp, string][] = [[/\s(women|woman|female|females|girls|ladies)\s/, 'Female'], [/\s(men|man|male|males|boys|gents)\s/, 'Male']];
  for (const [re, g] of sexes) if (re.test(q)) { f.genders.push(g); take(new RegExp(re.source, 'g')); chips.push({ key: `g:${g}`, label: g === 'Female' ? 'Women' : 'Men', without: (x) => ({ ...x, genders: x.genders.filter((y) => y !== g) }) }); }

  // —— When they joined.
  const y = now.getUTCFullYear();
  const when = (from?: string, to?: string, label?: string) => {
    f.joinedFrom = from; f.joinedTo = to;
    chips.push({ key: 'joined', label: label ?? 'Joined', without: (x) => ({ ...x, joinedFrom: undefined, joinedTo: undefined }) });
  };
  const monthYear = (m: string, yr?: string) => ({ m: MONTHS.indexOf(m.slice(0, 3)), y: yr ? Number(yr) : y });
  let mt: RegExpMatchArray | null;
  if ((mt = q.match(/\s(?:new\s+joiners?|joined\s+recently|recent\s+joiners?|newly\s+joined)\s/))) {
    when(iso(new Date(now.getTime() - 90 * 86_400_000)), undefined, 'Joined in the last 3 months'); take(/\s(?:new\s+joiners?|joined\s+recently|recent\s+joiners?|newly\s+joined)\s/g);
  } else if ((mt = q.match(/\sjoined\s+(?:in\s+)?(?:the\s+)?(?:last|past)\s+(\d+)\s+(day|days|week|weeks|month|months|year|years)\s/))) {
    const n = Number(mt[1]); const unit = mt[2].replace(/s$/, ''); const days = unit === 'day' ? n : unit === 'week' ? n * 7 : unit === 'month' ? n * 30 : n * 365;
    when(iso(new Date(now.getTime() - days * 86_400_000)), undefined, `Joined in the last ${n} ${unit}${n === 1 ? '' : 's'}`); take(new RegExp(mt[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
  } else if ((mt = q.match(/\sjoined\s+this\s+(year|month)\s/))) {
    if (mt[1] === 'year') when(`${y}-01-01`, undefined, 'Joined this year'); else when(startOfMonth(y, now.getUTCMonth()), undefined, 'Joined this month');
    take(/\sjoined\s+this\s+(year|month)\s/g);
  } else if ((mt = q.match(/\sjoined\s+(before|after|since|in)\s+(?:([a-z]{3,9})\s+)?(\d{4})\s/)) || (mt = q.match(/\sjoined\s+(before|after|since|in)\s+([a-z]{3,9})()\s/))) {
    const [, rel, mon, yr] = mt;
    const isMonth = mon && MONTHS.includes(mon.slice(0, 3));
    if (isMonth || yr) {
      const { m, y: yy } = isMonth ? monthYear(mon, yr || undefined) : { m: -1, y: Number(yr) };
      const from = m >= 0 ? startOfMonth(yy, m) : `${yy}-01-01`;
      const to = m >= 0 ? endOfMonth(yy, m) : `${yy}-12-31`;
      const what = m >= 0 ? `${MONTHS[m][0].toUpperCase()}${MONTHS[m].slice(1)} ${yy}` : String(yy);
      if (rel === 'in') when(from, to, `Joined in ${what}`);
      else if (rel === 'before') when(undefined, iso(new Date(Date.parse(from) - 86_400_000)), `Joined before ${what}`);
      else when(rel === 'since' ? from : iso(new Date(Date.parse(to) + 86_400_000)), undefined, `Joined ${rel} ${what}`);
      take(new RegExp(mt[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
    }
  }

  // —— People named outright (a full name, or a first name only one person has).
  for (const e of [...emps].sort((a, b) => b.name.length - a.name.length)) {
    const re = phrase(e.name);
    if (re.test(q)) { f.ids.push(e.id); take(new RegExp(re.source, 'g')); chips.push({ key: `id:${e.id}`, label: e.name, without: (x) => ({ ...x, ids: x.ids.filter((id) => id !== e.id) }) }); }
  }

  const leftover = q.split(/\s+/).filter((w) => w && !STOP.has(w)).join(' ');
  // Left over words that match someone's name, ID or email are a plain search; anything else is for Suwi.
  const words = leftover.split(' ').filter(Boolean);
  const searchable = words.filter((w) => w.length > 1 && emps.some((e) => norm(`${e.name} ${e.employeeId} ${e.email}`).includes(` ${w}`)));
  if (searchable.length) {
    f.text = searchable.join(' ');
    chips.push({ key: 'text', label: `“${f.text}”`, without: (x) => ({ ...x, text: '' }) });
  }
  return { filter: f, chips, leftover: words.filter((w) => !searchable.includes(w)).join(' ') };
}

/** Whether a filter asks for anything at all. */
export const isEmptyFilter = (f: PeopleFilter) =>
  !f.departments.length && !f.designations.length && !f.locations.length && !f.managerIds.length && !f.types.length && !f.genders.length && !f.ids.length && !f.joinedFrom && !f.joinedTo && !f.on && !f.text;

/** The people a filter selects. Within a kind any value matches; across kinds all must. */
export function applyPeopleFilter(f: PeopleFilter, emps: Emp[], onTemplate: (e: Emp) => boolean): Emp[] {
  const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const words = f.text.toLowerCase().split(/\s+/).filter(Boolean);
  return emps.filter((e) => {
    if (f.ids.length && !f.ids.includes(e.id)) return false;
    if (f.departments.length && !f.departments.some((d) => eq(d, e.team))) return false;
    if (f.designations.length && !f.designations.some((d) => eq(d, e.role))) return false;
    if (f.locations.length && !f.locations.some((l) => eq(l, e.location) || eq(l, e.branch))) return false;
    if (f.managerIds.length && !f.managerIds.includes(e.managerId)) return false;
    if (f.types.length && !f.types.some((t) => eq(t, e.empType))) return false;
    if (f.genders.length && !f.genders.some((g) => eq(g, e.gender))) return false;
    if (f.joinedFrom && (!e.joiningDate || e.joiningDate < f.joinedFrom)) return false;
    if (f.joinedTo && (!e.joiningDate || e.joiningDate > f.joinedTo)) return false;
    if (f.on === 'yes' && !onTemplate(e)) return false;
    if (f.on === 'no' && onTemplate(e)) return false;
    if (words.length) {
      const hay = `${e.name} ${e.employeeId} ${e.email}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

/** Lays filters Suwi read over the ones understood here (Suwi's win where it found something). */
export function mergeFilters(a: PeopleFilter, b: Partial<PeopleFilter>): PeopleFilter {
  const pick = <K extends keyof PeopleFilter>(k: K) => ((b[k] as unknown[] | undefined)?.length ? b[k] : a[k]) as PeopleFilter[K];
  return {
    departments: pick('departments'), designations: pick('designations'), locations: pick('locations'), managerIds: pick('managerIds'),
    types: pick('types'), genders: pick('genders'), ids: pick('ids'),
    joinedFrom: b.joinedFrom ?? a.joinedFrom, joinedTo: b.joinedTo ?? a.joinedTo, on: b.on ?? a.on, text: a.text,
  };
}

/** Chips for filters that came from Suwi. */
export function chipsOf(f: PeopleFilter, emps: Emp[]): FilterChip[] {
  const nameOf = (id: string) => emps.find((e) => e.id === id)?.name ?? 'someone';
  const out: FilterChip[] = [];
  for (const v of f.designations) out.push({ key: `designations:${v}`, label: v, without: (x) => ({ ...x, designations: x.designations.filter((y) => y !== v) }) });
  for (const v of f.departments) out.push({ key: `departments:${v}`, label: `${v} team`, without: (x) => ({ ...x, departments: x.departments.filter((y) => y !== v) }) });
  for (const v of f.locations) out.push({ key: `locations:${v}`, label: `In ${v}`, without: (x) => ({ ...x, locations: x.locations.filter((y) => y !== v) }) });
  for (const id of f.managerIds) out.push({ key: `mgr:${id}`, label: `Reports to ${nameOf(id)}`, without: (x) => ({ ...x, managerIds: x.managerIds.filter((y) => y !== id) }) });
  for (const v of f.types) out.push({ key: `type:${v}`, label: v, without: (x) => ({ ...x, types: x.types.filter((y) => y !== v) }) });
  for (const v of f.genders) out.push({ key: `g:${v}`, label: v === 'Female' ? 'Women' : 'Men', without: (x) => ({ ...x, genders: x.genders.filter((y) => y !== v) }) });
  if (f.joinedFrom || f.joinedTo) out.push({ key: 'joined', label: f.joinedFrom && f.joinedTo ? `Joined ${f.joinedFrom} to ${f.joinedTo}` : f.joinedFrom ? `Joined from ${f.joinedFrom}` : `Joined by ${f.joinedTo}`, without: (x) => ({ ...x, joinedFrom: undefined, joinedTo: undefined }) });
  for (const id of f.ids) out.push({ key: `id:${id}`, label: nameOf(id), without: (x) => ({ ...x, ids: x.ids.filter((y) => y !== id) }) });
  if (f.on) out.push({ key: 'on', label: f.on === 'yes' ? 'On this template' : 'Not on this template', without: (x) => ({ ...x, on: undefined }) });
  if (f.text) out.push({ key: 'text', label: `“${f.text}”`, without: (x) => ({ ...x, text: '' }) });
  return out;
}
