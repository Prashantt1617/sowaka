// Salary components and templates: what the company has, a new component
// from a plain-words description (prepared, Undo deletes it while unused),
// and a template built from components, duplicated, or changed — previewed at
// sample CTCs with the checks HR would do by hand before it is prepared.
import { payrollRuns, salaryStructures, salaryTemplates, users } from '../../config/db';
import { createPayHead, deletePayHead, PayHeadError } from '../../services/payHead.service';
import { createSalaryTemplate, deleteSalaryTemplate, previewSalaryTemplate, updateSalaryTemplate } from '../../services/salaryTemplate.service';
import { catalogWithStandard } from '../../services/standardComponents.service';
import { PayHead } from '../../models/payHead.model';
import { SalaryTemplate, SalaryTemplateComponent } from '../../models/salaryTemplate.model';
import { defineTools, num, rupees, str, SuwiContext } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { describeComputed, monthName, whyLines } from './payroll-actions';

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const codeFrom = (name: string) => norm(name).replace(/ /g, '_').toUpperCase().slice(0, 40) || 'COMPONENT';
const toPaise = (r: unknown) => (r === undefined || r === null || r === '' ? undefined : Math.round(num(r, NaN, 0) * 100));
const SAMPLE_CTCS = [3_00_000_00, 6_00_000_00, 12_00_000_00];

function calcOf(head: Pick<PayHead, 'calculation'>, isBalancing = false): string {
  if (isBalancing) return 'balance of CTC';
  const c = head.calculation;
  if (c.mode === 'flat_per_month') return `${rupees(c.amountPaise ?? 0)} a month`;
  if (c.mode === 'flat_amount') return 'amount set per person';
  return `${c.percent ?? 0}% of ${c.base === 'ctc' ? 'CTC' : c.base === 'basic' ? 'Basic' : c.baseComponentCode}`;
}

/** A calculation from Claude's plain input: {mode, percent, base, baseComponentCode, amountRupees}. */
function calculationFrom(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const mode = str(r.mode);
  if (mode === 'percentage') return { mode, percent: num(r.percent, 0, 0, 100), base: str(r.base) || 'ctc', ...(r.baseComponentCode ? { baseComponentCode: str(r.baseComponentCode).toUpperCase() } : {}) };
  if (mode === 'flat_per_month') return { mode, amountPaise: toPaise(r.amountRupees) ?? 0 };
  if (mode === 'flat_amount') return { mode };
  return undefined;
}

async function peopleOn(org: string, code: string) {
  const docs = await salaryStructures().find({ org, salaryTemplateCode: code }, { projection: { _id: 0, userId: 1, annualCtcPaise: 1 } }).toArray();
  const names = docs.length ? await users().find({ org, userId: { $in: docs.map((d) => d.userId) } }, { projection: { _id: 0, userId: 1, name: 1 } }).toArray() : [];
  const nameOf = new Map(names.map((n) => [n.userId, n.name]));
  return docs.map((d) => ({ userId: d.userId, name: nameOf.get(d.userId) ?? d.userId, annualCtcPaise: d.annualCtcPaise }));
}

/** The checks HR does by hand, at each sample CTC. */
function templateChecks(samples: { ctc: number; c: ReturnType<typeof describeComputed>; basicShare: number; overBudget: boolean }[]) {
  const out: { text: string; tone: 'info' | 'warn' }[] = [];
  const under = samples.filter((s) => s.basicShare < 50);
  if (under.length) out.push({ text: `Basic is under 50% of gross at ${under.map((s) => `${rupees(s.ctc)} (${s.basicShare.toFixed(0)}%)`).join(', ')}: the Code on Wages wants wages (Basic + DA) to be at least half of total pay, else the excess allowances count as wages for PF and gratuity.`, tone: 'warn' });
  const neg = samples.filter((s) => s.overBudget);
  if (neg.length) out.push({ text: `The balancing component goes negative at ${neg.map((s) => rupees(s.ctc)).join(', ')}: the fixed amounts add up to more than the CTC, so gross would exceed CTC.`, tone: 'warn' });
  if (!out.length) out.push({ text: 'Basic is at least half of gross and the balancing component stays positive at every sample CTC.', tone: 'info' });
  return out;
}

