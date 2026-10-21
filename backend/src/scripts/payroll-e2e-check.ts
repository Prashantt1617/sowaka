/**
 * End-to-end salary encryption, against the real API and database, in the
 * sowaka org only (dummy people). Starts the API alone (no schedulers) on its
 * own port and drives the sealed client the dashboard uses:
 *
 *   plaintext baseline: salaries + a tax declaration saved through the plain
 *     API, two months run by the server's calculator → the expected numbers
 *   setup (recovery key shown) → unlock → sealed salaries + declaration →
 *   sealed runs (April, then May with HR edits and TDS year-to-date) → read
 *   back, equal to the server's figures → an employee opens their own slip →
 *   a second payroll user is granted, approves, loses access → rotation →
 *   their old key opens nothing, the new one does → recovery with the
 *   recovery key → the database holds none of the known paise values.
 *
 * Everything sowaka had in the payroll collections is set aside first (to a
 * backup file) and put back exactly at the end, so the check runs the same
 * whether sowaka is encrypted or not, and leaves it as it found it.
 *
 *   npm run payroll:e2e-check                     (PORT defaults to 4097)
 *   npm run payroll:e2e-check -- --restore <file> (put a backup back after a crash)
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BSON, type Document } from 'mongodb';
import { app } from '../app';
import { authSessions, closeDb, connectDb, getDb, users } from '../config/db';
import { aadFor, createRecoveryKey, open, unlockPrivateKey, unwrapWithPrivateKey, type Sealed } from '../shared/payroll/crypto';
import { hashSessionToken } from '../services/auth.service';
import { SealedPayroll, SealedPayslipReader, type OpenPayslip, type PayrollApi, type RunEdits } from '../shared/payroll/sealed-client';

const ORG = 'sowaka';
const PORT = Number(process.env.PORT ?? 4097);
const BASE = `http://localhost:${PORT}`;
const COLLECTIONS = ['payroll_crypto', 'salary_structures', 'payroll_runs', 'payslips', 'tax_declarations'] as const;
const ACCESS_FIELDS = ['dashboardAccess', 'dashboardAdmin', 'dashboardTabs', 'supportRole'] as const;
const FY = '2026-27';
const APRIL = '2026-04';
const MAY = '2026-05';

// The dummy people (sowaka): two act as payroll users for the run of the check.
const PEOPLE = {
  hr: 'neha.iyer@getsowaka.com',
  second: 'farhan.qureshi@getsowaka.com',
  aditya: 'aditya.menon@getsowaka.com',
  sneha: 'sneha.kulkarni@getsowaka.com',
  rohit: 'rohit.bansal@getsowaka.com',
};

// Distinctive paise values: the database scan looks for these.
const SALARIES = {
  aditya: { template: 'TAXABLE_SALARY', annualCtcPaise: 123_456_789, componentValues: { FUEL: 271_828, INTERNET: 141_421 }, overrides: { add: [{ payHeadCode: 'CHILD_EDU', calculation: { mode: 'flat_per_month' as const, amountPaise: 314_159 } }] } },
  sneha: { template: 'BELOW_TAXABLE', annualCtcPaise: 34_567_891, componentValues: {}, overrides: {} },
  rohit: { template: 'STAFF_ESI', annualCtcPaise: 21_098_765, componentValues: {}, overrides: {} },
};
const DECLARATION = { regime: 'old' as const, declarations: { sec80C: 12_345_600, sec80DSelf: 2_468_000 }, proofs: 'submitted' as const };

let step = 0;
const ok = (msg: string) => console.log(`  ✓ ${++step}. ${msg}`);

function client(token: string): PayrollApi & { del<T>(p: string): Promise<T> } {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status}: ${String(data.message ?? '')}`), { status: res.status });
    return data as T;
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b ?? {}),
    put: (p, b) => call('PUT', p, b ?? {}),
    del: (p) => call('DELETE', p),
  };
}

async function rejects(p: Promise<unknown>, status: number | RegExp, what: string) {
  try {
    await p;
  } catch (e) {
    const err = e as Error & { status?: number };
    if (typeof status === 'number') assert.equal(err.status, status, `${what}: expected ${status}, got ${err.status} (${err.message})`);
    else assert.match(err.message, status, what);
    return;
  }
  assert.fail(`${what}: expected a refusal`);
}

// —— Set aside / put back ——

type Backup = { createdAt: string; collections: Record<string, Document[]>; users: Record<string, Document> };

async function setAside(userIds: string[]): Promise<{ file: string; backup: Backup }> {
  const db = getDb();
  const backup: Backup = { createdAt: new Date().toISOString(), collections: {}, users: {} };
  for (const c of COLLECTIONS) backup.collections[c] = await db.collection(c).find({ org: ORG }).toArray();
  for (const u of await users().find({ org: ORG, userId: { $in: userIds } }, { projection: { _id: 0, userId: 1, ...Object.fromEntries(ACCESS_FIELDS.map((f) => [f, 1])) } }).toArray()) {
    backup.users[u.userId] = u as Document;
  }
  const file = join(tmpdir(), `sowaka-payroll-e2e-backup-${Date.now()}.json`);
  writeFileSync(file, BSON.EJSON.stringify(backup, { relaxed: false }), { mode: 0o600 });
  for (const c of COLLECTIONS) await db.collection(c).deleteMany({ org: ORG });
  return { file, backup };
}

async function putBack(backup: Backup) {
  const db = getDb();
  for (const c of COLLECTIONS) {
    await db.collection(c).deleteMany({ org: ORG });
    const docs = backup.collections[c] ?? [];
    for (const d of docs) if (d.org !== ORG) throw new Error(`refusing to restore a ${c} document outside ${ORG}`);
    if (docs.length) await db.collection(c).insertMany(docs);
  }
  for (const [userId, saved] of Object.entries(backup.users)) {
    const set: Document = {};
    const unset: Document = {};
    for (const f of ACCESS_FIELDS) {
      if (saved[f] === undefined) unset[f] = '';
      else set[f] = saved[f];
    }
    await users().updateOne({ org: ORG, userId }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) });
  }
}

// —— Comparing what the browser computed with what the server computed ——

const pickSlip = (s: Record<string, unknown>) => {
  const i = (s.inputs ?? {}) as Record<string, unknown>;
  const tds = i.tds as Record<string, unknown> | undefined;
  return {
    userId: s.userId, period: s.period, annualCtcPaise: s.annualCtcPaise, monthlyCtcPaise: s.monthlyCtcPaise,
    earnings: ((s.earnings ?? []) as Record<string, unknown>[]).map((e) => ({ code: e.code, name: e.name, hidden: e.hidden === true, fullPaise: e.fullPaise, paidPaise: e.paidPaise })),
    deductions: ((s.deductions ?? []) as Record<string, unknown>[]).map((d) => ({ key: d.key, name: d.name, amountPaise: d.amountPaise })),
    reimbursementLines: ((s.reimbursementLines ?? []) as Record<string, unknown>[]).map((r) => ({ code: r.code, amountPaise: r.amountPaise })),
    // taxablePaise is not in the plaintext API's payslip view; the TDS working below carries it.
    pfWagePaise: s.pfWagePaise, grossPaise: s.grossPaise, employeeDeductionsPaise: s.employeeDeductionsPaise,
    netPaise: s.netPaise, reimbursementsPaise: s.reimbursementsPaise, netPayablePaise: s.netPayablePaise, employerCostPaise: s.employerCostPaise,
    esiApplicable: s.esiApplicable, epf: s.epf, employer: s.employer,
    inputs: {
      workingDays: i.workingDays, lopDays: i.lopDays, attendanceLopDays: i.attendanceLopDays, payableDays: i.payableDays, lopEnteredByHr: i.lopEnteredByHr,
      overtimePaise: i.overtimePaise, overtimeEnteredByHr: i.overtimeEnteredByHr, incomeTaxPaise: i.incomeTaxPaise, incomeTaxEnteredByHr: i.incomeTaxEnteredByHr,
      componentAmounts: i.componentAmounts ?? null, reimbursementsPaise: i.reimbursementsPaise,
      tds: tds ? { regime: tds.regime, taxableIncomePaise: tds.taxableIncomePaise, annualTaxPaise: tds.annualTaxPaise, alreadyDeductedPaise: tds.alreadyDeductedPaise, monthlyTdsPaise: tds.monthlyTdsPaise, proofs: tds.proofs } : null,
    },
  };
};
const bySlipUser = (list: Record<string, unknown>[]) => new Map(list.map((s) => [String(s.userId), pickSlip(s)]));

function assertSameRun(sealed: Record<string, unknown>[], plain: Record<string, unknown>[], what: string) {
  const a = bySlipUser(sealed);
  const b = bySlipUser(plain);
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort(), `${what}: the same people`);
  for (const [userId, expected] of b) assert.deepEqual(a.get(userId), expected, `${what}: ${userId}'s slip`);
}

/** Every paise figure ≥ ₹1,000 a slip or salary carries: what must not appear in the database. */
function knownValues(slips: Record<string, unknown>[]): Set<number> {
  const out = new Set<number>();
  const add = (v: unknown) => { if (typeof v === 'number' && Number.isInteger(v) && v >= 100_000) out.add(v); };
  for (const s of Object.values(SALARIES)) { add(s.annualCtcPaise); add(Math.round(s.annualCtcPaise / 12)); Object.values(s.componentValues).forEach(add); }
  add(SALARIES.aditya.overrides.add[0].calculation.amountPaise);
  Object.values(DECLARATION.declarations).forEach(add);
  for (const s of slips) {
    for (const k of ['grossPaise', 'taxablePaise', 'employeeDeductionsPaise', 'netPaise', 'netPayablePaise', 'employerCostPaise', 'pfWagePaise', 'monthlyCtcPaise']) add(s[k]);
    for (const e of (s.earnings ?? []) as Record<string, unknown>[]) { add(e.paidPaise); add(e.fullPaise); }
    for (const d of (s.deductions ?? []) as Record<string, unknown>[]) add(d.amountPaise);
    const tds = ((s.inputs ?? {}) as Record<string, unknown>).tds as Record<string, unknown> | undefined;
    if (tds) { add(tds.annualTaxPaise); add(tds.taxableIncomePaise); add(tds.grossSalaryPaise); }
  }
  return out;
}

