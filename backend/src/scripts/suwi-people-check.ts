/**
 * Checks Suwi's people tools (24 Nov): adding one employee, importing an attached sheet, dashboard access,
 * starting an exit (classic and employee lifecycle), company and tax details, and exporting lists. Each card
 * saves nothing until Confirm; Confirm goes through the dashboard's own service; Undo takes back what has an
 * inverse. On a scratch database only:
 *   npm run suwi-people:check
 */
import { companies, connectDb, getDb, journeys, leaves, users } from '../config/db';
import type { User } from '../models/user.model';
import { confirmProposal, getProposal, undoProposal } from '../suwi/proposals';
import '../suwi/registry';
import { asksForChange } from '../suwi/orchestrator';
import { parseSheet } from '../suwi/sheet';
import { contextFor, SUWI_AREAS, toolByName, type SuwiArea, type SuwiContext, type SuwiLevel } from '../suwi/tools';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}
const person = (userId: string, extra: Partial<User> = {}): User => ({
  userId, name: userId[0].toUpperCase() + userId.slice(1), email: `${userId}@x.test`, org: 'acme', lifecycleStatus: 'active', updatedAt: new Date(),
  role: 'employee', joiningDate: new Date('2024-01-01T00:00:00Z'), employeeId: `E-${userId}`, managerUserId: 'founder', ...extra,
} as User);
const refused = async (run: () => Promise<unknown>) => { try { await run(); return ''; } catch (e) { return (e as Error).message; } };
const run = (ctx: SuwiContext, name: string, input: Record<string, unknown>) => toolByName(name)!.run(ctx, input);
const data = (o: { data: unknown }) => o.data as Record<string, unknown>;

