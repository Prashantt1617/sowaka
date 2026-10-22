// Designation and department clean-up: every title in the company, grouped
// where they are the same thing spelt differently (case, spacing, Jr/Sr/Mgr
// abbreviations, typos), a suggested clean name per group, level words that
// don't fit the reporting line, and what references each title. No model call
// is needed for the grouping. The prepared action renames people through the
// same service the profile's Edit details uses, one person at a time, and
// keeps the Settings list in step; Undo puts every name back.
import { kpiTemplates, payslips, users } from '../../config/db';
import { updateEmployeeDetailsForAdmin } from '../../services/admin.service';
import { getCompanySettings, updateCompanySettings } from '../../services/company-settings.service';
import { defineExecutor, propose } from '../proposals';
import { defineTools, str, SuwiContext } from '../tools';
import { Person, roster } from './people';

type Kind = 'designation' | 'department';
const KINDS: Kind[] = ['designation', 'department'];
const kindOf = (v: unknown): Kind => (str(v) === 'department' ? 'department' : 'designation');
const plural = (k: Kind) => (k === 'designation' ? 'designations' : 'departments');

// —— Normalisation ——

/** Short forms people type, as whole words, to the word they mean. */
const ABBR: Record<string, string> = {
  jr: 'junior', jnr: 'junior', sr: 'senior', snr: 'senior', mgr: 'manager', mngr: 'manager', exec: 'executive', execs: 'executive',
  am: 'assistant manager', asst: 'assistant', assoc: 'associate', assocs: 'associate', engg: 'engineering', dev: 'developer', devs: 'developer',
  swe: 'software engineer', sde: 'software development engineer', hr: 'human resources', ops: 'operations', mktg: 'marketing', mkt: 'marketing',
  acct: 'account', accts: 'accounts', rep: 'representative', sdr: 'sales development representative', bd: 'business development', bde: 'business development executive',
  vp: 'vice president', svp: 'senior vice president', dir: 'director', coord: 'coordinator', spec: 'specialist', tl: 'team lead', lead: 'lead',
  qa: 'quality assurance', ux: 'user experience', ui: 'user interface', mgmt: 'management', admin: 'administration', fin: 'finance', cs: 'customer success',
  and: '', of: '', the: '', '&': '',
};
/** Words kept in capitals when a name is tidied. */
const CAPS = new Set(['qa', 'hr', 'ux', 'ui', 'it', 'vp', 'svp', 'ceo', 'cto', 'coo', 'cfo', 'cmo', 'cpo', 'sdr', 'bdr', 'api', 'seo', 'sem', 'ai', 'ml', 'l1', 'l2', 'l3', 'ii', 'iii', 'iv']);
const SMALL = new Set(['of', 'and', 'the', 'for', 'to', 'in']);
/** Display forms of the short level words, so "Sr. Engg Mgr" reads "Senior Engineering Manager". */
const DISPLAY: Record<string, string> = { jr: 'Junior', jnr: 'Junior', sr: 'Senior', snr: 'Senior', mgr: 'Manager', mngr: 'Manager', exec: 'Executive', asst: 'Assistant', assoc: 'Associate', engg: 'Engineering', mktg: 'Marketing', dir: 'Director', coord: 'Coordinator', spec: 'Specialist', mgmt: 'Management', rep: 'Representative' };

