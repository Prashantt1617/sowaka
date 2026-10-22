// Payroll › Salary Components — the org's reusable component catalog, split across
// four category tabs (Earnings / Deductions / Benefits / Reimbursements). Columns
// mirror the Zoho Payroll salary-components screens.
//
// Every tab is live through /admin/payroll/pay-heads, per org: earnings
// (Basic, HRA, Food Coupon, Special, Fixed, Conveyance, LTA, Medical,
// Telephone, Children Education, Statutory Bonus, custom allowances and
// one-time Bonus), deductions, employer benefits and reimbursements.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import { createPayHead, deletePayHead, listPayHeads, listSalaryTemplates, rupeesToPaise, updatePayHead } from '../../services/payroll';
import type { CalculationBasis, PayHeadDTO, PayHeadInput } from '../../services/payroll';
import { Card, ListPending, LoadingFigure } from '../ui';
import type { LoadState } from '../ui';
import { IconPlus } from '../icons';
import { CloseButton } from '../drawers/shell';
import * as L from './look';
import './look.css';

type Cat = 'earning' | 'deduction' | 'benefit' | 'reimbursement';
type Status = 'Active' | 'Inactive';

const CATEGORIES: { key: Cat; label: string }[] = [
  { key: 'earning', label: 'Earnings' },
  { key: 'deduction', label: 'Deductions' },
  { key: 'benefit', label: 'Benefits' },
  { key: 'reimbursement', label: 'Reimbursements' },
];

// —— Rows, all from the server ————————————————————————————————————————
// Every component on every tab is a real pay head, read from and saved to
// /admin/payroll/pay-heads for the signed-in org. Nothing is captured locally.
type EarningRow = { name: string; type: string; calc: string; epf: string; esi: string; fbp?: boolean; status: Status; live: PayHeadDTO };
type DeductionKind = 'food_coupons' | 'hold_amount' | 'salary_advance' | 'notice_pay' | 'vpf' | 'other';
type DeductionRow = { name: string; type: string; frequency: string; status: Status; kind: DeductionKind; live?: PayHeadDTO };
type BenefitRow = { name: string; type: string; calc: string; status: Status; live: PayHeadDTO };
type ReimbRow = { name: string; type: string; max: string; status: Status; live: PayHeadDTO };

const DEDUCTION_KINDS = new Set<string>(['food_coupons', 'hold_amount', 'salary_advance', 'notice_pay', 'vpf', 'other']);
const deductionTypeLabel = (kind: string) =>
  kind === 'food_coupons' ? 'Food Coupon Deduction' : kind === 'notice_pay' ? 'Notice Pay Deduction' : kind === 'vpf' ? 'Voluntary Provident Fund' : 'Other Deductions';
function rowFromDeductionHead(ph: PayHeadDTO): DeductionRow {
  const kind = (DEDUCTION_KINDS.has(ph.componentType) ? ph.componentType : 'other') as DeductionKind;
  return {
    name: ph.payslipName ?? ph.name, type: deductionTypeLabel(kind),
    frequency: ph.recurrence === 'recurring' ? 'Recurring' : 'One Time',
    status: ph.active ? 'Active' : 'Inactive', kind, live: ph,
  };
}
/** A pay-head code from a name, unique among the org's codes: "Hold Amount" -> HOLD_AMOUNT. */
function codeFor(name: string, taken: Set<string>): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 34) || 'COMPONENT';
  let code = base;
  for (let i = 2; taken.has(code); i++) code = `${base}_${i}`;
  return code;
}

// —— Per-earning-type spec ————————————————————————————————————————————
// Every earning renders from one form; only these knobs differ by type.
type Fbp = 'none' | 'optional' | 'forced';
/** A setting an earning type pins: shown ticked, can't be unticked. */
type FixedKey = 'partOfStructure' | 'taxable' | 'proRata' | 'epf' | 'esi' | 'showInPayslip';
type Spec = {
  nature: 'fixed' | 'variable';
  calcBase: 'ctc' | 'basic' | null; // null → no Calculation Type (FBP or variable)
  fbp: Fbp;
  epfSubChoice: boolean; // reveal Always / PF<25k when EPF is on
  taxDeductionPref: boolean; // variable bonus only
  fixed?: FixedKey[]; // ticked and locked; the server pins the same (FIXED_EARNING_SETTINGS)
  hideFbp?: boolean; // no "Include this as a Flexible Benefit Plan component" on the form
  /** May be set per employee (the amount is entered on each person's salary). */
  perPerson?: boolean;
  /** The percentage a new one starts at. */
  defaultPercent?: string;
};
const ALLOWANCE: Spec = { nature: 'fixed', calcBase: 'basic', fbp: 'optional', epfSubChoice: true, taxDeductionPref: false, perPerson: true };
const SPECS: Record<string, Spec> = {
  // Basic: everything ticked is fixed, PF counted always (no ₹25,000 condition).
  Basic: { nature: 'fixed', calcBase: 'ctc', fbp: 'none', epfSubChoice: true, taxDeductionPref: false, fixed: ['partOfStructure', 'taxable', 'proRata', 'epf', 'esi', 'showInPayslip'] },
  'House Rent Allowance': { nature: 'fixed', calcBase: 'basic', fbp: 'optional', epfSubChoice: true, taxDeductionPref: false, fixed: ['partOfStructure', 'taxable', 'showInPayslip'] },
  'Food Coupon': { nature: 'fixed', calcBase: null, fbp: 'forced', epfSubChoice: false, taxDeductionPref: false, fixed: ['partOfStructure', 'taxable', 'showInPayslip'], hideFbp: true },
  'Special Allowance': { ...ALLOWANCE, fbp: 'none' },
  'Fixed Allowance': { ...ALLOWANCE, fbp: 'none' },
  'Conveyance Allowance': ALLOWANCE,
  'Leave Travel Allowance': ALLOWANCE,
  'Medical Allowance': ALLOWANCE,
  'Telephone Allowance': ALLOWANCE,
  'Children Education Allowance': ALLOWANCE,
  'Statutory Bonus': { nature: 'fixed', calcBase: 'basic', fbp: 'none', epfSubChoice: false, taxDeductionPref: false, defaultPercent: '8.33' },
  'Custom Allowance': ALLOWANCE,
  Bonus: { nature: 'variable', calcBase: null, fbp: 'none', epfSubChoice: false, taxDeductionPref: true, fixed: ['taxable', 'showInPayslip'], perPerson: true },
};
const DEFAULT_SPEC: Spec = ALLOWANCE;
const specFor = (type: string): Spec => SPECS[type] ?? DEFAULT_SPEC;
const ADD_TYPES = Object.keys(SPECS);
const isFixed = (type: string, key: FixedKey) => specFor(type).fixed?.includes(key) ?? false;

