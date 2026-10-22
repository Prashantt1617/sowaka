// Change a reporting manager: the card shows the org-chart change, the
// requests waiting on the old manager that move with the person, and what
// happens to the old manager's role. Confirm goes through the same service as
// the profile's manager change (and the org chart); Undo puts the old manager
// back.
import { attendanceRegularizations, leaves, overtimeRequests, reimbursementClaims } from '../../config/db';
import { assignManager, removeManager } from '../../services/reporting.service';
import { defineExecutor, propose } from '../proposals';
import { defineTools } from '../tools';
import { findPerson, orgPathOf, roster, teamOf } from './people';

/** What is still waiting for a decision on this person, by kind. Leave is read from the current manager; the rest are stamped with one. */
export async function waitingOn(userId: string) {
  const [leave, overtime, claims, corrections] = await Promise.all([
    leaves().countDocuments({ userId, status: 'pending' } as never),
    overtimeRequests().countDocuments({ userId, status: 'pending' } as never),
    reimbursementClaims().countDocuments({ userId, status: 'pending' } as never),
    attendanceRegularizations().countDocuments({ userId, status: 'pending' } as never),
  ]);
  return { leave, overtime, claims, corrections, total: leave + overtime + claims + corrections };
}

defineTools({
  name: 'prepare_change_manager',
  area: 'people',
  acts: true,
  label: (i) => `Prepared: ${i.person} reports to ${i.newManager}`,
  description: 'Prepare changing who a person reports to. Changes nothing: it creates a "What will happen" card with the org-chart change, the requests waiting on the old manager that move to the new one, and the effect on the old manager, for HR to confirm. Undo restores the old manager.',
  input_schema: { type: 'object', properties: { person: { type: 'string', description: 'Name, employee ID or userId' }, newManager: { type: 'string', description: 'Name, employee ID or userId of the new manager' } }, required: ['person', 'newManager'] },
  api: { method: 'PUT', path: '/admin/reporting/employees/x/manager' },
  async run(ctx, i) {
    const all = await roster(ctx);
    const byId = new Map(all.map((p) => [p.userId, p]));
    const person = await findPerson(ctx, i.person, all);
    const manager = await findPerson(ctx, i.newManager, all);
    if (person.userId === manager.userId) throw new Error(`${person.name} cannot be their own manager`);
    if (person.managerUserId === manager.userId) return { data: { nothingToDo: true, message: `${person.name} already reports to ${manager.name}.` } };
    if (orgPathOf(manager.userId, byId).includes(person.name) || teamOf(person.userId, all, true).some((p) => p.userId === manager.userId)) {
      throw new Error(`${manager.name} is below ${person.name} in the org chart, so ${person.name} cannot report to them. Move ${manager.name} first.`);
    }
    const old = person.managerUserId ? byId.get(person.managerUserId) : undefined;
    const waiting = await waitingOn(person.userId);
    const reports = teamOf(person.userId, all, false);
    const oldOthers = old ? teamOf(old.userId, all, false).filter((p) => p.userId !== person.userId).length : 0;
    const path = [manager.name, ...orgPathOf(manager.userId, byId)].join(' › ');
    const moving = waiting.overtime + waiting.claims + waiting.corrections;
    const title = `${person.name} reports to ${manager.name}`;
    const proposalId = await propose(ctx, {
      kind: 'change_manager', area: 'people', title,
      summary: `${person.name}${person.designation ? ` (${person.designation})` : ''} moves from ${old ? `under ${old.name}` : 'nobody'} to under ${manager.name}${manager.designation ? ` (${manager.designation})` : ''}, from today.`,
      lines: [
        { text: `Org chart: ${person.name} → ${path}.`, why: 'The org chart and every "my team" list read the reporting manager from the person\'s record, so they change at once.' },
        ...(moving ? [{ text: `${moving} request${moving === 1 ? '' : 's'} waiting on ${old?.name ?? 'the old manager'} (${[waiting.overtime && `${waiting.overtime} overtime`, waiting.claims && `${waiting.claims} claim${waiting.claims === 1 ? '' : 's'}`, waiting.corrections && `${waiting.corrections} attendance correction${waiting.corrections === 1 ? '' : 's'}`].filter(Boolean).join(', ')}) move to ${manager.name}'s inbox.`, why: 'Requests still waiting go to the new manager so nothing sits with someone who no longer manages this person. Requests already decided keep who decided them.' }] : [{ text: `No overtime, claims or attendance corrections are waiting on ${old?.name ?? 'the old manager'}.`, tone: 'info' as const }]),
        ...(waiting.leave ? [{ text: `${waiting.leave} leave request${waiting.leave === 1 ? '' : 's'} waiting: ${manager.name} sees ${waiting.leave === 1 ? 'it' : 'them'} from now.`, why: 'Leave inboxes are built from who reports to the manager today, so a pending leave follows the person automatically.' }] : []),
        ...(reports.length ? [{ text: `${person.name}'s own ${reports.length} report${reports.length === 1 ? '' : 's'} stay with ${person.name.split(' ')[0]}.` }] : []),
        ...(old && !oldOthers ? [{ text: `${old.name} has no other reports and stops being marked as a manager.`, tone: 'warn' as const, why: 'A person counts as a manager while someone reports to them; the manager views in the app close when nobody does.' }] : []),
        { text: `${manager.name} gives ${person.name.split(' ')[0]}'s KPI feedback from now; anything ${old?.name ?? 'the old manager'} already sent stays as it is.` },
      ],
      effectiveFrom: ctx.today, undoable: true,
      payload: { userId: person.userId, personName: person.name, newManagerId: manager.userId, newManagerName: manager.name, oldManagerId: old?.userId ?? null, oldManagerName: old?.name ?? null, byUserId: ctx.userId },
    });
    return {
      data: { prepared: true, title, from: old?.name ?? null, to: manager.name, orgPath: path, requestsMoving: moving, leaveWaiting: waiting.leave, ownReports: reports.length, note: 'Nothing is saved until HR presses Confirm on the card.' },
      proposalId,
      links: [{ label: `Open ${person.name.split(' ')[0]}'s org chart`, userId: person.userId, tab: 'orgchart' }],
    };
  },
});

defineExecutor('change_manager', {
  async run(p) {
    const { userId, personName, newManagerId, newManagerName, byUserId } = p.payload as { userId: string; personName: string; newManagerId: string; newManagerName: string; byUserId: string };
    const r = await assignManager(byUserId, userId, newManagerId);
    return { message: `${personName} now reports to ${newManagerName}.${r.movedRequests ? ` ${r.movedRequests} waiting request${r.movedRequests === 1 ? '' : 's'} moved to their inbox.` : ''}` };
  },
  async undo(p) {
    const { userId, personName, oldManagerId, oldManagerName, byUserId } = p.payload as { userId: string; personName: string; oldManagerId: string | null; oldManagerName: string | null; byUserId: string };
    if (oldManagerId) { const r = await assignManager(byUserId, userId, oldManagerId); return `${personName} reports to ${oldManagerName} again.${r.movedRequests ? ` ${r.movedRequests} waiting request${r.movedRequests === 1 ? '' : 's'} moved back.` : ''}`; }
    await removeManager(byUserId, userId);
    return `${personName} has no reporting manager again, as before.`;
  },
});
