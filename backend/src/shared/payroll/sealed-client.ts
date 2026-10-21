/**
 * The client half of end-to-end encrypted payroll: unlock, set up, grant,
 * rotate; open and seal salary structures; compute a month's run with the
 * shared calculator; seal the payslips. Runs in the dashboard (browser) and
 * in Node tests, against the /admin/payroll API through the `api` it is given.
 * Keys live only in this object's memory.
 */
import type { PayHead } from '../../models/payHead.model';
import type { SalaryTemplate } from '../../models/salaryTemplate.model';
import type { ResolvedRuleSet } from '../../models/statutoryRule.model';
import type { StatutorySettings } from '../../models/statutorySettings.model';
import type { StructureOverrides } from '../../models/salaryStructure.model';
import {
  aadFor, createDataKey, createRecoveryKey, createUserKeys, open, seal, sealForPerson,
  unlockPrivateKey, unwrapWithPrivateKey, unwrapWithRecovery, wrapForPublicKey, wrapWithRecovery,
  type Sealed, type StructureSecret, type UserKeyRecord,
} from './crypto';
import { calculateSalaryStructure, type SalaryCalcResult } from './salary-calculator';
import { computePayslip, type PayslipComputation } from './payroll-run.calculator';
import { applyOverrides, resolveTemplateComponents } from './resolve';
import { computeTds, fyOf, type TaxDeclarations, type TaxRegime, type TdsConfig, type TdsResult } from './tds';

export interface PayrollApi {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
}

export interface CryptoStatus {
  mode: 'plaintext' | 'encrypted';
  keyVersion: number;
  rotationRequired: boolean;
  recovery: { wrapped: string; iv: string; keyVersion: number } | null;
  me: { userId: string; key: UserKeyRecord | null; wrappedDataKey: string | null };
  members: { userId: string; name: string; hasKey: boolean; publicKey?: string; granted: boolean }[];
}

export interface CalcContext {
  org: string;
  keyVersion: number;
  company: { name: string; address: string };
  payHeads: PayHead[];
  templates: (SalaryTemplate & { id: string })[];
  settings: StatutorySettings;
  ruleSets: Record<string, ResolvedRuleSet>;
  employees: { userId: string; name: string; employeeId?: string; department?: string; designation?: string; joiningDate?: string; state: string }[];
  withSalary: string[];
  tds: { fy: string; configs: TdsConfig[]; declarations: { userId: string; regime: TaxRegime; declarations: TaxDeclarations; proofs: string }[] } | null;
}

export interface StructureEnvelope {
  userId: string;
  salaryTemplateCode?: string;
  status: 'draft' | 'active';
  statutory: { epf?: boolean; esi?: boolean; lwf?: boolean; pfActualWage?: boolean; contributeEps?: boolean };
  bonusCategory?: string;
  sealed: Sealed | null;
  updatedAt: string;
}

/** A person's salary as the dashboard edits it: the envelope plus the opened amounts. */
export interface OpenStructure extends StructureEnvelope {
  secret: StructureSecret;
}

/** One payslip opened: the same fields the plaintext API returns. */
export type OpenPayslip = Record<string, unknown> & { userId: string; period: string; inputs: Record<string, unknown> };

export interface RunInputs {
  period: string;
  workingDays: number;
  month: number;
  people: {
    userId: string;
    attendanceLopDays: number;
    attendanceDeductions: unknown[];
    paidLeaveDaysApplied: number;
    approvedLeaveDays: number;
    approvedOtHours: number;
    reimbursementsPaise: number;
    reimbursementClaimIds: string[];
    esiCoveredEarlier: boolean;
  }[];
}

export interface RunEdits {
  lopDays?: Record<string, number | null>;
  overtimePaise?: Record<string, number | null>;
  incomeTaxPaise?: Record<string, number | null>;
  componentAmounts?: Record<string, Record<string, number | null> | null>;
}

const clampLop = (n: number, days: number) => (Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n * 2) / 2, days) : 0);
const nonNeg = (n: unknown) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.round(Number(n)) : 0);

export class SealedPayroll {
  private dataKey: CryptoKey | null = null;
  private keyVersion = 0;
  private org = '';
  private ctx: CalcContext | null = null;
  private ctxPeriod = '';

