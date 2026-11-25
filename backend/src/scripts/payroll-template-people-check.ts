/**
 * Checks the people side of salary templates, on a scratch database only:
 *   - who a pay run leaves out for want of a live salary (no structure, no
 *     template, no CTC, a draft, a deleted template), for the company's pay
 *     period — and who it does not list (left before the period, offboarded,
 *     joining after it, service accounts);
 *   - putting people on a template from its Edit employees: a CTC and a date
 *     are required, everything is checked before anything is saved, the salary
 *     is created live with its CTC and date (a revision in its history), a move
 *     keeps the CTC and clears the old template's own changes;
 *   - and that a person put on a template that way is then on the run.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:27133/?replicaSet=rs0 npm run payroll:template-people-check
 */
import { connectDb, getDb, paidDaysTemplates, payHeads, payrollPeriods, payslips, salaryStructures, salaryTemplates, statutoryConfigs, users } from '../config/db';
import type { User } from '../models/user.model';
import { createRun } from '../services/payrollRun.service';
import { listSalaryStructures } from '../services/salaryStructure.service';
import { assignPeopleToTemplate, peopleWithoutSalary } from '../services/salaryTemplatePeople.service';
import { payrollRouter } from '../routes/payroll.routes';
import { ZOHO_CATALOG, ZOHO_TEMPLATES } from './payroll-zoho-check';
import { STATUTORY_SEED } from './payroll-config-seed-data';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}
async function refusal(work: () => Promise<unknown>): Promise<{ status?: number; message: string }> {
  try { await work(); return { message: '' }; } catch (error) {
    const e = error as { statusCode?: number; message?: string };
    return { status: e.statusCode, message: e.message ?? String(error) };
  }
}

const ORG = 'tplpeoplecheck';
const day = (d: string) => new Date(`${d}T00:00:00Z`);
const person = (userId: string, extra: Partial<User> = {}): User => ({
  userId, name: userId, email: `${userId}@x.test`, org: ORG, lifecycleStatus: 'active',
  role: 'employee', joiningDate: day('2025-01-01'), ...extra,
} as User);