/**
 * Turns Claude's input into a template input for the service. A `code` or
 * `duplicateOf` that matches an existing template starts from its components;
 * given components merge in by code; `remove` drops codes.
 */
async function buildTemplate(ctx: SuwiContext, i: Record<string, unknown>) {
  const all = await salaryTemplates().find({ org: ctx.org }).toArray();
  const find = (v: unknown) => { const n = norm(v); return n ? all.find((t) => t.code.toLowerCase() === String(v).toLowerCase().trim()) ?? all.find((t) => norm(t.name) === n) : undefined; };
  const source = find(i.duplicateOf);
  const existing = source ? undefined : find(i.code) ?? (i.duplicateOf ? undefined : find(i.name));
  const base: SalaryTemplate | undefined = source ?? existing;
  const { all: catalog } = await catalogWithStandard(ctx.org);
  const byCode = new Map(catalog.map((h) => [h.code, h]));
  const comps = new Map<string, SalaryTemplateComponent>((base?.components ?? []).map((c) => [c.payHeadCode, { ...c }]));
  const missing: string[] = [];
  for (const raw of Array.isArray(i.components) ? i.components : []) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const code = str(r.payHeadCode ?? r.code).toUpperCase();
    if (!code) continue;
    if (!byCode.has(code)) { missing.push(code); continue; }
    const calc = calculationFrom(r.calculation ?? r) ?? comps.get(code)?.calculation ?? byCode.get(code)!.calculation;
    comps.set(code, { payHeadCode: code, calculation: calc as SalaryTemplateComponent['calculation'], ...(r.payslipName ? { payslipName: str(r.payslipName) } : comps.get(code)?.payslipName ? { payslipName: comps.get(code)!.payslipName } : {}) });
  }
  for (const c of Array.isArray(i.remove) ? i.remove.map((x) => String(x).toUpperCase()) : []) comps.delete(c);
  const name = str(i.name) || (source ? `${source.name} (copy)` : base?.name ?? '');
  const code = existing ? existing.code : str(i.code).toUpperCase() || codeFrom(name);
  const balancing = i.balancingComponentCode === null ? undefined : str(i.balancingComponentCode).toUpperCase() || base?.balancingComponentCode;
  const input = {
    name, code, description: i.description === undefined ? base?.description ?? undefined : str(i.description),
    components: [...comps.values()], balancingComponentCode: balancing && comps.has(balancing) ? balancing : undefined,
    epfApplyCeiling: base?.epfApplyCeiling, statutoryWages: base?.statutoryWages, overtimePay: base?.overtimePay, active: base?.active ?? true,
  };
  return { input, existing, source, missing, byCode };
}

async function sampleBreakups(ctx: SuwiContext, input: Parameters<typeof previewSalaryTemplate>[1], ctcs = SAMPLE_CTCS) {
  const out = [];
  for (const ctc of ctcs) {
    const c = await previewSalaryTemplate(ctx.userId, input, ctc);
    const basic = c.earnings.filter((l) => l.componentType === 'basic').reduce((s, l) => s + l.monthlyPaise, 0);
    out.push({ ctc, computed: c, c: describeComputed(c), basicShare: c.grossMonthlyPaise ? (basic / c.grossMonthlyPaise) * 100 : 0, overBudget: c.overBudget });
  }
  return out;
}

const describeTemplate = (t: SalaryTemplate, byCode: Map<string, PayHead>) => ({
  code: t.code, name: t.name, active: t.active,
  components: t.components.map((c) => ({ code: c.payHeadCode, name: byCode.get(c.payHeadCode)?.name ?? c.payHeadCode, category: byCode.get(c.payHeadCode)?.category, rule: calcOf(c, c.payHeadCode === t.balancingComponentCode) })),
  balancingComponent: t.balancingComponentCode ?? null,
  pfWage: t.statutoryWages?.pfComponents ? `${t.statutoryWages.pfComponents.join(' + ')} (${t.statutoryWages.pfWageMode ?? 'org setting'})` : 'each component\'s own PF flag',
  esiWage: t.statutoryWages?.esiComponents ? t.statutoryWages.esiComponents.join(' + ') : 'gross pay',
});