  constructor(private readonly api: PayrollApi) {}

  get unlocked(): boolean {
    return this.dataKey !== null;
  }

  lock(): void {
    this.dataKey = null;
    this.ctx = null;
  }

  async status(): Promise<CryptoStatus> {
    return (await this.api.get<{ crypto: CryptoStatus }>('/admin/payroll/crypto')).crypto;
  }

  /** First person: make my key, a data key and the recovery key; turn encryption on. Returns the recovery key, shown once. */
  async setup(passphrase: string): Promise<{ recoveryKey: string }> {
    const { record, privateKey } = await createUserKeys(passphrase);
    await this.api.post('/admin/payroll/crypto/keys', { key: record });
    const dataKey = await createDataKey();
    const recoveryKey = createRecoveryKey();
    const status = (await this.api.post<{ crypto: CryptoStatus }>('/admin/payroll/crypto/setup', {
      wrappedDataKey: await wrapForPublicKey(dataKey, record.publicKey),
      recovery: await wrapWithRecovery(dataKey, recoveryKey),
    })).crypto;
    void privateKey;
    this.dataKey = dataKey;
    this.keyVersion = status.keyVersion;
    return { recoveryKey };
  }

  /** Someone else with payroll access: make my key; a key holder then grants me the data key. */
  async createMyKey(passphrase: string): Promise<CryptoStatus> {
    const { record } = await createUserKeys(passphrase);
    return (await this.api.post<{ crypto: CryptoStatus }>('/admin/payroll/crypto/keys', { key: record })).crypto;
  }

  async unlock(passphrase: string): Promise<void> {
    const s = await this.status();
    if (!s.me.key) throw new Error('You have no key yet: create one first');
    if (!s.me.wrappedDataKey) throw new Error('Waiting for someone who holds the key to grant you access');
    const priv = await unlockPrivateKey(s.me.key, passphrase);
    this.dataKey = await unwrapWithPrivateKey(s.me.wrappedDataKey, priv);
    this.keyVersion = s.keyVersion;
  }

  /** Lost passphrase: open the data key with the recovery key, make a new key, grant it to myself. */
  async recover(recoveryKey: string, newPassphrase: string): Promise<void> {
    const s = await this.status();
    if (!s.recovery) throw new Error('Encryption is not set up');
    const dataKey = await unwrapWithRecovery(s.recovery, recoveryKey);
    const { record } = await createUserKeys(newPassphrase);
    await this.api.post('/admin/payroll/crypto/keys', { key: record });
    // Granting needs a current grant; the recovery path re-grants through rotation-free self grant.
    this.dataKey = dataKey;
    this.keyVersion = s.keyVersion;
    await this.api.post('/admin/payroll/crypto/grants', { grants: [{ userId: s.me.userId, wrappedDataKey: await wrapForPublicKey(dataKey, record.publicKey) }] }).catch(() => undefined);
  }

  /** Grant the data key to every payroll user who has a key and no grant yet. */
  async grantPending(): Promise<string[]> {
    const key = this.requireKey();
    const s = await this.status();
    const pending = s.members.filter((m) => m.hasKey && !m.granted && m.publicKey);
    if (pending.length === 0) return [];
    const grants = [];
    for (const m of pending) grants.push({ userId: m.userId, wrappedDataKey: await wrapForPublicKey(key, m.publicKey!) });
    await this.api.post('/admin/payroll/crypto/grants', { grants });
    return pending.map((m) => m.name);
  }

  private requireKey(): CryptoKey {
    if (!this.dataKey) throw new Error('Salaries are locked: unlock with your passphrase');
    return this.dataKey;
  }

  async context(period?: string): Promise<CalcContext> {
    const p = period ?? '';
    if (!this.ctx || this.ctxPeriod !== p) {
      this.ctx = (await this.api.get<{ context: CalcContext }>(`/admin/payroll/sealed/context${period ? `?period=${period}` : ''}`)).context;
      this.ctxPeriod = p;
      this.org = this.ctx.org;
      this.keyVersion = this.ctx.keyVersion;
    }
    return this.ctx;
  }

  // —— Salary structures ——

