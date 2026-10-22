// Tax proofs: who on payroll has not declared their regime and investments
// for the financial year, or has declared without proofs; Form 16 status;
// and a prepared reminder to them through the app's notifications (push,
// inbox and email). The reminder cannot be taken back once sent.
import { salaryStructures, taxDeclarations, users } from '../../config/db';
import { notifyUsers } from '../../services/notification.service';
import { payrollAccessOf } from '../../services/payrollAccess.service';
import { defineExecutor, propose } from '../proposals';
import { defineTools, str, SuwiContext } from '../tools';
import { fyOfPeriod } from './payroll-common';

const ACTIVE = { lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as const;
const fyFrom = (v: unknown, today: string) => (typeof v === 'string' && /^\d{4}-\d{2}$/.test(v) ? v : fyOfPeriod(today.slice(0, 7)));
type Row = { userId: string; name: string; employeeId: string | null; regime: string | null; proofs: string; status: 'no declaration' | 'declared, no proofs' | 'proofs submitted' | 'proofs verified' };

/** Everyone with an active salary, and where their declaration stands for the FY. */
async function proofStatus(ctx: SuwiContext, fy: string): Promise<Row[]> {
  const structures = await salaryStructures().find({ org: ctx.org, status: 'active' }, { projection: { _id: 0, userId: 1 } }).toArray();
  const people = await users().find({ org: ctx.org, userId: { $in: structures.map((s) => s.userId) }, ...ACTIVE } as never, { projection: { _id: 0, userId: 1, name: 1, employeeId: 1 } }).toArray();
  const decl = new Map((await taxDeclarations().find({ org: ctx.org, fy, userId: { $in: people.map((p) => p.userId) } }).toArray()).map((d) => [d.userId, d]));
  return people.map((p) => {
    const d = decl.get(p.userId);
    const proofs = d?.proofs ?? 'none';
    return {
      userId: p.userId, name: p.name, employeeId: p.employeeId ?? null, regime: d?.regime ?? null, proofs,
      status: !d ? 'no declaration' : proofs === 'verified' ? 'proofs verified' : proofs === 'submitted' ? 'proofs submitted' : 'declared, no proofs',
    } as Row;
  }).sort((a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name));
}

defineTools(
  {
    name: 'tax_proofs_status',
    area: 'payroll',
    payroll: true,
    label: (i) => `Tax declarations and proofs for FY ${i.fy ?? 'this year'}`,
    description: "For a financial year (default: the current one, like 2026-27): everyone on payroll and where their income-tax declaration stands: no declaration (they're taxed on the company's default regime with no deductions), declared but no proofs, proofs submitted, proofs verified; with their regime. Also Form 16 status. Use for 'who hasn't submitted tax proofs', 'who hasn't declared their regime', 'Form 16 status'.",
    input_schema: { type: 'object', properties: { fy: { type: 'string', description: 'Like 2026-27' } } },
    api: { method: 'GET', path: '/admin/payroll/employees/x/tax-declaration' },
    async run(ctx, i) {
      const fy = fyFrom(i.fy, ctx.today);
      const rows = await proofStatus(ctx, fy);
      const count = (s: Row['status']) => rows.filter((r) => r.status === s).length;
      const fyEnd = `${Number(fy.slice(0, 4)) + 1}-03-31`;
      return {
        data: {
          fy, peopleOnPayroll: rows.length,
          counts: { noDeclaration: count('no declaration'), declaredNoProofs: count('declared, no proofs'), proofsSubmitted: count('proofs submitted'), proofsVerified: count('proofs verified') },
          needAttention: rows.filter((r) => r.status === 'no declaration' || r.status === 'declared, no proofs').slice(0, 50),
          submittedAwaitingCheck: rows.filter((r) => r.status === 'proofs submitted').slice(0, 30),
          form16: `Sowaka does not generate or track Form 16 yet. For FY ${fy} it is due to employees by 15 June ${Number(fy.slice(0, 4)) + 1}; the TDS work sheet on each payslip has the same computation.`,
          note: `Declarations are entered by HR on each person's Salary details (Tax declaration). Without one, the TDS engine uses the company's default regime and no deductions. The financial year ends ${fyEnd}.`,
        },
        links: [{ label: 'Open payroll runs', view: 'payruns' }, { label: 'Open employees', view: 'employees' }],
      };
    },
  },
  {
    name: 'prepare_tax_proof_reminder',
    area: 'payroll',
    payroll: true,
    acts: true,
    label: (i) => `A tax-proof reminder for FY ${i.fy ?? 'this year'}`,
    description: "Prepare a reminder (app notification and email) to people who have not submitted their income-tax declaration or proofs for the financial year. Who: 'missing' (no declaration or no proofs; default), 'no_declaration' only, or a list of userIds. Optionally a due date (YYYY-MM-DD) to mention. Nothing is sent until HR confirms, and a sent reminder cannot be undone.",
    input_schema: {
      type: 'object',
      properties: {
        fy: { type: 'string', description: 'Like 2026-27; default the current year' },
        who: { type: 'string', enum: ['missing', 'no_declaration'] },
        userIds: { type: 'array', items: { type: 'string' }, description: 'Only these people (must be on payroll)' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD, mentioned in the message' },
      },
    },
    api: { method: 'PUT', path: '/admin/payroll/employees/x/tax-declaration' },
    async run(ctx, i) {
      const fy = fyFrom(i.fy, ctx.today);
      const rows = await proofStatus(ctx, fy);
      const only = Array.isArray(i.userIds) ? new Set((i.userIds as unknown[]).map((x) => str(x))) : null;
      const targets = rows.filter((r) => (only ? only.has(r.userId) : i.who === 'no_declaration' ? r.status === 'no declaration' : r.status === 'no declaration' || r.status === 'declared, no proofs'));
      if (!targets.length) return { data: { fy, prepared: false, note: 'No one matches: nobody to remind.' } };
      const due = typeof i.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i.dueDate) ? i.dueDate : undefined;
      const names = targets.map((t) => t.name);
      const undeclared = targets.filter((t) => t.status === 'no declaration').length;
      const proposalId = await propose(ctx, {
        kind: 'payroll.tax_proof_reminder',
        area: 'payroll',
        title: `Remind ${targets.length} ${targets.length === 1 ? 'person' : 'people'} about tax proofs`,
        summary: `Sends an app notification and an email asking them to submit their income-tax declaration and investment proofs for FY ${fy}${due ? ` by ${due}` : ''} to HR.`,
        lines: [
          { text: `To: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ` and ${names.length - 8} more` : ''}` },
          ...(undeclared ? [{ text: `${undeclared} ${undeclared === 1 ? 'has' : 'have'} no declaration: taxed on the default regime with no deductions until they declare`, tone: 'info' as const }] : []),
          { text: 'A sent reminder cannot be undone', tone: 'warn' as const, why: 'Notifications and emails go out at once and cannot be recalled.' },
        ],
        undoable: false,
        payload: { fy, userIds: targets.map((t) => t.userId), due: due ?? null },
      });
      return { data: { fy, prepared: true, people: names, note: 'Ready for HR to confirm; nothing has been sent. It cannot be undone once sent.' }, proposalId };
    },
  },
);

defineExecutor('payroll.tax_proof_reminder', {
  async run(p) {
    if (!(await payrollAccessOf(p.userId))) throw Object.assign(new Error('Only people with payroll access can send this'), { statusCode: 403 });
    const fy = String(p.payload.fy);
    const due = p.payload.due ? ` by ${p.payload.due}` : '';
    // Only people still in this company and still missing proofs.
    const asked = (p.payload.userIds as string[]) ?? [];
    const still = await users().find({ org: p.org, userId: { $in: asked }, ...ACTIVE } as never, { projection: { _id: 0, userId: 1 } }).toArray();
    const done = new Set((await taxDeclarations().find({ org: p.org, fy, userId: { $in: asked }, proofs: { $in: ['submitted', 'verified'] } }).toArray()).map((d) => d.userId));
    const ids = still.map((u) => u.userId).filter((id) => !done.has(id));
    if (!ids.length) return { message: 'Everyone has submitted since this was prepared: nothing sent.' };
    await notifyUsers(ids, {
      scenario: 'tax_proofs_reminder',
      title: 'Tax proofs due',
      body: `Please send HR your income-tax regime and investment proofs for FY ${fy}${due}.`,
      data: { fy },
      email: {
        subject: `Your tax declaration and proofs for FY ${fy}`,
        body: `Hi {firstName},\n\nPlease send HR your income-tax regime (new or old) and the proofs of your investments and rent for FY ${fy}${due}. Without them, tax is worked out on the default regime with no deductions, which may mean more tax withheld from your salary.\n\nThank you.`,
      },
    });
    return { message: `Reminder sent to ${ids.length} ${ids.length === 1 ? 'person' : 'people'}.` };
  },
});