defineTools(
  {
    name: 'salary_components',
    area: 'payroll',
    payroll: true,
    label: () => 'Salary components',
    description: 'The company\'s salary components (pay heads): code, name, category (earning, deduction, benefit, reimbursement), type, default calculation, taxable, PF/ESI wage inclusion, FBP, monthly limit — plus the standard components it has not added yet (a template may use those directly; they are created on first use).',
    input_schema: { type: 'object', properties: { text: { type: 'string', description: 'Filter by name or code' } } },
    api: { method: 'GET', path: '/admin/payroll/pay-heads' },
    async run(ctx, i) {
      const { own, all } = await catalogWithStandard(ctx.org);
      const ownCodes = new Set(own.map((h) => h.code));
      const t = norm(i.text);
      const row = (h: PayHead) => ({
        code: h.code, name: h.name, payslipName: h.payslipName ?? h.name, category: h.category, type: h.componentType, calculation: calcOf(h),
        taxable: h.category === 'earning' ? h.taxable !== false : h.category === 'reimbursement' ? 'until bills are approved' : undefined,
        inPfWage: h.considerForEpf?.consider ? (h.considerForEpf.condition && h.considerForEpf.condition !== 'always' ? 'only under the ceiling' : true) : false,
        inEsiWage: h.considerForEsi?.consider === true, fbp: h.fbp === true || undefined,
        monthlyLimit: h.maxClaimablePaise ? rupees(h.maxClaimablePaise) : undefined, oneTime: h.recurrence === 'one_time' || undefined, active: h.active,
        standardNotAddedYet: ownCodes.has(h.code) ? undefined : true,
      });
      const rows = all.filter((h) => !t || norm(`${h.name} ${h.code} ${h.payslipName ?? ''}`).includes(t)).map(row);
      return { data: { total: rows.length, components: rows.slice(0, 60) }, links: [{ label: 'Open salary components', view: 'payheads' }] };
    },
  },
  {
    name: 'salary_templates',
    area: 'payroll',
    payroll: true,
    label: () => 'Salary templates',
    description: 'The company\'s salary templates: code, name, each component\'s rule, the balancing component, PF/ESI wage settings, and who is on each.',
    input_schema: { type: 'object', properties: { code: { type: 'string', description: 'One template\'s code or name, for its people' } } },
    api: { method: 'GET', path: '/admin/payroll/salary-templates' },
    async run(ctx, i) {
      const all = await salaryTemplates().find({ org: ctx.org }).sort({ name: 1 }).toArray();
      const { all: catalog } = await catalogWithStandard(ctx.org);
      const byCode = new Map(catalog.map((h) => [h.code, h]));
      const counts = await salaryStructures().aggregate<{ _id: string; n: number }>([{ $match: { org: ctx.org } }, { $group: { _id: '$salaryTemplateCode', n: { $sum: 1 } } }]).toArray();
      const n = new Map(counts.map((c) => [c._id, c.n]));
      const one = i.code ? all.find((t) => t.code.toLowerCase() === str(i.code).toLowerCase() || norm(t.name) === norm(i.code)) : undefined;
      return {
        data: {
          templates: (one ? [one] : all).map((t) => ({ ...describeTemplate(t, byCode), people: n.get(t.code) ?? 0 })),
          ...(one ? { peopleOnIt: (await peopleOn(ctx.org, one.code)).map((p) => ({ userId: p.userId, name: p.name, annualCtc: rupees(p.annualCtcPaise) })) } : {}),
        },
        links: [{ label: 'Open salary templates', view: 'templates' }],
      };
    },
  },
  {
    name: 'prepare_salary_component',
    area: 'payroll',
    payroll: true,
    acts: true,
    label: (i) => `Prepared: new component ${i.name ?? ''}`,
    description: 'Prepare creating a salary component from a plain-words description, mapped to its fields: category (earning | deduction | benefit | reimbursement), componentType (basic, hra, conveyance, meal_card, lta, fixed_allowance, special_allowance, medical, telephone, child_education, statutory_bonus, salary_advance, notice_pay, hold_amount, vpf, gratuity, food_coupons, other), calculation ({mode: flat_per_month, amountRupees} | {mode: percentage, percent, base: ctc|basic|component, baseComponentCode} | {mode: flat_amount} = set per person), taxable, fbp (Flexible Benefit Plan), considerForEpf/considerForEsi (in the PF/ESI wage), maxClaimableRupees (reimbursement monthly limit), payslipName, prorate, recurrence (recurring | one_time), showInPayslip. A reimbursement "taxed until bills are approved" is just category reimbursement: that is how reimbursements always work. Sowaka has no per-unit rate (per night, per day, per visit): map "₹200 a night" to flat_amount, pass the rate as statedRate, and tell HR the amount (units × rate) is entered per person on each run. Checks for a similar existing or standard component first and reports it instead of preparing (set ignoreSimilar to go ahead). Changes nothing until HR confirms; Undo deletes it while unused.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' }, code: { type: 'string', description: 'Optional; made from the name' },
        category: { type: 'string', enum: ['earning', 'deduction', 'benefit', 'reimbursement'] },
        componentType: { type: 'string' },
        calculation: { type: 'object', properties: { mode: { type: 'string', enum: ['flat_per_month', 'percentage', 'flat_amount'] }, amountRupees: { type: 'number' }, percent: { type: 'number' }, base: { type: 'string', enum: ['ctc', 'basic', 'component'] }, baseComponentCode: { type: 'string' } } },
        taxable: { type: 'boolean' }, fbp: { type: 'boolean' }, considerForEpf: { type: 'boolean' }, considerForEsi: { type: 'boolean' },
        maxClaimableRupees: { type: 'number' }, payslipName: { type: 'string' }, prorate: { type: 'boolean' }, recurrence: { type: 'string', enum: ['recurring', 'one_time'] }, showInPayslip: { type: 'boolean' },
        ignoreSimilar: { type: 'boolean' },
        statedRate: { type: 'string', description: 'A per-unit rate HR gave, e.g. "₹200 a night"; kept as a note on the card' },
      },
      required: ['name', 'category', 'componentType'],
    },
    api: { method: 'POST', path: '/admin/payroll/pay-heads' },
    async run(ctx, i) {
      const name = str(i.name, 100);
      const category = str(i.category);
      const componentType = str(i.componentType) || 'other';
      const code = str(i.code).toUpperCase() || codeFrom(name);
      const { own, all } = await catalogWithStandard(ctx.org);
      const ownCodes = new Set(own.map((h) => h.code));
      const n = norm(name);
      const words = n.split(' ').filter((w) => w.length > 3 && !['allowance', 'reimbursement', 'deduction'].includes(w));
      const similar = all.filter((h) => h.code === code || norm(h.name) === n || (words.length && words.every((w) => norm(`${h.name} ${h.payslipName ?? ''}`).includes(w))));
      if (similar.length && !i.ignoreSimilar) {
        return { data: { similar: similar.map((h) => ({ code: h.code, name: h.name, category: h.category, standardNotAddedYet: ownCodes.has(h.code) ? undefined : true, calculation: calcOf(h), monthlyLimit: h.maxClaimablePaise ? rupees(h.maxClaimablePaise) : undefined })), message: `Something like "${name}" already exists. A standard one not added yet can be used in a template as it is (it is created on first use). Ask again with ignoreSimilar if this is really a new component.` } };
      }
      const calc = calculationFrom(i.calculation) ?? { mode: 'flat_amount' };
      if (calc.mode === 'percentage' && calc.base === 'basic' && !own.some((h) => h.componentType === 'basic')) throw new Error('"% of Basic" needs a Basic component first; add Basic on Salary Components.');
      if ((componentType === 'basic' || componentType === 'hra') && own.some((h) => h.componentType === componentType)) throw new Error(`The company already has a ${componentType === 'basic' ? 'Basic' : 'House Rent Allowance'} component; there can be only one.`);
      const maxPaise = category === 'reimbursement' ? toPaise(i.maxClaimableRupees) : undefined;
      const fields: Record<string, unknown> = {
        name, code, category, componentType, calculation: calc,
        ...(i.taxable !== undefined ? { taxable: Boolean(i.taxable) } : {}), ...(i.fbp !== undefined ? { fbp: Boolean(i.fbp) } : {}),
        ...(i.considerForEpf !== undefined ? { considerForEpf: { consider: Boolean(i.considerForEpf) } } : {}), ...(i.considerForEsi !== undefined ? { considerForEsi: { consider: Boolean(i.considerForEsi) } } : {}),
        ...(maxPaise !== undefined ? { maxClaimablePaise: maxPaise } : {}), ...(i.payslipName ? { payslipName: str(i.payslipName, 100) } : {}),
        ...(i.prorate !== undefined ? { prorate: Boolean(i.prorate) } : {}), ...(i.recurrence ? { recurrence: str(i.recurrence) } : {}), ...(i.showInPayslip !== undefined ? { showInPayslip: Boolean(i.showInPayslip) } : {}),
        ...(category === 'reimbursement' ? { unclaimedHandling: 'encash_monthly', recurrence: 'recurring', showInPayslip: i.showInPayslip === undefined ? true : Boolean(i.showInPayslip) } : {}),
      };
      const calcText = calcOf({ calculation: calc as unknown as PayHead["calculation"] });
      const lines: { text: string; why?: string; tone?: 'info' | 'warn' }[] = [
        { text: `${name} (code ${code}): ${category}, type ${componentType.replace(/_/g, ' ')}, ${calcText}.`, why: category === 'reimbursement' ? 'A reimbursement is paid every month inside CTC, outside gross pay: it does not count for PF, ESI or PT.' : category === 'benefit' ? 'A benefit is an employer cost inside CTC (like gratuity); the employee does not receive it in the month.' : category === 'deduction' ? 'A deduction is taken from net pay; its amount is typed per person on the run or the salary.' : 'An earning is part of gross pay; its rule here is the default a template starts from.' },
        ...(category === 'reimbursement' ? [{ text: `Monthly limit ${maxPaise ? rupees(maxPaise) : 'none'}; paid in full and taxed until bills are approved.`, why: 'The part covered by an approved bill is tax-free; the rest is taxable salary. A later bill lowers the tax from then on.' }] : []),
        ...(category === 'earning' ? [{ text: `Taxable: ${i.taxable === false ? 'no' : 'yes'}. In the PF wage: ${i.considerForEpf ? 'yes' : 'no'}. In the ESI wage: ${i.considerForEsi ? 'yes' : 'no'}.`, why: 'Basic always counts for PF; other earnings only if ticked. ESI is on gross unless a template names its ESI components.' }] : []),
        ...(str(i.statedRate) ? [{ text: `Stated rate: ${str(i.statedRate, 100)}. Sowaka has no per-unit rate, so the amount (units × rate) is entered per person on each run.`, tone: 'info' as const }] : []),
        ...(i.fbp ? [{ text: 'Part of the Flexible Benefit Plan: the employee chooses how much of their FBP pool goes here.' }] : []),
        ...(fields.recurrence === 'one_time' ? [{ text: 'Paid once, entered on a run; never prorated and never part of the monthly CTC split.' }] : []),
        { text: 'It becomes usable on Salary Templates and per-person salaries at once; nobody is paid it until a template or salary includes it.' },
      ];
      const proposalId = await propose(ctx, {
        kind: 'create_pay_head', area: 'payroll', title: `Create salary component ${name}`,
        summary: `A new ${category} "${name}" (${calcText}${maxPaise ? `, limit ${rupees(maxPaise)} a month` : ''}). Nothing changes on anyone's pay until a template or salary uses it.`,
        lines, undoable: true,
        payload: { byUserId: ctx.userId, fields },
      });
      return { data: { prepared: true, fields: { ...fields, calculation: calcText }, note: 'Nothing is created until HR presses Confirm on the card.' }, proposalId, links: [{ label: 'Open salary components', view: 'payheads' }] };
    },
  },
  {
    name: 'preview_salary_template',
    area: 'payroll',
    payroll: true,
    label: (i) => `Template preview: ${i.name ?? i.code ?? i.duplicateOf ?? ''}`,
    description: 'Work out a salary template without saving: from a list of components, as a copy of an existing one with edits (duplicateOf + components to change + remove), or an existing template (code) with changes. Shows the breakup at ₹3 L, ₹6 L and ₹12 L (components, PF, ESI, PT, net), checks Basic is at least half of gross and the balancing component never goes negative, and lists components that do not exist yet (create them with prepare_salary_component first). Component rule: {payHeadCode, calculation: {mode: percentage, percent, base: ctc|basic|component} | {mode: flat_per_month, amountRupees} | {mode: flat_amount}}.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' }, code: { type: 'string' }, duplicateOf: { type: 'string', description: 'Existing template code or name to copy' },
        components: { type: 'array', items: { type: 'object' } }, remove: { type: 'array', items: { type: 'string' } },
        balancingComponentCode: { type: 'string', description: 'The earning that takes what CTC has left' },
        sampleCtcRupees: { type: 'array', items: { type: 'number' }, description: 'Annual CTCs to show; default 3 L, 6 L, 12 L' },
      },
    },
    api: { method: 'POST', path: '/admin/payroll/salary-templates/preview' },
    async run(ctx, i) {
      const { input, existing, source, missing, byCode } = await buildTemplate(ctx, i);
      if (missing.length) return { data: { missingComponents: missing, message: `These components do not exist yet: ${missing.join(', ')}. Create them first (prepare_salary_component) or pick from salary_components.` } };
      if (!input.components.length) throw new Error('Give the components, or a template to copy or change');
      if (!input.name) input.name = input.code;
      const ctcs = Array.isArray(i.sampleCtcRupees) && i.sampleCtcRupees.length ? i.sampleCtcRupees.map((r) => Math.round(num(r, 0, 0) * 100)).filter((x) => x > 0).slice(0, 5) : SAMPLE_CTCS;
      const samples = await sampleBreakups(ctx, input, ctcs);
      return {
        data: {
          nothingSaved: true, basedOn: source ? `copy of ${source.name}` : existing ? `change to ${existing.name}` : 'new',
          checks: templateChecks(samples),
          template: describeTemplate({ ...input, org: ctx.org, createdAt: new Date(), updatedAt: new Date() } as SalaryTemplate, byCode),
          // One compact row per sample CTC, so three of them stay well inside a tool result.
          samples: samples.map(({ ctc, c, basicShare, overBudget }) => ({
            annualCtc: rupees(ctc), monthlyCtc: c.monthlyCtc,
            earnings: c.earnings.filter((l) => l.monthly !== '₹0').map((l) => `${l.name} ${l.monthly}`).join(', '),
            ...(c.reimbursements.length ? { reimbursements: c.reimbursements.map((l) => `${l.name} ${l.monthly}`).join(', ') } : {}),
            ...(c.benefits.length ? { benefits: c.benefits.map((l) => `${l.name} ${l.monthly}`).join(', ') } : {}),
            gross: c.gross, pfEmployee: c.pf.employee, esi: typeof c.esi === 'string' ? c.esi : c.esi.employee, pt: c.pt, netBeforeTax: c.netBeforeTax,
            basicShareOfGross: `${basicShare.toFixed(0)}%`, ...(overBudget ? { balancingNegative: true } : {}),
          })),
          // Worked out on one sample CTC only, so each line says which.
          why: ((s) => whyLines(s.computed, ctx.today.slice(0, 7)).map((l) => `At ${rupees(s.ctc)} a year: ${l}`))(samples[Math.min(1, samples.length - 1)]),
        },
        links: [{ label: 'Open salary templates', view: 'templates' }],
      };
    },
  },
  {
    name: 'prepare_salary_template',
    area: 'payroll',
    payroll: true,
    acts: true,
    label: (i) => `Prepared: salary template ${i.name ?? i.code ?? ''}`,
    description: 'Prepare creating a salary template (from components, or duplicateOf an existing one with edits) or changing an existing one (its code, with components to change and remove). Same inputs as preview_salary_template; preview first. The card shows the breakup at sample CTCs, who is on the template and from when it applies; a change to a template people are on asks HR to type the number of people. Undo deletes a new template while unused, or puts a changed one back.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' }, code: { type: 'string' }, duplicateOf: { type: 'string' }, description: { type: 'string' },
        components: { type: 'array', items: { type: 'object' } }, remove: { type: 'array', items: { type: 'string' } },
        balancingComponentCode: { type: 'string' },
      },
    },
    api: { method: 'POST', path: '/admin/payroll/salary-templates' },
    async run(ctx, i) {
      const { input, existing, source, missing, byCode } = await buildTemplate(ctx, i);
      if (missing.length) return { data: { missingComponents: missing, message: `These components do not exist yet: ${missing.join(', ')}. Create them first with prepare_salary_component, then prepare the template.` } };
      if (!input.components.length) throw new Error('Give the components, or a template to copy or change');
      if (!input.name) throw new Error('Give the template a name');
      if (!existing && (await salaryTemplates().findOne({ org: ctx.org, code: input.code }))) throw new Error(`A template with code ${input.code} already exists; give another code, or name it to change it.`);
      const samples = await sampleBreakups(ctx, input);
      const checks = templateChecks(samples);
      const people = existing ? await peopleOn(ctx.org, existing.code) : [];
      const thisMonth = ctx.today.slice(0, 7);
      const thisRun = existing ? await payrollRuns().findOne({ org: ctx.org, period: thisMonth }, { projection: { status: 1 } }) : null;
      const whenText = !thisRun ? `${monthName(thisMonth)} has no run yet, so it is the first month on the new rules` : thisRun.status === "draft" ? `${monthName(thisMonth)}'s draft run picks it up when it is recalculated` : `${monthName(thisMonth)} is already ${thisRun.status === "paid" ? "submitted" : thisRun.status.replace("_", " ")} and stays as it is; the next month is the first on the new rules`;
      const sampleLine = (s: (typeof samples)[number]) => `${rupees(s.ctc)}: ${s.computed.earnings.filter((l) => l.monthlyPaise > 0).map((l) => `${l.payslipName} ${rupees(l.monthlyPaise)}`).join(', ')}; PF ${rupees(s.computed.statutory.epf.employeePaise)}, ESI ${s.computed.statutory.esi.applicable ? rupees(s.computed.statutory.esi.employeePaise) : 'none'}, PT ${rupees(s.computed.statutory.pt.amountPaise)}, net ${rupees(s.computed.netMonthlyPaise)}`;
      const lines: { text: string; why?: string; tone?: 'info' | 'warn' }[] = [
        { text: `${input.name} (${input.code}): ${input.components.map((c) => `${byCode.get(c.payHeadCode)?.name ?? c.payHeadCode} ${calcOf(c, c.payHeadCode === input.balancingComponentCode)}`).join('; ')}.`, why: input.balancingComponentCode ? `${byCode.get(input.balancingComponentCode)?.name ?? input.balancingComponentCode} takes whatever CTC has left after the other components and any employer PF/ESI placed inside CTC, so gross always reconciles to CTC.` : 'There is no balancing component, so gross is the sum of the components and may not equal CTC.' },
        ...samples.map((s) => ({ text: sampleLine(s), why: whyLines(s.computed, thisMonth).join(' ') || undefined })),
        ...checks.map((c) => ({ text: c.text, tone: c.tone })),
        ...(existing
          ? [
              { text: people.length ? `${people.length} ${people.length === 1 ? 'person is' : 'people are'} on it: ${people.slice(0, 8).map((p) => p.name).join(', ')}${people.length > 8 ? ` and ${people.length - 8} more` : ''}.` : 'Nobody is on this template yet.', tone: 'info' as const },
              { text: `Applies to every run calculated from now on: ${whenText}. Months already submitted are never worked out again.`, why: 'A template has no effective date: a run reads the template as it is when the run is calculated, and a submitted run is a record.' },
              ...(people.length ? [{ text: 'Each person keeps their CTC and their own add/remove/edit on top of the template.', why: 'The template holds the rules; per-person overrides live on the salary and are applied after it.' }] : []),
            ]
          : [{ text: `A new template${source ? ` copied from ${source.name}` : ''}; nobody is on it until assigned on Salary details (prepare_assign_salary_template).` }]),
      ];
      const title = existing ? `Change salary template ${existing.name}` : `Create salary template ${input.name}`;
      const proposalId = await propose(ctx, {
        kind: 'salary_template', area: 'payroll', title,
        summary: existing ? `${existing.name} changes for ${people.length} ${people.length === 1 ? 'person' : 'people'} from the next run calculated.` : `A new salary template ${input.name} with ${input.components.length} components. At ₹6 L a year, net before tax is ${rupees(samples[1].computed.netMonthlyPaise)} a month.`,
        lines, undoable: true, typeToConfirm: existing && people.length ? String(people.length) : undefined,
        payload: { byUserId: ctx.userId, mode: existing ? 'change' : 'create', code: input.code, input, previous: existing ? { ...existing, _id: undefined } : null },
      });
      return {
        data: { prepared: true, title, samples: samples.map((s) => ({ annualCtc: rupees(s.ctc), net: rupees(s.computed.netMonthlyPaise), basicShareOfGross: `${s.basicShare.toFixed(0)}%` })), checks, peopleAffected: people.length, typeToConfirm: existing && people.length ? String(people.length) : undefined, note: 'Nothing is saved until HR presses Confirm on the card.' },
        proposalId,
        links: [{ label: 'Open salary templates', view: 'templates' }],
      };
    },
  },
);

