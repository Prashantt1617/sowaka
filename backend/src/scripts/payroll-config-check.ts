/**
 * Scratch-database check of the national payroll config: the statutory and
 * income tax rows per FY, their HR APIs (read, replace, start a year from the
 * one before), validation, who may read and who may write, that payroll reads
 * the stored figures (an edit moves the result), and that a year without rows
 * is refused rather than worked out on anything else. It drops and recreates
 * its own database, and refuses any other. Test data is the `sowaka` org with
 * invented people and amounts. Run with
 *   npm run payroll:config-check
 */
import {
  companies, connectDb, getDb, payHeads, salaryStructures, salaryTemplates, statutoryConfigs, statutorySettings, tdsConfigs, users,
} from '../config/db';
import { env } from '../config/env';
import { tabsForRequest } from '../models/dashboard-tabs';
import { PayHead } from '../models/payHead.model';
import {
  copyStatutoryConfig, copyTdsConfig, getStatutoryConfig, getTdsConfig, listStatutoryConfigs, listTdsConfigs, putStatutoryConfig, putTdsConfig,
  requireTdsConfigs, statutoryConfigFor, validateStatutoryConfig, validateTdsConfig,
} from '../services/payrollConfig.service';
import { createRun } from '../services/payrollRun.service';
import { previewSalaryStructure } from '../services/salaryStructure.service';
import { STATUTORY_SEED, TDS_SEED } from './payroll-config-seed-data';

const SCRATCH = 'payroll_config_scratch';
const ORG = 'sowaka';
const R = (rupees: number) => rupees * 100;

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  → ${JSON.stringify(got)}`}`);
  if (ok) passed += 1;
  else failed += 1;
}
async function refusal(run: () => Promise<unknown>) {
  try {
    await run();
    return null;
  } catch (error) {
    const e = error as { statusCode?: number; message?: string };
    return { status: e.statusCode, message: e.message };
  }
}
const refused = async (run: () => Promise<unknown>, status: number, message?: RegExp) => {
  const r = await refusal(run);
  return r !== null && r.status === status && (!message || message.test(r.message ?? ''));
};

const head = (h: Partial<PayHead> & Pick<PayHead, 'code' | 'name' | 'category' | 'calculation'>): PayHead => ({
  org: ORG, componentType: 'other', active: true, showInPayslip: true, recurrence: 'recurring', createdAt: new Date(), updatedAt: new Date(), ...h,
} as PayHead);

const person = (userId: string, name: string, org: string, extra: Record<string, unknown> = {}) => ({
  userId, name, email: `${userId}@sowaka.test`, org, lifecycleStatus: 'active', employeeId: `E-${userId.toUpperCase()}`, ...extra,
});

/** A row as the API takes it: the seeded year without its fy. */
const bodyOf = (fy: string) => {
  const { fy: _fy, ...rest } = structuredClone(STATUTORY_SEED.find((c) => c.fy === fy)!);
  void _fy;
  return rest as Record<string, unknown> & typeof rest;
};
const tdsBodyOf = (regime: 'new' | 'old') => {
  const { fy: _fy, regime: _r, ...rest } = structuredClone(TDS_SEED.find((c) => c.fy === '2026-27' && c.regime === regime)!);
  void _fy;
  void _r;
  return rest as Record<string, unknown> & typeof rest;
};