  async structures(): Promise<OpenStructure[]> {
    const key = this.requireKey();
    const ctx = await this.context();
    const list = (await this.api.get<{ structures: StructureEnvelope[] }>('/admin/payroll/sealed/structures')).structures;
    const out: OpenStructure[] = [];
    for (const s of list) {
      const secret = s.sealed ? await open<StructureSecret>(key, s.sealed, aadFor(ctx.org, 'structure', s.userId)) : { annualCtcPaise: 0 };
      out.push({ ...s, secret });
    }
    return out;
  }

  async structure(userId: string): Promise<OpenStructure | null> {
    return (await this.structures()).find((s) => s.userId === userId) ?? null;
  }

  /** The breakup for a draft structure, in the browser. */
  async compute(s: Pick<OpenStructure, 'userId' | 'salaryTemplateCode' | 'statutory' | 'bonusCategory' | 'secret'>, period?: string): Promise<{ computed: SalaryCalcResult; components: ReturnType<typeof applyOverrides> }> {
    const ctx = await this.context();
    const template = ctx.templates.find((t) => t.code === s.salaryTemplateCode);
    if (!template) throw new Error('Assign a salary template first');
    const byCode = new Map(ctx.payHeads.map((h) => [h.code, h]));
    const components = applyOverrides(template.components, s.secret.overrides as StructureOverrides | undefined, byCode);
    const emp = ctx.employees.find((e) => e.userId === s.userId);
    const p = period ?? new Date().toISOString().slice(0, 7);
    const computed = calculateSalaryStructure({
      monthlyCtcPaise: Math.round(s.secret.annualCtcPaise / 12),
      payHeads: resolveTemplateComponents(components, byCode),
      componentValues: s.secret.componentValues,
      balancingComponentCode: template.balancingComponentCode,
      ruleSet: ctx.ruleSets[emp?.state ?? ''] ?? { state: emp?.state ?? '' },
      settings: ctx.settings,
      month: Number(p.slice(5)),
      period: p,
      bonusCategory: s.bonusCategory,
      statutory: { ...s.statutory, pfRestrictedWagePaise: s.secret.pfRestrictedWagePaise },
      statutoryWages: template.statutoryWages ?? undefined,
    });
    return { computed, components };
  }

  /** Seal and save. A CTC change is added to the sealed revision history. */
  async saveStructure(s: Pick<OpenStructure, 'userId' | 'salaryTemplateCode' | 'statutory' | 'bonusCategory' | 'secret' | 'status'>, previous?: StructureSecret, effectiveFrom?: string): Promise<void> {
    const key = this.requireKey();
    const ctx = await this.context();
    await this.compute(s); // refuses what doesn't resolve, as the server would
    const revisions = [...((previous?.revisions as unknown[]) ?? (s.secret.revisions as unknown[]) ?? [])];
    if ((previous?.annualCtcPaise ?? 0) !== s.secret.annualCtcPaise) {
      revisions.push({ previousCtcPaise: previous?.annualCtcPaise ?? 0, annualCtcPaise: s.secret.annualCtcPaise, effectiveFrom: effectiveFrom ?? new Date().toISOString().slice(0, 10), at: new Date().toISOString() });
    }
    const secret: StructureSecret = { ...s.secret, revisions };
    const overrides = secret.overrides as StructureOverrides | undefined;
    await this.api.put(`/admin/payroll/sealed/structures/${s.userId}`, {
      salaryTemplateCode: s.salaryTemplateCode,
      status: s.status,
      statutory: s.statutory,
      bonusCategory: s.bonusCategory,
      componentCodes: [...(overrides?.add ?? []).map((a) => a.payHeadCode), ...Object.keys(secret.componentValues ?? {})],
      sealed: await seal(key, ctx.keyVersion, secret, aadFor(ctx.org, 'structure', s.userId)),
    });
    this.ctx = null; // standard components may have become the org's own
  }

  // —— Runs ——

  async openPayslip(slip: { userId: string; period: string; sealed?: Sealed; inputs: Record<string, unknown> } & Record<string, unknown>): Promise<OpenPayslip> {
    if (!slip.sealed) return slip as OpenPayslip;
    const ctx = await this.context();
    const opened = await open<OpenPayslip>(this.requireKey(), slip.sealed, aadFor(ctx.org, 'payslip', `${slip.period}:${slip.userId}`));
    return { ...slip, ...opened, id: slip.id, inputs: { ...slip.inputs, ...(opened.inputs ?? {}) } } as OpenPayslip;
  }

