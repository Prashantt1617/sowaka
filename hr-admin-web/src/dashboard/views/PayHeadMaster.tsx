// Payroll › Salary Components — the org's reusable component catalog, split across
// four category tabs (Earnings / Deductions / Benefits / Reimbursements). Columns
// mirror the Zoho Payroll salary-components screens.
//
// NOTE: frontend-capture phase — renders from local mock data, no API calls.
// Reconnect listPayHeads/createPayHead/updatePayHead/deletePayHead when finalising.
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
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
type EarningRow = { name: string; type: string; calc: string; epf: string; esi: string; fbp?: boolean; status: Status };
type DeductionRow = { name: string; type: string; frequency: string; status: Status };
type BenefitRow = { name: string; type: string; frequency: string; status: Status };
type ReimbRow = { name: string; type: string; max: string; status: Status };

const EARNINGS: EarningRow[] = [
  { name: 'Basic', type: 'Basic', calc: 'Fixed; 50% of CTC', epf: 'Yes', esi: 'Yes', status: 'Active' },
  { name: 'Basic Pay', type: 'Basic', calc: 'Fixed; Flat Amount', epf: 'Yes', esi: 'Yes', status: 'Active' },
  { name: 'House Rent Allowance', type: 'House Rent Allowance', calc: 'Fixed; 50% of Basic', epf: 'No', esi: 'Yes', status: 'Active' },
  { name: 'Conveyance Allowance', type: 'Conveyance Allowance', calc: 'Fixed; 10000 per month', epf: 'No', esi: 'No', fbp: true, status: 'Inactive' },
  { name: 'Children Education Allowance', type: 'Children Education Allowance', calc: 'Fixed; Flat Amount', epf: 'Yes (If PF Wage < 15k)', esi: 'Yes', status: 'Inactive' },
  { name: 'Transport Allowance', type: 'Transport Allowance', calc: 'Fixed; Flat amount of 1600', epf: 'Yes (If PF Wage < 15k)', esi: 'Yes', status: 'Inactive' },
  { name: 'Travelling Allowance', type: 'Travelling Allowance', calc: 'Fixed; 10000 per month', epf: 'No', esi: 'No', fbp: true, status: 'Inactive' },
  { name: 'Meal Card', type: 'Food Coupon', calc: 'Fixed; 8800 per month', epf: 'No', esi: 'No', fbp: true, status: 'Active' },
  { name: 'Books and periodicals allowance', type: 'Books and Periodicals Allowance', calc: 'Fixed; 3000 per month', epf: 'No', esi: 'No', fbp: true, status: 'Active' },
  { name: 'Communication Allowance', type: 'Telephone And Internet Allowance', calc: 'Fixed; 1800 per month', epf: 'No', esi: 'No', fbp: true, status: 'Active' },
  { name: 'LTA', type: 'Leave Travel Allowance', calc: 'Fixed; 8329 per month', epf: 'No', esi: 'No', fbp: true, status: 'Inactive' },
  { name: 'Fixed Allowance', type: 'Fixed Allowance', calc: 'Fixed; Flat Amount', epf: 'Yes (If PF Wage < 15k)', esi: 'Yes', status: 'Active' },
  { name: 'Statutory Bonus', type: 'Statutory Bonus', calc: 'Fixed; 8.33% of Basic', epf: 'No', esi: 'No', status: 'Active' },
];
const DEDUCTIONS: DeductionRow[] = [
  { name: 'Food Coupon Deduction', type: 'Food Coupon Deduction', frequency: 'One Time', status: 'Active' },
  { name: 'Hold Amount', type: 'Other Deductions', frequency: 'One Time', status: 'Active' },
  { name: 'Salary Advance Deduction', type: 'Other Deductions', frequency: 'One Time', status: 'Active' },
  { name: 'Notice Pay Deduction', type: 'Notice Pay Deduction', frequency: 'One Time', status: 'Active' },
];
const BENEFITS: BenefitRow[] = [
  { name: 'Voluntary Provident Fund', type: 'Voluntary Provident Fund', frequency: 'Recurring', status: 'Active' },
  { name: 'Gratuity -Deduction', type: 'Other Non-Taxable Deduction', frequency: 'Recurring', status: 'Active' },
  { name: 'Food Coupons', type: 'Other Non-Taxable Deduction', frequency: 'Recurring', status: 'Active' },
];
const REIMBURSEMENTS: ReimbRow[] = [
  { name: 'Fuel Reimbursement', type: 'Fuel Reimbursement', max: '₹15,000', status: 'Active' },
  { name: 'Driver Reimbursement', type: 'Driver Reimbursement', max: '₹0', status: 'Inactive' },
  { name: 'Vehicle Maintenance Reimbursement', type: 'Vehicle Maintenance Reimbursement', max: '₹0', status: 'Inactive' },
  { name: 'Telephone Reimbursement', type: 'Telephone Reimbursement', max: '₹0', status: 'Inactive' },
  { name: 'Leave Travel Allowance', type: 'Leave Travel Allowance', max: '₹8,333', status: 'Active' },
  { name: 'Books and Periodicals Reimbursement', type: 'Books and Periodicals Reimbursement', max: '₹3,000', status: 'Active' },
  { name: 'Internet Reimbursement', type: 'Internet Reimbursement', max: '₹1,800', status: 'Active' },
];