const words = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
/** The comparable form: lower case, abbreviations expanded, filler words dropped, plurals trimmed. */
export function keyOf(name: string): string {
  return words(name).flatMap((w) => (w in ABBR ? ABBR[w].split(' ') : [w])).filter(Boolean)
    .map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ');
}
/** A tidy display form of a name: Title Case, abbreviations spelt out, acronyms in capitals. */
export function tidy(name: string): string {
  const raw = name.replace(/\s+/g, ' ').replace(/\s*([&/-])\s*/g, ' $1 ').trim();
  return raw.split(' ').map((tok, i) => {
    const w = tok.toLowerCase().replace(/\.$/, '');
    if (tok === '&' || tok === '/' || tok === '-') return tok;
    if (DISPLAY[w]) return DISPLAY[w];
    if (CAPS.has(w)) return w.toUpperCase();
    if (i > 0 && SMALL.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ').replace(/ & /g, ' & ');
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]; prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}
/** Two keys are "the same thing with a typo" when they differ by a character or two, relative to their length. */
const closeEnough = (a: string, b: string) => {
  const d = editDistance(a, b);
  const len = Math.max(a.length, b.length);
  return d > 0 && d <= (len >= 12 ? 2 : len >= 6 ? 1 : 0);
};

// —— Levels ——

/** Seniority implied by a title's words, for checking reporting lines. Higher reports to higher. */
const LEVELS: [RegExp, number, string][] = [
  [/\b(chief|ceo|cto|coo|cfo|cmo|cpo|founder|co founder|president|vice president|managing director)\b/, 7, 'Chief / Founder'],
  [/\b(head|director)\b/, 6, 'Head / Director'],
  [/\bassistant manager\b/, 4, 'Assistant Manager'],
  [/\bmanager\b/, 5, 'Manager'],
  [/\b(lead|principal|staff|architect)\b/, 4, 'Lead / Principal'],
  [/\bsenior\b/, 3, 'Senior'],
  [/\b(junior|associate|assistant|trainee|fresher)\b/, 1, 'Junior / Associate'],
  [/\b(intern|internship|apprentice)\b/, 0, 'Intern'],
];
export function levelOf(name: string): { rank: number; label: string } {
  const k = keyOf(name);
  for (const [re, rank, label] of LEVELS) if (re.test(k)) return { rank, label };
  return { rank: 2, label: 'No level word' };
}

// —— Grouping ——

export interface Group { names: { name: string; people: number }[]; people: number; suggested: string; reason: string }

/** Group names that are the same thing: equal keys first, then keys a typo apart (union-find). */
export function groupNames(counts: Map<string, number>): Group[] {
  const names = [...counts.keys()];
  const keys = new Map(names.map((n) => [n, keyOf(n)]));
  const parent = new Map(names.map((n) => [n, n]));
  const find = (n: string): string => (parent.get(n) === n ? n : (parent.set(n, find(parent.get(n)!)), parent.get(n)!));
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  const reasons = new Map<string, Set<string>>();
  const why = (a: string, b: string, r: string) => { for (const n of [a, b]) reasons.set(n, (reasons.get(n) ?? new Set()).add(r)); };
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = names[i], b = names[j], ka = keys.get(a)!, kb = keys.get(b)!;
    if (ka === kb) {
      const wa = words(a).join(' '), wb = words(b).join(' ');
      union(a, b); why(a, b, wa === wb ? 'case or spacing' : words(a).some((w) => w in ABBR && ABBR[w]) || words(b).some((w) => w in ABBR && ABBR[w]) ? 'abbreviation' : 'wording');
    } else if (closeEnough(ka, kb)) { union(a, b); why(a, b, 'spelling'); }
  }
  const buckets = new Map<string, string[]>();
  for (const n of names) buckets.set(find(n), [...(buckets.get(find(n)) ?? []), n]);
  const out: Group[] = [];
  for (const members of buckets.values()) {
    if (members.length < 2) continue;
    const rows = members.map((name) => ({ name, people: counts.get(name) ?? 0 })).sort((a, b) => b.people - a.people || a.name.localeCompare(b.name));
    // The most-held spelling, tidied; a tie goes to the longer (least abbreviated) name.
    const top = rows.filter((r) => r.people === rows[0].people).sort((a, b) => b.name.length - a.name.length)[0];
    const reason = [...new Set(members.flatMap((m) => [...(reasons.get(m) ?? [])]))].join(', ');
    out.push({ names: rows, people: rows.reduce((t, r) => t + r.people, 0), suggested: tidy(top.name), reason });
  }
  return out.sort((a, b) => b.people - a.people);
}

async function references(ctx: SuwiContext, kind: Kind, names: string[]) {
  const field = kind === 'designation' ? 'designations' : 'departments';
  const tpls = await kpiTemplates().find({ org: ctx.org, [field]: { $in: names } } as never, { projection: { _id: 0, name: 1, [field]: 1 } }).toArray() as unknown as Record<string, unknown>[];
  const kpi = tpls.map((t) => ({ template: String(t.name), lists: (t[field] as string[]).filter((n) => names.includes(n)) }));
  const slips = kind === 'designation' ? await payslips().countDocuments({ org: ctx.org, designation: { $in: names } } as never) : await payslips().countDocuments({ org: ctx.org, department: { $in: names } } as never);
  return { kpiTemplates: kpi, payslips: slips };
}

async function heldBy(ctx: SuwiContext, kind: Kind) {
  const all = await roster(ctx);
  const counts = new Map<string, number>();
  for (const p of all) { const v = (p[kind] ?? '').trim(); if (v) counts.set(v, (counts.get(v) ?? 0) + 1); }
  return { all, counts };
}

defineTools(
  {
    name: 'review_titles',
    area: 'people',
    label: (i) => `${kindOf(i.kind) === 'department' ? 'Departments' : 'Designations'} clean-up review`,
    description: "Review every designation (or department) in the company and suggest a cleaner set: groups of names that are the same thing spelt differently (case, spacing, Jr/Sr/Mgr/Exec abbreviations, typos) with the people count and a suggested name; the level words in use (Junior/Senior/Lead/Manager) and anyone whose title outranks their manager's; and which KPI templates and payslips reference each name. Use the `mapping` it returns with prepare_rename_titles after HR picks the names.",
    input_schema: { type: 'object', properties: { kind: { type: 'string', enum: KINDS, description: 'Default designation' } } },
    api: { method: 'GET', path: '/admin/company/settings' },
    async run(ctx, i) {
      const kind = kindOf(i.kind);
      const { all, counts } = await heldBy(ctx, kind);
      const settings = await getCompanySettings(ctx.userId);
      const listed = kind === 'designation' ? settings.designationList : settings.departmentList;
      for (const n of listed) if (!counts.has(n)) counts.set(n, 0);
      const groups = groupNames(counts);
      const inGroup = new Set(groups.flatMap((g) => g.names.map((n) => n.name)));
      const refs = await references(ctx, kind, [...inGroup]);
      const data: Record<string, unknown> = {
        kind, distinctNames: counts.size, peopleWithOne: all.filter((p) => (p[kind] ?? '').trim()).length, peopleWithout: all.filter((p) => !(p[kind] ?? '').trim()).length,
        groups: groups.map((g) => ({
          ...g,
          references: {
            kpiTemplates: refs.kpiTemplates.filter((r) => r.lists.some((n) => g.names.some((x) => x.name === n))).map((r) => r.template),
            payslipsWithOldName: g.names.filter((n) => n.name !== g.suggested).length ? 'kept as issued (payslips are snapshots)' : 'none affected',
          },
        })),
        mapping: groups.flatMap((g) => g.names.filter((n) => n.name !== g.suggested).map((n) => ({ from: n.name, to: g.suggested }))),
        unlistedInSettings: [...counts.keys()].filter((n) => !listed.includes(n)).slice(0, 40),
        listedButNobodyHolds: listed.filter((n) => !(counts.get(n) ?? 0)).slice(0, 40),
      };
      if (kind === 'designation') {
        const byId = new Map(all.map((p) => [p.userId, p]));
        const levelsUsed: Record<string, string[]> = {};
        for (const n of counts.keys()) { const l = levelOf(n).label; levelsUsed[l] = [...(levelsUsed[l] ?? []), n]; }
        const issues = all.flatMap((p) => {
          const m = p.managerUserId ? byId.get(p.managerUserId) : undefined;
          if (!m || !p.designation || !m.designation) return [];
          const a = levelOf(p.designation), b = levelOf(m.designation);
          return a.rank > b.rank && b.rank !== 2 ? [{ userId: p.userId, name: p.name, designation: p.designation, level: a.label, reportsTo: m.name, managerUserId: m.userId, managerDesignation: m.designation, managerLevel: b.label }] : [];
        });
        data.levelsInUse = Object.fromEntries(Object.entries(levelsUsed).map(([l, ns]) => [l, ns.slice(0, 15)]));
        data.levelIssues = { count: issues.length, people: issues.slice(0, 20), note: 'A title that outranks the manager\'s (a Lead under a Junior). Titles without a level word are not flagged.' };
        data.payslipsNamingGroupedTitles = refs.payslips;
      } else {
        // Departments that may be the same team under two names (one inside the other, e.g. "Sales" and "Sales & Marketing").
        const keys = [...counts.keys()].map((n) => [n, keyOf(n)] as const);
        data.maybeRelated = keys.flatMap(([a, ka]) => keys.filter(([b, kb]) => a < b && ka !== kb && (ka.includes(kb) || kb.includes(ka))).map(([b]) => ({ a, b, peopleA: counts.get(a) ?? 0, peopleB: counts.get(b) ?? 0 }))).slice(0, 20);
      }
      return { data, links: [{ label: kind === 'designation' ? 'Open designations' : 'Open departments', view: plural(kind) }] };
    },
  },
  {
    name: 'prepare_rename_titles',
    area: 'people',
    acts: true,
    label: (i) => `Prepared: rename ${Array.isArray(i.mapping) ? i.mapping.length : 0} ${plural(kindOf(i.kind))}`,
    description: 'Prepare renaming designations (or departments) across the company from a mapping of old name → new name (as chosen by HR from review_titles). Changes nothing: it creates a "What will happen" card listing each rename and how many people it touches, for HR to confirm by typing the number of people affected. Undo puts every name back.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: KINDS },
        mapping: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } },
      },
      required: ['mapping'],
    },
    api: { method: 'PATCH', path: '/admin/employees/x' },
    async run(ctx, i) {
      const kind = kindOf(i.kind);
      const raw = Array.isArray(i.mapping) ? (i.mapping as { from?: unknown; to?: unknown }[]) : [];
      const mapping = raw.map((m) => ({ from: str(m.from, 120), to: str(m.to, 80) })).filter((m) => m.from && m.to && m.from !== m.to);
      if (!mapping.length) throw new Error('Give at least one rename (from → to)');
      if (new Set(mapping.map((m) => m.from)).size !== mapping.length) throw new Error('A name appears twice on the left of the mapping');
      // Everyone in the company holding an old name, inactive people included, so the records agree afterwards.
      const holders = await users().find({ org: ctx.org, [kind]: { $in: mapping.map((m) => m.from) } } as never, { projection: { _id: 0, userId: 1, name: 1, [kind]: 1, lifecycleStatus: 1 } }).toArray() as unknown as (Person & { lifecycleStatus?: string })[];
      const before = Object.fromEntries(holders.map((p) => [p.userId, p[kind] as string]));
      const active = holders.filter((p) => p.lifecycleStatus !== 'offboarded' && p.lifecycleStatus !== 'terminated');
      const per = mapping.map((m) => ({ ...m, people: holders.filter((p) => p[kind] === m.from).length }));
      const refs = await references(ctx, kind, mapping.map((m) => m.from));
      const settings = await getCompanySettings(ctx.userId);
      const listBefore = kind === 'designation' ? settings.designationList : settings.departmentList;
      // The Settings list is only rewritten when it names an old spelling; names people hold show there anyway.
      const listTouched = listBefore.some((n) => mapping.some((m) => m.from === n));
      const title = `Rename ${mapping.length === 1 ? `${kind} "${mapping[0].from}" to "${mapping[0].to}"` : `${mapping.length} ${plural(kind)}`}`;
      const proposalId = await propose(ctx, {
        kind: 'rename_titles', area: 'people', title,
        summary: `${holders.length} ${holders.length === 1 ? 'person gets' : 'people get'} a new ${kind} on their record${active.length !== holders.length ? ` (${holders.length - active.length} of them no longer on the active roll)` : ''}.${listTouched ? ` The ${plural(kind)} list in Settings is updated to match.` : ''}`,
        lines: [
          ...per.map((m) => ({ text: `${m.from} → ${m.to}: ${m.people} ${m.people === 1 ? 'person' : 'people'}.`, ...(m.people === 0 ? { tone: 'info' as const } : {}) })),
          { text: `Each change goes through the same Edit details save as the profile, one person at a time, by ${ctx.user.name}.`, why: 'There is no bulk rename in Sowaka; doing it per person keeps every record\'s own checks and audit trail.' },
          ...(listTouched ? [{ text: `Settings › ${kind === 'designation' ? 'Designations' : 'Departments'}: the old names are replaced by the new ones.`, why: 'The list there is what the profile\'s dropdown offers; left as it was, the old spelling would come straight back.' }] : []),
          ...(refs.kpiTemplates.length ? [{ text: `KPI template${refs.kpiTemplates.length === 1 ? '' : 's'} ${refs.kpiTemplates.map((r) => `"${r.template}"`).join(', ')} still list${refs.kpiTemplates.length === 1 ? 's' : ''} the old name${refs.kpiTemplates.length === 1 ? '' : 's'}; update ${refs.kpiTemplates.length === 1 ? 'it' : 'them'} under KPI templates afterwards.`, tone: 'warn' as const, why: 'A KPI template lists the designations it is offered for. That list is not renamed here, so until it is updated the template won\'t be suggested for people with the new title.' }] : []),
          ...(refs.payslips ? [{ text: `${refs.payslips} past payslip${refs.payslips === 1 ? '' : 's'} keep the old name as issued.`, tone: 'info' as const, why: 'A payslip is a record of what was issued; it is never rewritten.' }] : []),
        ],
        effectiveFrom: ctx.today, undoable: true, typeToConfirm: String(holders.length),
        payload: { kind, mapping, byUserId: ctx.userId, before, listBefore, listTouched },
      });
      return { data: { prepared: true, title, people: holders.length, renames: per, typeToConfirm: String(holders.length), note: 'Nothing is saved until HR types the number of people and presses Confirm.' }, proposalId };
    },
  },
);