(async () => {
  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const year = Number(today.slice(0, 4));
  await companies().insertMany([
    { id: 'acme', name: 'Acme', features: { exits: true }, departmentList: ['Exterior', 'Interiors'], statutoryRegistration: { pan: 'ABCDE1234F' } },
    { id: 'lifeco', name: 'LifeCo', features: { exits: true, lifecycle: true } },
  ] as never[]);
  await users().insertMany([
    person('founder', { dashboardAccess: true, dashboardAdmin: true, canEditEmployeeDetails: true, managerUserId: undefined }),
    person('dev', { name: 'Dev Malhotra', department: 'Exterior', designation: 'Lead' }),
    person('asha', { department: 'Interiors', designation: 'Designer', location: 'Delhi' }),
    person('ravi', { department: 'Interiors', designation: 'Draughtsman' }),
    person('tanu', { name: 'Tanu Bose', department: 'Accounts' }),
    person('meera', { name: 'Meera Iyer', department: 'Exterior' }),
    person('kabir', { department: 'Exterior', managerUserId: 'meera' }),
    person('hr', { org: 'lifeco', dashboardAccess: true, dashboardAdmin: true, managerUserId: undefined }),
    person('neel', { org: 'lifeco', name: 'Neel Das', managerUserId: 'hr' }),
  ]);
  const levels = Object.fromEntries(SUWI_AREAS.map((a) => [a.key, 'act'])) as Record<SuwiArea, SuwiLevel>;
  const ctxOf = async (userId: string) => contextFor((await users().findOne({ userId }))!, levels, today);
  const ctx = await ctxOf('founder');

  const NAMES = ['prepare_add_employee', 'people_import_plan', 'prepare_people_import', 'dashboard_accesses', 'prepare_dashboard_access', 'prepare_start_exit', 'company_details', 'prepare_company_details_change', 'prepare_tax_details_change', 'export_list'];
  ok('all ten people tools are registered', NAMES.every((n) => toolByName(n)), NAMES.filter((n) => !toolByName(n)));
  ok('the delete tool points leavers to prepare_start_exit', /prepare_start_exit/.test(toolByName('prepare_delete_employee')!.description));
  const changes = ['Give Tanu Claims access', 'Start an exit for Meera, last day 14 Nov, end of contract', 'Add our TDS circle as Ward 72(1) Delhi', 'Import these 30 joiners', 'Add Ira Kapoor as a 3D Visualiser in Exterior from 1 Dec, reporting to Dev'];
  ok('each change request goes to the loop that prepares cards', changes.every((q) => asksForChange(ctx, q)), changes.filter((q) => !asksForChange(ctx, q)));
  ok('an export is a lookup, not a change', !asksForChange(ctx, 'Export November attendance') && !asksForChange(ctx, 'Who has claims access?'));

  console.log('Add one employee');
  const noEmail = await run(ctx, 'prepare_add_employee', { name: 'Ira Kapoor', designation: '3D Visualiser', department: 'exterior', joiningDate: `${year}-12-01`, manager: 'Dev' });
  ok('without a work email nothing is prepared and Suwi asks for it', !noEmail.proposalId && JSON.stringify(data(noEmail).needs) === '["work email"]', noEmail.data);
  const dup = await run(ctx, 'prepare_add_employee', { name: 'Ira Kapoor', email: 'asha@x.test' });
  ok('an email already in use is refused before a card', !dup.proposalId && /already signs in/.test(JSON.stringify(dup.data)), dup.data);
  const add = await run(ctx, 'prepare_add_employee', { name: 'Ira Kapoor', email: 'ira@x.test', designation: '3D Visualiser', department: 'exterior', joiningDate: `${year}-12-01`, manager: 'Dev' });
  const addCard = await getProposal('founder', 'acme', add.proposalId!);
  ok('the card lists every field it sets', ['Full name', 'Work email', 'Joining date', 'Designation', 'Department', 'Reporting manager'].every((f) => addCard.preview?.rows.some((r) => r.name === f && r.next !== '—')), addCard.preview?.rows);
  ok('the department takes the company\'s spelling', addCard.preview?.rows.some((r) => r.name === 'Department' && r.next === 'Exterior') === true);
  ok('the card says shift and salary are still missing', addCard.lines.some((l) => /Still missing/.test(l.text) && /shift template/.test(l.text) && /salary/.test(l.text)), addCard.lines);
  ok('nothing is created before Confirm', !(await users().findOne({ email: 'ira@x.test' })));
  await confirmProposal('founder', 'acme', add.proposalId!);
  const ira = await users().findOne({ email: 'ira@x.test' });
  ok('Confirm adds them through the Add user service', ira?.org === 'acme' && ira.department === 'Exterior' && ira.designation === '3D Visualiser' && ira.managerUserId === 'dev' && ira.joiningDate?.toISOString().slice(0, 10) === `${year}-12-01` && ira.lifecycleStatus === 'onboarding', ira);

  console.log('Import an attached sheet');
  const csv = ['Employee ID,Full Name,Work Email,Designation,Department,Reporting Manager', 'E-asha,Asha,asha@x.test,Senior Designer,Interiors,', ',Tara Sen,tara@x.test,Designer,Interiors,E-dev', ',Om Puri,om@x.test,Designer,Interiors,', ',No Email,,Designer,Interiors,'].join('\n');
  const sheet = parseSheet('joiners.csv', csv)!;
  ok('the attached sheet keeps every row by header', sheet.records?.length === 4 && sheet.records[1]['Full Name'] === 'Tara Sen' && sheet.records[1].__row === '3', sheet.records);
  const sctx = { ...ctx, sheet };
  const plan = await run(sctx, 'people_import_plan', {});
  const pd = data(plan);
  ok('the plan: 2 new, 1 updated, 1 not imported', pd.newEmployees === 2 && pd.updated === 1 && (pd.notImported as unknown[]).length === 1, pd);
  ok('the plan carries the risk check', /new employee has no reporting manager/.test(JSON.stringify(pd.risks)), pd.risks);
  ok('the plan saves nothing', (await db.collection('employee_imports').countDocuments()) === 0);
  const imp = await run(sctx, 'prepare_people_import', {});
  const impCard = await getProposal('founder', 'acme', imp.proposalId!);
  ok('one card for the whole sheet with a row each', impCard.preview?.rows.length === 3 && impCard.preview.skipped.some((s) => s.who === 'Row 5'), impCard.preview);
  ok('the card shows the risk lines', impCard.lines.some((l) => /no reporting manager/.test(l.text)), impCard.lines);
  ok('nothing is imported before Confirm', !(await users().findOne({ email: 'tara@x.test' })) && (await users().findOne({ userId: 'asha' }))?.designation === 'Designer');
  const impDone = await confirmProposal('founder', 'acme', imp.proposalId!);
  const tara = await users().findOne({ email: 'tara@x.test' });
  ok('Confirm applies the import', Boolean(tara) && tara?.managerUserId === 'dev' && Boolean(await users().findOne({ email: 'om@x.test' })) && (await users().findOne({ userId: 'asha' }))?.designation === 'Senior Designer', impDone.message);
  ok('the import reports what it did', /2 new employees added, 1 person updated/.test(impDone.message ?? ''), impDone.message);
  ok('an import without a sheet asks for one', /Attach the spreadsheet/.test(await refused(() => run(ctx, 'prepare_people_import', {}))));

  console.log('Dashboard access');
  const give = await run(ctx, 'prepare_dashboard_access', { person: 'Tanu', give: ['Claims'] });
  const giveCard = await getProposal('founder', 'acme', give.proposalId!);
  ok('"Claims" is the Reimbursements tab', /Reimbursements \(claims\)/.test(giveCard.lines.map((l) => l.text).join(' ')), giveCard.lines);
  ok('nothing changes before Confirm', (await users().findOne({ userId: 'tanu' }))?.dashboardAccess !== true);
  await confirmProposal('founder', 'acme', give.proposalId!);
  const w1 = await users().findOne({ userId: 'tanu' });
  ok('Confirm gives Tanu the Reimbursements tab only', w1?.dashboardAccess === true && JSON.stringify(w1.dashboardTabs) === '["reimbursements"]', w1);
  const more = await run(ctx, 'prepare_dashboard_access', { person: 'Tanu', give: ['leave requests', 'payroll'] });
  const moreCard = await getProposal('founder', 'acme', more.proposalId!);
  ok('payroll access is called out', moreCard.lines.some((l) => /salaries/.test(l.text) && l.tone === 'warn'), moreCard.lines);
  await confirmProposal('founder', 'acme', more.proposalId!);
  ok('a second give adds to what they have', JSON.stringify((await users().findOne({ userId: 'tanu' }))?.dashboardTabs?.sort()) === JSON.stringify(['leave', 'payruns', 'reimbursements']));
  await undoProposal('founder', 'acme', more.proposalId!);
  ok('Undo puts their tabs back exactly', JSON.stringify((await users().findOne({ userId: 'tanu' }))?.dashboardTabs) === '["reimbursements"]');
  ok('Suwi never changes the asker\'s own access', /never changes your own/.test(await refused(() => run(ctx, 'prepare_dashboard_access', { person: 'founder', give: ['claims'] }))));
  const off = await run(ctx, 'prepare_dashboard_access', { person: 'Tanu', remove: ['claims'] });
  await confirmProposal('founder', 'acme', off.proposalId!);
  ok('taking the last tab removes access', (await users().findOne({ userId: 'tanu' }))?.dashboardAccess === false);
  await undoProposal('founder', 'acme', off.proposalId!);
  ok('Undo gives the access back', (await users().findOne({ userId: 'tanu' }))?.dashboardAccess === true);
  const list = await run(ctx, 'dashboard_accesses', { tab: 'claims' });
  ok('dashboard_accesses lists who can open Claims', JSON.stringify(data(list).people).includes('Tanu Bose'), list.data);
  const wctx = await ctxOf('tanu');
  ok('a non-admin cannot change access', /Only a dashboard admin/.test(await refused(() => run({ ...wctx, user: { ...wctx.user, dashboardTabs: undefined } }, 'prepare_dashboard_access', { person: 'Asha', give: ['claims'] }))));

  console.log('Start an exit (classic)');
  const blocked = await run(ctx, 'prepare_start_exit', { person: 'Meera', lastWorkingDay: `${year}-12-14`, exitType: 'end_of_contract' });
  ok('someone with a team needs a new manager first', data(blocked).blocked === true && /Kabir/.test(JSON.stringify(blocked.data)), blocked.data);
  const ex = await run(ctx, 'prepare_start_exit', { person: 'Meera', lastWorkingDay: `${year}-12-14`, exitType: 'end of contract', newManager: 'Dev' });
  const exCard = await getProposal('founder', 'acme', ex.proposalId!);
  ok('the card shows the notice from the offer letter, with no notice pay', exCard.lines.some((l) => /Notice period: 60 days/.test(l.text) && /no notice pay and no recovery/.test(l.text)), exCard.lines);
  ok('HR types the name to confirm', exCard.typeToConfirm === 'Meera Iyer' && exCard.undoable === true);
  ok('nothing changes before Confirm', !(await users().findOne({ userId: 'meera' }))?.exit);
  ok('a wrong name is refused', /Type Meera Iyer/.test(await refused(() => confirmProposal('founder', 'acme', ex.proposalId!, 'Meera'))));
  await confirmProposal('founder', 'acme', ex.proposalId!, 'meera iyer');
  const meera = await users().findOne({ userId: 'meera' });
  ok('Confirm records the exit through recordExit', meera?.exit?.kind === 'other' && meera.exit.lastWorkingDay === `${year}-12-14` && meera.lifecycleStatus === 'notice' && meera.exit.noticeDays === 60 && meera.exit.rules?.noticePay === 'none' && meera.exit.rules?.noticeRecovery === 'none' && meera.exit.newManagerUserId === 'dev', meera?.exit);
  ok('a second exit for the same person is blocked', data(await run(ctx, 'prepare_start_exit', { person: 'Meera', lastWorkingDay: `${year}-12-20`, exitType: 'resignation', newManager: 'Dev' })).blocked === true);
  await undoProposal('founder', 'acme', ex.proposalId!);
  const meera2 = await users().findOne({ userId: 'meera' });
  ok('Undo withdraws the exit', !meera2?.exit && meera2?.lifecycleStatus === 'active');

  console.log('Start an exit (employee lifecycle)');
  const hctx = await ctxOf('hr');
  const lx = await run(hctx, 'prepare_start_exit', { person: 'Neel', lastWorkingDay: `${year}-12-14`, exitType: 'end_of_contract' });
  const lxCard = await getProposal('hr', 'lifeco', lx.proposalId!);
  ok('the lifecycle card starts an offboarding journey and has no Undo', lxCard.undoable === false && lxCard.lines.some((l) => /Offboarding board/.test(l.text)), lxCard.lines);
  await confirmProposal('hr', 'lifeco', lx.proposalId!, 'Neel Das');
  const neel = await users().findOne({ userId: 'neel' });
  ok('Confirm starts the exit through startExit, notice not applicable', neel?.exit?.offboarding?.exitType === 'end_of_contract' && neel.exit.offboarding.noticeHandling === 'not_applicable' && neel.exit.rules?.noticePay === 'none' && neel.exit.noticeDays === 60, neel?.exit);
  ok('its offboarding journey exists', (await journeys().countDocuments({ org: 'lifeco', kind: 'offboarding', userId: 'neel' } as never)) === 1);

  console.log('Company and tax details');
  const det = await run(ctx, 'company_details', {});
  ok('company_details reads the profile and tax details', (data(det).taxDetails as Record<string, unknown>)?.['Company PAN'] === 'ABCDE1234F', det.data);
  ok('a bad TAN is refused before a card', /TAN must look like/.test(await refused(() => run(ctx, 'prepare_tax_details_change', { changes: { tan: '12345' } }))));
  const tds = await run(ctx, 'prepare_tax_details_change', { changes: { tdsCircle: 'Ward 72(1) Delhi' } });
  const tdsCard = await getProposal('founder', 'acme', tds.proposalId!);
  ok('the card shows old and new', tdsCard.lines.some((l) => /TDS circle \/ ward: \(empty\) → Ward 72\(1\) Delhi/.test(l.text)), tdsCard.lines);
  ok('nothing is saved before Confirm', !(await companies().findOne({ id: 'acme' }))?.statutoryRegistration?.tdsCircle);
  await confirmProposal('founder', 'acme', tds.proposalId!);
  const reg = (await companies().findOne({ id: 'acme' }))?.statutoryRegistration;
  ok('Confirm saves the TDS circle and keeps the PAN', reg?.tdsCircle === 'Ward 72(1) Delhi' && reg.pan === 'ABCDE1234F', reg);
  await undoProposal('founder', 'acme', tds.proposalId!);
  const reg2 = (await companies().findOne({ id: 'acme' }))?.statutoryRegistration;
  ok('Undo removes it again, PAN still there', !reg2?.tdsCircle && reg2?.pan === 'ABCDE1234F', reg2);
  const snd = await run(ctx, 'prepare_company_details_change', { changes: { senderEmail: 'HR@Acme.in', city: 'Delhi' } });
  await confirmProposal('founder', 'acme', snd.proposalId!);
  const prof = (await companies().findOne({ id: 'acme' }))?.profile;
  ok('Confirm saves the sender email and city', prof?.senderEmail === 'hr@acme.in' && prof.city === 'Delhi', prof);
  await undoProposal('founder', 'acme', snd.proposalId!);
  const prof2 = (await companies().findOne({ id: 'acme' }))?.profile;
  ok('Undo clears them again', prof2?.senderEmail === '' && prof2.city === '', prof2);

  console.log('Export a list');
  const ppl = await run(ctx, 'export_list', { list: 'people', department: 'Interiors', fields: ['employeeId', 'designation'] });
  const pt = ppl.tables?.[0];
  ok('everyone in Interiors, with the fields asked for', pt?.rows.length === 4 && JSON.stringify(pt.columns) === '["Name","Employee ID","Designation"]', pt);
  ok('the export links to the page that downloads it', ppl.links?.[0]?.view === 'employees' && /can't hand over a file/.test(String(data(ppl).note)), ppl);
  await leaves().insertOne({ userId: 'asha', type: 'casual', startDate: new Date(`${month}-02T00:00:00Z`), endDate: new Date(`${month}-03T00:00:00Z`), days: 2, reason: 'x', status: 'approved', createdAt: new Date() } as never);
  await leaves().insertOne({ userId: 'ravi', type: 'casual', startDate: new Date(`${month}-04T00:00:00Z`), endDate: new Date(`${month}-04T00:00:00Z`), days: 1, reason: 'x', status: 'pending', createdAt: new Date() } as never);
  const lv = await run(ctx, 'export_list', { list: 'leave', month });
  ok('leave taken lists approved leave in the month', lv.tables?.[0]?.rows.length === 1 && lv.tables[0].rows[0][0] === 'Asha', lv.tables ?? lv.data);
  const pend = await run(ctx, 'export_list', { list: 'pending' });
  ok('pending lists what is waiting', pend.tables?.[0]?.rows.some((r) => r[0] === 'Ravi') === true, pend.tables ?? pend.data);
  const att = await run(ctx, 'export_list', { list: 'attendance', month });
  ok('attendance has a row per person for the month', (att.tables?.[0]?.rows.length ?? 0) >= 6 && att.tables![0].columns.includes('Absent'), att.tables?.[0]?.rows.length ?? att.data);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
