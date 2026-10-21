/**
 * The client half of end-to-end encrypted payroll: unlock, set up, recover,
 * grant, rotate; open and seal salary structures and tax declarations;
 * compute a month's run with the shared calculator; seal the payslips (to the
 * org's data key, and to each employee who has a key). Runs in the dashboard
 * (browser) and in Node scripts, against the API through the `api` it is
 * given. Keys live only in this object's memory. docs/PAYROLL_ENCRYPTION.md.
 */
import type { PayHead } from '../../models/payHead.model';
import type { SalaryTemplate } from '../../models/salaryTemplate.model';
import type { ResolvedRuleSet } from '../../models/statutoryRule.model';
import type { StatutorySettings } from '../../models/statutorySettings.model';
import type { StructureOverrides } from '../../models/salaryStructure.model';
import {
  aadFor, createDataKey, createRecoveryKey, createRecoveryRecord, createUserKeys, open, openForPerson, recoveryProof, seal, sealForPerson,
  unlockPrivateKey, unwrapWithPrivateKey, unwrapWithRecovery, wrapForPublicKey,
  type DeclarationSecret, type Sealed, type SealedForPerson, type StructureSecret, type UserKeyRecord,
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

export interface PublicRecovery {
  publicKey: string;
  wrappedPrivateKey: string;
  iv: string;
  wrappedDataKey: string;
  keyVersion: number;
}

export interface CryptoStatus {
  mode: 'plaintext' | 'encrypted';
  keyVersion: number;
  rotationRequired: boolean;
  recovery: PublicRecovery | null;
  /** People who hold the current data key. */
  holders: number;
  since: string | null;
  me: { userId: string; key: UserKeyRecord | null; wrappedDataKey: string | null };
  members: { userId: string; name: string; hasKey: boolean; publicKey?: string; granted: boolean }[];
}

/** A declaration row as the context carries it: plain regime and proofs, amounts sealed. */
export interface DeclarationRow {
  userId: string;
  fy: string;
  regime: TaxRegime;
  proofs: string;
  sealed?: Sealed | null;
  declarations?: TaxDeclarations;
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
  employeeKeys: { userId: string; publicKey: string }[];
  tds: { fy: string; configs: TdsConfig[]; declarations: DeclarationRow[] } | null;
}

export interface StructureStatutory {
  epf?: boolean;
  esi?: boolean;
  lwf?: boolean;
  pfActualWage?: boolean;
  contributeEps?: boolean;
  pfAccountNumber?: string;
  uan?: string;
  esiNumber?: string;
}

export interface StructureEnvelope {
  userId: string;
  employeeName?: string;
  salaryTemplateCode?: string;
  status: 'draft' | 'active';
  statutory: StructureStatutory;
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

export type RunTotals = { grossPaise: number; employeeDeductionsPaise: number; netPaise: number; reimbursementsPaise: number; employerCostPaise: number };

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
const payslipAad = (org: string, period: string, userId: string) => aadFor(org, 'payslip', `${period}:${userId}`);
const declarationAad = (org: string, userId: string, fy: string) => aadFor(org, 'declaration', `${userId}:${fy}`);

export class PayrollLockedError extends Error {
  constructor() {
    super('Payroll is locked: unlock it with your passphrase');
    this.name = 'PayrollLockedError';
  }
}

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

  get version(): number {
    return this.keyVersion;
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
    // Registering a key drops any grant I hold: check first, so a second setup can't lock me out.
    if ((await this.status()).mode === 'encrypted') throw Object.assign(new Error('Salary encryption is already set up for this organisation'), { status: 409 });
    const { record } = await createUserKeys(passphrase);
    await this.api.post('/admin/payroll/crypto/keys', { key: record });
    const dataKey = await createDataKey();
    const recoveryKey = createRecoveryKey();
    const recovery = await createRecoveryRecord(recoveryKey);
    const status = (await this.api.post<{ crypto: CryptoStatus }>('/admin/payroll/crypto/setup', {
      wrappedDataKey: await wrapForPublicKey(dataKey, record.publicKey),
      recovery: { ...recovery, wrappedDataKey: await wrapForPublicKey(dataKey, recovery.publicKey) },
    })).crypto;
    this.dataKey = dataKey;
    this.keyVersion = status.keyVersion;
    this.ctx = null;
    return { recoveryKey };
  }

  /** Someone else with payroll access: make my key; a key holder then grants me the data key. */
  async createMyKey(passphrase: string): Promise<CryptoStatus> {
    const { record } = await createUserKeys(passphrase);
    return (await this.api.post<{ crypto: CryptoStatus }>('/admin/payroll/crypto/keys', { key: record })).crypto;
  }

  async unlock(passphrase: string): Promise<CryptoStatus> {
    const s = await this.status();
    if (s.mode !== 'encrypted') throw new Error('Salary encryption is not set up');
    if (!s.me.key) throw new Error('You have no key yet: create one first');
    if (!s.me.wrappedDataKey) throw new Error('Waiting for someone who holds the key to grant you access');
    const priv = await unlockPrivateKey(s.me.key, passphrase);
    this.dataKey = await unwrapWithPrivateKey(s.me.wrappedDataKey, priv);
    this.keyVersion = s.keyVersion;
    this.ctx = null;
    return s;
  }

  /** Lost passphrase, or no grant yet (after a migration): open the data key with the recovery key, make a new key, grant it to myself. */
  async recover(recoveryKey: string, newPassphrase: string): Promise<CryptoStatus> {
    const s = await this.status();
    if (!s.recovery) throw new Error('Salary encryption is not set up');
    const dataKey = await unwrapWithRecovery(s.recovery, recoveryKey); // throws on a wrong key, before anything changes
    const { record } = await createUserKeys(newPassphrase);
    await this.api.post('/admin/payroll/crypto/keys', { key: record });
    const status = (await this.api.post<{ crypto: CryptoStatus }>('/admin/payroll/crypto/recover', {
      proof: await recoveryProof(recoveryKey),
      wrappedDataKey: await wrapForPublicKey(dataKey, record.publicKey),
    })).crypto;
    this.dataKey = dataKey;
    this.keyVersion = status.keyVersion;
    this.ctx = null;
    return status;
  }

  /** Grant the data key to payroll users who have a key and no grant yet (all of them, or those listed). Returns their names. */
  async grantPending(userIds?: string[]): Promise<string[]> {
    const key = this.requireKey();
    const s = await this.status();
    const pending = s.members.filter((m) => m.hasKey && !m.granted && m.publicKey && (!userIds || userIds.includes(m.userId)));
    if (pending.length === 0) return [];
    const grants = [];
    for (const m of pending) grants.push({ userId: m.userId, wrappedDataKey: await wrapForPublicKey(key, m.publicKey!) });
    await this.api.post('/admin/payroll/crypto/grants', { grants });
    return pending.map((m) => m.name);
  }

  private requireKey(): CryptoKey {
    if (!this.dataKey) throw new PayrollLockedError();
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

  /** Any context will do for the org and the catalog. */
  private async anyContext(): Promise<CalcContext> {
    return this.ctx ?? this.context();
  }

  // —— Salary structures ——

  async structures(): Promise<OpenStructure[]> {
    const key = this.requireKey();
    const ctx = await this.anyContext();
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

  /** The breakup for a structure (saved or a draft), in the browser. */
  async compute(s: Pick<OpenStructure, 'userId' | 'salaryTemplateCode' | 'statutory' | 'bonusCategory' | 'secret'>, period?: string): Promise<{ computed: SalaryCalcResult; components: ReturnType<typeof applyOverrides>; template: SalaryTemplate & { id: string } }> {
    const ctx = await this.anyContext();
    const template = ctx.templates.find((t) => t.code === s.salaryTemplateCode);
    if (!template) throw new Error('Assign a salary template first');
    const byCode = new Map(ctx.payHeads.map((h) => [h.code, h]));
    const overrides = s.secret.overrides as StructureOverrides | undefined;
    // What the server checks on the plaintext path, since it can't here.
    for (const c of [...(overrides?.add ?? []).map((a) => a.payHeadCode), ...(overrides?.remove ?? []), ...Object.keys(overrides?.edit ?? {}), ...Object.keys(s.secret.componentValues ?? {})]) {
      if (!byCode.has(c)) throw new Error(`"${c}" is not a salary component`);
    }
    if ((overrides?.remove ?? []).some((c) => byCode.get(c)?.componentType === 'basic')) throw new Error('Basic cannot be removed for one person');
    if (!Number.isInteger(s.secret.annualCtcPaise) || s.secret.annualCtcPaise < 0) throw new Error('CTC must be a whole amount in paise');
    const components = applyOverrides(template.components, overrides, byCode);
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
      bonusCategory: s.bonusCategory,
      statutory: { ...s.statutory, pfRestrictedWagePaise: s.secret.pfRestrictedWagePaise },
      statutoryWages: template.statutoryWages ?? undefined,
    });
    return { computed, components, template };
  }

  /** Seal and save. A CTC change is added to the sealed revision history. */
  async saveStructure(s: Pick<OpenStructure, 'userId' | 'salaryTemplateCode' | 'statutory' | 'bonusCategory' | 'secret' | 'status'>, previous?: StructureSecret, effectiveFrom?: string): Promise<StructureEnvelope> {
    const key = this.requireKey();
    const ctx = await this.anyContext();
    await this.compute(s); // refuses what doesn't resolve, as the server would
    const revisions = [...((previous?.revisions as unknown[]) ?? (s.secret.revisions as unknown[]) ?? [])];
    if ((previous?.annualCtcPaise ?? 0) !== s.secret.annualCtcPaise) {
      revisions.push({ previousCtcPaise: previous?.annualCtcPaise ?? 0, annualCtcPaise: s.secret.annualCtcPaise, effectiveFrom: effectiveFrom ?? new Date().toISOString().slice(0, 10), at: new Date().toISOString() });
    }
    const secret: StructureSecret = { ...s.secret, revisions };
    const overrides = secret.overrides as StructureOverrides | undefined;
    const saved = (await this.api.put<{ structure: StructureEnvelope }>(`/admin/payroll/sealed/structures/${s.userId}`, {
      salaryTemplateCode: s.salaryTemplateCode,
      status: s.status,
      statutory: s.statutory,
      bonusCategory: s.bonusCategory,
      componentCodes: [...(overrides?.add ?? []).map((a) => a.payHeadCode), ...Object.keys(secret.componentValues ?? {})],
      sealed: await seal(key, this.keyVersion || ctx.keyVersion, secret, aadFor(ctx.org, 'structure', s.userId)),
    })).structure;
    this.ctx = null; // standard components may have become the org's own
    return saved;
  }

  // —— Tax declarations ——

  async openDeclaration(row: { userId: string; fy: string; sealed?: Sealed | null; declarations?: TaxDeclarations }): Promise<TaxDeclarations> {
    if (!row.sealed) return row.declarations ?? {};
    const ctx = await this.anyContext();
    return (await open<DeclarationSecret>(this.requireKey(), row.sealed, declarationAad(ctx.org, row.userId, row.fy))).declarations as TaxDeclarations;
  }

  async sealDeclaration(userId: string, fy: string, declarations: TaxDeclarations): Promise<Sealed> {
    const ctx = await this.anyContext();
    const secret: DeclarationSecret = { declarations: { ...declarations } as Record<string, number | boolean> };
    return seal(this.requireKey(), this.keyVersion || ctx.keyVersion, secret, declarationAad(ctx.org, userId, fy));
  }

  // —— Runs ——

  async openPayslip<T extends { userId: string; period: string; sealed?: Sealed; inputs: Record<string, unknown> }>(slip: T): Promise<T & OpenPayslip> {
    if (!slip.sealed) return slip as T & OpenPayslip;
    const ctx = await this.anyContext();
    const opened = await open<OpenPayslip>(this.requireKey(), slip.sealed, payslipAad(ctx.org, slip.period, slip.userId));
    const id = (slip as { id?: string }).id;
    return { ...slip, ...opened, id, inputs: { ...slip.inputs, ...(opened.inputs ?? {}) } } as T & OpenPayslip;
  }

  async openTotals(run: { period: string; sealedTotals?: Sealed; totals: RunTotals }): Promise<RunTotals> {
    if (!run.sealedTotals) return run.totals;
    const ctx = await this.anyContext();
    return open<RunTotals>(this.requireKey(), run.sealedTotals, aadFor(ctx.org, 'run', run.period));
  }

  /**
   * Compute a month for everyone with an active salary, exactly as the server
   * does for a plaintext org, and save it sealed as the draft run. `previous`
   * is the run's earlier slips (opened), so what HR typed stays unless `edits`
   * change it (a null clears one back).
   */
  async buildRun(period: string, edits: RunEdits = {}, previous: OpenPayslip[] = []): Promise<{ runId: string; payslipCount: number }> {
    const key = this.requireKey();
    const ctx = await this.context(period);
    const inputs = (await this.api.get<{ inputs: RunInputs }>(`/admin/payroll/sealed/run-inputs?period=${period}`)).inputs;
    const structures = (await this.structures()).filter((s) => s.status === 'active');
    const prev = new Map(previous.map((p) => [p.userId, p]));
    const pick = (map: Record<string, number | null> | undefined, userId: string, kept: number | undefined) =>
      map && userId in map ? (map[userId] === null ? undefined : map[userId]!) : kept;
    const tdsOn = !!ctx.tds && ctx.tds.configs.length > 0;
    const ytd = tdsOn ? await this.ytd(period) : new Map<string, { taxable: number; tds: number }>();
    const declarations = new Map<string, { regime: TaxRegime; proofs: string; declarations: TaxDeclarations }>();
    if (tdsOn) for (const d of ctx.tds!.declarations) declarations.set(d.userId, { regime: d.regime, proofs: d.proofs, declarations: await this.openDeclaration(d) });
    const employeeKeys = new Map(ctx.employeeKeys.map((k) => [k.userId, k.publicKey]));
    const byCode = new Map(ctx.payHeads.map((h) => [h.code, h]));
    const slips: Record<string, unknown>[] = [];
    const totals: RunTotals = { grossPaise: 0, employeeDeductionsPaise: 0, netPaise: 0, reimbursementsPaise: 0, employerCostPaise: 0 };
    for (const s of structures) {
      const inp = inputs.people.find((p) => p.userId === s.userId);
      const emp = ctx.employees.find((e) => e.userId === s.userId);
      const template = ctx.templates.find((t) => t.code === s.salaryTemplateCode);
      if (!inp || !emp || !template) continue;
      const before = prev.get(s.userId)?.inputs as Record<string, unknown> | undefined;
      const beforeTax = before?.incomeTaxPaise ?? ((prev.get(s.userId)?.deductions as { key: string; amountPaise: number }[] | undefined) ?? []).find((d) => d.key === 'income_tax')?.amountPaise ?? 0;
      const lopHr = pick(edits.lopDays, s.userId, before?.lopEnteredByHr ? Number(before.lopDays) : undefined);
      const otHr = pick(edits.overtimePaise, s.userId, before?.overtimeEnteredByHr ? Number(before.overtimePaise) : undefined);
      const taxHr = pick(edits.incomeTaxPaise, s.userId, before?.incomeTaxEnteredByHr ? Number(beforeTax) : undefined);
      let amounts: Record<string, number> = { ...((before?.componentAmounts as Record<string, number>) ?? {}) };
      const e = edits.componentAmounts?.[s.userId];
      if (e === null) amounts = {};
      else if (e) {
        // As the server merges them: a null clears a code; only whole non-negative paise are kept.
        for (const [code, v] of Object.entries(e)) {
          const c = code.trim().toUpperCase();
          if (v === null || v === undefined) delete amounts[c];
          else if (Number.isFinite(Number(v)) && Number(v) >= 0) amounts[c] = Math.round(Number(v));
        }
      }

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
      const statutory = { ...s.statutory, pfRestrictedWagePaise: s.secret.pfRestrictedWagePaise };
      const slipInput = { workingDays: inputs.workingDays, lopDays, overtimePaise, reimbursementsPaise: inp.reimbursementsPaise, ruleSet, month: inputs.month, statutory, settings: ctx.settings, esiCoveredEarlier: inp.esiCoveredEarlier, incomeTaxPaise, period };
      let slip: PayslipComputation = computePayslip(base, slipInput);
      let tds: (TdsResult & { proofs: string }) | undefined;
      if (taxHr === undefined && tdsOn) {
        const decl = declarations.get(s.userId);
        const config = ctx.tds!.configs.find((c) => c.regime === (decl?.regime ?? ctx.settings.tds?.defaultRegime ?? 'new'));
        if (config) {
          const byType = (t: string) => base.earnings.filter((l) => l.componentType === t).reduce((a, l) => a + l.monthlyPaise, 0);
          const y = ytd.get(s.userId);
          const result = computeTds({
            config, ytdTaxablePaise: y?.taxable ?? 0, ytdTdsPaise: y?.tds ?? 0, currentTaxablePaise: slip.taxablePaise,
            futureMonthlyTaxablePaise: base.earnings.filter((l) => l.taxable !== false && !l.oneTime).reduce((a, l) => a + l.monthlyPaise, 0),
            monthsAfter: fyOf(period).monthsAfter, basicYearPaise: byType('basic') * 12, hraYearPaise: byType('hra') * 12,
            employeePfYearPaise: base.statutory.epf.employeePaise * 12, ptYearPaise: base.statutory.pt.amountPaise * 12, declarations: decl?.declarations,
          });
          tds = { ...result, proofs: decl?.proofs ?? 'none' };
          incomeTaxPaise = result.monthlyTdsPaise;
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
        earnings: slip.earnings.map((x) => ({ code: x.code, name: x.name, ...(x.hidden ? { hidden: true } : {}), calcLabel: x.calcLabel, fullPaise: x.fullPaise, paidPaise: x.paidPaise })),
        deductions: slip.deductions, pfWagePaise: slip.pfWagePaise, grossPaise: slip.grossPaise, taxablePaise: slip.taxablePaise,
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
      const employeeKey = employeeKeys.get(s.userId);
      const aad = payslipAad(ctx.org, period, s.userId);
      slips.push({
        userId: s.userId,
        esiApplicable: slip.esiApplicable,
        inputs: plainInputs,
        sealed: await seal(key, ctx.keyVersion, full, aad),
        ...(employeeKey ? { sealedForEmployee: await sealForPerson(full, employeeKey, aad) } : {}),
      });
    }
    if (slips.length === 0) throw new Error('No active salaries to run payroll for');
    return this.api.post('/admin/payroll/sealed/runs', {
      period,
      payslips: slips,
      sealedTotals: await seal(key, ctx.keyVersion, totals, aadFor(ctx.org, 'run', period)),
    });
  }

  /** This FY so far, per person, from earlier runs' opened slips (runs not rejected, before `period`). */
  private async ytd(period: string): Promise<Map<string, { taxable: number; tds: number }>> {
    const { firstPeriod } = fyOf(period);
    const runs = (await this.api.get<{ runs: { id: string; period: string; status: string }[] }>('/admin/payroll/runs')).runs
      .filter((r) => r.period >= firstPeriod && r.period < period && r.status !== 'rejected');
    const out = new Map<string, { taxable: number; tds: number }>();
    for (const r of runs) {
      const d = await this.api.get<{ payslips: (OpenPayslip & { sealed?: Sealed })[] }>(`/admin/payroll/runs/${r.id}`);
      for (const raw of d.payslips) {
        const p = await this.openPayslip(raw);
        const y = out.get(p.userId) ?? { taxable: 0, tds: 0 };
        y.taxable += Number(p.taxablePaise ?? p.grossPaise ?? 0);
        y.tds += ((p.deductions as { key: string; amountPaise: number }[]) ?? []).find((x) => x.key === 'income_tax')?.amountPaise ?? 0;
        out.set(p.userId, y);
      }
    }
    return out;
  }

  /**
   * Rotate the data key (after someone loses payroll access, or on demand):
   * open every sealed record with the old key, re-seal with a new one, grant
   * it to everyone still allowed and wrap it to the recovery public key. With
   * `newRecoveryKey` the recovery key is replaced too (returned, shown once).
   */
  async rotate(opts: { newRecoveryKey?: boolean } = {}): Promise<{ recoveryKey?: string; keyVersion: number }> {
    const oldKey = this.requireKey();
    const s = await this.status();
    if (!s.recovery) throw new Error('Salary encryption is not set up');
    const ctx = await this.anyContext();
    const next = s.keyVersion + 1;
    const newKey = await createDataKey();
    const reseal = async (sealed: Sealed, aad: string) => seal(newKey, next, await open(oldKey, sealed, aad), aad);
    const structures = (await this.api.get<{ structures: StructureEnvelope[] }>('/admin/payroll/sealed/structures')).structures.filter((x) => x.sealed);
    const resealedStructures = [];
    for (const x of structures) resealedStructures.push({ userId: x.userId, sealed: await reseal(x.sealed!, aadFor(ctx.org, 'structure', x.userId)) });
    const runs = (await this.api.get<{ runs: { id: string; period: string; sealedTotals?: Sealed }[] }>('/admin/payroll/runs')).runs;
    const resealedRuns = [];
    const resealedSlips = [];
    for (const r of runs) {
      if (r.sealedTotals) resealedRuns.push({ id: r.id, sealedTotals: await reseal(r.sealedTotals, aadFor(ctx.org, 'run', r.period)) });
      const d = await this.api.get<{ payslips: { id: string; userId: string; period: string; sealed?: Sealed }[] }>(`/admin/payroll/runs/${r.id}`);
      for (const p of d.payslips) if (p.sealed) resealedSlips.push({ id: p.id, sealed: await reseal(p.sealed, payslipAad(ctx.org, p.period, p.userId)) });
    }
    const decl = (await this.api.get<{ declarations: { userId: string; fy: string; sealed: Sealed }[] }>('/admin/payroll/sealed/tax-declarations')).declarations;
    const resealedDecl = [];
    for (const d of decl) resealedDecl.push({ userId: d.userId, fy: d.fy, sealed: await reseal(d.sealed, declarationAad(ctx.org, d.userId, d.fy)) });
    const grants = [];
    for (const m of s.members.filter((m) => m.hasKey && m.publicKey)) grants.push({ userId: m.userId, wrappedDataKey: await wrapForPublicKey(newKey, m.publicKey!) });
    let recoveryKey: string | undefined;
    let recovery: Record<string, unknown>;
    if (opts.newRecoveryKey) {
      recoveryKey = createRecoveryKey();
      const record = await createRecoveryRecord(recoveryKey);
      recovery = { ...record, wrappedDataKey: await wrapForPublicKey(newKey, record.publicKey) };
    } else {
      recovery = { wrappedDataKey: await wrapForPublicKey(newKey, s.recovery.publicKey) };
    }
    await this.api.post('/admin/payroll/crypto/rotate', {
      keyVersion: next, grants, recovery,
      structures: resealedStructures, payslips: resealedSlips, runs: resealedRuns, declarations: resealedDecl,
    });
    this.dataKey = newKey;
    this.keyVersion = next;
    this.ctx = null;
    return { recoveryKey, keyVersion: next };
  }
}

/**
 * An employee's side (the app's job; here so the e2e check can drive it and
 * the app has a reference): a key their payslips are sealed to, and opening
 * their own sealed payslips with it.
 */
export class SealedPayslipReader {
  private privateKey: CryptoKey | null = null;

  constructor(private readonly api: PayrollApi) {}

  async key(): Promise<UserKeyRecord | null> {
    return (await this.api.get<{ key: UserKeyRecord | null }>('/payslips/key')).key;
  }

  /** Make (or replace) my key. Payslips from the next run on are sealed to it; older ones stay with the old key. */
  async createKey(passphrase: string): Promise<void> {
    const { record, privateKey } = await createUserKeys(passphrase);
    await this.api.put('/payslips/key', { key: record });
    this.privateKey = privateKey;
  }

  async unlock(passphrase: string): Promise<void> {
    const record = await this.key();
    if (!record) throw new Error('No payslip key yet');
    this.privateKey = await unlockPrivateKey(record, passphrase);
  }

  /** My released payslips, opened. */
  async mine(): Promise<OpenPayslip[]> {
    if (!this.privateKey) throw new PayrollLockedError();
    const res = await this.api.get<{ payslips: { id: string; org: string; userId: string; period: string; runStatus: string; sealedForEmployee: SealedForPerson }[] }>('/payslips/mine/sealed');
    const out: OpenPayslip[] = [];
    for (const p of res.payslips) {
      // The AAD names the org, period and person, so a slip moved to someone else's record won't open.
      const opened = await openForPerson<OpenPayslip>(p.sealedForEmployee, this.privateKey, payslipAad(p.org, p.period, p.userId));
      out.push({ ...opened, id: p.id, runStatus: p.runStatus });
    }
    return out;
  }
}