// —— Earning types: saved to and read from the pay-heads API ——————————————
// `single`: an org holds one of these, under a fixed code. Others get a code from their name.
type EarningComponentType = 'basic' | 'hra' | 'meal_card' | 'special_allowance' | 'fixed_allowance' | 'conveyance' | 'lta' | 'medical' | 'telephone' | 'child_education' | 'statutory_bonus' | 'other';
const LIVE_TYPES: Record<string, { componentType: EarningComponentType; code?: string; single: boolean; recurrence?: 'recurring' | 'one_time' }> = {
  Basic: { componentType: 'basic', code: 'BASIC', single: true },
  'House Rent Allowance': { componentType: 'hra', code: 'HRA', single: true },
  'Food Coupon': { componentType: 'meal_card', single: false },
  'Special Allowance': { componentType: 'special_allowance', single: false },
  'Fixed Allowance': { componentType: 'fixed_allowance', single: false },
  'Conveyance Allowance': { componentType: 'conveyance', single: false },
  'Leave Travel Allowance': { componentType: 'lta', single: false },
  'Medical Allowance': { componentType: 'medical', single: false },
  'Telephone Allowance': { componentType: 'telephone', single: false },
  'Children Education Allowance': { componentType: 'child_education', single: false },
  'Statutory Bonus': { componentType: 'statutory_bonus', single: false },
  'Custom Allowance': { componentType: 'other', single: false, recurrence: 'recurring' },
  Bonus: { componentType: 'other', single: false, recurrence: 'one_time' },
};
const LIVE_ORDER = ['basic', 'hra', 'meal_card', 'special_allowance', 'fixed_allowance', 'conveyance', 'lta', 'medical', 'telephone', 'child_education', 'statutory_bonus', 'other'];
const typeOfLive = (ph: PayHeadDTO) => {
  if (ph.componentType === 'other') return ph.recurrence === 'one_time' ? 'Bonus' : 'Custom Allowance';
  return Object.entries(LIVE_TYPES).find(([, t]) => t.componentType === ph.componentType)?.[0] ?? 'Custom Allowance';
};

function rupeesText(paise: number | undefined): string {
  return Math.round((paise ?? 0) / 100).toLocaleString('en-IN');
}
function calcText(c: CalculationBasis): string {
  if (c.mode === 'percentage') return `Fixed; ${c.percent ?? 0}% of ${c.base === 'ctc' ? 'CTC' : c.base === 'basic' ? 'Basic' : c.baseComponentCode ?? 'component'}`;
  if (c.mode === 'flat_per_month') return `Fixed; ${rupeesText(c.amountPaise)} per month`;
  return 'Set per employee';
}
function rowFromPayHead(ph: PayHeadDTO): EarningRow {
  const epf = ph.considerForEpf?.consider
    ? ph.considerForEpf.condition && ph.considerForEpf.condition !== 'always' ? 'Yes (If PF Wage < 25k)' : 'Yes'
    : 'No';
  return {
    name: ph.name, type: typeOfLive(ph), calc: calcText(ph.calculation), epf,
    esi: ph.considerForEsi?.consider ? 'Yes' : 'No', fbp: ph.fbp === true,
    status: ph.active ? 'Active' : 'Inactive', live: ph,
  };
}
type CalcChoice = 'flat' | 'percentage' | 'per_person';
type EForm = {
  id?: string; // the saved pay head
  code?: string;
  isNew: boolean;
  associated: boolean; // already used by a template → only Name + Amount/% editable
  type: string;
  name: string;
  payslipName: string;
  calcMode: CalcChoice;
  amount: string;
  percent: string;
  active: boolean;
  partOfStructure: boolean;
  taxable: boolean;
  proRata: boolean;
  fbp: boolean;
  fbpRestrict: boolean;
  taxPref: 'subsequent' | 'same';
  epf: boolean;
  epfWhen: 'always' | 'pfCeiling';
  esi: boolean;
  showInPayslip: boolean;
};

function blankEarning(type: string): EForm {
  const spec = specFor(type);
  return {
    isNew: true, associated: false, type, name: '', payslipName: '',
    calcMode: spec.nature === 'variable' ? 'per_person' : spec.defaultPercent ? 'percentage' : 'flat', amount: '0', percent: spec.defaultPercent ?? '50', active: true,
    partOfStructure: spec.nature === 'fixed', taxable: true, proRata: spec.nature === 'fixed',
    fbp: spec.fbp === 'forced', fbpRestrict: spec.fbp === 'forced', taxPref: 'subsequent',
    epf: isFixed(type, 'epf'), epfWhen: 'always', esi: isFixed(type, 'esi'), showInPayslip: true,
  };
}
function formFromPayHead(ph: PayHeadDTO, associated: boolean): EForm {
  const type = typeOfLive(ph);
  const c = ph.calculation;
  const pick = (key: FixedKey, stored: boolean | undefined, fallback: boolean) => (isFixed(type, key) ? true : stored ?? fallback);
  return {
    id: ph.id, code: ph.code, isNew: false, associated, type, name: ph.name, payslipName: ph.payslipName ?? ph.name,
    calcMode: c.mode === 'percentage' ? 'percentage' : c.mode === 'flat_amount' ? 'per_person' : 'flat',
    amount: c.mode === 'percentage' ? '0' : String((c.amountPaise ?? 0) / 100),
    percent: c.mode === 'percentage' ? String(c.percent ?? 50) : '50',
    active: ph.active,
    partOfStructure: pick('partOfStructure', ph.partOfStructure, true),
    taxable: pick('taxable', ph.taxable, true),
    proRata: pick('proRata', ph.prorate, true),
    fbp: ph.fbp === true || specFor(type).fbp === 'forced', fbpRestrict: false, taxPref: 'subsequent',
    epf: pick('epf', ph.considerForEpf?.consider, false),
    epfWhen: isFixed(type, 'epf') ? 'always' : ph.considerForEpf?.condition && ph.considerForEpf.condition !== 'always' ? 'pfCeiling' : 'always',
    esi: pick('esi', ph.considerForEsi?.consider, false),
    showInPayslip: pick('showInPayslip', ph.showInPayslip, true),
  };
}
function inputFromForm(f: EForm, code: string): PayHeadInput {
  const live = LIVE_TYPES[f.type] ?? LIVE_TYPES['Custom Allowance'];
  const spec = specFor(f.type);
  const base = spec.calcBase === 'ctc' ? 'ctc' : 'basic';
  const calculation: CalculationBasis =
    f.calcMode === 'per_person' && (spec.perPerson || spec.nature === 'variable')
      ? { mode: 'flat_amount' }
      : f.calcMode === 'percentage' && spec.calcBase
        ? { mode: 'percentage', percent: Number(f.percent) || 0, base }
        : { mode: 'flat_per_month', amountPaise: rupeesToPaise(f.amount || '0') };
  return {
    name: f.name.trim(),
    code,
    category: 'earning',
    componentType: live.componentType,
    calculation,
    payslipName: f.payslipName.trim(),
    partOfStructure: f.partOfStructure,
    taxable: f.taxable,
    prorate: f.proRata,
    fbp: f.fbp,
    considerForEpf: { consider: f.epf, ...(f.epf ? { condition: f.epfWhen === 'pfCeiling' ? 'if_pf_wage_below_ceiling' : 'always' } : {}) },
    considerForEsi: { consider: f.esi },
    showInPayslip: f.showInPayslip,
    recurrence: live.recurrence ?? 'recurring',
    active: f.active,
  };
}