const COUNTS: Record<Cat, number> = {
  earning: EARNINGS.length,
  deduction: DEDUCTIONS.length,
  benefit: BENEFITS.length,
  reimbursement: REIMBURSEMENTS.length,
};

// —— Per-earning-type spec ————————————————————————————————————————————
// Every earning renders from one form; only these knobs differ by type.
const FIXED_NOTE = 'Fixed amount paid at the end of every month.';
const VARIABLE_NOTE = 'Variable amount paid during any payroll.';
type Fbp = 'none' | 'optional' | 'forced';
type Spec = {
  nature: 'fixed' | 'variable';
  note: string;
  calcBase: 'ctc' | 'basic' | null; // null → no Calculation Type (FBP or variable)
  fbp: Fbp;
  epfSubChoice: boolean; // reveal Always / PF<15k when EPF is on
  taxDeductionPref: boolean; // variable bonus only
};
const SPECS: Record<string, Spec> = {
  Basic: { nature: 'fixed', note: FIXED_NOTE, calcBase: 'ctc', fbp: 'none', epfSubChoice: true, taxDeductionPref: false },
  'House Rent Allowance': { nature: 'fixed', note: FIXED_NOTE, calcBase: 'basic', fbp: 'optional', epfSubChoice: true, taxDeductionPref: false },
  'Children Education Allowance': { nature: 'fixed', note: FIXED_NOTE, calcBase: 'basic', fbp: 'optional', epfSubChoice: true, taxDeductionPref: false },
  'Transport Allowance': { nature: 'fixed', note: FIXED_NOTE, calcBase: 'basic', fbp: 'optional', epfSubChoice: true, taxDeductionPref: false },
  'Fixed Allowance': { nature: 'fixed', note: FIXED_NOTE, calcBase: 'basic', fbp: 'optional', epfSubChoice: true, taxDeductionPref: false },
  'Statutory Bonus': { nature: 'fixed', note: FIXED_NOTE, calcBase: 'basic', fbp: 'none', epfSubChoice: false, taxDeductionPref: false },
  'Conveyance Allowance': { nature: 'fixed', note: FIXED_NOTE, calcBase: null, fbp: 'forced', epfSubChoice: false, taxDeductionPref: false },
  'Travelling Allowance': { nature: 'fixed', note: FIXED_NOTE, calcBase: null, fbp: 'forced', epfSubChoice: false, taxDeductionPref: false },
  'Food Coupon': { nature: 'fixed', note: FIXED_NOTE, calcBase: null, fbp: 'forced', epfSubChoice: false, taxDeductionPref: false },
  'Books and Periodicals Allowance': { nature: 'fixed', note: FIXED_NOTE, calcBase: null, fbp: 'forced', epfSubChoice: false, taxDeductionPref: false },
  'Telephone And Internet Allowance': { nature: 'fixed', note: FIXED_NOTE, calcBase: null, fbp: 'forced', epfSubChoice: false, taxDeductionPref: false },
  'Leave Travel Allowance': { nature: 'fixed', note: FIXED_NOTE, calcBase: null, fbp: 'forced', epfSubChoice: false, taxDeductionPref: false },
  'Overtime Allowance': { nature: 'variable', note: VARIABLE_NOTE, calcBase: null, fbp: 'none', epfSubChoice: false, taxDeductionPref: false },
  Bonus: { nature: 'variable', note: VARIABLE_NOTE, calcBase: null, fbp: 'none', epfSubChoice: false, taxDeductionPref: true },
};
const DEFAULT_SPEC: Spec = { nature: 'fixed', note: FIXED_NOTE, calcBase: 'basic', fbp: 'optional', epfSubChoice: true, taxDeductionPref: false };
const specFor = (type: string): Spec => SPECS[type] ?? DEFAULT_SPEC;
const ADD_TYPES = Object.keys(SPECS);

