// Payroll › Salary Components — the org's reusable component catalog, split across
// four category tabs (Earnings / Deductions / Benefits / Reimbursements). Columns
// mirror the Zoho Payroll salary-components screens.
//
// Live through /admin/payroll/pay-heads: Basic, House Rent Allowance and Food
// Coupon among earnings, and every deduction. Bonus, benefits and
// reimbursements still render from the local capture below.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import { createPayHead, deletePayHead, listPayHeads, listSalaryTemplates, rupeesToPaise, updatePayHead } from '../../services/payroll';
import type { CalculationBasis, PayHeadDTO, PayHeadInput } from '../../services/payroll';
import { useAuth } from '../auth/AuthContext';
import { Card } from '../ui';
import { IconPlus } from '../icons';
import { CloseButton } from '../drawers/shell';

type Cat = 'earning' | 'deduction' | 'benefit' | 'reimbursement';
type Status = 'Active' | 'Inactive';

const CATEGORIES: { key: Cat; label: string }[] = [
  { key: 'earning', label: 'Earnings' },
  { key: 'deduction', label: 'Deductions' },
  { key: 'benefit', label: 'Benefits' },
  { key: 'reimbursement', label: 'Reimbursements' },
];

// —— Mock catalog (from the Zoho salary-components capture) ——————————————
type EarningRow = { name: string; type: string; calc: string; epf: string; esi: string; fbp?: boolean; status: Status; live?: PayHeadDTO };
type DeductionKind = 'food_coupons' | 'hold_amount' | 'salary_advance' | 'notice_pay' | 'other';
type DeductionRow = { name: string; type: string; frequency: string; status: Status; kind: DeductionKind; live?: PayHeadDTO };
type BenefitRow = { name: string; type: string; frequency: string; status: Status };
type ReimbRow = { name: string; type: string; max: string; status: Status };

// Earnings are limited to the four agreed types. Basic, House Rent Allowance
// and Food Coupon come from the server (see LIVE_TYPES); Bonus is form-only
// until it is wired. Nothing is captured locally any more.
const EARNINGS: EarningRow[] = [];
// The four standard deductions. Each is live: a saved one comes from the
// server (matched by kind), an unsaved one shows from here and is created on
// its first save.
const DEDUCTIONS: DeductionRow[] = [
  { name: 'Food Coupon Deduction', type: 'Food Coupon Deduction', frequency: 'One Time', status: 'Active', kind: 'food_coupons' },
  { name: 'Hold Amount', type: 'Other Deductions', frequency: 'One Time', status: 'Active', kind: 'hold_amount' },
  { name: 'Salary Advance Deduction', type: 'Other Deductions', frequency: 'One Time', status: 'Active', kind: 'salary_advance' },
  { name: 'Notice Pay Deduction', type: 'Notice Pay Deduction', frequency: 'One Time', status: 'Active', kind: 'notice_pay' },
];
const DEDUCTION_KINDS = new Set<string>(['food_coupons', 'hold_amount', 'salary_advance', 'notice_pay', 'other']);
const deductionTypeLabel = (kind: string) =>
  kind === 'food_coupons' ? 'Food Coupon Deduction' : kind === 'notice_pay' ? 'Notice Pay Deduction' : 'Other Deductions';
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
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 34) || 'DEDUCTION';
  let code = base;
  for (let i = 2; taken.has(code); i++) code = `${base}_${i}`;
  return code;
}
const BENEFITS: BenefitRow[] = [
  { name: 'Voluntary Provident Fund', type: 'Voluntary Provident Fund', frequency: 'Recurring', status: 'Active' },
  { name: 'Gratuity -Deduction', type: 'Other Non-Taxable Deduction', frequency: 'Recurring', status: 'Active' },
  { name: 'Food Coupons', type: 'Other Non-Taxable Deduction', frequency: 'Recurring', status: 'Active' },
];
const REIMBURSEMENTS: ReimbRow[] = [
  { name: 'Fuel Reimbursement', type: 'Fuel Reimbursement', max: '₹15,000', status: 'Active' },
  { name: 'Driver Reimbursement', type: 'Driver Reimbursement', max: '₹0', status: 'Active' },
  { name: 'Vehicle Maintenance Reimbursement', type: 'Vehicle Maintenance Reimbursement', max: '₹0', status: 'Active' },
  { name: 'Telephone Reimbursement', type: 'Telephone Reimbursement', max: '₹0', status: 'Active' },
  { name: 'Leave Travel Allowance', type: 'Leave Travel Allowance', max: '₹8,333', status: 'Active' },
  { name: 'Books and Periodicals Reimbursement', type: 'Books and Periodicals Reimbursement', max: '₹3,000', status: 'Active' },
  { name: 'Internet Reimbursement', type: 'Internet Reimbursement', max: '₹1,800', status: 'Active' },
];