(async () => {
  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  await statutoryConfigs().insertMany(STATUTORY_SEED.map((c) => ({ ...structuredClone(c), createdAt: new Date(), updatedAt: new Date(), updatedByUserId: null })));
  const now = new Date();
  // Convrse's cycle: November is 26 Oct – 25 Nov.
  await payrollPeriods().insertOne({ org: ORG, period: 'default', startDay: 26, updatedAt: now } as never);
  await payHeads().insertMany(ZOHO_CATALOG.map((h) => ({ ...h, org: ORG })));
  await salaryTemplates().insertMany([
    { ...ZOHO_TEMPLATES.BELOW_TAXABLE, org: ORG },
    { ...ZOHO_TEMPLATES.TAXABLE_SALARY, org: ORG },
    { ...ZOHO_TEMPLATES.BELOW_TAXABLE, org: ORG, code: 'OLD_GROUP', name: 'Old group', active: false },
  ]);
  // Every day paid: the run need not read attendance here.
  await paidDaysTemplates().insertOne({ org: ORG, code: 'DEFAULT', name: 'All days', allDaysPaid: true, deductionRules: [], monthlyPaidLeaveDays: 0, isDefault: true, createdAt: now, updatedAt: now });

  await users().insertMany([
    person('hr', { dashboardAccess: true, employeeId: 'H1', name: 'HR Admin' }),
    person('paid', { employeeId: 'E1', name: 'Paid Person' }),
    person('joiner', { employeeId: 'E2', name: 'Nov Joiner', joiningDate: day('2026-11-12') }),
    person('halfdone', { employeeId: 'E3', name: 'Half Done' }),
    person('tplgone', { employeeId: 'E4', name: 'Template Gone' }),
    person('leftduring', { employeeId: 'E5', name: 'Left During', endDate: day('2026-11-05'), lifecycleStatus: 'notice' }),
    person('leftbefore', { employeeId: 'E6', name: 'Left Before', endDate: day('2026-10-20'), lifecycleStatus: 'notice' }),
    person('offboarded', { employeeId: 'E7', name: 'Offboarded', lifecycleStatus: 'offboarded' }),
    person('future', { employeeId: 'E8', name: 'December Joiner', joiningDate: day('2026-12-01') }),
    person('support', { employeeId: 'S1', name: 'Support', hiddenFromDirectory: true }),
    person('drafty', { employeeId: 'E9', name: 'Draft Salary' }),
    person('lateoct', { employeeId: 'E10', name: 'Late October', joiningDate: day('2026-10-28') }),
  ]);
  await salaryStructures().insertMany([
    { org: ORG, userId: 'hr', salaryTemplateCode: 'BELOW_TAXABLE', annualCtcPaise: 6_00_000_00, status: 'active', createdAt: now, updatedAt: now },
    { org: ORG, userId: 'paid', salaryTemplateCode: 'BELOW_TAXABLE', annualCtcPaise: 3_72_000_00, status: 'active', overrides: { remove: ['BONUS'] }, componentValues: { FIXED_ALLOWANCE: 0 }, createdAt: now, updatedAt: now },
    { org: ORG, userId: 'halfdone', salaryTemplateCode: 'BELOW_TAXABLE', annualCtcPaise: 0, status: 'draft', createdAt: now, updatedAt: now },
    { org: ORG, userId: 'tplgone', salaryTemplateCode: 'DELETED_ONE', annualCtcPaise: 4_00_000_00, status: 'active', createdAt: now, updatedAt: now },
    { org: ORG, userId: 'drafty', salaryTemplateCode: 'BELOW_TAXABLE', annualCtcPaise: 4_00_000_00, status: 'draft', createdAt: now, updatedAt: now },
    { org: ORG, userId: 'leftbefore', annualCtcPaise: 0, status: 'draft', createdAt: now, updatedAt: now },
  ] as never);

  console.log('who a run leaves out');
  const nov = await peopleWithoutSalary('hr', '2026-11');
  ok('November on the 26th cycle: 26 Oct – 25 Nov', nov.period === '2026-11' && nov.from === '2026-10-26' && nov.to === '2026-11-25', nov);
  const reasons = Object.fromEntries(nov.people.map((p) => [p.userId, p.reason]));
  ok('the November joiner with no structure is listed', reasons.joiner === 'none', reasons);
  ok('a template without a CTC, a draft and a deleted template are listed, each with its reason',
    reasons.halfdone === 'no_ctc' && reasons.drafty === 'draft' && reasons.tplgone === 'template_gone', reasons);
  ok('someone leaving during the period is listed', reasons.leftduring === 'none', reasons);
  ok('a late-October joiner (inside November\'s cycle) is listed', reasons.lateoct === 'none', reasons);
  ok('not listed: people paid, left before the period, offboarded, joining after it, service accounts',
    ['hr', 'paid', 'leftbefore', 'offboarded', 'future', 'support'].every((id) => !(id in reasons)), reasons);
  const joinerRow = nov.people.find((p) => p.userId === 'joiner');
  ok('each row has name, employee ID and joining date', joinerRow?.name === 'Nov Joiner' && joinerRow.employeeId === 'E2' && joinerRow.joiningDate === '2026-11-12', joinerRow);
  ok('newest joiners first', nov.people[0]?.userId === 'joiner', nov.people.map((p) => p.userId));
  const dec = await peopleWithoutSalary('hr', '2026-12');
  ok('December lists the December joiner too', dec.people.some((p) => p.userId === 'future'), dec.people.map((p) => p.userId));
  ok('a bad period is refused', (await refusal(() => peopleWithoutSalary('hr', '2026-13'))).status === 400);
  const cur = await peopleWithoutSalary('hr');
  ok('no period: the current pay period, and it says which', cur.period === cur.current.period && /^\d{4}-\d{2}$/.test(cur.current.period) && cur.from === cur.current.from, cur.current);

  console.log('putting people on a template');
  const before = await salaryStructures().countDocuments({ org: ORG });
  const noCtc = await refusal(() => assignPeopleToTemplate('hr', 'TAXABLE_SALARY', { people: [
    { userId: 'joiner', annualCtcPaise: 5_00_000_00, effectiveFrom: '2026-11-12' },
    { userId: 'lateoct', effectiveFrom: '2026-10-28' },
  ] }));
  ok('a CTC is required: refused, naming the person', noCtc.status === 400 && /Late October/.test(noCtc.message) && /CTC/.test(noCtc.message), noCtc);
  ok('…and nobody was saved', (await salaryStructures().countDocuments({ org: ORG })) === before && !(await salaryStructures().findOne({ org: ORG, userId: 'joiner' })));
  ok('a CTC of 0 is refused', (await refusal(() => assignPeopleToTemplate('hr', 'TAXABLE_SALARY', { people: [{ userId: 'joiner', annualCtcPaise: 0, effectiveFrom: '2026-11-12' }] }))).status === 400);
  ok('a date that is not a date is refused', (await refusal(() => assignPeopleToTemplate('hr', 'TAXABLE_SALARY', { people: [{ userId: 'joiner', annualCtcPaise: 5_00_000_00, effectiveFrom: '2026-02-30' }] }))).status === 400);
  ok('an inactive template is refused', (await refusal(() => assignPeopleToTemplate('hr', 'OLD_GROUP', { people: [{ userId: 'joiner', annualCtcPaise: 5_00_000_00, effectiveFrom: '2026-11-12' }] }))).status === 409);
  ok('an unknown template is refused', (await refusal(() => assignPeopleToTemplate('hr', 'NOPE', { people: [{ userId: 'joiner', annualCtcPaise: 5_00_000_00, effectiveFrom: '2026-11-12' }] }))).status === 404);
  ok('someone who has left is refused', (await refusal(() => assignPeopleToTemplate('hr', 'TAXABLE_SALARY', { people: [{ userId: 'offboarded', annualCtcPaise: 5_00_000_00, effectiveFrom: '2026-11-01' }] }))).status === 409);
  ok('someone listed twice is refused', (await refusal(() => assignPeopleToTemplate('hr', 'TAXABLE_SALARY', { people: [
    { userId: 'joiner', annualCtcPaise: 5_00_000_00, effectiveFrom: '2026-11-12' }, { userId: 'joiner', annualCtcPaise: 5_00_000_00, effectiveFrom: '2026-11-12' },
  ] }))).status === 400);
  ok('another company\'s person is refused', (await refusal(async () => {
    await users().insertOne(person('elsewhere', { org: 'another-org' }));
    return assignPeopleToTemplate('hr', 'TAXABLE_SALARY', { people: [{ userId: 'elsewhere', annualCtcPaise: 5_00_000_00, effectiveFrom: '2026-11-01' }] });
  })).status === 404);

  const added = await assignPeopleToTemplate('hr', 'taxable_salary', { people: [
    { userId: 'joiner', annualCtcPaise: 5_00_000_00, effectiveFrom: '2026-11-12' },
    { userId: 'halfdone', annualCtcPaise: 4_20_000_00, effectiveFrom: '2026-10-26' },
    { userId: 'paid', annualCtcPaise: 3_72_000_00, effectiveFrom: '2026-11-01' },
  ] });
  ok('three saved, none refused', added.saved === 3 && added.results.every((r) => r.ok), added);
  ok('the move says where from', added.results.find((r) => r.userId === 'paid')?.movedFrom === 'BELOW_TAXABLE' && !added.results.find((r) => r.userId === 'joiner')?.movedFrom, added.results);
  const j = await salaryStructures().findOne({ org: ORG, userId: 'joiner' });
  ok('the joiner\'s salary is created live on the template, with the CTC', j?.status === 'active' && j.salaryTemplateCode === 'TAXABLE_SALARY' && j.annualCtcPaise === 5_00_000_00, j);
  ok('…from the date given', j?.effectiveFrom?.toISOString().slice(0, 10) === '2026-11-12', j?.effectiveFrom);
  ok('…and its history has the first CTC from that date', j?.revisions?.length === 1 && j.revisions[0].previousCtcPaise === 0 && j.revisions[0].annualCtcPaise === 5_00_000_00 && j.revisions[0].effectiveFrom === '2026-11-12', j?.revisions);
  const h = await salaryStructures().findOne({ org: ORG, userId: 'halfdone' });
  ok('a template without a CTC gets its CTC and goes live', h?.status === 'active' && h.annualCtcPaise === 4_20_000_00 && h.salaryTemplateCode === 'TAXABLE_SALARY', h);
  const p = await salaryStructures().findOne({ org: ORG, userId: 'paid' });
  ok('a move keeps the CTC, with no new revision', p?.salaryTemplateCode === 'TAXABLE_SALARY' && p.annualCtcPaise === 3_72_000_00 && (p.revisions ?? []).length === 0, p);
  ok('…clears the old template\'s own changes, keeps the per-person amounts', JSON.stringify(p?.overrides ?? {}) === '{}' && p?.componentValues?.FIXED_ALLOWANCE === 0, { overrides: p?.overrides, values: p?.componentValues });
  ok('…and is dated', p?.effectiveFrom?.toISOString().slice(0, 10) === '2026-11-01', p?.effectiveFrom);
  const list = await listSalaryStructures('hr');
  ok('the salaries list gives the date', list.find((r) => r.userId === 'joiner')?.effectiveFrom === '2026-11-12' && list.find((r) => r.userId === 'hr')?.effectiveFrom === undefined, list.map((r) => [r.userId, r.effectiveFrom]));
  const again = await assignPeopleToTemplate('hr', 'TAXABLE_SALARY', { people: [{ userId: 'joiner', annualCtcPaise: 5_40_000_00, effectiveFrom: '2026-12-01' }] });
  const j2 = await salaryStructures().findOne({ org: ORG, userId: 'joiner' });
  ok('already on it with a new CTC: a revision from the new date; the template date stays', again.saved === 1 && j2?.revisions?.length === 2 && j2.revisions[1].effectiveFrom === '2026-12-01'
    && j2.revisions[1].previousCtcPaise === 5_00_000_00 && j2.effectiveFrom?.toISOString().slice(0, 10) === '2026-11-12', j2);
  // A move with nothing but the person (25 Nov 2026): someone with a CTC moves keeping it, undated, no revision.
  const paidBefore = await salaryStructures().findOne({ userId: 'paid' });
  const moved = await assignPeopleToTemplate('hr', 'BELOW_TAXABLE', { people: [{ userId: 'paid' }] });
  const pm = await salaryStructures().findOne({ userId: 'paid' });
  ok('a move with no CTC or date keeps the CTC', moved.saved === 1 && pm?.salaryTemplateCode === 'BELOW_TAXABLE' && pm.annualCtcPaise === 3_72_000_00, pm);
  ok('…adds no revision and keeps the date it had', (pm?.revisions?.length ?? 0) === (paidBefore?.revisions?.length ?? 0) && pm?.effectiveFrom?.toISOString() === paidBefore?.effectiveFrom?.toISOString(), [pm?.revisions, pm?.effectiveFrom]);
  ok('someone with no salary still needs a CTC', (await refusal(() => assignPeopleToTemplate('hr', 'TAXABLE_SALARY', { people: [{ userId: 'lateoct' }] }))).status === 400);
  ok('…and a date', (await refusal(() => assignPeopleToTemplate('hr', 'TAXABLE_SALARY', { people: [{ userId: 'lateoct', annualCtcPaise: 4_00_000_00 }] }))).status === 400);
  await assignPeopleToTemplate('hr', 'TAXABLE_SALARY', { people: [{ userId: 'paid' }] });
  await salaryStructures().updateOne({ org: ORG, userId: 'joiner' }, { $set: { annualCtcPaise: 5_00_000_00 } });

  const after = await peopleWithoutSalary('hr', '2026-11');
  const left = after.people.map((p) => p.userId).sort();
  ok('the list drops the people now on a template', !left.includes('joiner') && !left.includes('halfdone') && left.join() === ['drafty', 'lateoct', 'leftduring', 'tplgone'].sort().join(), left);

  console.log('then on the run');
  const run = await createRun('hr', { period: '2026-11' });
  const slipOf = async (userId: string) => payslips().findOne({ org: ORG, period: '2026-11', userId });
  const joinerSlip = await slipOf('joiner');
  ok('the joiner put on a template is on the November run', !!joinerSlip && run.payslipCount >= 3, { count: run.payslipCount });
  ok('…paid from the joining day: 26 Oct – 11 Nov before joining (17 days)', joinerSlip?.inputs.lopDays === 17 && joinerSlip.inputs.workingDays === 31, joinerSlip?.inputs);
  ok('…on the template\'s pay: half the monthly CTC is Basic', joinerSlip?.earnings.some((e) => e.code === 'BASIC') === true, joinerSlip?.earnings.map((e) => e.code));
  ok('the moved person is paid on the new template', !!(await slipOf('paid')) && !!(await slipOf('halfdone')));
  ok('people still without a live salary are not on it', !(await slipOf('lateoct')) && !(await slipOf('drafty')) && !(await slipOf('tplgone')));

  console.log('routes');
  const routes = (payrollRouter.stack as { route?: { path: string; methods: Record<string, boolean> } }[]).filter((l) => l.route).map((l) => `${Object.keys(l.route!.methods)[0]} ${l.route!.path}`);
  ok('GET /people-without-salary and POST /salary-templates/:code/people are routed', routes.includes('get /people-without-salary') && routes.includes('post /salary-templates/:code/people'), routes.filter((r) => /people/.test(r)));

  await db.dropDatabase();
  console.log(`\n${failed ? `${failed} failed, ` : 'all '}${passed} passed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
