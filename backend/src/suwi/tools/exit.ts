// Delete an employee: the card says what is removed and what stays (payslips
// and Form 16 are records of what was issued), is blocked until their reports
// and waiting requests are dealt with, and asks HR to type the person's name.
// Confirm runs the same service as the profile's Delete button. There is no
// exit (keep the record, mark as left) service yet, so there is no undo and
// the card says so.
import { deleteEmployeeForAdmin } from '../../services/admin.service';
import { defineExecutor, propose } from '../proposals';
import { defineTools } from '../tools';
import { waitingOn } from './manager';
import { findPerson, roster, teamOf } from './people';

defineTools({
  name: 'prepare_delete_employee',
  area: 'people',
  acts: true,
  label: (i) => `Prepared: delete ${i.person}`,
  description: 'Prepare deleting an employee\'s account and record (there is no "mark as exited" yet: this removes them). Changes nothing: it creates a "What will happen" card listing what is removed and what is kept, blocked while anyone reports to them or a request of theirs is waiting, for HR to confirm by typing the person\'s name. Cannot be undone.',
  input_schema: { type: 'object', properties: { person: { type: 'string', description: 'Name, employee ID or userId' } }, required: ['person'] },
  api: { method: 'DELETE', path: '/admin/employees/x' },
  async run(ctx, i) {
    if (ctx.user.dashboardAdmin !== true) throw new Error('Only a dashboard admin can delete an employee');
    const all = await roster(ctx);
    const person = await findPerson(ctx, i.person, all);
    if (person.userId === ctx.userId) throw new Error('You cannot delete your own account');
    const reports = teamOf(person.userId, all, false);
    const waiting = await waitingOn(ctx, person.userId);
    if (reports.length || waiting.total) {
      return {
        data: {
          blocked: true, person: { userId: person.userId, name: person.name },
          reasons: [
            ...(reports.length ? [`${reports.length} ${reports.length === 1 ? 'person reports' : 'people report'} to ${person.name}: ${reports.slice(0, 8).map((r) => r.name).join(', ')}${reports.length > 8 ? '…' : ''}. Move them to another manager first (prepare_change_manager).`] : []),
            ...(waiting.total ? [`${waiting.total} request${waiting.total === 1 ? '' : 's'} of theirs still waiting (${[waiting.leave && `${waiting.leave} leave`, waiting.overtime && `${waiting.overtime} overtime`, waiting.claims && `${waiting.claims} claims`, waiting.corrections && `${waiting.corrections} corrections`].filter(Boolean).join(', ')}). Decide them first so nothing is left half-done.`] : []),
          ],
          reports: reports.map((r) => ({ userId: r.userId, name: r.name })),
        },
        links: [{ label: `Open ${person.name.split(' ')[0]}'s profile`, userId: person.userId }],
      };
    }
    const title = `Delete ${person.name}`;
    const proposalId = await propose(ctx, {
      kind: 'delete_employee', area: 'people', title,
      summary: `${person.name}${person.designation ? `, ${person.designation}` : ''}${person.department ? ` in ${person.department}` : ''}, is removed from the roll and can no longer sign in. This cannot be undone.`,
      lines: [
        { text: 'Removed: their profile and login, app sessions and device notifications, salary structure, and bank, PAN and UAN details.', why: 'These are the person\'s live record; once they have left, nothing should be able to pay them or sign in as them.' },
        { text: 'Kept: attendance, leave and overtime history, payslips and Form 16, claims, posts and KPI feedback.', why: 'These are records of what already happened. Past payroll and reports must still add up, and tax documents must stay available.' },
        { text: 'They drop out of headcount, the org chart, teams and every list from now.' },
        { text: 'No Undo: Suwi cannot restore a deleted record. If they might come back, keep the record and remove their dashboard access instead.', tone: 'warn' },
      ],
      effectiveFrom: ctx.today, undoable: false, typeToConfirm: person.name,
      payload: { userId: person.userId, name: person.name, byUserId: ctx.userId },
    });
    return { data: { prepared: true, title, typeToConfirm: person.name, undoable: false, note: 'Nothing happens until HR types the name and presses Confirm.' }, proposalId, links: [{ label: `Open ${person.name.split(' ')[0]}'s profile`, userId: person.userId }] };
  },
});

defineExecutor('delete_employee', {
  async run(p) {
    const { userId, name, byUserId } = p.payload as { userId: string; name: string; byUserId: string };
    await deleteEmployeeForAdmin(byUserId, userId, name);
    return { message: `${name} has been deleted. Their payslips, Form 16 and history are kept.` };
  },
});