type Catalog = { earnings: EarningRow[]; deductions: DeductionRow[]; benefits: BenefitRow[]; reimbursements: ReimbRow[] };
// Which catalog shows is decided by the signed-in org. ACMT and CDE run on a
// single Basic component, which now comes from the server; everyone else still
// sees the capture above alongside their live Basic and HRA.
const CATALOGS: Record<string, Catalog> = {
  acmt: {
    earnings: [],
    deductions: [],
    benefits: [],
    reimbursements: [],
  },
  // As set up in their pay head master: Basic (live, from the server) is the
  // whole CTC, no EPF or ESI.
  cde: {
    earnings: [],
    deductions: [],
    benefits: [],
    reimbursements: [],
  },
};
const DEFAULT_CATALOG: Catalog = { earnings: EARNINGS, deductions: DEDUCTIONS, benefits: BENEFITS, reimbursements: REIMBURSEMENTS };
const countsFor = (c: Catalog, earnings: EarningRow[]): Record<Cat, number> => ({
  earning: earnings.length,
  deduction: c.deductions.length,
  benefit: c.benefits.length,
  reimbursement: c.reimbursements.length,
});

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
};
// Only these earning types exist on the screen and in Add Component.
const SPECS: Record<string, Spec> = {
  // Basic: everything ticked is fixed, PF counted always (no ₹25,000 condition).
  Basic: { nature: 'fixed', calcBase: 'ctc', fbp: 'none', epfSubChoice: true, taxDeductionPref: false, fixed: ['partOfStructure', 'taxable', 'proRata', 'epf', 'esi', 'showInPayslip'] },
  'House Rent Allowance': { nature: 'fixed', calcBase: 'basic', fbp: 'optional', epfSubChoice: true, taxDeductionPref: false, fixed: ['partOfStructure', 'taxable', 'showInPayslip'] },
  'Food Coupon': { nature: 'fixed', calcBase: null, fbp: 'forced', epfSubChoice: false, taxDeductionPref: false, fixed: ['partOfStructure', 'taxable', 'showInPayslip'], hideFbp: true },
  Bonus: { nature: 'variable', calcBase: null, fbp: 'none', epfSubChoice: false, taxDeductionPref: true, fixed: ['taxable', 'showInPayslip'] },
};
const DEFAULT_SPEC: Spec = { nature: 'fixed', calcBase: 'basic', fbp: 'optional', epfSubChoice: true, taxDeductionPref: false };
const specFor = (type: string): Spec => SPECS[type] ?? DEFAULT_SPEC;
const ADD_TYPES = Object.keys(SPECS);
const isFixed = (type: string, key: FixedKey) => specFor(type).fixed?.includes(key) ?? false;

// —— Live earning types: saved to and read from the pay-heads API ——————————
// `single`: an org holds one of these, under a fixed code. Others get a code from their name.
const LIVE_TYPES: Record<string, { componentType: 'basic' | 'hra' | 'meal_card'; code: string; single: boolean }> = {
  Basic: { componentType: 'basic', code: 'BASIC', single: true },
  'House Rent Allowance': { componentType: 'hra', code: 'HRA', single: true },
  'Food Coupon': { componentType: 'meal_card', code: 'MEAL_CARD', single: false },
};
const LIVE_COMPONENT_TYPES = new Set<string>(Object.values(LIVE_TYPES).map((t) => t.componentType));
const LIVE_ORDER = ['basic', 'hra', 'meal_card'];
const typeOfLive = (ph: PayHeadDTO) =>
  Object.entries(LIVE_TYPES).find(([, t]) => t.componentType === ph.componentType)?.[0] ?? 'Food Coupon';