  async openTotals(run: { period: string; sealedTotals?: Sealed; totals: unknown }): Promise<unknown> {
    if (!run.sealedTotals) return run.totals;
    const ctx = await this.context();
    return open(this.requireKey(), run.sealedTotals, aadFor(ctx.org, 'run', run.period));
  }

  /**
   * Compute a month for everyone with an active salary, exactly as the server
   * does for a plaintext org, and save it sealed as the draft run. `previous`
   * is the run's earlier slips (opened), so what HR typed stays unless `edits`
   * change it.
   */
  async buildRun(period: string, edits: RunEdits = {}, previous: OpenPayslip[] = []): Promise<{ runId: string; payslipCount: number }> {
    const key = this.requireKey();
    const ctx = await this.context(period);
    const inputs = (await this.api.get<{ inputs: RunInputs }>(`/admin/payroll/sealed/run-inputs?period=${period}`)).inputs;
    const structures = (await this.structures()).filter((s) => s.status === 'active');
    const prev = new Map(previous.map((p) => [p.userId, p]));
    const pick = (map: Record<string, number | null> | undefined, userId: string, kept: number | undefined) =>
      map && userId in map ? (map[userId] === null ? undefined : map[userId]!) : kept;
    const ytd = ctx.tds ? await this.ytd(period) : new Map<string, { taxable: number; tds: number }>();
    const byCode = new Map(ctx.payHeads.map((h) => [h.code, h]));
    const slips: Record<string, unknown>[] = [];
    const totals = { grossPaise: 0, employeeDeductionsPaise: 0, netPaise: 0, reimbursementsPaise: 0, employerCostPaise: 0 };
    for (const s of structures) {
      const inp = inputs.people.find((p) => p.userId === s.userId);
      const emp = ctx.employees.find((e) => e.userId === s.userId);
      const template = ctx.templates.find((t) => t.code === s.salaryTemplateCode);
      if (!inp || !emp || !template) continue;
      const before = prev.get(s.userId)?.inputs as Record<string, unknown> | undefined;
      const lopHr = pick(edits.lopDays, s.userId, before?.lopEnteredByHr ? Number(before.lopDays) : undefined);
      const otHr = pick(edits.overtimePaise, s.userId, before?.overtimeEnteredByHr ? Number(before.overtimePaise) : undefined);
      const taxHr = pick(edits.incomeTaxPaise, s.userId, before?.incomeTaxEnteredByHr ? Number(before.incomeTaxPaise) : undefined);
      let amounts: Record<string, number> = { ...((before?.componentAmounts as Record<string, number>) ?? {}) };
      const e = edits.componentAmounts?.[s.userId];
      if (e === null) amounts = {};
      else if (e) for (const [c, v] of Object.entries(e)) { if (v === null) delete amounts[c]; else amounts[c] = Math.round(v); }

      const components = resolveTemplateComponents(applyOverrides(template.components, s.secret.overrides as StructureOverrides | undefined, byCode), byCode);
      for (const code of Object.keys(amounts)) {
        const head = byCode.get(code);
        if (!head) continue;
        const i = components.findIndex((h) => h.code === code);
        const runHead = { ...(i >= 0 ? components[i] : head), calculation: { mode: 'flat_amount' as const }, active: true };
        if (i >= 0) components[i] = runHead;
        else components.push(runHead);
      }
      const ruleSet = ctx.ruleSets[emp.state] ?? { state: emp.state };
      const base = calculateSalaryStructure({
        monthlyCtcPaise: Math.round(s.secret.annualCtcPaise / 12),
        payHeads: components,
        componentValues: { ...(s.secret.componentValues ?? {}), ...amounts },
        balancingComponentCode: template.balancingComponentCode,
        ruleSet, month: inputs.month, period, bonusCategory: s.bonusCategory,
        statutory: { ...s.statutory, pfRestrictedWagePaise: s.secret.pfRestrictedWagePaise },
        settings: ctx.settings,
        statutoryWages: template.statutoryWages ?? undefined,
      });
      const lopDays = lopHr !== undefined ? clampLop(lopHr, inputs.workingDays) : inp.attendanceLopDays;
      const overtimePaise = nonNeg(otHr);
      let incomeTaxPaise = nonNeg(taxHr);
      const slipInput = { workingDays: inputs.workingDays, lopDays, overtimePaise, reimbursementsPaise: inp.reimbursementsPaise, ruleSet, month: inputs.month, statutory: s.statutory, settings: ctx.settings, esiCoveredEarlier: inp.esiCoveredEarlier, incomeTaxPaise, period };
      let slip: PayslipComputation = computePayslip(base, slipInput);
      let tds: TdsResult | undefined;
      if (taxHr === undefined && ctx.tds) {
        const decl = ctx.tds.declarations.find((d) => d.userId === s.userId);
        const config = ctx.tds.configs.find((c) => c.regime === (decl?.regime ?? ctx.settings.tds?.defaultRegime ?? 'new'));
        if (config) {
          const byType = (t: string) => base.earnings.filter((l) => l.componentType === t).reduce((a, l) => a + l.monthlyPaise, 0);
          const y = ytd.get(s.userId);
          tds = computeTds({
            config, ytdTaxablePaise: y?.taxable ?? 0, ytdTdsPaise: y?.tds ?? 0, currentTaxablePaise: slip.taxablePaise,
            futureMonthlyTaxablePaise: base.earnings.filter((l) => l.taxable !== false && !l.oneTime).reduce((a, l) => a + l.monthlyPaise, 0),
            monthsAfter: fyOf(period).monthsAfter, basicYearPaise: byType('basic') * 12, hraYearPaise: byType('hra') * 12,
            employeePfYearPaise: base.statutory.epf.employeePaise * 12, ptYearPaise: base.statutory.pt.amountPaise * 12, declarations: decl?.declarations,
          });
          incomeTaxPaise = tds.monthlyTdsPaise;
          slip = computePayslip(base, { ...slipInput, incomeTaxPaise });
        }
      }
      const plainInputs = {
        workingDays: inputs.workingDays, lopDays, attendanceLopDays: inp.attendanceLopDays, lopEnteredByHr: lopHr !== undefined,
        incomeTaxEnteredByHr: taxHr !== undefined, overtimeEnteredByHr: otHr !== undefined,
        attendanceDeductions: inp.attendanceDeductions, paidLeaveDaysApplied: inp.paidLeaveDaysApplied, payableDays: slip.payableDays,
        approvedLeaveDays: inp.approvedLeaveDays, approvedOtHours: inp.approvedOtHours, reimbursementClaimIds: inp.reimbursementClaimIds,
      };
      const full = {
        userId: s.userId, period, employeeName: emp.name, department: emp.department, employeeId: emp.employeeId, designation: emp.designation, joiningDate: emp.joiningDate,
        annualCtcPaise: s.secret.annualCtcPaise, monthlyCtcPaise: Math.round(s.secret.annualCtcPaise / 12),
        earnings: slip.earnings, deductions: slip.deductions, pfWagePaise: slip.pfWagePaise, grossPaise: slip.grossPaise, taxablePaise: slip.taxablePaise,
        employeeDeductionsPaise: slip.employeeDeductionsPaise, netPaise: slip.netPaise, reimbursementsPaise: slip.reimbursementsPaise,
        netPayablePaise: slip.netPayablePaise, employerCostPaise: slip.employerCostPaise, esiApplicable: slip.esiApplicable,
        reimbursementLines: slip.reimbursementLines, employer: slip.employer, epf: slip.epf,
        inputs: { ...plainInputs, overtimePaise, reimbursementsPaise: inp.reimbursementsPaise, incomeTaxPaise, ...(Object.keys(amounts).length ? { componentAmounts: amounts } : {}), ...(tds ? { tds } : {}) },
      };
      totals.grossPaise += slip.grossPaise;
      totals.employeeDeductionsPaise += slip.employeeDeductionsPaise;
      totals.netPaise += slip.netPaise;
      totals.reimbursementsPaise += slip.reimbursementsPaise;
      totals.employerCostPaise += slip.employerCostPaise;
      const employeeKey = (await this.status().catch(() => null))?.members.find((m) => m.userId === s.userId)?.publicKey;
      slips.push({
        userId: s.userId,
        esiApplicable: slip.esiApplicable,
        inputs: plainInputs,
        sealed: await seal(key, ctx.keyVersion, full, aadFor(ctx.org, 'payslip', `${period}:${s.userId}`)),
        ...(employeeKey ? { sealedForEmployee: await sealForPerson(full, employeeKey, aadFor(ctx.org, 'payslip', `${period}:${s.userId}`)) } : {}),
      });
    }
    if (slips.length === 0) throw new Error('No active salaries to run payroll for');
    return this.api.post('/admin/payroll/sealed/runs', {
      period,
      payslips: slips,
      sealedTotals: await seal(key, ctx.keyVersion, totals, aadFor(ctx.org, 'run', period)),
    });
  }