// —— Deduction form ————————————————————————————————————————————————————
type DForm = {
  id?: string; // the saved pay head, once it exists
  code?: string;
  kind: DeductionKind;
  isNew: boolean;
  associated: boolean; // once associated, only Name in Payslip is editable
  type: string;
  payslipName: string;
  frequency: 'one_time' | 'recurring';
  active: boolean;
};
function formFromDeduction(r: DeductionRow, associated: boolean): DForm {
  return {
    id: r.live?.id, code: r.live?.code, kind: r.kind, isNew: false, associated, type: r.type, payslipName: r.name,
    frequency: r.frequency === 'Recurring' ? 'recurring' : 'one_time', active: r.status === 'Active',
  };
}
function blankDeduction(): DForm {
  return { kind: 'other', isNew: true, associated: false, type: 'Other Deductions', payslipName: '', frequency: 'one_time', active: true };
}
function deductionInput(f: DForm, code: string): PayHeadInput {
  const name = f.payslipName.trim();
  return {
    name, payslipName: name, code, category: 'deduction', componentType: f.kind,
    calculation: { mode: 'flat_amount' }, // the amount is set per person
    recurrence: f.frequency, active: f.active,
  };
}

// —— Benefit form ——————————————————————————————————————————————————————
// Employer-paid benefits inside CTC (Gratuity, an employer NPS share…).
const BENEFIT_PLANS: { label: string; componentType: 'gratuity' | 'other'; percent?: string }[] = [
  { label: 'Gratuity', componentType: 'gratuity', percent: '4.81' },
  { label: 'Employer NPS Contribution', componentType: 'other', percent: '10' },
  { label: 'Other Employer Benefit', componentType: 'other' },
];
type BForm = {
  id?: string;
  code?: string;
  isNew: boolean;
  associated: boolean; // once on a template, only Name in Payslip + amount editable
  plan: string;
  payslipName: string;
  calcMode: CalcChoice;
  percent: string;
  amount: string;
  proRata: boolean;
  showInPayslip: boolean;
  active: boolean;
};
const planOf = (ph: PayHeadDTO) => (ph.componentType === 'gratuity' ? 'Gratuity' : /nps/i.test(ph.name) ? 'Employer NPS Contribution' : 'Other Employer Benefit');
function rowFromBenefitHead(ph: PayHeadDTO): BenefitRow {
  return { name: ph.payslipName ?? ph.name, type: planOf(ph), calc: calcText(ph.calculation), status: ph.active ? 'Active' : 'Inactive', live: ph };
}
function formFromBenefit(ph: PayHeadDTO, associated: boolean): BForm {
  const c = ph.calculation;
  return {
    id: ph.id, code: ph.code, isNew: false, associated, plan: planOf(ph), payslipName: ph.payslipName ?? ph.name,
    calcMode: c.mode === 'percentage' ? 'percentage' : c.mode === 'flat_amount' ? 'per_person' : 'flat',
    percent: String(c.percent ?? 4.81), amount: String((c.amountPaise ?? 0) / 100),
    proRata: ph.prorate === true, showInPayslip: ph.showInPayslip !== false, active: ph.active,
  };
}
function blankBenefit(): BForm {
  return { isNew: true, associated: false, plan: '', payslipName: '', calcMode: 'percentage', percent: '4.81', amount: '0', proRata: false, showInPayslip: true, active: true };
}
function benefitInput(f: BForm, code: string): PayHeadInput {
  const plan = BENEFIT_PLANS.find((p) => p.label === f.plan) ?? BENEFIT_PLANS[2];
  const name = f.payslipName.trim();
  return {
    name, payslipName: name, code, category: 'benefit', componentType: plan.componentType,
    calculation: f.calcMode === 'percentage'
      ? { mode: 'percentage', percent: Number(f.percent) || 0, base: 'basic' }
      : f.calcMode === 'per_person' ? { mode: 'flat_amount' } : { mode: 'flat_per_month', amountPaise: rupeesToPaise(f.amount || '0') },
    prorate: f.proRata, showInPayslip: f.showInPayslip, recurrence: 'recurring', active: f.active,
  };
}

// —— Reimbursement form ————————————————————————————————————————————————
const REIMB_TYPES = [
  'Fuel Reimbursement', 'Driver Reimbursement', 'Vehicle Maintenance Reimbursement', 'Telephone Reimbursement',
  'Leave Travel Allowance', 'Books and Periodicals Reimbursement', 'Internet Reimbursement', 'Club Reimbursement',
  'Entertainment Reimbursement', 'Gadget Reimbursement', 'Business Development Expense Reimbursement',
  'Helper Reimbursement', 'Children Education Reimbursement', 'Hostel Expenditure Reimbursement',
  'Research Reimbursement', 'Uniform Reimbursement',
];
type RForm = {
  id?: string;
  code?: string;
  isNew: boolean;
  associated: boolean; // once associated, only Name in Payslip + Amount editable
  type: string;
  payslipName: string;
  fbp: boolean;
  fbpRestrict: boolean;
  unclaimed: 'carry_forward' | 'encash_monthly';
  amount: string;
  showInPayslip: boolean;
  active: boolean;
};
// Reimbursement types that start with the Flexible Benefit Plan box unticked.
const NO_PRETICK_REIMB = new Set(['Fuel Reimbursement', 'Internet Reimbursement']);
function rowFromReimbHead(ph: PayHeadDTO): ReimbRow {
  return { name: ph.payslipName ?? ph.name, type: ph.name, max: `₹${rupeesText(ph.maxClaimablePaise)}`, status: ph.active ? 'Active' : 'Inactive', live: ph };
}
function formFromReimbursement(ph: PayHeadDTO, associated: boolean): RForm {
  return {
    id: ph.id, code: ph.code, isNew: false, associated, type: ph.name, payslipName: ph.payslipName ?? ph.name, fbp: ph.fbp === true, fbpRestrict: false,
    unclaimed: ph.unclaimedHandling ?? 'carry_forward', amount: String((ph.maxClaimablePaise ?? 0) / 100),
    showInPayslip: ph.showInPayslip !== false, active: ph.active,
  };
}
function blankReimbursement(): RForm {
  return { isNew: true, associated: false, type: '', payslipName: '', fbp: true, fbpRestrict: false, unclaimed: 'carry_forward', amount: '0', showInPayslip: true, active: true };
}
function reimbursementInput(f: RForm, code: string): PayHeadInput {
  return {
    name: f.type.trim(), payslipName: f.payslipName.trim(), code, category: 'reimbursement', componentType: 'other',
    // Paid every month at the person's amount, or this monthly limit.
    calculation: { mode: 'flat_amount' },
    maxClaimablePaise: rupeesToPaise(f.amount || '0'), fbp: f.fbp, unclaimedHandling: f.unclaimed,
    showInPayslip: f.showInPayslip, recurrence: 'recurring', active: f.active,
  };
}