defineExecutor('create_pay_head', {
  async run(p) {
    const { byUserId, fields } = p.payload as { byUserId: string; fields: Record<string, unknown> };
    const head = await createPayHead(byUserId, fields as unknown as Parameters<typeof createPayHead>[1]);
    return { message: `${head.name} (${head.code}) is on Salary Components, ready for templates and salaries.`, undo: { id: head.id } };
  },
  async undo(p) {
    const { byUserId } = p.payload as { byUserId: string };
    const id = String((p.undo as { id?: string } | undefined)?.id ?? '');
    if (!id) throw new Error('The component id was not kept; delete it on Salary Components.');
    try {
      await deletePayHead(byUserId, id);
    } catch (e) {
      if (e instanceof PayHeadError && e.statusCode === 409) throw new Error(`Cannot delete it now: ${e.message}`);
      throw e;
    }
    return 'Deleted the component; nothing was using it.';
  },
});

defineExecutor('salary_template', {
  async run(p) {
    const { byUserId, mode, code, input } = p.payload as { byUserId: string; mode: 'create' | 'change'; code: string; input: Record<string, unknown> };
    if (mode === 'change') {
      const t = await updateSalaryTemplate(byUserId, code, input);
      const n = await salaryStructures().countDocuments({ org: p.org, salaryTemplateCode: t.code });
      return { message: `${t.name} updated; ${n} ${n === 1 ? 'person follows' : 'people follow'} the new rules from the next run calculated.` };
    }
    const t = await createSalaryTemplate(byUserId, input);
    return { message: `${t.name} (${t.code}) is on Salary Templates; assign it on Salary details.` };
  },
  async undo(p) {
    const { byUserId, mode, code, previous } = p.payload as { byUserId: string; mode: 'create' | 'change'; code: string; previous: SalaryTemplate | null };
    if (mode === 'create') {
      await deleteSalaryTemplate(byUserId, code); // refuses while anyone is on it
      return 'Deleted the template; nobody was on it.';
    }
    if (!previous) throw new Error('The earlier template was not kept; change it back on Salary Templates.');
    const { name, description, components, balancingComponentCode, epfApplyCeiling, statutoryWages, overtimePay, active } = previous;
    await updateSalaryTemplate(byUserId, code, { name, description: description ?? undefined, components, balancingComponentCode, epfApplyCeiling, statutoryWages: statutoryWages ?? null, overtimePay: overtimePay ?? null, active });
    return `${name} is back as it was; it applies from the next run calculated.`;
  },
});