async function scanForPlaintext(values: Set<number>): Promise<{ docs: number; hits: string[] }> {
  const db = getDb();
  const hits: string[] = [];
  let docs = 0;
  for (const c of COLLECTIONS) {
    for (const d of await db.collection(c).find({ org: ORG }).toArray()) {
      docs++;
      const { _id, ...rest } = d;
      const text = JSON.stringify(rest);
      for (const v of values) if (new RegExp(`(?<![0-9])${v}(?![0-9])`).test(text)) hits.push(`${c}/${String(_id)} holds ${v}`);
    }
  }
  return { docs, hits };
}

// —— The check ——

async function main() {
  if (PORT === 4000 || PORT === 5173) throw new Error('Pick a port nobody is using (not 4000 or 5173)');
  await connectDb();
  const restoreAt = process.argv.indexOf('--restore');
  if (restoreAt > 0) {
    const file = process.argv[restoreAt + 1];
    await putBack(BSON.EJSON.parse(readFileSync(file, 'utf8'), { relaxed: false }) as Backup);
    console.log(`Restored ${ORG} from ${file}`);
    return;
  }

  const people = Object.fromEntries(
    await Promise.all(Object.entries(PEOPLE).map(async ([k, email]) => {
      const u = await users().findOne({ org: ORG, email }, { projection: { _id: 0, userId: 1, name: 1 } });
      if (!u) throw new Error(`${email} is not in ${ORG}`);
      return [k, u.userId];
    })),
  ) as Record<keyof typeof PEOPLE, string>;

  const server: Server = await new Promise((resolve) => { const s = app.listen(PORT, () => resolve(s)); });
  const { file, backup } = await setAside([people.hr, people.second]);
  console.log(`Set aside ${ORG}'s payroll (${COLLECTIONS.map((c) => `${backup.collections[c].length} ${c}`).join(', ')}) → ${file}`);
  const tokens: string[] = [];
  const session = async (userId: string) => {
    const token = `e2e-${randomBytes(24).toString('hex')}`;
    tokens.push(token);
    await authSessions().insertOne({ tokenHash: hashSessionToken(token), userId, createdAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000) } as never);
    return client(token);
  };
  let failed: unknown = null;
  try {
    await users().updateOne({ org: ORG, userId: people.hr }, { $set: { dashboardAccess: true, dashboardAdmin: true }, $unset: { dashboardTabs: '' } });
    await users().updateOne({ org: ORG, userId: people.second }, { $set: { dashboardAccess: true, dashboardAdmin: false, dashboardTabs: ['payruns'] } });
    const hr = await session(people.hr);
    const second = await session(people.second);
    const aditya = await session(people.aditya);

    // —— The server's own figures, while the org is plaintext ——
    console.log('\nplaintext baseline');
    const plain = hr;
    for (const [who, s] of Object.entries(SALARIES) as [keyof typeof SALARIES, (typeof SALARIES)[keyof typeof SALARIES]][]) {
      await plain.put(`/admin/payroll/salary-structures/${people[who]}`, { salaryTemplateCode: s.template, annualCtcPaise: s.annualCtcPaise, componentValues: s.componentValues, overrides: s.overrides, status: 'active', effectiveFrom: '2026-04-01' });
    }
    await plain.put(`/admin/payroll/employees/${people.aditya}/tax-declaration?fy=${FY}`, DECLARATION);
    const plainApril = await plain.post<{ run: { id: string } }>('/admin/payroll/runs', { period: APRIL });
    const plainMay = await plain.post<{ run: { id: string } }>('/admin/payroll/runs', { period: MAY });
    const mayEdits: RunEdits = {
      lopDays: { [people.sneha]: 1.5 },
      overtimePaise: { [people.rohit]: 123_456 },
      componentAmounts: { [people.aditya]: { BONUS_ONE_TIME: 7_777_700 }, [people.sneha]: { ADVANCE: 333_300 } },
    };
    await plain.post(`/admin/payroll/runs/${plainMay.run.id}/recompute`, mayEdits);
    const expectApril = (await plain.get<{ payslips: Record<string, unknown>[]; run: { totals: unknown } }>(`/admin/payroll/runs/${plainApril.run.id}`));
    const expectMay = (await plain.get<{ payslips: Record<string, unknown>[]; run: { totals: unknown } }>(`/admin/payroll/runs/${plainMay.run.id}`));
    assert.equal(expectMay.payslips.length, 3);
    const tdsOf = (slips: Record<string, unknown>[], userId: string) => ((slips.find((s) => s.userId === userId)?.inputs as Record<string, unknown>)?.tds as Record<string, unknown> | undefined);
    assert.ok(tdsOf(expectMay.payslips, people.aditya), 'the TDS engine ran for Aditya');
    assert.ok(Number(tdsOf(expectMay.payslips, people.aditya)!.alreadyDeductedPaise) >= 0);
    ok(`server computed April and May for 3 people (TDS on, old regime with declarations for Aditya, May with HR edits)`);
    // The scan used at the end must see plaintext when there is some.
    const control = await scanForPlaintext(knownValues([...expectApril.payslips, ...expectMay.payslips]));
    assert.ok(control.hits.length > 20, 'the scan finds the plaintext baseline');
    ok(`control: the database scan finds ${control.hits.length} known paise values while the org is plaintext`);
    // The plaintext baseline is the test's own data: it goes before the org is encrypted.
    await getDb().collection('payslips').deleteMany({ org: ORG });
    await getDb().collection('payroll_runs').deleteMany({ org: ORG });

    // —— Setup ——
    console.log('\nencryption');
    const hrClient = new SealedPayroll(hr);
    const passphrase = `hr-${randomBytes(12).toString('hex')}`;
    const { recoveryKey } = await hrClient.setup(passphrase);
    assert.match(recoveryKey, /^([0-9a-f]{8}-){7}[0-9a-f]{8}$/);
    let status = await hrClient.status();
    assert.equal(status.mode, 'encrypted');
    assert.equal(status.holders, 1);
    ok(`setup: encrypted, key version ${status.keyVersion}, recovery key shown once (${recoveryKey.slice(0, 8)}-…)`);
    await rejects(hr.get(`/admin/payroll/salary-structures/${people.aditya}`), 409, 'plaintext salary read');
    await rejects(hr.post('/admin/payroll/runs', { period: MAY }), 409, 'plaintext run');
    await rejects(hrClient.setup(passphrase), 409, 'second setup');
    ok('plaintext salary and run endpoints refuse the encrypted org (409)');

    // —— Unlock ——
    const fresh = new SealedPayroll(hr);
    await rejects(fresh.unlock('not the passphrase'), /Wrong passphrase/, 'wrong passphrase');
    await fresh.unlock(passphrase);
    assert.ok(fresh.unlocked);
    ok('unlock: the wrong passphrase is refused, the right one opens the data key');

    // An employee makes their key before the run, so their payslip is sealed to them too.
    const reader = new SealedPayslipReader(aditya);
    const employeePass = `emp-${randomBytes(12).toString('hex')}`;
    await reader.createKey(employeePass);

    // —— Sealed salaries and declaration ——
    for (const [who, s] of Object.entries(SALARIES) as [keyof typeof SALARIES, (typeof SALARIES)[keyof typeof SALARIES]][]) {
      await fresh.saveStructure({ userId: people[who], salaryTemplateCode: s.template, status: 'active', statutory: {}, secret: { annualCtcPaise: s.annualCtcPaise, componentValues: s.componentValues, overrides: s.overrides } }, undefined, '2026-04-01');
    }
    await hr.put(`/admin/payroll/employees/${people.aditya}/tax-declaration?fy=${FY}`, { regime: DECLARATION.regime, proofs: DECLARATION.proofs, sealed: await fresh.sealDeclaration(people.aditya, FY, DECLARATION.declarations) });
    const back = await fresh.structures();
    for (const [who, s] of Object.entries(SALARIES) as [keyof typeof SALARIES, (typeof SALARIES)[keyof typeof SALARIES]][]) {
      const got = back.find((b) => b.userId === people[who])!;
      assert.equal(got.secret.annualCtcPaise, s.annualCtcPaise);
      assert.deepEqual(got.secret.componentValues, s.componentValues);
      assert.deepEqual(got.secret.overrides, s.overrides);
      assert.equal((got.secret.revisions ?? []).length, 1, 'the CTC change is in the sealed revision history');
    }
    const declRes = await hr.get<{ declaration: { regime: string; sealed: Sealed } }>(`/admin/payroll/employees/${people.aditya}/tax-declaration?fy=${FY}`);
    assert.deepEqual(await fresh.openDeclaration({ userId: people.aditya, fy: FY, sealed: declRes.declaration.sealed }), DECLARATION.declarations);
    ok('3 sealed salaries (with per-person values, an added component, revisions) and a sealed tax declaration saved and read back');

    // —— Sealed runs ——
    const april = await fresh.buildRun(APRIL);
    assert.equal(april.payslipCount, 3);
    const mayDraft = await fresh.buildRun(MAY);
    const openRun = async (c: SealedPayroll, api: PayrollApi, runId: string) => {
      const d = await api.get<{ run: { period: string; totals: never; sealedTotals?: Sealed }; payslips: (OpenPayslip & { sealed?: Sealed })[] }>(`/admin/payroll/runs/${runId}`);
      return { totals: await c.openTotals(d.run), payslips: await Promise.all(d.payslips.map((p) => c.openPayslip(p))), raw: d };
    };
    const mayPrev = await openRun(fresh, hr, mayDraft.runId);
    const may = await fresh.buildRun(MAY, mayEdits, mayPrev.payslips);
    assert.equal(may.runId, mayDraft.runId, 'the draft is recomputed in place');
    const gotApril = await openRun(fresh, hr, april.runId);
    const gotMay = await openRun(fresh, hr, may.runId);
    assertSameRun(gotApril.payslips, expectApril.payslips, 'April');
    assertSameRun(gotMay.payslips, expectMay.payslips, 'May');
    assert.deepEqual(gotApril.totals, expectApril.run.totals, 'April totals');
    assert.deepEqual(gotMay.totals, expectMay.run.totals, 'May totals');
    for (const s of gotMay.raw.payslips) assert.ok(s.sealed && s.grossPaise === 0 && s.netPayablePaise === 0, 'the server holds zeros and a sealed blob');
    const a = tdsOf(gotMay.payslips, people.aditya)!;
    ok(`sealed April and May equal the server's calculator to the paisa: every line, total, LOP, overtime, one-time amounts, TDS (May's year-to-date includes April: ${Number(a.alreadyDeductedPaise) > 0 ? 'tax already deducted carried' : 'no tax in April'})`);

    // —— A second payroll user ——
    const secondClient = new SealedPayroll(second);
    const secondPass = `second-${randomBytes(12).toString('hex')}`;
    await secondClient.createMyKey(secondPass);
    await rejects(secondClient.unlock(secondPass), /grant you access/, 'no grant yet');
    const granted = await fresh.grantPending();
    assert.equal(granted.length, 1);
    await secondClient.unlock(secondPass);
    const secondSees = await openRun(secondClient, second, may.runId);
    assert.deepEqual(secondSees.totals, expectMay.run.totals);
    status = await fresh.status();
    assert.equal(status.holders, 2);
    ok(`granted to a second payroll user (${granted[0]}): they open the May run; status "Encrypted · ${status.holders} people hold keys"`);
    // Keep their key aside: after they lose access it must open nothing new.
    const secondStatus = await secondClient.status();
    const secondOldKey = await unwrapWithPrivateKey(secondStatus.me.wrappedDataKey!, await unlockPrivateKey(secondStatus.me.key!, secondPass));

    // —— Approval, and the employee's own payslip ——
    await hr.post(`/admin/payroll/runs/${may.runId}/submit`);
    await second.post(`/admin/payroll/runs/${may.runId}/decision`, { decision: 'approved' });
    const readerFresh = new SealedPayslipReader(aditya);
    await rejects(readerFresh.unlock('wrong passphrase!'), /Wrong passphrase/, 'employee wrong passphrase');
    await readerFresh.unlock(employeePass);
    const mine = await readerFresh.mine();
    assert.equal(mine.length, 1, 'only the released (approved) May slip');
    assert.deepEqual(pickSlip(mine[0]), pickSlip(expectMay.payslips.find((s) => s.userId === people.aditya)!), 'the employee sees the same slip');
    const plainMine = await aditya.get<{ payslips: unknown[] }>('/payslips/mine');
    assert.equal(plainMine.payslips.length, 0, 'the current app is not handed a slip of zeros');
    await rejects(aditya.get(`/payslips/${String(mine[0].id)}/html`), 409, 'server-rendered sealed payslip');
    ok('the employee opens their own approved May payslip with their key; the plaintext app endpoints never show zeros');

    // —— Removing access → rotation ——
    await hr.put(`/admin/accesses/${people.second}`, { access: false });
    status = await fresh.status();
    assert.equal(status.rotationRequired, true);
    assert.equal(status.holders, 1);
    await rejects(fresh.saveStructure({ userId: people.sneha, salaryTemplateCode: 'BELOW_TAXABLE', status: 'active', statutory: {}, secret: { annualCtcPaise: SALARIES.sneha.annualCtcPaise } }, back.find((b) => b.userId === people.sneha)!.secret), 409, 'sealed write before rotating');
    await rejects(second.get('/admin/payroll/crypto'), /→ 40[13]/, 'removed user');
    ok('removing their access drops their grant and requires rotation; sealed writes wait for it');
    const rotated = await fresh.rotate();
    assert.equal(rotated.keyVersion, 2);
    assert.equal(rotated.recoveryKey, undefined, 'the recovery key is unchanged by a rotation');
    status = await fresh.status();
    assert.equal(status.rotationRequired, false);
    assert.equal(status.keyVersion, 2);
    const env = (await hr.get<{ structures: { userId: string; sealed: Sealed }[] }>('/admin/payroll/sealed/structures')).structures.find((s) => s.userId === people.aditya)!;
    assert.equal(env.sealed.keyVersion, 2);
    await assert.rejects(open(secondOldKey, env.sealed, aadFor(ORG, 'structure', people.aditya)), 'the old key opens no rotated salary');
    const mayRaw = await hr.get<{ run: { sealedTotals: Sealed }; payslips: { userId: string; sealed: Sealed }[] }>(`/admin/payroll/runs/${may.runId}`);
    await assert.rejects(open(secondOldKey, mayRaw.run.sealedTotals, aadFor(ORG, 'run', MAY)), 'the old key opens no rotated run');
    await assert.rejects(open(secondOldKey, mayRaw.payslips[0].sealed, aadFor(ORG, 'payslip', `${MAY}:${mayRaw.payslips[0].userId}`)), 'the old key opens no rotated payslip');
    assert.deepEqual((await openRun(fresh, hr, may.runId)).totals, expectMay.run.totals, 'the new key opens it');
    const afterRotation = new SealedPayroll(hr);
    await afterRotation.unlock(passphrase);
    assert.equal((await afterRotation.structure(people.aditya))!.secret.annualCtcPaise, SALARIES.aditya.annualCtcPaise);
    assert.equal((await readerFresh.mine()).length, 1, 'the employee still opens their slip');
    ok('rotated to key version 2: the removed user\'s old key opens no salary, run or payslip; the remaining holder\'s new grant opens everything');

    // —— Recovery ——
    const lost = new SealedPayroll(hr);
    await rejects(lost.recover(createRecoveryKey(), 'a new passphrase'), /Wrong recovery key/, 'wrong recovery key');
    await rejects(hr.post('/admin/payroll/crypto/recover', { proof: 'f'.repeat(64), wrappedDataKey: 'x' }), 403, 'recovery without the key');
    const newPass = `recovered-${randomBytes(12).toString('hex')}`;
    await lost.recover(recoveryKey, newPass);
    assert.equal((await lost.structure(people.rohit))!.secret.annualCtcPaise, SALARIES.rohit.annualCtcPaise);
    await rejects(new SealedPayroll(hr).unlock(passphrase), /Wrong passphrase/, 'the old passphrase after recovery');
    await new SealedPayroll(hr).unlock(newPass);
    ok('recovered with the recovery key (the same one, after rotation): a new passphrase, everything opens; the old passphrase no longer does');

    // —— Nothing readable in the database ——
    const values = knownValues([...expectApril.payslips, ...expectMay.payslips]);
    const scan = await scanForPlaintext(values);
    assert.deepEqual(scan.hits, [], 'no known paise value is stored in clear');
    ok(`scanned ${scan.docs} stored documents for ${values.size} known paise values: none found`);
  } catch (e) {
    failed = e;
  } finally {
    await putBack(backup);
    await authSessions().deleteMany({ tokenHash: { $in: tokens.map(hashSessionToken) } });
    if (!failed && existsSync(file)) unlinkSync(file);
    server.close();
    console.log(`\nPut back ${ORG}'s payroll as it was; test sessions removed${failed ? `; backup kept at ${file}` : ''}.`);
  }
  if (failed) throw failed;
  console.log(`\nPayroll E2E check passed (${step} steps).`);
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(e);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