export function PayHeadMaster() {
  const { flash } = useStore();
  const [heads, setHeads] = useState<PayHeadDTO[]>([]);
  const [allCodes, setAllCodes] = useState<Set<string>>(new Set());
  const [usedCodes, setUsedCodes] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  // Skeleton until the first load; a refresh after a save keeps the table up.
  const [state, setState] = useState<LoadState>('loading');
  const loadLive = async () => {
    try {
      const [list, templates] = await Promise.all([listPayHeads(), listSalaryTemplates()]);
      setHeads(list);
      setAllCodes(new Set(list.map((h) => h.code)));
      setUsedCodes(new Set(templates.flatMap((t) => t.components.map((c) => c.payHeadCode))));
      setState('ready');
    } catch (e) {
      setState((st) => (st === 'ready' ? st : 'error'));
      flash(e instanceof ApiError ? e.message : 'Could not load salary components');
    }
  };
  useEffect(() => {
    void loadLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Only the components this company has: anything else is added with
  // "+ Add Component" when it's needed.
  const catalog = heads;
  // Basic first, then HRA, then the rest; standard ones after the org's own.
  const earnings = catalog
    .filter((h) => h.category === 'earning')
    .sort((a, b) => Number(a.standard === true) - Number(b.standard === true) || LIVE_ORDER.indexOf(a.componentType) - LIVE_ORDER.indexOf(b.componentType) || a.name.localeCompare(b.name))
    .map(rowFromPayHead);
  // Types an org may hold only one of, once it has one.
  const takenTypes = new Set(earnings.filter((r) => !r.live.standard && LIVE_TYPES[r.type]?.single).map((r) => r.type));
  /** A standard row opens as a new component under its standard code. */
  const asNew = <F extends { isNew: boolean; id?: string; code?: string }>(f: F, ph: PayHeadDTO): F => (ph.standard ? { ...f, isNew: true, id: undefined, code: ph.code } : f);
  // Saved deductions first, then any standard one this org hasn't saved yet.
  const deductions = catalog.filter((h) => h.category === 'deduction').map(rowFromDeductionHead);
  const benefits = catalog.filter((h) => h.category === 'benefit').map(rowFromBenefitHead);
  const reimbursements = catalog.filter((h) => h.category === 'reimbursement').map(rowFromReimbHead);
  const COUNTS: Record<Cat, number> = { earning: earnings.length, deduction: deductions.length, benefit: benefits.length, reimbursement: reimbursements.length };
  const [tab, setTab] = useState<Cat>('earning');
  const [form, setForm] = useState<EForm | null>(null);
  const [dForm, setDForm] = useState<DForm | null>(null);
  const [bForm, setBForm] = useState<BForm | null>(null);
  const [rForm, setRForm] = useState<RForm | null>(null);

  const onAdd = () => {
    if (tab === 'earning') setForm(blankEarning(ADD_TYPES.find((t) => !takenTypes.has(t)) ?? 'Custom Allowance'));
    else if (tab === 'deduction') setDForm(blankDeduction());
    else if (tab === 'benefit') setBForm(blankBenefit());
    else setRForm(blankReimbursement());
  };
  /** Create or update one pay head, then reload. */
  const persist = async (id: string | undefined, input: PayHeadInput, isNew: boolean, label: string, what: string, close: () => void) => {
    setSaving(true);
    try {
      if (id) await updatePayHead(id, input);
      else await createPayHead(input);
      flash(isNew ? `${label} added` : `${label} updated`);
      close();
      await loadLive();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : `Could not save the ${what}`);
    } finally {
      setSaving(false);
    }
  };
  const saveForm = async () => {
    if (!form || saving) return;
    if (!form.name.trim()) return flash('Please enter an earning name');
    if (!form.payslipName.trim()) return flash('Please enter the name in payslip');
    if (form.calcMode === 'percentage') {
      const pct = Number(form.percent);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return flash('Enter a percentage between 0 and 100');
    } else if (form.calcMode === 'flat' && !(Number(form.amount) >= 0)) {
      return flash('Enter an amount');
    }
    const live = LIVE_TYPES[form.type] ?? LIVE_TYPES['Custom Allowance'];
    const code = form.code ?? (live.single && live.code ? live.code : codeFor(form.name, allCodes));
    const input = inputFromForm(form, code);
    await persist(form.id, input, form.isNew, input.name, 'earning', () => setForm(null));
  };
  const saveDeduction = async () => {
    if (!dForm || saving) return;
    if (!dForm.payslipName.trim()) return flash('Please enter the name in payslip');
    const code = dForm.code ?? codeFor(dForm.payslipName, allCodes);
    await persist(dForm.id, deductionInput(dForm, code), dForm.isNew, dForm.payslipName.trim(), 'deduction', () => setDForm(null));
  };
  const saveBenefit = async () => {
    if (!bForm || saving) return;
    if (bForm.isNew && !bForm.plan) return flash('Please select a benefit plan');
    if (!bForm.payslipName.trim()) return flash('Please enter the name in payslip');
    if (bForm.calcMode === 'percentage' && !(Number(bForm.percent) > 0 && Number(bForm.percent) <= 100)) return flash('Enter a percentage between 0 and 100');
    if (bForm.calcMode === 'percentage' && !heads.some((h) => h.componentType === 'basic')) return flash('Add a Basic component first: this is a percentage of Basic');
    const code = bForm.code ?? codeFor(bForm.payslipName, allCodes);
    await persist(bForm.id, benefitInput(bForm, code), bForm.isNew, bForm.payslipName.trim(), 'benefit', () => setBForm(null));
  };
  const saveReimbursement = async () => {
    if (!rForm || saving) return;
    if (rForm.isNew && !rForm.type) return flash('Please select a reimbursement type');
    if (!rForm.payslipName.trim()) return flash('Please enter the name in payslip');
    if (!(Number(rForm.amount) >= 0)) return flash('Enter an amount');
    const code = rForm.code ?? codeFor(rForm.type.replace(/ Reimbursement$/, ''), allCodes);
    await persist(rForm.id, reimbursementInput(rForm, code), rForm.isNew, rForm.payslipName.trim(), 'reimbursement', () => setRForm(null));
  };
  // Only saved components can be deleted. The server refuses while a salary
  // template or a person's salary uses the component, or another component is
  // worked out from it.
  const removeComponent = async (id: string, label: string) => {
    if (saving) return;
    setSaving(true);
    try {
      await deletePayHead(id);
      flash(`${label} deleted`);
      setForm(null);
      setDForm(null);
      setBForm(null);
      setRForm(null);
      await loadLive();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : `Could not delete ${label}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 20 }}>
        <button onClick={onAdd} className="lk-btn-p" style={primaryBtn}>
          <IconPlus size={15} /> Add Component
        </button>
      </div>

      {tab === 'reimbursement' && (
        <div style={{ display: 'flex', gap: 12, background: 'var(--warn-bg)', border: '1px solid var(--warn-line)', borderRadius: 14, padding: '12px 14px', marginBottom: 20 }}>
          <span style={{ fontSize: 13 }}>ℹ️</span>
          <div style={{ fontSize: 13, color: 'var(--warn)', lineHeight: 1.5 }}>
            With these reimbursement components, employees can claim reimbursements for the components which are part of the payroll — not for other expense reimbursements.
          </div>
        </div>
      )}

      <Card style={L.cardPad}>
        <div style={{ ...L.seg, marginBottom: 16 }}>
          {CATEGORIES.map((c) => {
            const on = tab === c.key;
            return (
              <button
                key={c.key}
                onClick={() => setTab(c.key)}
                style={L.segBtn(on)}
              >
                {c.label} <span style={{ ...L.segCount, color: on ? 'inherit' : 'var(--ink-3)' }}>· <LoadingFigure state={state} w={12} h={11}>{COUNTS[c.key]}</LoadingFigure></span>
              </button>
            );
          })}
        </div>
        <table className="lk-t" style={L.table}>
          <thead>
            <tr>
              <Th>Name</Th>
              {tab === 'earning' && <><Th>Earning Type</Th><Th>Calculation Type</Th><Th>Consider for EPF</Th><Th>Consider for ESI</Th></>}
              {tab === 'deduction' && <><Th>Deduction Type</Th><Th>Deduction Frequency</Th></>}
              {tab === 'benefit' && <><Th>Benefit Type</Th><Th>Calculation Type</Th></>}
              {tab === 'reimbursement' && <><Th>Reimbursement Type</Th><Th right>Maximum Reimbursable Amount</Th></>}
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {tab === 'earning' && earnings.map((r) => (
              <tr key={r.live.code} className="phm-row" onClick={() => setForm(asNew(formFromPayHead(r.live, usedCodes.has(r.live.code)), r.live))} style={{ cursor: 'pointer' }}>
                <Td><NameCell name={r.name} fbp={r.fbp} standard={r.live.standard} /></Td>
                <Td muted>{r.type}</Td>
                <Td muted>{r.calc}</Td>
                <Td><YesNo value={r.epf} /></Td>
                <Td><YesNo value={r.esi} /></Td>
                <Td><StatusText status={r.status} /></Td>
              </tr>
            ))}
            {tab === 'deduction' && deductions.map((r) => (
              <tr key={r.live?.code ?? r.name} className="phm-row" onClick={() => setDForm(r.live ? asNew(formFromDeduction(r, usedCodes.has(r.live.code)), r.live) : formFromDeduction(r, false))} style={{ cursor: 'pointer' }}>
                <Td><NameCell name={r.name} standard={r.live?.standard} /></Td>
                <Td muted>{r.type}</Td>
                <Td muted>{r.frequency}</Td>
                <Td><StatusText status={r.status} /></Td>
              </tr>
            ))}
            {tab === 'benefit' && benefits.map((r) => (
              <tr key={r.live.code} className="phm-row" onClick={() => setBForm(asNew(formFromBenefit(r.live, usedCodes.has(r.live.code)), r.live))} style={{ cursor: 'pointer' }}>
                <Td><NameCell name={r.name} standard={r.live.standard} /></Td>
                <Td muted>{r.type}</Td>
                <Td muted>{r.calc}</Td>
                <Td><StatusText status={r.status} /></Td>
              </tr>
            ))}
            {tab === 'reimbursement' && reimbursements.map((r) => (
              <tr key={r.live.code} className="phm-row" onClick={() => setRForm(asNew(formFromReimbursement(r.live, usedCodes.has(r.live.code)), r.live))} style={{ cursor: 'pointer' }}>
                <Td><NameCell name={r.name} standard={r.live.standard} /></Td>
                <Td muted>{r.type}</Td>
                <Td right mono>{r.max}</Td>
                <Td><StatusText status={r.status} /></Td>
              </tr>
            ))}
            {state !== 'ready' && (
              <tr><td colSpan={6} style={{ padding: 0 }}><ListPending state={state} onRetry={() => { setState('loading'); void loadLive(); }} rows={5} cols={5} avatar={false} rowHeight={50} /></td></tr>
            )}
            {state === 'ready' && COUNTS[tab] === 0 && (
              <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13.5 }}>No components yet — add one to get started.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {form && <EarningModal form={form} setForm={setForm} onClose={() => setForm(null)} onSave={() => void saveForm()} saving={saving} takenTypes={takenTypes}
        onDelete={form.id ? () => void removeComponent(form.id!, form.name) : undefined} />}
      {dForm && <DeductionModal form={dForm} setForm={setDForm} onClose={() => setDForm(null)} onSave={() => void saveDeduction()} saving={saving}
        onDelete={dForm.id ? () => void removeComponent(dForm.id!, dForm.payslipName) : undefined} />}
      {bForm && <BenefitModal form={bForm} setForm={setBForm} onClose={() => setBForm(null)} onSave={() => void saveBenefit()} saving={saving}
        onDelete={bForm.id ? () => void removeComponent(bForm.id!, bForm.payslipName) : undefined} />}
      {rForm && <ReimbursementModal form={rForm} setForm={setRForm} onClose={() => setRForm(null)} onSave={() => void saveReimbursement()} saving={saving}
        onDelete={rForm.id ? () => void removeComponent(rForm.id!, rForm.payslipName) : undefined} />}
    </div>
  );
}

// —— Add / Edit Reimbursement modal ————————————————————————————————————
function ReimbursementModal({ form, setForm, onClose, onSave, saving, onDelete }: { form: RForm; setForm: (f: RForm) => void; onClose: () => void; onSave: () => void; saving: boolean; onDelete?: () => void }) {
  const set = <K extends keyof RForm>(k: K, v: RForm[K]) => setForm({ ...form, [k]: v });
  const locked = form.associated; // only Name in Payslip + Amount editable once associated

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 244, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 14px' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)', animation: 'ovl .2s ease both' }} />
      <div className="scry" style={modalCard}>
        <div style={modalHead}>
          <div>
            <div style={L.modalTitle}>{form.isNew ? 'New Reimbursement' : 'Edit Reimbursement'}</div>
          </div>
          <CloseButton onClose={onClose} />
        </div>

        <div className="scry" style={{ ...L.modalBody, overflowY: 'auto', flex: 1 }}>
          <div style={{ ...panelCard, maxWidth: 640 }}>
            <Field label="Reimbursement Type" req>
              {form.isNew ? (
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, ...(NO_PRETICK_REIMB.has(e.target.value) ? { fbp: false, fbpRestrict: false } : {}) })} style={inputStyle}>
                  <option value="">Select</option>
                  {REIMB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              ) : (
                <input value={form.type} disabled style={{ ...inputStyle, background: 'var(--surface-2)', color: 'var(--ink-3)' }} />
              )}
            </Field>

            <Field label="Name in Payslip" req>
              <input value={form.payslipName} onChange={(e) => set('payslipName', e.target.value)} placeholder="e.g. Fuel Reimbursement" style={inputStyle} />
            </Field>

            <Checkbox checked={form.fbp} disabled={locked} onChange={(v) => set('fbp', v)} label="Include this as a Flexible Benefit Plan component" />
            {form.fbp && (
              <div style={{ marginLeft: 26 }}>
                <Checkbox checked={form.fbpRestrict} disabled={locked} onChange={(v) => set('fbpRestrict', v)} label="Restrict employee from overriding the FBP amount" />
              </div>
            )}

            <Field label="How do you want to handle unclaimed reimbursement?" style={{ marginTop: 14 }}>
              <Radio checked={form.unclaimed === 'carry_forward'} disabled={locked} onChange={() => set('unclaimed', 'carry_forward')} label="Carry forward and encash at the end of the fiscal year" />
              <Radio checked={form.unclaimed === 'encash_monthly'} disabled={locked} onChange={() => set('unclaimed', 'encash_monthly')} label="Do not carry forward and encash monthly" />
            </Field>

            <Field label={form.fbp ? 'Enter Maximum Amount' : 'Enter Amount'} req>
              <AmountInput suffix="per month" value={form.amount} onChange={(v) => set('amount', v)} disabled={false} />
            </Field>

            <Checkbox checked={form.showInPayslip} onChange={(v) => set('showInPayslip', v)} label="Show this component in payslip" />
            <Checkbox checked={form.active} disabled={locked} onChange={(v) => set('active', v)} label="Mark this as Active" />

            <div style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-line)', borderRadius: 14, padding: '12px 14px', fontSize: 13, color: 'var(--warn)', lineHeight: 1.5, marginTop: 16 }}>
              <strong>Note:</strong> Once you associate this component with an employee, you’ll only be able to edit the <strong>Name in Payslip</strong> and <strong>Amount</strong>. Changes to the amount apply only to new employees.
            </div>
          </div>
        </div>

        <div style={modalFoot}>
          <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--bad)' }}>* indicates mandatory fields</span>
          {onDelete && <DeleteButton onDelete={onDelete} busy={saving} />}
          <button onClick={onClose} className="lk-btn" style={ghostBtn}>Cancel</button>
          <button onClick={onSave} disabled={saving} className="lk-btn-p" style={{ ...primaryBtn, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// —— Add / Edit Benefit modal ——————————————————————————————————————————
// An employer-paid benefit inside CTC: Gratuity (4.81% of Basic by default),
// an employer NPS share, or any other employer benefit.
function BenefitModal({ form, setForm, onClose, onSave, saving, onDelete }: { form: BForm; setForm: (f: BForm) => void; onClose: () => void; onSave: () => void; saving: boolean; onDelete?: () => void }) {
  const set = <K extends keyof BForm>(k: K, v: BForm[K]) => setForm({ ...form, [k]: v });
  const locked = form.associated; // only Name in Payslip + amount editable once on a template

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 244, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 14px' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)', animation: 'ovl .2s ease both' }} />
      <div className="scry" style={modalCard}>
        <div style={modalHead}>
          <div>
            <div style={L.modalTitle}>{form.isNew ? 'New Benefit' : 'Edit Benefit'}</div>
          </div>
          <CloseButton onClose={onClose} />
        </div>

        <div className="scry" style={{ ...L.modalBody, overflowY: 'auto', flex: 1 }}>
          <div style={{ ...panelCard, maxWidth: 640 }}>
            <Field label="Benefit Plan" req>
              {form.isNew ? (
                <select
                  value={form.plan}
                  onChange={(e) => {
                    const plan = BENEFIT_PLANS.find((p) => p.label === e.target.value);
                    setForm({ ...form, plan: e.target.value, payslipName: form.payslipName || e.target.value, ...(plan?.percent ? { calcMode: 'percentage' as const, percent: plan.percent } : { calcMode: 'flat' as const }) });
                  }}
                  style={inputStyle}
                >
                  <option value="">Select a Benefit Plan</option>
                  {BENEFIT_PLANS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
                </select>
              ) : (
                <input value={form.plan} disabled style={{ ...inputStyle, background: 'var(--surface-2)', color: 'var(--ink-3)' }} />
              )}
            </Field>

            <Field label="Name in Payslip" req>
              <input value={form.payslipName} onChange={(e) => set('payslipName', e.target.value)} placeholder="e.g. Gratuity" style={inputStyle} />
            </Field>

            <Field label="Calculation Type" req>
              <Radio checked={form.calcMode === 'percentage'} disabled={locked} onChange={() => set('calcMode', 'percentage')} label="Percentage of Basic" />
              <Radio checked={form.calcMode === 'flat'} disabled={locked} onChange={() => set('calcMode', 'flat')} label="Flat amount per month" />
              <Radio checked={form.calcMode === 'per_person'} disabled={locked} onChange={() => set('calcMode', 'per_person')} label="Set per employee" />
            </Field>
            {form.calcMode === 'percentage' && (
              <Field label="Enter Percentage"><AmountInput suffix="% of Basic" prefix={null} value={form.percent} onChange={(v) => set('percent', v)} /></Field>
            )}
            {form.calcMode === 'flat' && (
              <Field label="Enter Amount"><AmountInput suffix="per month" value={form.amount} onChange={(v) => set('amount', v)} /></Field>
            )}

            <Checkbox checked={form.proRata} disabled={locked} onChange={(v) => set('proRata', v)} label="Calculate on pro-rata basis" />
            <Checkbox checked={form.showInPayslip} onChange={(v) => set('showInPayslip', v)} label="Show this component in payslip" />
            <div style={{ marginTop: 8 }}>
              <Checkbox checked={form.active} disabled={locked} onChange={(v) => set('active', v)} label="Mark this as Active" />
            </div>

            <div style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-line)', borderRadius: 14, padding: '12px 14px', fontSize: 13, color: 'var(--warn)', lineHeight: 1.5, marginTop: 16 }}>
              <strong>Note:</strong> Benefits are paid by the employer and sit inside CTC, so the balancing component shrinks by the same amount. Once a template uses this benefit, only the <strong>Name in Payslip</strong> and the amount can be changed.
            </div>
          </div>
        </div>

        <div style={modalFoot}>
          <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--bad)' }}>* indicates mandatory fields</span>
          {onDelete && <DeleteButton onDelete={onDelete} busy={saving} />}
          <button onClick={onClose} className="lk-btn" style={ghostBtn}>Cancel</button>
          <button onClick={onSave} disabled={saving} className="lk-btn-p" style={{ ...primaryBtn, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// —— Add / Edit Deduction modal ————————————————————————————————————————
function DeductionModal({ form, setForm, onClose, onSave, saving, onDelete }: { form: DForm; setForm: (f: DForm) => void; onClose: () => void; onSave: () => void; saving: boolean; onDelete?: () => void }) {
  const set = <K extends keyof DForm>(k: K, v: DForm[K]) => setForm({ ...form, [k]: v });
  const locked = form.associated; // only Name in Payslip editable once associated

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 244, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 14px' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)', animation: 'ovl .2s ease both' }} />
      <div className="scry" style={modalCard}>
        <div style={modalHead}>
          <div>
            <div style={L.modalTitle}>{form.isNew ? 'New Deduction' : 'Edit Deduction'}</div>
          </div>
          <CloseButton onClose={onClose} />
        </div>

        <div className="scry" style={{ ...L.modalBody, overflowY: 'auto', flex: 1 }}>
          <div style={{ ...panelCard, maxWidth: 640 }}>
            {!form.isNew && (
              <Field label="Deduction Type" req>
                <input value={form.type} disabled style={{ ...inputStyle, background: 'var(--surface-2)', color: 'var(--ink-3)' }} />
              </Field>
            )}
            <Field label="Name in Payslip" req>
              <input value={form.payslipName} onChange={(e) => set('payslipName', e.target.value)} placeholder="e.g. Food Coupon Deduction" style={inputStyle} />
            </Field>
            <Field label="Select the deduction frequency" req>
              <Radio checked={form.frequency === 'one_time'} disabled={locked} onChange={() => set('frequency', 'one_time')} label="One-time deduction" />
              <Radio checked={form.frequency === 'recurring'} disabled={locked} onChange={() => set('frequency', 'recurring')} label="Recurring deduction for subsequent Payrolls" />
            </Field>
            <Checkbox checked={form.active} disabled={locked} onChange={(v) => set('active', v)} label="Mark this as Active" />

            <div style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-line)', borderRadius: 14, padding: '12px 14px', fontSize: 13, color: 'var(--warn)', lineHeight: 1.5, marginTop: 16 }}>
              <strong>Note:</strong> Once you associate this deduction with an employee, you’ll only be able to edit the <strong>Name in Payslip</strong>. The change will be reflected in both new and existing employees.
            </div>
          </div>
        </div>

        <div style={modalFoot}>
          <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--bad)' }}>* indicates mandatory fields</span>
          {onDelete && <DeleteButton onDelete={onDelete} busy={saving} />}
          <button onClick={onClose} className="lk-btn" style={ghostBtn}>Cancel</button>
          <button onClick={onSave} disabled={saving} className="lk-btn-p" style={{ ...primaryBtn, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// —— Add / Edit Earning modal ————————————————————————————————————————
// Centered, near-full-screen modal (same shell as Add-a-user). Labels and
// headings only: no helper text under fields or options.
function EarningModal({ form, setForm, onClose, onSave, saving, takenTypes, onDelete }: { form: EForm; setForm: (f: EForm) => void; onClose: () => void; onSave: () => void; saving: boolean; takenTypes: Set<string>; onDelete?: () => void }) {
  const spec = specFor(form.type);
  const fx = (key: FixedKey) => spec.fixed?.includes(key) ?? false;
  const set = <K extends keyof EForm>(k: K, v: EForm[K]) => setForm({ ...form, [k]: v });
  const locked = form.associated; // only Name + Amount/% editable once associated
  const baseWord = spec.calcBase === 'ctc' ? 'CTC' : 'Basic';

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 244, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 14px' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)', animation: 'ovl .2s ease both' }} />
      <div className="scry" style={modalCard}>
        {/* Header */}
        <div style={modalHead}>
          <div>
            <div style={L.modalTitle}>{form.isNew ? 'Add Earning' : 'Edit Earning'}</div>
          </div>
          <CloseButton onClose={onClose} />
        </div>

        {/* Body */}
        <div className="scry" style={{ ...L.modalBody, overflowY: 'auto', flex: 1 }}>
          {/* Earning Type — full width, with the nature helper */}
          <div style={panelCard}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
              <Field label="Earning Type" req>
                {form.isNew ? (
                  <select value={form.type} onChange={(e) => setForm({ ...blankEarning(e.target.value), name: form.name, payslipName: form.payslipName })} style={inputStyle}>
                    {ADD_TYPES.map((t) => <option key={t} value={t} disabled={takenTypes.has(t)}>{takenTypes.has(t) ? `${t} (already added)` : t}</option>)}
                  </select>
                ) : (
                  <input value={form.type} disabled style={{ ...inputStyle, background: 'var(--surface-2)', color: 'var(--ink-3)' }} />
                )}
              </Field>
            </div>
          </div>

          {/* Two columns: details (left) · other configurations (right) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 18, alignItems: 'start' }}>
            {/* Left — details */}
            <div style={panelCard}>
              <div style={panelTitle}>Details</div>
              <Field label="Earning Name" req>
                <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Special Allowance" style={inputStyle} />
              </Field>
              <Field label="Name in Payslip" req>
                <input value={form.payslipName} onChange={(e) => set('payslipName', e.target.value)} placeholder="Shown on the payslip" style={inputStyle} />
              </Field>

              {spec.fbp === 'forced' ? (
                <Field label="Enter Maximum Amount" req>
                  <AmountInput suffix="per month" value={form.amount} onChange={(v) => set('amount', v)} disabled={false} />
                </Field>
              ) : spec.calcBase ? (
                <>
                  <Field label="Calculation Type" req>
                    <Radio checked={form.calcMode === 'flat'} disabled={locked} onChange={() => set('calcMode', 'flat')} label="Flat Amount" />
                    <Radio checked={form.calcMode === 'percentage'} disabled={locked} onChange={() => set('calcMode', 'percentage')} label={`Percentage of ${baseWord}`} />
                    {spec.perPerson && <Radio checked={form.calcMode === 'per_person'} disabled={locked} onChange={() => set('calcMode', 'per_person')} label="Set per employee (or the balancing amount)" />}
                  </Field>
                  {form.calcMode === 'per_person' ? null : form.calcMode === 'percentage' ? (
                    <Field label="Enter Percentage">
                      <AmountInput suffix="%" prefix={null} value={form.percent} onChange={(v) => set('percent', v)} disabled={false} />
                    </Field>
                  ) : (
                    <Field label="Enter Amount">
                      <AmountInput value={form.amount} onChange={(v) => set('amount', v)} disabled={false} />
                    </Field>
                  )}
                </>
              ) : null}

              <div style={{ marginTop: 8 }}>
                <Checkbox checked={form.active} onChange={(v) => set('active', v)} label="Mark this as Active" />
              </div>
            </div>

            {/* Right — other configurations */}
            <div style={panelCard}>
              <div style={panelTitle}>Other Configurations</div>
              <Checkbox checked={form.partOfStructure} fixed={fx('partOfStructure')} onChange={(v) => set('partOfStructure', v)} label="Make this earning a part of the employee’s salary structure" />
              <Checkbox checked={form.taxable} disabled={locked} fixed={fx('taxable')} onChange={(v) => set('taxable', v)} label="This is a taxable earning" />

              {spec.nature === 'fixed' && (
                <Checkbox checked={form.proRata} disabled={locked} fixed={fx('proRata')} onChange={(v) => set('proRata', v)} label="Calculate on pro-rata basis" />
              )}

              {spec.fbp !== 'none' && !spec.hideFbp && (
                <>
                  <Checkbox checked={form.fbp} disabled={spec.fbp === 'forced'} onChange={(v) => set('fbp', v)} label="Include this as a Flexible Benefit Plan component" />
                  {form.fbp && (
                    <div style={{ marginLeft: 26 }}>
                      <Checkbox checked={form.fbpRestrict} onChange={(v) => set('fbpRestrict', v)} label="Restrict employee from overriding the FBP amount" />
                    </div>
                  )}
                </>
              )}

              {spec.taxDeductionPref && form.taxable && (
                <Field label="Tax Deduction Preference" req style={{ marginTop: 12 }}>
                  <Radio checked={form.taxPref === 'subsequent'} disabled={locked} onChange={() => set('taxPref', 'subsequent')} label="Deduct tax in subsequent payrolls of the financial year" />
                  <Radio checked={form.taxPref === 'same'} disabled={locked} onChange={() => set('taxPref', 'same')} label="Deduct tax in same payroll" />
                </Field>
              )}

              <Checkbox checked={form.epf} fixed={fx('epf')} onChange={(v) => set('epf', v)} label="Consider for EPF Contribution" />
              {form.epf && spec.epfSubChoice && (
                <div style={{ marginLeft: 26 }}>
                  <Radio checked={form.epfWhen === 'always'} fixed={fx('epf')} onChange={() => set('epfWhen', 'always')} label="Always" />
                  <Radio checked={form.epfWhen === 'pfCeiling'} fixed={fx('epf')} onChange={() => set('epfWhen', 'pfCeiling')} label="Only when PF Wage is less than ₹ 25,000" />
                </div>
              )}
              <Checkbox checked={form.esi} disabled={locked} fixed={fx('esi')} onChange={(v) => set('esi', v)} label="Consider for ESI Contribution" />
              <Checkbox checked={form.showInPayslip} disabled={locked} fixed={fx('showInPayslip')} onChange={(v) => set('showInPayslip', v)} label="Show this component in payslip" />
            </div>
          </div>

          {locked && (
            <div style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-line)', borderRadius: 14, padding: '12px 14px', fontSize: 13, color: 'var(--warn)', lineHeight: 1.5, marginTop: 18 }}>
              <strong>Note:</strong> This component is already associated with one or more employees, so you can only edit the <strong>Name</strong> and <strong>Amount/Percentage</strong>. Changes to the amount will apply only to new employees.
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={modalFoot}>
          <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--bad)' }}>* indicates mandatory fields</span>
          {onDelete && <DeleteButton onDelete={onDelete} busy={saving} />}
          <button onClick={onClose} className="lk-btn" style={ghostBtn}>Cancel</button>
          <button onClick={onSave} disabled={saving} className="lk-btn-p" style={{ ...primaryBtn, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// ——— presentational helpers ———
/** Delete with a second click to confirm; resets if the pointer leaves. */
function DeleteButton({ onDelete, busy }: { onDelete: () => void; busy: boolean }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <button
      onClick={() => (confirming ? onDelete() : setConfirming(true))}
      onMouseLeave={() => setConfirming(false)}
      disabled={busy}
      style={{ ...ghostBtn, color: 'var(--bad)', borderColor: confirming ? 'var(--bad)' : 'transparent', background: 'var(--bad-bg)' }}
    >
      {confirming ? 'Click again to delete' : 'Delete'}
    </button>
  );
}
function NameCell({ name, fbp, standard }: { name: string; fbp?: boolean; standard?: boolean }) {
  return (
    <span>
      <span style={{ ...L.cellName, color: standard ? 'var(--ink-2)' : 'var(--ink)' }}>{name}</span>
      {standard && <span title="A built-in component: saved for your organisation when you save it or add it to a template" style={{ ...L.tag, marginLeft: 8, color: 'var(--ink-3)' }}>Standard · not added yet</span>}
      {fbp && <span style={{ ...L.tag, marginLeft: 8 }}>FBP</span>}
    </span>
  );
}
function YesNo({ value }: { value: string }) {
  const [main, ...rest] = value.split(' (');
  return (
    <span style={{ color: 'var(--ink)' }}>
      {main === 'Yes' || main === 'No' ? <span style={L.pill(main === 'Yes' ? 'ok' : 'mute')}><span aria-hidden style={L.pillDot} />{main}</span> : main}
      {rest.length > 0 && <span style={{ color: 'var(--ink-3)', fontSize: 11.5 }}> ({rest.join(' (')}</span>}
    </span>
  );
}
function StatusText({ status }: { status: Status }) {
  return <span style={L.pill(status === 'Active' ? 'ok' : 'mute')}><span aria-hidden style={L.pillDot} />{status}</span>;
}
function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return (
    <th style={{ ...L.th, textAlign: right ? 'right' : 'left' }}>
      {children}
    </th>
  );
}
function Td({ children, muted, right, mono }: { children: ReactNode; muted?: boolean; right?: boolean; mono?: boolean }) {
  return (
    <td style={{ ...L.td, color: muted ? 'var(--ink-2)' : 'var(--ink)', textAlign: right ? 'right' : 'left', fontVariantNumeric: mono ? 'tabular-nums' : undefined }}>
      {children}
    </td>
  );
}

function Field({ label, req, children, style }: { label: string; req?: boolean; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ marginBottom: 16, ...style }}>
      <label style={L.label}>
        {label}{req && <span style={{ color: 'var(--bad)', marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  );
}
function AmountInput({ value, onChange, suffix, prefix = '₹', disabled }: { value: string; onChange: (v: string) => void; suffix?: string; prefix?: string | null; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div className="lk-field" style={{ display: 'flex', alignItems: 'stretch', height: 42, border: '1px solid var(--line-2)', borderRadius: 12, overflow: 'hidden', background: 'var(--surface)', maxWidth: 200 }}>
        {prefix && <span style={{ padding: '0 12px', display: 'flex', alignItems: 'center', background: 'var(--surface-2)', color: 'var(--ink-3)', fontSize: 13, borderRight: '1px solid var(--line-2)' }}>{prefix}</span>}
        <input type="number" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={{ border: 'none', outline: 'none', padding: '0 12px', fontSize: 13, fontFamily: 'inherit', width: 120, color: 'var(--ink)', background: 'none' }} />
      </div>
      {suffix && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{suffix}</span>}
    </div>
  );
}
// `fixed`: set by the earning type — looks like any ticked box, can't be changed.
function Checkbox({ checked, onChange, label, disabled, fixed }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; fixed?: boolean }) {
  const off = disabled || fixed;
  return (
    <div style={{ display: 'flex', gap: 10, padding: '7px 0', opacity: disabled && !fixed ? 0.55 : 1 }} title={fixed ? 'Fixed for this earning type' : undefined}>
      <button type="button" disabled={off} aria-disabled={off} onClick={() => !off && onChange(!checked)}
        style={{ flexShrink: 0, width: 18, height: 18, marginTop: 2, borderRadius: 5, cursor: off ? 'default' : 'pointer', border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--line-2)'}`, background: checked ? 'var(--accent-grad)' : 'var(--surface)', color: 'var(--on-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, lineHeight: 1, padding: 0 }}>
        {checked ? '✓' : ''}
      </button>
      <div>
        <div style={{ fontSize: 13.5, color: 'var(--ink)' }}>{label}</div>
      </div>
    </div>
  );
}
function Radio({ checked, onChange, label, disabled, fixed }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean; fixed?: boolean }) {
  const off = disabled || fixed;
  return (
    <div style={{ display: 'flex', gap: 10, padding: '6px 0', opacity: disabled && !fixed ? 0.55 : 1, cursor: off ? 'default' : 'pointer' }} title={fixed ? 'Fixed for this earning type' : undefined} onClick={() => !off && onChange()}>
      <span style={{ flexShrink: 0, width: 17, height: 17, marginTop: 1, borderRadius: '50%', border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--line-2)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {checked && <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--accent-grad)' }} />}
      </span>
      <div>
        <div style={{ fontSize: 13.5, color: 'var(--ink)' }}>{label}</div>
      </div>
    </div>
  );
}

const primaryBtn: CSSProperties = { ...L.btnPrimary };
const ghostBtn: CSSProperties = { ...L.btn };
const inputStyle: CSSProperties = { ...L.input };
const modalCard: CSSProperties = { ...L.modalSheet };
const modalHead: CSSProperties = { ...L.modalHeadBar };
const modalFoot: CSSProperties = { ...L.modalFootBar };
const panelCard: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 20 };
const panelTitle: CSSProperties = { ...L.cardTitle, marginBottom: 16 };