/** The Settings list with the renamed entries swapped, duplicates and empties dropped. */
const swapList = (list: string[], mapping: { from: string; to: string }[]) =>
  [...new Set(list.map((n) => mapping.find((m) => m.from === n)?.to ?? n).map((n) => n.trim()).filter(Boolean))];

defineExecutor('rename_titles', {
  async run(p) {
    const { kind, mapping, byUserId, before, listBefore, listTouched } = p.payload as { kind: Kind; mapping: { from: string; to: string }[]; byUserId: string; before: Record<string, string>; listBefore: string[]; listTouched: boolean };
    let done = 0;
    const failed: string[] = [];
    for (const [userId, old] of Object.entries(before)) {
      const to = mapping.find((m) => m.from === old)?.to;
      if (!to) continue;
      try { await updateEmployeeDetailsForAdmin(byUserId, userId, { [kind]: to }); done++; } catch (e) { failed.push((e as Error).message); }
    }
    let listNote = '';
    if (listTouched) try {
      const next = swapList(listBefore, mapping);
      await updateCompanySettings(byUserId, kind === 'designation' ? { designationList: next } : { departmentList: next });
    } catch (e) { listNote = ` The Settings list could not be updated (${(e as Error).message}).`; }
    if (failed.length && !done) throw new Error(failed[0]);
    return { message: `Renamed ${done} ${done === 1 ? 'person' : 'people'}'s ${kind}.${failed.length ? ` ${failed.length} could not be changed: ${failed[0]}` : ''}${listNote}` };
  },
  async undo(p) {
    const { kind, byUserId, before, listBefore, listTouched } = p.payload as { kind: Kind; byUserId: string; before: Record<string, string>; listBefore: string[]; listTouched: boolean };
    let done = 0;
    for (const [userId, old] of Object.entries(before)) {
      try { await updateEmployeeDetailsForAdmin(byUserId, userId, { [kind]: old }); done++; } catch { /* the person may have been removed since */ }
    }
    if (listTouched) try { await updateCompanySettings(byUserId, kind === 'designation' ? { designationList: listBefore } : { departmentList: listBefore }); } catch { /* list stays as renamed */ }
    return `Put the previous ${kind} back on ${done} ${done === 1 ? 'record' : 'records'}${listTouched ? ' and restored the Settings list' : ''}.`;
  },
});