(async () => {
  if (env.mongoDbName !== SCRATCH) throw new Error(`refusing to run against ${env.mongoDbName}: set MONGODB_DB=${SCRATCH}`);
  await connectDb();
  const db = getDb();
  if (db.databaseName !== SCRATCH) throw new Error(`refusing to run against ${db.databaseName}: set MONGODB_DB=${SCRATCH}`);
  await db.dropDatabase();
  await statutoryConfigs().createIndex({ fy: 1 }, { unique: true });

  const now = new Date();
  await companies().insertMany([{ id: ORG, name: 'Sowaka (scratch)' }, { id: 'otherco', name: 'Other (scratch)' }] as never[]);
  await users().insertMany([
    // A Sowaka dashboard admin: may edit the national rows.
    person('admin', 'Asha Admin', ORG, { dashboardAccess: true, dashboardAdmin: true }),
    // Sowaka HR with the Payroll Runs tab but not admin: reads only.
    person('payhr', 'Pavan Payroll', ORG, { dashboardAccess: true, dashboardTabs: ['payruns'] }),
    // Sowaka HR limited to Leave: no payroll access at all.
    person('leavehr', 'Lata Leave', ORG, { dashboardAccess: true, dashboardTabs: ['leave'] }),
    // Another company's own admin: reads, never writes another company's figures.
    person('otheradmin', 'Omar Other', 'otherco', { dashboardAccess: true, dashboardAdmin: true }),
    person('emp', 'Esha Employee', ORG, { state: 'Karnataka', location: 'Bengaluru' }),
  ] as never[]);
  await statutoryConfigs().insertMany(STATUTORY_SEED.map((c) => ({ ...structuredClone(c), createdAt: now, updatedAt: now, updatedByUserId: null })));
  await tdsConfigs().insertMany(TDS_SEED.map((c) => ({ ...structuredClone(c), createdAt: now, updatedAt: now })));
  await payHeads().insertMany([
    head({ code: 'BASIC', name: 'Basic', category: 'earning', componentType: 'basic', calculation: { mode: 'percentage', percent: 50, base: 'ctc' }, considerForEpf: { consider: true } }),
    head({ code: 'FIXED_ALLOWANCE', name: 'Fixed Allowance', category: 'earning', componentType: 'fixed_allowance', calculation: { mode: 'flat_amount' } }),
  ]);
  await salaryTemplates().insertOne({
    org: ORG, name: 'Plain', code: 'PLAIN', active: true, createdAt: now, updatedAt: now, balancingComponentCode: 'FIXED_ALLOWANCE',
    components: [{ payHeadCode: 'BASIC', calculation: { mode: 'percentage', percent: 50, base: 'ctc' } }, { payHeadCode: 'FIXED_ALLOWANCE', calculation: { mode: 'flat_amount' } }],
  } as never);
  await salaryStructures().insertOne({ org: ORG, userId: 'emp', salaryTemplateCode: 'PLAIN', annualCtcPaise: R(4_80_000), status: 'active', createdAt: now, updatedAt: now } as never);

  // —— the seed is exactly what validation accepts ——
  for (const c of STATUTORY_SEED) {
    const { fy, ...rest } = structuredClone(c);
    const v = validateStatutoryConfig(fy, rest);
    check(`seed FY ${fy} passes validation unchanged`, JSON.stringify(v) === JSON.stringify({ ...c, states: [...c.states].sort((a, b) => a.state.localeCompare(b.state)) }), v);
  }
  for (const c of TDS_SEED) {
    const v = validateTdsConfig(c.fy, c.regime, c);
    check(`seed TDS ${c.fy} ${c.regime} passes validation unchanged`, JSON.stringify(v) === JSON.stringify(c), v);
  }

  // —— access ——
  const list = await listStatutoryConfigs('admin');
  check('a Sowaka admin can edit; both seeded years listed, newest first', list.canEdit === true && list.years.map((y) => y.fy).join() === '2026-27,2025-26', list);
  check('payroll-tab HR reads, cannot edit', (await getStatutoryConfig('payhr', '2026-27')).canEdit === false);
  check('payroll-tab HR\'s PUT is refused (403)', await refused(() => putStatutoryConfig('payhr', '2026-27', bodyOf('2026-27')), 403));
  check('another company\'s admin reads, cannot edit', (await getTdsConfig('otheradmin', '2026-27')).canEdit === false);
  check('another company\'s admin cannot PUT (403, every company\'s figures)', await refused(() => putStatutoryConfig('otheradmin', '2026-27', bodyOf('2026-27')), 403, /every company/));
  check('another company\'s admin cannot copy a year (403)', await refused(() => copyTdsConfig('otheradmin', '2027-28', '2026-27'), 403));
  check('HR without payroll access cannot read (403)', await refused(() => getStatutoryConfig('leavehr', '2026-27'), 403));
  check('HR without payroll access cannot list income tax years (403)', await refused(() => listTdsConfigs('leavehr'), 403));
  check('dashboard tabs: reading the rows needs a payroll tab', JSON.stringify(tabsForRequest('GET', '/admin/payroll/statutory-config')) === JSON.stringify(['payruns', 'salarydetails']));
  check('dashboard tabs: Statutory Components alone does not open them', !(tabsForRequest('PUT', '/admin/payroll/tds-config') ?? []).includes('statutorycomponents'));

  // —— read ——
  const got = await getStatutoryConfig('admin', '2026-27');
  check('GET a year: the seeded PF ceilings', JSON.stringify(got.config.epf.wageCeilings) === JSON.stringify([{ from: '2026-04-01', ceilingPaise: R(15_000) }, { from: '2026-09-17', ceilingPaise: R(25_000) }]), got.config.epf);
  check('GET a year: Karnataka PT and Haryana LWF', got.config.states.some((s) => s.state === 'karnataka' && s.pt) && got.config.states.some((s) => s.state === 'haryana' && s.lwf), got.config.states);
  check('GET a year with no row: 404, says so', await refused(() => getStatutoryConfig('admin', '2030-31'), 404, /Statutory settings for FY 2030-31 are not set up/));
  check('GET with a malformed fy: 400', await refused(() => getStatutoryConfig('admin', '2026-28'), 400));
  const tds = await getTdsConfig('admin', '2026-27');
  check('GET income tax: both regimes', tds.configs.new?.regime === 'new' && tds.configs.old?.regime === 'old' && tds.configs.old?.hra?.metroPercentOfBasic === 50, tds);
  check('GET income tax with no rows: 404', await refused(() => getTdsConfig('admin', '2030-31'), 404, /Income tax settings for FY 2030-31 are not set up/));

  // —— validation ——
  const bad = async (name: string, mutate: (b: ReturnType<typeof bodyOf>) => void, message: RegExp) => {
    const b = bodyOf('2026-27');
    mutate(b);
    check(name, await refused(() => putStatutoryConfig('admin', '2026-27', b), 400, message), await refusal(() => putStatutoryConfig('admin', '2026-27', b)));
  };
  await bad('a rate above 1 is refused', (b) => { b.epf.employeeRate = 12; }, /epf\.employeeRate must be a fraction between 0 and 1/);
  await bad('a negative rate is refused', (b) => { b.esi.employerRate = -0.01; }, /esi\.employerRate/);
  await bad('a missing rate is refused', (b) => { delete (b.epf as Partial<typeof b.epf>).edliRate; }, /epf\.edliRate/);
  await bad('EPS above the employer rate is refused', (b) => { b.epf.epsRate = 0.2; }, /epsRate cannot be more/);
  await bad('a zero ESI ceiling is refused', (b) => { b.esi.grossCeilingPaise = 0; }, /grossCeilingPaise must be more than 0/);
  await bad('a zero PF ceiling is refused', (b) => { b.epf.wageCeilings[1].ceilingPaise = 0; }, /ceilingPaise must be more than 0/);
  await bad('ceilings must start on the FY\'s first day', (b) => { b.epf.wageCeilings[0].from = '2026-05-01'; }, /must be the year's first day, 2026-04-01/);
  await bad('ceilings must be in date order', (b) => { b.epf.wageCeilings = [{ from: '2026-04-01', ceilingPaise: R(15_000) }, { from: '2026-09-17', ceilingPaise: R(25_000) }, { from: '2026-06-01', ceilingPaise: R(20_000) }]; }, /date order/);
  await bad('a ceiling after the FY is refused', (b) => { b.epf.wageCeilings[1].from = '2027-04-01'; }, /after FY 2026-27 ends/);
  await bad('bonus max below min is refused', (b) => { b.bonus.maxRate = 0.05; }, /maxRate cannot be below/);
  await bad('PT slabs out of order are refused', (b) => { b.states = [{ state: 'karnataka', pt: { slabs: [{ upToPaise: R(25_000), amountPaise: 0 }, { upToPaise: R(15_000), amountPaise: R(100) }, { upToPaise: null, amountPaise: R(200) }] } }]; }, /must go up/);
  await bad('the open-ended PT slab must be last', (b) => { b.states = [{ state: 'karnataka', pt: { slabs: [{ upToPaise: null, amountPaise: R(200) }, { upToPaise: R(25_000), amountPaise: 0 }] } }]; }, /must be the last one/);
  await bad('PT needs an open-ended top slab', (b) => { b.states = [{ state: 'karnataka', pt: { slabs: [{ upToPaise: R(25_000), amountPaise: 0 }] } }]; }, /open-ended top slab/);
  await bad('a state listed twice is refused', (b) => { b.states = [...b.states, { ...b.states[0] }]; }, /listed twice/);
  await bad('an LWF month 13 is refused', (b) => { b.states = [{ state: 'haryana', lwf: { cycle: 'monthly', deductionMonths: [13], employee: { mode: 'flat', amountPaise: 100 }, employer: { mode: 'flat', amountPaise: 200 } } }]; }, /states\[haryana\]: .*month 1-12/);
  const badTds = async (name: string, mutate: (b: ReturnType<typeof tdsBodyOf>) => void, message: RegExp) => {
    const b = tdsBodyOf('old');
    mutate(b);
    check(name, await refused(() => putTdsConfig('admin', '2026-27', 'old', b), 400, message), await refusal(() => putTdsConfig('admin', '2026-27', 'old', b)));
  };
  await badTds('income tax slabs out of order are refused', (b) => { b.slabs = [{ upToPaise: R(5_00_000), ratePercent: 0 }, { upToPaise: R(2_50_000), ratePercent: 5 }, { upToPaise: null, ratePercent: 30 }]; }, /slabs must go up/);
  await badTds('income tax needs an open-ended top slab', (b) => { b.slabs = [{ upToPaise: R(5_00_000), ratePercent: 0 }]; }, /open-ended top slab/);
  await badTds('a slab rate above 100 is refused', (b) => { b.slabs[1].ratePercent = 105; }, /slabs\[1\]\.ratePercent must be a percentage/);
  await badTds('surcharge out of order is refused', (b) => { b.surcharge = [{ abovePaise: R(1_00_00_000), ratePercent: 15 }, { abovePaise: R(50_00_000), ratePercent: 10 }]; }, /surcharge must go up/);
  await badTds('HRA exemption without its rule is refused', (b) => { delete (b as Partial<typeof b>).hra; }, /hra \(the exemption rule\) is needed/);
  await badTds('a fractional paise limit is refused', (b) => { b.limits.sec80C = 1.5; }, /limits\.sec80C/);
  check('a regime other than new/old is refused', await refused(() => putTdsConfig('admin', '2026-27', 'middle', tdsBodyOf('new')), 400, /regime must be new or old/));

  // —— the stored figures are what payroll uses ——
  const pfOf = async () => (await previewSalaryStructure('admin', 'emp', {})).computed.statutory.epf.employeePaise;
  const before = await pfOf();
  check('preview: PF 12% of the ₹20,000 Basic under the ₹25,000 ceiling (Oct 2026)', before === R(2_400), before);
  const tenPercent = bodyOf('2026-27');
  tenPercent.epf.employeeRate = 0.1;
  const saved = await putStatutoryConfig('admin', '2026-27', tenPercent);
  check('PUT a valid year: saved, who and when recorded', saved.config.epf.employeeRate === 0.1 && saved.config.updatedByUserId === 'admin' && Boolean(saved.config.updatedAt), saved.config);
  const after = await pfOf();
  check('the same preview now takes 10%: payroll reads the row', after === R(2_000), after);
  await putStatutoryConfig('admin', '2026-27', bodyOf('2026-27'));
  check('putting the seeded figures back restores ₹2,400', (await pfOf()) === R(2_400));
  const hraSaved = await putTdsConfig('admin', '2026-27', 'old', { ...tdsBodyOf('old'), hra: { metroPercentOfBasic: 50, nonMetroPercentOfBasic: 40, rentOverPercentOfBasic: 10 } });
  check('PUT income tax: saved for that regime only', hraSaved.configs.old?.updatedByUserId === 'admin' && hraSaved.configs.new?.updatedByUserId === null, hraSaved.configs);

  // —— a new year from the one before ——
  check('copying from a year with no row: 404', await refused(() => copyStatutoryConfig('admin', '2028-29', '2027-28'), 404, /FY 2027-28 are not set up/));
  const copied = await copyStatutoryConfig('admin', '2027-28', '2026-27');
  check('copy: the new year is to confirm, rates carried over',
    copied.config.fy === '2027-28' && copied.config.status === 'to_confirm' && copied.config.epf.employeeRate === 0.12 && copied.config.esi.grossCeilingPaise === R(21_000), copied.config);
  check('copy: one PF ceiling from 1 Apr 2027 at the value FY 2026-27 ended on', JSON.stringify(copied.config.epf.wageCeilings) === JSON.stringify([{ from: '2027-04-01', ceilingPaise: R(25_000) }]), copied.config.epf.wageCeilings);
  check('copy: the states come too', copied.config.states.length === STATUTORY_SEED[1].states.length);
  check('copying onto a year that exists: 409', await refused(() => copyStatutoryConfig('admin', '2027-28', '2026-27'), 409, /already exist/));
  check('copy needs another year to copy from (400)', await refused(() => copyStatutoryConfig('admin', '2029-30', '2029-30'), 400));
  check('income tax for FY 2027-28 is not set up yet (409)', await refused(() => requireTdsConfigs('2027-28'), 409, /Income tax settings for FY 2027-28 are not set up/));
  const tdsCopy = await copyTdsConfig('admin', '2027-28', '2026-27');
  check('copy income tax: both regimes, to confirm', tdsCopy.configs.new?.status === 'to_confirm' && tdsCopy.configs.old?.status === 'to_confirm' && tdsCopy.configs.old?.limits.sec80C === R(1_50_000), tdsCopy.configs);
  check('copy income tax onto a year that has it: 409', await refused(() => copyTdsConfig('admin', '2027-28', '2026-27'), 409));
  check('the new year lists', (await listTdsConfigs('payhr')).years.some((y) => y.fy === '2027-28' && y.status === 'to_confirm' && y.regimes.join() === 'new,old'));

  // —— a year without rows is refused, never worked out on other figures ——
  check('statutoryConfigFor a year with no row: 409', await refused(() => statutoryConfigFor('2028-29'), 409, /Statutory settings for FY 2028-29 are not set up/));
  check('a payroll run for May 2028 (FY 2028-29): 409, names the year', await refused(() => createRun('admin', { period: '2028-05' }), 409, /Statutory settings for FY 2028-29 are not set up/));
  const run = await refusal(() => createRun('admin', { period: '2027-05' }));
  check('a payroll run for May 2027 works on the copied row', run === null, run);
  await statutorySettings().updateOne({ org: ORG }, { $set: { org: ORG, tds: { enabled: true, defaultRegime: 'new' }, updatedAt: now } }, { upsert: true });
  await tdsConfigs().deleteMany({ fy: '2027-28' });
  check('with TDS on, a run in a year without income tax rows: 409', await refused(() => createRun('admin', { period: '2027-06' }), 409, /Income tax settings for FY 2027-28 are not set up/));
  const current = await statutoryConfigs().findOneAndDelete({ fy: '2026-27' });
  check('without this year\'s row, the salary preview is refused (409)', await refused(() => previewSalaryStructure('admin', 'emp', {}), 409, /Statutory settings for FY 2026-27 are not set up/));
  if (current) await statutoryConfigs().insertOne(current);
  check('with it back, the preview works', (await pfOf()) === R(2_400));

  await db.dropDatabase();
  console.log(failed === 0 ? `\nall ${passed} payroll config checks passed` : `\n${failed} check(s) failed, ${passed} passed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (error) => {
  console.error(error);
  try {
    if (getDb().databaseName === SCRATCH) await getDb().dropDatabase();
  } catch { /* not connected */ }
  process.exit(1);
});