  /** This FY so far, per person, from earlier runs' opened slips. */
  private async ytd(period: string): Promise<Map<string, { taxable: number; tds: number }>> {
    const { firstPeriod } = fyOf(period);
    const runs = (await this.api.get<{ runs: { id: string; period: string; status: string }[] }>('/admin/payroll/runs')).runs
      .filter((r) => r.period >= firstPeriod && r.period < period && r.status !== 'rejected');
    const out = new Map<string, { taxable: number; tds: number }>();
    for (const r of runs) {
      const d = await this.api.get<{ payslips: OpenPayslip[] }>(`/admin/payroll/runs/${r.id}`);
      for (const raw of d.payslips) {
        const p = await this.openPayslip(raw as never);
        const y = out.get(p.userId) ?? { taxable: 0, tds: 0 };
        y.taxable += Number(p.taxablePaise ?? p.grossPaise ?? 0);
        y.tds += ((p.deductions as { key: string; amountPaise: number }[]) ?? []).find((x) => x.key === 'income_tax')?.amountPaise ?? 0;
        out.set(p.userId, y);
      }
    }
    return out;
  }

  /**
   * Rotate the data key (after someone loses payroll access): open every
   * sealed record with the old key, re-seal with a new one, grant it to
   * everyone still allowed, and a new recovery key (returned, shown once).
   */
  async rotate(): Promise<{ recoveryKey: string }> {
    const oldKey = this.requireKey();
    const s = await this.status();
    const ctx = await this.context();
    const next = s.keyVersion + 1;
    const newKey = await createDataKey();
    const structures = (await this.api.get<{ structures: StructureEnvelope[] }>('/admin/payroll/sealed/structures')).structures.filter((x) => x.sealed);
    const resealedStructures = [];
    for (const x of structures) {
      const aad = aadFor(ctx.org, 'structure', x.userId);
      resealedStructures.push({ userId: x.userId, sealed: await seal(newKey, next, await open(oldKey, x.sealed!, aad), aad) });
    }
    const runs = (await this.api.get<{ runs: { id: string; period: string; sealedTotals?: Sealed }[] }>('/admin/payroll/runs')).runs;
    const resealedRuns = [];
    const resealedSlips = [];
    for (const r of runs) {
      if (r.sealedTotals) {
        const aad = aadFor(ctx.org, 'run', r.period);
        resealedRuns.push({ id: r.id, sealedTotals: await seal(newKey, next, await open(oldKey, r.sealedTotals, aad), aad) });
      }
      const d = await this.api.get<{ payslips: { id: string; userId: string; period: string; sealed?: Sealed }[] }>(`/admin/payroll/runs/${r.id}`);
      for (const p of d.payslips) {
        if (!p.sealed) continue;
        const aad = aadFor(ctx.org, 'payslip', `${p.period}:${p.userId}`);
        resealedSlips.push({ id: p.id, sealed: await seal(newKey, next, await open(oldKey, p.sealed, aad), aad) });
      }
    }
    const grants = [];
    for (const m of s.members.filter((m) => m.hasKey && m.publicKey)) grants.push({ userId: m.userId, wrappedDataKey: await wrapForPublicKey(newKey, m.publicKey!) });
    const recoveryKey = createRecoveryKey();
    await this.api.post('/admin/payroll/crypto/rotate', {
      keyVersion: next, grants, recovery: await wrapWithRecovery(newKey, recoveryKey),
      structures: resealedStructures, payslips: resealedSlips, runs: resealedRuns,
    });
    this.dataKey = newKey;
    this.keyVersion = next;
    this.ctx = null;
    return { recoveryKey };
  }
}