function rupeesText(paise: number | undefined): string {
  return Math.round((paise ?? 0) / 100).toLocaleString('en-IN');
}
function calcText(c: CalculationBasis): string {
  if (c.mode === 'percentage') return `Fixed; ${c.percent ?? 0}% of ${c.base === 'ctc' ? 'CTC' : 'Basic'}`;
  if (c.mode === 'flat_per_month') return `Fixed; ${rupeesText(c.amountPaise)} per month`;
  return 'Fixed; Flat Amount';
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
type EForm = {
  id?: string; // the saved pay head, for live types
  code?: string;
  isNew: boolean;
  associated: boolean; // already used by employees → only Name + Amount/% editable
  type: string;
  name: string;
  payslipName: string;
  calcMode: 'flat' | 'percentage';
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

function parseCalc(calc: string): { mode: 'flat' | 'percentage'; amount: string; percent: string } {
  const pct = calc.match(/([\d.]+)%/);
  if (pct) return { mode: 'percentage', percent: pct[1], amount: '0' };
  const perMonth = calc.match(/([\d,]+)\s*per month/i);
  if (perMonth) return { mode: 'flat', amount: perMonth[1].replace(/,/g, ''), percent: '50' };
  const flatOf = calc.match(/of\s*([\d,]+)/i);
  if (flatOf) return { mode: 'flat', amount: flatOf[1].replace(/,/g, ''), percent: '50' };
  return { mode: 'flat', amount: '0', percent: '50' };
}
function formFromEarning(r: EarningRow): EForm {
  const spec = specFor(r.type);
  const p = parseCalc(r.calc);
  return {
    isNew: false, associated: true, type: r.type, name: r.name, payslipName: r.name,
    calcMode: spec.calcBase ? p.mode : 'flat', amount: p.amount, percent: p.percent,
    active: r.status === 'Active', partOfStructure: spec.nature === 'fixed', taxable: true,
    proRata: spec.nature === 'fixed', fbp: r.fbp === true || spec.fbp === 'forced', fbpRestrict: spec.fbp === 'forced',
    taxPref: 'subsequent', epf: r.epf.startsWith('Yes'), epfWhen: r.epf.includes('PF Wage') ? 'pfCeiling' : 'always',
    esi: r.esi === 'Yes', showInPayslip: true,
  };
}
function blankEarning(type: string): EForm {
  const spec = specFor(type);
  return {
    isNew: true, associated: false, type, name: '', payslipName: '',
    calcMode: 'flat', amount: '0', percent: '50', active: true,
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
    calcMode: c.mode === 'percentage' ? 'percentage' : 'flat',
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
  const live = LIVE_TYPES[f.type];
  const base = specFor(f.type).calcBase === 'ctc' ? 'ctc' : 'basic';
  const calculation: CalculationBasis = f.calcMode === 'percentage' && specFor(f.type).calcBase
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
    recurrence: 'recurring',
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
const BENEFIT_PLANS = ['National Pension Scheme', 'Other Non-Taxable Deduction']; // selectable when adding
const INVESTMENTS: { group: string; items: string[] }[] = [
  { group: 'Section 123 (80C)', items: ['Life Insurance Premium', 'Public Provident Fund', 'Unit-linked insurance plan', 'ELSS Tax Saving Mutual Fund'] },
];
type BForm = {
  isNew: boolean;
  associated: boolean; // once associated, only Name in Payslip is editable
  plan: string;
  investment: string;
  payslipName: string;
  employerContribution: boolean;
  superannuation: boolean;
  proRata: boolean;
  active: boolean;
};
// VPF hides the employer-contribution + superannuation options; every other plan shows them.
const planShowsEmployerSuper = (plan: string) => plan !== 'Voluntary Provident Fund';
function formFromBenefit(r: BenefitRow): BForm {
  const isVpf = r.type === 'Voluntary Provident Fund';
  return {
    isNew: false, associated: true, plan: r.type, investment: isVpf ? 'Voluntary Provident Fund' : '',
    payslipName: r.name, employerContribution: !isVpf, superannuation: false, proRata: !isVpf, active: r.status === 'Active',
  };
}
function blankBenefit(): BForm {
  return { isNew: true, associated: false, plan: '', investment: '', payslipName: '', employerContribution: false, superannuation: true, proRata: false, active: true };
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
  isNew: boolean;
  associated: boolean; // once associated, only Name in Payslip + Amount editable
  type: string;
  payslipName: string;
  fbp: boolean;
  fbpRestrict: boolean;
  unclaimed: 'carry_forward' | 'encash_monthly';
  amount: string;
  active: boolean;
};
// Reimbursement types that start with the Flexible Benefit Plan box unticked.
const NO_PRETICK_REIMB = new Set(['Fuel Reimbursement', 'Internet Reimbursement']);
function formFromReimbursement(r: ReimbRow): RForm {
  return {
    isNew: false, associated: true, type: r.type, payslipName: r.name, fbp: false, fbpRestrict: false,
    unclaimed: 'carry_forward', amount: r.max.replace(/[₹,]/g, ''), active: r.status === 'Active',
  };
}
function blankReimbursement(): RForm {
  return { isNew: true, associated: false, type: '', payslipName: '', fbp: true, fbpRestrict: false, unclaimed: 'carry_forward', amount: '0', active: true };
}

export function PayHeadMaster() {
  const { flash } = useStore();
  const { user } = useAuth();
  const catalog = CATALOGS[user?.org ?? ''] ?? DEFAULT_CATALOG;
  const [live, setLive] = useState<PayHeadDTO[]>([]);
  const [liveDeductions, setLiveDeductions] = useState<PayHeadDTO[]>([]);
  const [allCodes, setAllCodes] = useState<Set<string>>(new Set());
  const [usedCodes, setUsedCodes] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const loadLive = async () => {
    try {
      const [heads, templates] = await Promise.all([listPayHeads(), listSalaryTemplates()]);
      setLive(heads.filter((h) => h.category === 'earning' && LIVE_COMPONENT_TYPES.has(h.componentType)));
      setLiveDeductions(heads.filter((h) => h.category === 'deduction'));
      setAllCodes(new Set(heads.map((h) => h.code)));
      setUsedCodes(new Set(templates.flatMap((t) => t.components.map((c) => c.payHeadCode))));
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not load salary components');
    }
  };
  useEffect(() => {
    void loadLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Basic first, then HRA, then the rest.
  const liveRows = [...live]
    .sort((a, b) => LIVE_ORDER.indexOf(a.componentType) - LIVE_ORDER.indexOf(b.componentType) || a.name.localeCompare(b.name))
    .map(rowFromPayHead);
  const earnings = [...liveRows, ...catalog.earnings];
  // Types an org may hold only one of, once it has one.
  const takenTypes = new Set(liveRows.filter((r) => LIVE_TYPES[r.type]?.single).map((r) => r.type));
  // Saved deductions first, then any standard one this org hasn't saved yet.
  const savedKinds = new Set(liveDeductions.map((h) => h.componentType));
  const deductions = [...liveDeductions.map(rowFromDeductionHead), ...catalog.deductions.filter((r) => !savedKinds.has(r.kind))];
  const COUNTS = { ...countsFor(catalog, earnings), deduction: deductions.length };
  const [tab, setTab] = useState<Cat>('earning');
  const [form, setForm] = useState<EForm | null>(null);
  const [dForm, setDForm] = useState<DForm | null>(null);
  const [bForm, setBForm] = useState<BForm | null>(null);
  const [rForm, setRForm] = useState<RForm | null>(null);

  const onAdd = () => {
    if (tab === 'earning') setForm(blankEarning(ADD_TYPES.find((t) => !takenTypes.has(t)) ?? 'Food Coupon'));
    else if (tab === 'deduction') setDForm(blankDeduction());
    else if (tab === 'benefit') setBForm(blankBenefit());
    else setRForm(blankReimbursement());
  };
  const saveForm = async () => {
    if (!form || saving) return;
    if (!form.name.trim()) return flash('Please enter an earning name');
    if (!LIVE_TYPES[form.type]) {
      // Not wired yet: the capture rows stay as they are.
      flash(form.isNew ? `${form.name} added` : `${form.name} updated`);
      setForm(null);
      return;
    }
    if (!form.payslipName.trim()) return flash('Please enter the name in payslip');
    if (form.calcMode === 'percentage') {
      const pct = Number(form.percent);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return flash('Enter a percentage between 0 and 100');
    } else if (!(Number(form.amount) >= 0)) {
      return flash('Enter an amount');
    }
    setSaving(true);
    try {
      const live = LIVE_TYPES[form.type];
      const code = form.code ?? (live.single ? live.code : codeFor(form.name, allCodes));
      const input = inputFromForm(form, code);
      if (form.id) await updatePayHead(form.id, input);
      else await createPayHead(input);
      flash(form.isNew ? `${input.name} added` : `${input.name} updated`);
      setForm(null);
      await loadLive();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save the earning');
    } finally {
      setSaving(false);
    }
  };
  const saveDeduction = async () => {
    if (!dForm || saving) return;
    if (!dForm.payslipName.trim()) return flash('Please enter the name in payslip');
    setSaving(true);
    try {
      if (dForm.id) await updatePayHead(dForm.id, deductionInput(dForm, dForm.code ?? codeFor(dForm.payslipName, allCodes)));
      else await createPayHead(deductionInput(dForm, codeFor(dForm.payslipName, allCodes)));
      flash(dForm.isNew ? `${dForm.payslipName.trim()} added` : `${dForm.payslipName.trim()} updated`);
      setDForm(null);
      await loadLive();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save the deduction');
    } finally {
      setSaving(false);
    }
  };
  // Only saved components can be deleted. The server refuses while a salary
  // template uses the component or another component is worked out from it.
  const removeComponent = async (id: string, label: string) => {
    if (saving) return;
    setSaving(true);
    try {
      await deletePayHead(id);
      flash(`${label} deleted`);
      setForm(null);
      setDForm(null);
      await loadLive();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : `Could not delete ${label}`);
    } finally {
      setSaving(false);
    }
  };
  const saveBenefit = () => {
    if (!bForm) return;
    if (bForm.isNew && !bForm.plan) return flash('Please select a benefit plan');
    if (!bForm.payslipName.trim()) return flash('Please enter the name in payslip');
    flash(bForm.isNew ? `${bForm.payslipName} added` : `${bForm.payslipName} updated`);
    setBForm(null);
  };
  const saveReimbursement = () => {
    if (!rForm) return;
    if (rForm.isNew && !rForm.type) return flash('Please select a reimbursement type');
    if (!rForm.payslipName.trim()) return flash('Please enter the name in payslip');
    flash(rForm.isNew ? `${rForm.payslipName} added` : `${rForm.payslipName} updated`);
    setRForm(null);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 4, background: '#fff', border: '1px solid #EBEBEB', borderRadius: 12, padding: 4 }}>
          {CATEGORIES.map((c) => {
            const on = tab === c.key;
            return (
              <button
                key={c.key}
                onClick={() => setTab(c.key)}
                style={{
                  border: 'none', cursor: 'pointer', fontSize: 16, fontWeight: 700, padding: '7px 15px',
                  borderRadius: 8, background: on ? '#0571A6' : 'transparent', color: on ? '#fff' : '#717171',
                }}
              >
                {c.label} <span style={{ opacity: 0.7 }}>· {COUNTS[c.key]}</span>
              </button>
            );
          })}
        </div>
        <button onClick={onAdd} style={primaryBtn}>
          <IconPlus size={15} /> Add Component
        </button>
      </div>

      {tab === 'reimbursement' && (
        <div style={{ display: 'flex', gap: 10, background: '#F6E9D5', border: '1px solid #ECD9B4', borderRadius: 12, padding: '12px 15px', marginBottom: 14 }}>
          <span style={{ fontSize: 15 }}>ℹ️</span>
          <div style={{ fontSize: 14, color: '#8A6A20', lineHeight: 1.5 }}>
            With these reimbursement components, employees can claim reimbursements for the components which are part of the payroll — not for other expense reimbursements.
          </div>
        </div>
      )}

      <Card>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 16 }}>
          <thead>
            <tr>
              <Th>Name</Th>
              {tab === 'earning' && <><Th>Earning Type</Th><Th>Calculation Type</Th><Th>Consider for EPF</Th><Th>Consider for ESI</Th></>}
              {tab === 'deduction' && <><Th>Deduction Type</Th><Th>Deduction Frequency</Th></>}
              {tab === 'benefit' && <><Th>Benefit Type</Th><Th>Benefit Frequency</Th></>}
              {tab === 'reimbursement' && <><Th>Reimbursement Type</Th><Th right>Maximum Reimbursable Amount</Th></>}
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {tab === 'earning' && earnings.map((r) => (
              <tr key={r.live?.id ?? r.name} className="phm-row" onClick={() => setForm(r.live ? formFromPayHead(r.live, usedCodes.has(r.live.code)) : formFromEarning(r))} style={{ cursor: 'pointer' }}>
                <Td><NameCell name={r.name} fbp={r.fbp} /></Td>
                <Td muted>{r.type}</Td>
                <Td muted>{r.calc}</Td>
                <Td><YesNo value={r.epf} /></Td>
                <Td><YesNo value={r.esi} /></Td>
                <Td><StatusText status={r.status} /></Td>
              </tr>
            ))}
            {tab === 'deduction' && deductions.map((r) => (
              <tr key={r.live?.id ?? r.name} className="phm-row" onClick={() => setDForm(formFromDeduction(r, r.live ? usedCodes.has(r.live.code) : false))} style={{ cursor: 'pointer' }}>
                <Td><NameCell name={r.name} /></Td>
                <Td muted>{r.type}</Td>
                <Td muted>{r.frequency}</Td>
                <Td><StatusText status={r.status} /></Td>
              </tr>
            ))}
            {tab === 'benefit' && catalog.benefits.map((r) => (
              <tr key={r.name} className="phm-row" onClick={() => setBForm(formFromBenefit(r))} style={{ cursor: 'pointer' }}>
                <Td><NameCell name={r.name} /></Td>
                <Td muted>{r.type}</Td>
                <Td muted>{r.frequency}</Td>
                <Td><StatusText status={r.status} /></Td>
              </tr>
            ))}
            {tab === 'reimbursement' && catalog.reimbursements.map((r) => (
              <tr key={r.name} className="phm-row" onClick={() => setRForm(formFromReimbursement(r))} style={{ cursor: 'pointer' }}>
                <Td><NameCell name={r.name} /></Td>
                <Td muted>{r.type}</Td>
                <Td right mono>{r.max}</Td>
                <Td><StatusText status={r.status} /></Td>
              </tr>
            ))}
            {COUNTS[tab] === 0 && (
              <tr><td colSpan={6} style={{ padding: '28px 16px', textAlign: 'center', color: '#9A9AA5', fontSize: 15 }}>No components yet — add one to get started.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {form && <EarningModal form={form} setForm={setForm} onClose={() => setForm(null)} onSave={() => void saveForm()} saving={saving} takenTypes={takenTypes}
        onDelete={form.id ? () => void removeComponent(form.id!, form.name) : undefined} />}
      {dForm && <DeductionModal form={dForm} setForm={setDForm} onClose={() => setDForm(null)} onSave={() => void saveDeduction()} saving={saving}
        onDelete={dForm.id ? () => void removeComponent(dForm.id!, dForm.payslipName) : undefined} />}
      {bForm && <BenefitModal form={bForm} setForm={setBForm} onClose={() => setBForm(null)} onSave={saveBenefit} />}
      {rForm && <ReimbursementModal form={rForm} setForm={setRForm} onClose={() => setRForm(null)} onSave={saveReimbursement} />}
    </div>
  );
}

// —— Add / Edit Reimbursement modal ————————————————————————————————————
function ReimbursementModal({ form, setForm, onClose, onSave }: { form: RForm; setForm: (f: RForm) => void; onClose: () => void; onSave: () => void }) {
  const set = <K extends keyof RForm>(k: K, v: RForm[K]) => setForm({ ...form, [k]: v });
  const locked = form.associated; // only Name in Payslip + Amount editable once associated

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 244, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 14px' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(34,34,34,.4)', animation: 'ovl .2s ease both' }} />
      <div className="scry" style={modalCard}>
        <div style={modalHead}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.3px' }}>{form.isNew ? 'New Reimbursement' : 'Edit Reimbursement'}</div>
          </div>
          <CloseButton onClose={onClose} />
        </div>

        <div className="scry" style={{ padding: '20px 26px', overflowY: 'auto', flex: 1 }}>
          <div style={{ ...panelCard, maxWidth: 640 }}>
            <Field label="Reimbursement Type" req>
              {form.isNew ? (
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, ...(NO_PRETICK_REIMB.has(e.target.value) ? { fbp: false, fbpRestrict: false } : {}) })} style={inputStyle}>
                  <option value="">Select</option>
                  {REIMB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              ) : (
                <input value={form.type} disabled style={{ ...inputStyle, background: '#F7F7F9', color: '#717171' }} />
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

            <Checkbox checked={form.active} disabled={locked} onChange={(v) => set('active', v)} label="Mark this as Active" />

            <div style={{ background: '#F6E9D5', border: '1px solid #ECD9B4', borderRadius: 10, padding: '12px 14px', fontSize: 14, color: '#8A6A20', lineHeight: 1.5, marginTop: 16 }}>
              <strong>Note:</strong> Once you associate this component with an employee, you’ll only be able to edit the <strong>Name in Payslip</strong> and <strong>Amount</strong>. Changes to the amount apply only to new employees.
            </div>
          </div>
        </div>

        <div style={modalFoot}>
          <span style={{ marginRight: 'auto', fontSize: 13, color: '#A8475F' }}>* indicates mandatory fields</span>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={onSave} style={primaryBtn}>Save</button>
        </div>
      </div>
    </div>
  );
}