type EForm = {
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
  epfWhen: 'always' | 'pf15k';
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
    taxPref: 'subsequent', epf: r.epf.startsWith('Yes'), epfWhen: r.epf.includes('PF Wage') ? 'pf15k' : 'always',
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
    epf: false, epfWhen: 'always', esi: false, showInPayslip: true,
  };
}

// —— Deduction form ————————————————————————————————————————————————————
type DForm = {
  isNew: boolean;
  associated: boolean; // once associated, only Name in Payslip is editable
  type: string;
  payslipName: string;
  frequency: 'one_time' | 'recurring';
  active: boolean;
};
function formFromDeduction(r: DeductionRow): DForm {
  return { isNew: false, associated: true, type: r.type, payslipName: r.name, frequency: r.frequency === 'Recurring' ? 'recurring' : 'one_time', active: r.status === 'Active' };
}
function blankDeduction(): DForm {
  return { isNew: true, associated: false, type: 'Other Deductions', payslipName: '', frequency: 'one_time', active: true };
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
  const [tab, setTab] = useState<Cat>('earning');
  const [form, setForm] = useState<EForm | null>(null);
  const [dForm, setDForm] = useState<DForm | null>(null);
  const [bForm, setBForm] = useState<BForm | null>(null);
  const [rForm, setRForm] = useState<RForm | null>(null);

  const onAdd = () => {
    if (tab === 'earning') setForm(blankEarning('Fixed Allowance'));
    else if (tab === 'deduction') setDForm(blankDeduction());
    else if (tab === 'benefit') setBForm(blankBenefit());
    else setRForm(blankReimbursement());
  };
  const saveForm = () => {
    if (!form) return;
    if (!form.name.trim()) return flash('Please enter an earning name');
    flash(form.isNew ? `${form.name} added` : `${form.name} updated`);
    setForm(null);
  };
  const saveDeduction = () => {
    if (!dForm) return;
    if (!dForm.payslipName.trim()) return flash('Please enter the name in payslip');
    flash(dForm.isNew ? `${dForm.payslipName} added` : `${dForm.payslipName} updated`);
    setDForm(null);
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
            {tab === 'earning' && EARNINGS.map((r) => (
              <tr key={r.name} className="phm-row" onClick={() => setForm(formFromEarning(r))} style={{ cursor: 'pointer' }}>
                <Td><NameCell name={r.name} fbp={r.fbp} /></Td>
                <Td muted>{r.type}</Td>
                <Td muted>{r.calc}</Td>
                <Td><YesNo value={r.epf} /></Td>
                <Td><YesNo value={r.esi} /></Td>
                <Td><StatusText status={r.status} /></Td>
              </tr>
            ))}
            {tab === 'deduction' && DEDUCTIONS.map((r) => (
              <tr key={r.name} className="phm-row" onClick={() => setDForm(formFromDeduction(r))} style={{ cursor: 'pointer' }}>
                <Td><NameCell name={r.name} /></Td>
                <Td muted>{r.type}</Td>
                <Td muted>{r.frequency}</Td>
                <Td><StatusText status={r.status} /></Td>
              </tr>
            ))}
            {tab === 'benefit' && BENEFITS.map((r) => (
              <tr key={r.name} className="phm-row" onClick={() => setBForm(formFromBenefit(r))} style={{ cursor: 'pointer' }}>
                <Td><NameCell name={r.name} /></Td>
                <Td muted>{r.type}</Td>
                <Td muted>{r.frequency}</Td>
                <Td><StatusText status={r.status} /></Td>
              </tr>
            ))}
            {tab === 'reimbursement' && REIMBURSEMENTS.map((r) => (
              <tr key={r.name} className="phm-row" onClick={() => setRForm(formFromReimbursement(r))} style={{ cursor: 'pointer' }}>
                <Td><NameCell name={r.name} /></Td>
                <Td muted>{r.type}</Td>
                <Td right mono>{r.max}</Td>
                <Td><StatusText status={r.status} /></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {form && <EarningModal form={form} setForm={setForm} onClose={() => setForm(null)} onSave={saveForm} />}
      {dForm && <DeductionModal form={dForm} setForm={setDForm} onClose={() => setDForm(null)} onSave={saveDeduction} />}
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
            <div style={{ fontSize: 14, color: '#717171', fontWeight: 500, marginTop: 2 }}>A payroll component employees can claim against, up to a monthly cap.</div>
          </div>
          <CloseButton onClose={onClose} />
        </div>

        <div className="scry" style={{ padding: '20px 26px', overflowY: 'auto', flex: 1 }}>
          <div style={{ ...panelCard, maxWidth: 640 }}>
            <Field label="Reimbursement Type" req>
              {form.isNew ? (
                <select value={form.type} onChange={(e) => set('type', e.target.value)} style={inputStyle}>
                  <option value="">Select</option>
                  {REIMB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              ) : (
                <input value={form.type} disabled style={{ ...inputStyle, background: '#F7F7F9', color: '#717171' }} />
              )}
            </Field>

            <Field label="Name in Payslip" req hint="How this reimbursement appears to the employee on their payslip.">
              <input value={form.payslipName} onChange={(e) => set('payslipName', e.target.value)} placeholder="e.g. Fuel Reimbursement" style={inputStyle} />
            </Field>

            <Checkbox checked={form.fbp} disabled={locked} onChange={(v) => set('fbp', v)} label="Include this as a Flexible Benefit Plan component"
              sub="FBP lets employees personalise their salary structure by choosing how much they want to receive under each FBP component." />
            {form.fbp && (
              <div style={{ marginLeft: 26 }}>
                <Checkbox checked={form.fbpRestrict} disabled={locked} onChange={(v) => set('fbpRestrict', v)} label="Restrict employee from overriding the FBP amount"
                  sub="Employees will be given the exact amount set below and cannot re-allocate it." />
              </div>
            )}

            <Field label="How do you want to handle unclaimed reimbursement?" style={{ marginTop: 14 }}>
              <Radio checked={form.unclaimed === 'carry_forward'} disabled={locked} onChange={() => set('unclaimed', 'carry_forward')} label="Carry forward and encash at the end of the fiscal year"
                sub="Unclaimed amounts accumulate and are paid out at year-end." />
              <Radio checked={form.unclaimed === 'encash_monthly'} disabled={locked} onChange={() => set('unclaimed', 'encash_monthly')} label="Do not carry forward and encash monthly"
                sub="Any unclaimed amount is paid out with that month’s payroll." />
            </Field>

            <Field label={form.fbp ? 'Enter Maximum Amount' : 'Enter Amount'} req hint="The most an employee can claim under this component each month.">
              <AmountInput suffix="per month" value={form.amount} onChange={(v) => set('amount', v)} disabled={false} />
            </Field>

            <Checkbox checked={form.active} disabled={locked} onChange={(v) => set('active', v)} label="Mark this as Active"
              sub="Only active components can be added to new salary structures." />

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
            <div style={{ fontSize: 14, color: '#717171', fontWeight: 500, marginTop: 2 }}>An employer-funded benefit plan added to the employee’s CTC.</div>
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

            <Field label="Associate this benefit with" hint="Link this benefit to the investment declaration it counts against.">
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

            <Field label="Name in Payslip" req hint="How this benefit appears to the employee on their payslip.">
              <input value={form.payslipName} onChange={(e) => set('payslipName', e.target.value)} placeholder="e.g. Voluntary Provident Fund" style={inputStyle} />
            </Field>

            {showEmployerSuper && (
              <>
                <Checkbox checked={form.employerContribution} disabled={locked} onChange={(v) => set('employerContribution', v)} label="Include employer's contribution in employee's salary structure." />
                <Checkbox checked={form.superannuation} disabled={locked} onChange={(v) => set('superannuation', v)} label="Consider this a superannuation fund"
                  sub="If the employer’s total contribution towards EPF, EPS, NPS and superannuation fund exceeds ₹7.5 lakh in a financial year, the excess amount will be treated as a taxable perquisite for the employee." />
              </>
            )}
            <Checkbox checked={form.proRata} disabled={locked} onChange={(v) => set('proRata', v)} label="Calculate on pro-rata basis"
              sub="Pay will be adjusted based on the employee’s working days." />

            <div style={{ marginTop: 8 }}>
              <Checkbox checked={form.active} disabled={locked} onChange={(v) => set('active', v)} label="Mark this as Active"
                sub="Only active components can be added to new salary structures." />
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
function DeductionModal({ form, setForm, onClose, onSave }: { form: DForm; setForm: (f: DForm) => void; onClose: () => void; onSave: () => void }) {
  const set = <K extends keyof DForm>(k: K, v: DForm[K]) => setForm({ ...form, [k]: v });
  const locked = form.associated; // only Name in Payslip editable once associated

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 244, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 14px' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(34,34,34,.4)', animation: 'ovl .2s ease both' }} />
      <div className="scry" style={modalCard}>
        <div style={modalHead}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.3px' }}>{form.isNew ? 'New Deduction' : 'Edit Deduction'}</div>
            <div style={{ fontSize: 14, color: '#717171', fontWeight: 500, marginTop: 2 }}>How this amount is withheld from the employee’s pay.</div>
          </div>
          <CloseButton onClose={onClose} />
        </div>

        <div className="scry" style={{ padding: '20px 26px', overflowY: 'auto', flex: 1 }}>
          <div style={{ ...panelCard, maxWidth: 640 }}>
            {!form.isNew && (
              <Field label="Deduction Type" req>
                <input value={form.type} disabled style={{ ...inputStyle, background: '#F7F7F9', color: '#717171' }} />
                <div style={{ fontSize: 12, color: '#9197A2', marginTop: 5 }}>The deduction type is set when the component is created and can’t be changed.</div>
              </Field>
            )}
            <Field label="Name in Payslip" req hint="How this deduction appears to the employee on their payslip.">
              <input value={form.payslipName} onChange={(e) => set('payslipName', e.target.value)} placeholder="e.g. Food Coupon Deduction" style={inputStyle} />
            </Field>
            <Field label="Select the deduction frequency" req>
              <Radio checked={form.frequency === 'one_time'} disabled={locked} onChange={() => set('frequency', 'one_time')} label="One-time deduction"
                sub="Withheld once, from a single payroll." />
              <Radio checked={form.frequency === 'recurring'} disabled={locked} onChange={() => set('frequency', 'recurring')} label="Recurring deduction for subsequent Payrolls"
                sub="Withheld every payroll until it is stopped." />
            </Field>
            <Checkbox checked={form.active} disabled={locked} onChange={(v) => set('active', v)} label="Mark this as Active"
              sub="Only active components can be added to new salary structures." />

            <div style={{ background: '#F6E9D5', border: '1px solid #ECD9B4', borderRadius: 10, padding: '12px 14px', fontSize: 14, color: '#8A6A20', lineHeight: 1.5, marginTop: 16 }}>
              <strong>Note:</strong> Once you associate this deduction with an employee, you’ll only be able to edit the <strong>Name in Payslip</strong>. The change will be reflected in both new and existing employees.
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

// —— Add / Edit Earning modal ————————————————————————————————————————
// Centered, near-full-screen modal (same shell as Add-a-user) — the extra room
// lets us keep every one of Zoho's inline helper texts alongside the fields.
function EarningModal({ form, setForm, onClose, onSave }: { form: EForm; setForm: (f: EForm) => void; onClose: () => void; onSave: () => void }) {
  const spec = specFor(form.type);
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
            <div style={{ fontSize: 14, color: '#717171', fontWeight: 500, marginTop: 2 }}>
              Define how this earning is calculated, taxed and shown on the payslip.
            </div>
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
                    {ADD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                ) : (
                  <input value={form.type} disabled style={{ ...inputStyle, background: '#F7F7F9', color: '#717171' }} />
                )}
                {!form.isNew && <div style={{ fontSize: 12, color: '#9197A2', marginTop: 5 }}>The earning type is set when the component is created and can’t be changed.</div>}
              </Field>
              <div style={noteTag}>ⓘ&nbsp; {spec.note}</div>
            </div>
          </div>

          {/* Two columns: details (left) · other configurations (right) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 18, alignItems: 'start' }}>
            {/* Left — details */}
            <div style={panelCard}>
              <div style={panelTitle}>Details</div>
              <Field label="Earning Name" req hint="The name used internally when building salary structures.">
                <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Special Allowance" style={inputStyle} />
              </Field>
              <Field label="Name in Payslip" req hint="How this component appears to the employee on their payslip.">
                <input value={form.payslipName} onChange={(e) => set('payslipName', e.target.value)} placeholder="Shown on the payslip" style={inputStyle} />
              </Field>

              {spec.fbp === 'forced' ? (
                <Field label="Enter Maximum Amount" req hint="The FBP cap for this component. Employees can’t exceed this amount in their FBP declarations, and once selected the amount can’t be edited by them.">
                  <AmountInput suffix="per month" value={form.amount} onChange={(v) => set('amount', v)} disabled={false} />
                </Field>
              ) : spec.calcBase ? (
                <>
                  <Field label="Calculation Type" req hint={spec.calcBase === 'ctc' ? 'A flat monthly figure, or a percentage of the total CTC.' : 'A flat monthly figure, or a percentage of the Basic component.'}>
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
              ) : (
                <div style={{ fontSize: 13.5, color: '#717171', background: '#F7F7F9', border: '1px solid #EBEBEB', borderRadius: 10, padding: '11px 13px', lineHeight: 1.5 }}>
                  This is a variable earning — no fixed amount is set here. The amount is entered for each employee while running that month’s payroll.
                </div>
              )}

              <div style={{ marginTop: 8 }}>
                <Checkbox checked={form.active} onChange={(v) => set('active', v)} label="Mark this as Active"
                  sub="Only active components can be added to new salary structures." />
              </div>
            </div>

            {/* Right — other configurations */}
            <div style={panelCard}>
              <div style={panelTitle}>Other Configurations</div>
              <Checkbox checked={form.partOfStructure} onChange={(v) => set('partOfStructure', v)} label="Make this earning a part of the employee’s salary structure"
                sub="When on, the component is part of the fixed monthly salary structure rather than a one-off payout." />
              <Checkbox checked={form.taxable} disabled={locked} onChange={(v) => set('taxable', v)} label="This is a taxable earning"
                sub="The income tax amount will be divided equally and deducted every month across the financial year." />

              {spec.nature === 'fixed' && (
                <Checkbox checked={form.proRata} disabled={locked} onChange={(v) => set('proRata', v)} label="Calculate on pro-rata basis"
                  sub="Pay will be adjusted based on the employee’s working days in the month." />
              )}

              {spec.fbp !== 'none' && (
                <>
                  <Checkbox checked={form.fbp} disabled={spec.fbp === 'forced'} onChange={(v) => set('fbp', v)} label="Include this as a Flexible Benefit Plan component"
                    sub="FBP lets employees personalise their salary structure by choosing how much they want to receive under each FBP component." />
                  {form.fbp && (
                    <div style={{ marginLeft: 26 }}>
                      <Checkbox checked={form.fbpRestrict} onChange={(v) => set('fbpRestrict', v)} label="Restrict employee from overriding the FBP amount"
                        sub="Employees will be given the exact amount set above and cannot re-allocate it." />
                    </div>
                  )}
                </>
              )}

              {spec.taxDeductionPref && form.taxable && (
                <Field label="Tax Deduction Preference" req style={{ marginTop: 12 }}>
                  <Radio checked={form.taxPref === 'subsequent'} disabled={locked} onChange={() => set('taxPref', 'subsequent')} label="Deduct tax in subsequent payrolls of the financial year"
                    sub="The income tax amount will be divided equally and deducted every month across the financial year." />
                  <Radio checked={form.taxPref === 'same'} disabled={locked} onChange={() => set('taxPref', 'same')} label="Deduct tax in same payroll"
                    sub="The entire income tax amount will be deducted when it is paid to the employee." />
                </Field>
              )}

              <Checkbox checked={form.epf} onChange={(v) => set('epf', v)} label="Consider for EPF Contribution"
                sub="Include this component in the wage on which the 12% Provident Fund contribution is calculated." />
              {form.epf && spec.epfSubChoice && (
                <div style={{ marginLeft: 26 }}>
                  <Radio checked={form.epfWhen === 'always'} onChange={() => set('epfWhen', 'always')} label="Always" />
                  <Radio checked={form.epfWhen === 'pf15k'} onChange={() => set('epfWhen', 'pf15k')} label="Only when PF Wage is less than ₹ 15,000"
                    sub="ⓘ Counted towards PF wage only until the ₹15,000 statutory ceiling is reached." />
                </div>
              )}
              <Checkbox checked={form.esi} disabled={locked} onChange={(v) => set('esi', v)} label="Consider for ESI Contribution"
                sub="Include this component when computing ESI eligibility and contribution." />
              <Checkbox checked={form.showInPayslip} disabled={locked} onChange={(v) => set('showInPayslip', v)} label="Show this component in payslip" />
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
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={onSave} style={primaryBtn}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ——— presentational helpers ———
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

function Field({ label, req, hint, children, style }: { label: string; req?: boolean; hint?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ marginBottom: 16, ...style }}>
      <label style={{ display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 6, color: '#484848' }}>
        {label}{req && <span style={{ color: '#C4382E', marginLeft: 2 }}>*</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize: 12, color: '#717171', marginTop: 5, lineHeight: 1.45 }}>{hint}</div>}
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
function Checkbox({ checked, onChange, label, sub, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; sub?: string; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '7px 0', opacity: disabled ? 0.55 : 1 }}>
      <button type="button" disabled={disabled} onClick={() => onChange(!checked)}
        style={{ flexShrink: 0, width: 18, height: 18, marginTop: 2, borderRadius: 5, cursor: disabled ? 'default' : 'pointer', border: `1.5px solid ${checked ? '#0571A6' : '#C7CBD2'}`, background: checked ? '#0571A6' : '#fff', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, lineHeight: 1, padding: 0 }}>
        {checked ? '✓' : ''}
      </button>
      <div>
        <div style={{ fontSize: 15, color: '#222222' }}>{label}</div>
        {sub && <div style={{ fontSize: 13, color: '#717171', marginTop: 2, lineHeight: 1.45 }}>{sub}</div>}
      </div>
    </div>
  );
}
function Radio({ checked, onChange, label, sub, disabled }: { checked: boolean; onChange: () => void; label: string; sub?: string; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '6px 0', opacity: disabled ? 0.55 : 1, cursor: disabled ? 'default' : 'pointer' }} onClick={() => !disabled && onChange()}>
      <span style={{ flexShrink: 0, width: 17, height: 17, marginTop: 1, borderRadius: '50%', border: `1.5px solid ${checked ? '#0571A6' : '#C7CBD2'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {checked && <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#0571A6' }} />}
      </span>
      <div>
        <div style={{ fontSize: 15, color: '#222222' }}>{label}</div>
        {sub && <div style={{ fontSize: 13, color: '#717171', marginTop: 2, lineHeight: 1.45 }}>{sub}</div>}
      </div>
    </div>
  );
}

const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 15px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const ghostBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '11px 20px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const inputStyle: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 10, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const noteTag: CSSProperties = { background: '#EAF2FB', color: '#3C6E9E', fontSize: 13.5, borderRadius: 10, padding: '11px 13px', lineHeight: 1.5 };
const modalCard: CSSProperties = { position: 'relative', width: '100%', maxHeight: '92vh', background: '#F7F7F9', borderRadius: 20, boxShadow: '0 30px 70px rgba(60,40,24,.3)', animation: 'pop .2s ease both', display: 'flex', flexDirection: 'column' };
const modalHead: CSSProperties = { padding: '20px 26px', borderBottom: '1px solid #EBEBEB', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 };
const modalFoot: CSSProperties = { padding: '14px 26px', borderTop: '1px solid #EBEBEB', display: 'flex', alignItems: 'center', gap: 11, background: '#fff', borderBottomLeftRadius: 20, borderBottomRightRadius: 20, flexShrink: 0 };
const panelCard: CSSProperties = { background: '#fff', border: '1px solid #EBEBEB', borderRadius: 14, padding: '18px 20px' };
const panelTitle: CSSProperties = { fontSize: 16, fontWeight: 800, marginBottom: 14 };
