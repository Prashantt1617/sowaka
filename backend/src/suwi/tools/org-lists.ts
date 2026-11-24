// Adding names to the company's saved Departments / Designations lists (People ›
// Departments, People › Designations), through the same settings update those
// pages use (updateCompanySettings). Nobody is moved; the names become choices
// on profiles, imports and bulk assign. Undo removes the names it added.
import { getCompanySettings, updateCompanySettings } from '../../services/company-settings.service';
import { defineExecutor, propose } from '../proposals';
import { defineTools, str } from '../tools';

type Which = 'department' | 'designation';
const LIST: Record<Which, 'departmentList' | 'designationList'> = { department: 'departmentList', designation: 'designationList' };
const clean = (s: string) => s.trim().replace(/\s+/g, ' ');

defineTools({
  name: 'prepare_add_department_or_designation',
  area: 'people',
  acts: true,
  label: (i) => `Prepared: add ${Array.isArray(i.names) ? i.names.join(', ') : 'names'} to ${i.kind === 'designation' ? 'designations' : 'departments'}`,
  description: 'Prepare adding one or more names to the company\'s saved Departments or Designations list (People › Departments / Designations). Nobody is moved; to put people in a department or title use prepare_bulk_assign. kind: department or designation. Changes nothing until HR confirms; Undo removes the names it added.',
  input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['department', 'designation'] }, names: { type: 'array', items: { type: 'string' } } }, required: ['kind', 'names'] },
  api: { method: 'PATCH', path: '/admin/company/settings' },
  async run(ctx, i) {
    const kind: Which = str(i.kind) === 'designation' ? 'designation' : 'department';
    const wanted = (Array.isArray(i.names) ? i.names : [i.names]).map((n) => clean(str(n, 80))).filter(Boolean);
    if (!wanted.length) throw new Error(`Give the ${kind} names to add`);
    const settings = await getCompanySettings(ctx.userId);
    const saved = settings[LIST[kind]];
    const spelling = new Map((kind === 'department' ? settings.departments : settings.designations).map((n) => [n.toLowerCase(), n]));
    const known = new Set(spelling.keys());
    const savedLower = new Set(saved.map((n) => n.toLowerCase()));
    const adding: string[] = [];
    const skipped: { who: string; reason: string }[] = [];
    for (const typed of wanted) {
      const n = spelling.get(typed.toLowerCase()) ?? typed; // a name someone already holds keeps its spelling

      if (savedLower.has(n.toLowerCase()) || adding.some((a) => a.toLowerCase() === n.toLowerCase())) skipped.push({ who: n, reason: 'Already on the list' });
      else adding.push(n);
    }
    if (!adding.length) return { data: { nothingToDo: true, skipped, message: `Every one of these is already on the ${kind} list.` } };
    const plural = kind === 'department' ? 'Departments' : 'Designations';
    const title = `Add ${adding.length === 1 ? adding[0] : `${adding.length} names`} to ${plural}`;
    const proposalId = await propose(ctx, {
      kind: 'add_org_list_names', area: 'people', title,
      summary: `${adding.join(', ')} ${adding.length === 1 ? 'is' : 'are'} added to the saved ${kind} list. Nobody is moved.`,
      lines: [
        { text: `Adds to People › ${plural}: ${adding.join(', ')}.` },
        ...(adding.some((a) => known.has(a.toLowerCase())) ? [{ text: `Already held by someone (now saved on the list too): ${adding.filter((a) => known.has(a.toLowerCase())).join(', ')}.`, tone: 'info' as const }] : []),
        { text: `Nobody's ${kind} changes; the names become choices on profiles, imports and bulk assign.`, tone: 'info' as const },
        ...(skipped.length ? [{ text: `Left out (already on the list): ${skipped.map((s) => s.who).join(', ')}.`, tone: 'info' as const }] : []),
        { text: 'Undo removes the names this adds.', tone: 'info' as const },
      ],
      effectiveFrom: ctx.today, undoable: true,
      payload: { byUserId: ctx.userId, which: kind, adding },
    });
    return { data: { prepared: true, title, adding, skipped, note: 'Nothing is saved until HR presses Confirm on the card.' }, proposalId, links: [{ label: `Open ${plural}`, view: kind === 'department' ? 'departments' : 'designations' }] };
  },
});

defineExecutor('add_org_list_names', {
  async run(p) {
    const { byUserId, which, adding } = p.payload as { byUserId: string; which: Which; adding: string[] };
    const current = (await getCompanySettings(byUserId))[LIST[which]];
    const lower = new Set(current.map((n) => n.toLowerCase()));
    const added = adding.filter((n) => !lower.has(n.toLowerCase()));
    if (added.length) await updateCompanySettings(byUserId, { [LIST[which]]: [...current, ...added] });
    return { message: added.length ? `Added ${added.join(', ')} to the ${which} list.` : `Nothing to add: already on the ${which} list.`, undo: { added } };
  },
  async undo(p) {
    const { byUserId, which } = p.payload as { byUserId: string; which: Which };
    const added = ((p.undo as { added?: string[] } | undefined)?.added) ?? [];
    const drop = new Set(added.map((n) => n.toLowerCase()));
    const current = (await getCompanySettings(byUserId))[LIST[which]];
    await updateCompanySettings(byUserId, { [LIST[which]]: current.filter((n) => !drop.has(n.toLowerCase())) });
    return `Removed ${added.join(', ') || 'nothing'} from the ${which} list.`;
  },
});