// —— Add / Edit Benefit modal ——————————————————————————————————————————
function BenefitModal({ form, setForm, onClose, onSave }: { form: BForm; setForm: (f: BForm) => void; onClose: () => void; onSave: () => void }) {
  const set = <K extends keyof BForm>(k: K, v: BForm[K]) => setForm({ ...form, [k]: v });
  const locked = form.associated; // only Name in Payslip editable once associated
  const showEmployerSuper = planShowsEmployerSuper(form.plan);

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 244, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 14px' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(34,34,34,.4)', animation: 'ovl .2s ease both' }} />
      <div className="scry" style={modalCard}>
        <div style={modalHead}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.3px' }}>{form.isNew ? 'New Benefit' : 'Edit Benefit'}</div>
          </div>
          <CloseButton onClose={onClose} />
        </div>

        <div className="scry" style={{ padding: '20px 26px', overflowY: 'auto', flex: 1 }}>
          <div style={{ ...panelCard, maxWidth: 640 }}>
            <Field label="Benefit Plan" req>
              {form.isNew ? (
                <select value={form.plan} onChange={(e) => set('plan', e.target.value)} style={inputStyle}>
                  <option value="">Select a Benefit Plan</option>
                  {BENEFIT_PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              ) : (
                <input value={form.plan} disabled style={{ ...inputStyle, background: '#F7F7F9', color: '#717171' }} />
              )}
            </Field>

            <Field label="Associate this benefit with">
              {form.isNew ? (
                <select value={form.investment} onChange={(e) => set('investment', e.target.value)} style={inputStyle}>
                  <option value="">Select an Investment</option>
                  {INVESTMENTS.map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.items.map((i) => <option key={i} value={i}>{i}</option>)}
                    </optgroup>
                  ))}
                </select>
              ) : (
                <input value={form.investment} placeholder="Select an Investment" disabled style={{ ...inputStyle, background: '#F7F7F9', color: '#717171' }} />
              )}
            </Field>

            <Field label="Name in Payslip" req>
              <input value={form.payslipName} onChange={(e) => set('payslipName', e.target.value)} placeholder="e.g. Voluntary Provident Fund" style={inputStyle} />
            </Field>

            {showEmployerSuper && (
              <>
                <Checkbox checked={form.employerContribution} disabled={locked} onChange={(v) => set('employerContribution', v)} label="Include employer's contribution in employee's salary structure." />
                <Checkbox checked={form.superannuation} disabled={locked} onChange={(v) => set('superannuation', v)} label="Consider this a superannuation fund" />
              </>
            )}
            <Checkbox checked={form.proRata} disabled={locked} onChange={(v) => set('proRata', v)} label="Calculate on pro-rata basis" />

            <div style={{ marginTop: 8 }}>
              <Checkbox checked={form.active} disabled={locked} onChange={(v) => set('active', v)} label="Mark this as Active" />
            </div>

            <div style={{ background: '#F6E9D5', border: '1px solid #ECD9B4', borderRadius: 10, padding: '12px 14px', fontSize: 14, color: '#8A6A20', lineHeight: 1.5, marginTop: 16 }}>
              <strong>Note:</strong> Once you associate this benefit with an employee, you’ll only be able to edit the <strong>Name in Payslip</strong>. The change will be reflected in both new and existing employees.
            </div>
          </div>
        </div>

        <div style={modalFoot}>
          <span style={{ marginRight: 'auto', fontSize: 13, color: '#A8475F' }}>* indicates mandatory fields</span>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={onSave} style={primaryBtn}>Save</button>
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
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(34,34,34,.4)', animation: 'ovl .2s ease both' }} />
      <div className="scry" style={modalCard}>
        <div style={modalHead}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.3px' }}>{form.isNew ? 'New Deduction' : 'Edit Deduction'}</div>
          </div>
          <CloseButton onClose={onClose} />
        </div>

        <div className="scry" style={{ padding: '20px 26px', overflowY: 'auto', flex: 1 }}>
          <div style={{ ...panelCard, maxWidth: 640 }}>
            {!form.isNew && (
              <Field label="Deduction Type" req>
                <input value={form.type} disabled style={{ ...inputStyle, background: '#F7F7F9', color: '#717171' }} />
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

            <div style={{ background: '#F6E9D5', border: '1px solid #ECD9B4', borderRadius: 10, padding: '12px 14px', fontSize: 14, color: '#8A6A20', lineHeight: 1.5, marginTop: 16 }}>
              <strong>Note:</strong> Once you associate this deduction with an employee, you’ll only be able to edit the <strong>Name in Payslip</strong>. The change will be reflected in both new and existing employees.
            </div>
          </div>
        </div>

        <div style={modalFoot}>
          <span style={{ marginRight: 'auto', fontSize: 13, color: '#A8475F' }}>* indicates mandatory fields</span>
          {onDelete && <DeleteButton onDelete={onDelete} busy={saving} />}
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={onSave} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
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
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(34,34,34,.4)', animation: 'ovl .2s ease both' }} />
      <div className="scry" style={modalCard}>
        {/* Header */}
        <div style={modalHead}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.3px' }}>{form.isNew ? 'Add Earning' : 'Edit Earning'}</div>
          </div>
          <CloseButton onClose={onClose} />
        </div>

        {/* Body */}
        <div className="scry" style={{ padding: '20px 26px', overflowY: 'auto', flex: 1 }}>
          {/* Earning Type — full width, with the nature helper */}
          <div style={panelCard}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
              <Field label="Earning Type" req>
                {form.isNew ? (
                  <select value={form.type} onChange={(e) => setForm({ ...blankEarning(e.target.value), name: form.name, payslipName: form.payslipName })} style={inputStyle}>
                    {ADD_TYPES.map((t) => <option key={t} value={t} disabled={takenTypes.has(t)}>{takenTypes.has(t) ? `${t} (already added)` : t}</option>)}
                  </select>
                ) : (
                  <input value={form.type} disabled style={{ ...inputStyle, background: '#F7F7F9', color: '#717171' }} />
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
                  </Field>
                  {form.calcMode === 'percentage' ? (
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
            <div style={{ background: '#F6E9D5', border: '1px solid #ECD9B4', borderRadius: 10, padding: '12px 14px', fontSize: 14, color: '#8A6A20', lineHeight: 1.5, marginTop: 18 }}>
              <strong>Note:</strong> This component is already associated with one or more employees, so you can only edit the <strong>Name</strong> and <strong>Amount/Percentage</strong>. Changes to the amount will apply only to new employees.
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={modalFoot}>
          <span style={{ marginRight: 'auto', fontSize: 13, color: '#A8475F' }}>* indicates mandatory fields</span>
          {onDelete && <DeleteButton onDelete={onDelete} busy={saving} />}
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={onSave} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
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
      style={{ ...ghostBtn, color: '#A8475F', borderColor: confirming ? '#A8475F' : '#EBD9DE', background: confirming ? '#FBEFF2' : '#fff' }}
    >
      {confirming ? 'Click again to delete' : 'Delete'}
    </button>
  );
}
function NameCell({ name, fbp }: { name: string; fbp?: boolean }) {
  return (
    <span>
      <span style={{ fontWeight: 700, color: '#0571A6' }}>{name}</span>
      {fbp && <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: '#E4EDE0', color: '#0F6E56' }}>FBP</span>}
    </span>
  );
}
function YesNo({ value }: { value: string }) {
  const [main, ...rest] = value.split(' (');
  return (
    <span style={{ color: '#222222' }}>
      {main}
      {rest.length > 0 && <span style={{ color: '#9197A2', fontSize: 13 }}> ({rest.join(' (')}</span>}
    </span>
  );
}
function StatusText({ status }: { status: Status }) {
  return <span style={{ fontWeight: 700, color: status === 'Active' ? '#4F7A52' : '#9197A2' }}>{status}</span>;
}
function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return (
    <th style={{ textAlign: right ? 'right' : 'left', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', color: '#717171', fontWeight: 700, padding: '11px 14px', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>
      {children}
    </th>
  );
}
function Td({ children, muted, right, mono }: { children: ReactNode; muted?: boolean; right?: boolean; mono?: boolean }) {
  return (
    <td style={{ padding: '13px 14px', borderBottom: '1px solid #F0F0F2', color: muted ? '#484848' : '#222222', textAlign: right ? 'right' : 'left', fontVariantNumeric: mono ? 'tabular-nums' : undefined }}>
      {children}
    </td>
  );
}

function Field({ label, req, children, style }: { label: string; req?: boolean; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ marginBottom: 16, ...style }}>
      <label style={{ display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 6, color: '#484848' }}>
        {label}{req && <span style={{ color: '#C4382E', marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  );
}
function AmountInput({ value, onChange, suffix, prefix = '₹', disabled }: { value: string; onChange: (v: string) => void; suffix?: string; prefix?: string | null; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'stretch', border: '1px solid #EBEBEB', borderRadius: 10, overflow: 'hidden', background: '#fff', maxWidth: 200 }}>
        {prefix && <span style={{ padding: '9px 11px', background: '#F7F7F9', color: '#717171', fontWeight: 700, borderRight: '1px solid #EBEBEB' }}>{prefix}</span>}
        <input type="number" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={{ border: 'none', outline: 'none', padding: '9px 11px', fontSize: 16, fontFamily: 'inherit', width: 120, color: '#222222', background: 'none' }} />
      </div>
      {suffix && <span style={{ fontSize: 15, color: '#717171' }}>{suffix}</span>}
    </div>
  );
}
// `fixed`: set by the earning type — looks like any ticked box, can't be changed.
function Checkbox({ checked, onChange, label, disabled, fixed }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; fixed?: boolean }) {
  const off = disabled || fixed;
  return (
    <div style={{ display: 'flex', gap: 10, padding: '7px 0', opacity: disabled && !fixed ? 0.55 : 1 }} title={fixed ? 'Fixed for this earning type' : undefined}>
      <button type="button" disabled={off} aria-disabled={off} onClick={() => !off && onChange(!checked)}
        style={{ flexShrink: 0, width: 18, height: 18, marginTop: 2, borderRadius: 5, cursor: off ? 'default' : 'pointer', border: `1.5px solid ${checked ? '#0571A6' : '#C7CBD2'}`, background: checked ? '#0571A6' : '#fff', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, lineHeight: 1, padding: 0 }}>
        {checked ? '✓' : ''}
      </button>
      <div>
        <div style={{ fontSize: 15, color: '#222222' }}>{label}</div>
      </div>
    </div>
  );
}
function Radio({ checked, onChange, label, disabled, fixed }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean; fixed?: boolean }) {
  const off = disabled || fixed;
  return (
    <div style={{ display: 'flex', gap: 10, padding: '6px 0', opacity: disabled && !fixed ? 0.55 : 1, cursor: off ? 'default' : 'pointer' }} title={fixed ? 'Fixed for this earning type' : undefined} onClick={() => !off && onChange()}>
      <span style={{ flexShrink: 0, width: 17, height: 17, marginTop: 1, borderRadius: '50%', border: `1.5px solid ${checked ? '#0571A6' : '#C7CBD2'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {checked && <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#0571A6' }} />}
      </span>
      <div>
        <div style={{ fontSize: 15, color: '#222222' }}>{label}</div>
      </div>
    </div>
  );
}

const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 15px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const ghostBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '11px 20px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const inputStyle: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 10, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const modalCard: CSSProperties = { position: 'relative', width: '100%', maxHeight: '92vh', background: '#F7F7F9', borderRadius: 20, boxShadow: '0 30px 70px rgba(60,40,24,.3)', animation: 'pop .2s ease both', display: 'flex', flexDirection: 'column' };
const modalHead: CSSProperties = { padding: '20px 26px', borderBottom: '1px solid #EBEBEB', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 };
const modalFoot: CSSProperties = { padding: '14px 26px', borderTop: '1px solid #EBEBEB', display: 'flex', alignItems: 'center', gap: 11, background: '#fff', borderBottomLeftRadius: 20, borderBottomRightRadius: 20, flexShrink: 0 };
const panelCard: CSSProperties = { background: '#fff', border: '1px solid #EBEBEB', borderRadius: 14, padding: '18px 20px' };
const panelTitle: CSSProperties = { fontSize: 16, fontWeight: 800, marginBottom: 14 };
