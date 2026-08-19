// Per-state statutory rules editor (PRD §5.5). EPF & ESI are national and live in
// the calculation engine; this screen configures the state-varying rules:
// Professional Tax slabs, Labour Welfare Fund, and the Statutory Bonus min-wage floor.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import {
  deleteStatutoryRule,
  getStatutoryRule,
  listStatutoryRules,
  rupeesToPaise,
  upsertStatutoryRule,
} from '../../services/payroll';
import type {
  BonusRule,
  LwfEmployeeBasis,
  LwfEmployerBasis,
  PtRule,
  StatutoryRuleDTO,
  StatutoryRuleInput,
} from '../../services/payroll';
import { Card, EmptyRow } from '../ui';
import { IconPlus, IconClose } from '../icons';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const paiseToR = (p: number) => String(p / 100);
const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

// ——— form model ———
type PtSlabForm = { openEnded: boolean; upToRupees: string; amountRupees: string };
type LwfBasisForm = {
  mode: 'flat' | 'percentage' | 'multiple_of_employee';
  amountRupees: string;
  percent: string;
  capRupees: string;
  factor: string;
};
type BonusCatForm = { category: string; minWageRupees: string };
type StateForm = {
  state: string;
  pt: { enabled: boolean; slabs: PtSlabForm[] };
  lwf: {
    enabled: boolean;
    cycle: 'monthly' | 'half_yearly';
    deductionMonths: number[];
    employee: LwfBasisForm;
    employer: LwfBasisForm;
  };
  bonus: { enabled: boolean; ratePercent: string; categories: BonusCatForm[] };
};

function blankBasis(): LwfBasisForm {
  return { mode: 'flat', amountRupees: '0', percent: '0', capRupees: '', factor: '2' };
}
function blankForm(state: string): StateForm {
  return {
    state,
    pt: {
      enabled: false,
      slabs: [
        { openEnded: false, upToRupees: '25000', amountRupees: '0' },
        { openEnded: true, upToRupees: '', amountRupees: '200' },
      ],
    },
    lwf: {
      enabled: false,
      cycle: 'monthly',
      deductionMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      employee: blankBasis(),
      employer: { ...blankBasis(), mode: 'multiple_of_employee' },
    },
    bonus: { enabled: false, ratePercent: '8.33', categories: [{ category: 'skilled', minWageRupees: '12000' }] },
  };
}

function basisToForm(b: LwfEmployeeBasis | LwfEmployerBasis): LwfBasisForm {
  const f = blankBasis();
  f.mode = b.mode;
  if (b.mode === 'flat') f.amountRupees = paiseToR(b.amountPaise);
  else if (b.mode === 'percentage') {
    f.percent = String(b.percent);
    f.capRupees = b.capPaise != null ? paiseToR(b.capPaise) : '';
  } else f.factor = String(b.factor);
  return f;
}

function ruleToForm(dto: StatutoryRuleDTO): StateForm {
  const base = blankForm(dto.state);
  if (dto.pt) {
    base.pt = {
      enabled: true,
      slabs: dto.pt.slabs.map((s) => ({
        openEnded: s.upToPaise === null,
        upToRupees: s.upToPaise === null ? '' : paiseToR(s.upToPaise),
        amountRupees: paiseToR(s.amountPaise),
      })),
    };
  }
  if (dto.lwf) {
    base.lwf = {
      enabled: true,
      cycle: dto.lwf.cycle,
      deductionMonths: dto.lwf.deductionMonths,
      employee: basisToForm(dto.lwf.employee),
      employer: basisToForm(dto.lwf.employer),
    };
  }
  if (dto.bonus) {
    base.bonus = {
      enabled: true,
      ratePercent: String(dto.bonus.ratePercent),
      categories: Object.entries(dto.bonus.minWageByCategoryPaise).map(([category, paise]) => ({
        category,
        minWageRupees: paiseToR(paise),
      })),
    };
  }
  return base;
}

function basisToInput(f: LwfBasisForm, allowMultiple: boolean): LwfEmployeeBasis | LwfEmployerBasis {
  if (f.mode === 'percentage') {
    const capRupees = f.capRupees.trim();
    return { mode: 'percentage', percent: Number(f.percent) || 0, ...(capRupees ? { capPaise: rupeesToPaise(capRupees) } : {}) };
  }
  if (f.mode === 'multiple_of_employee' && allowMultiple) {
    return { mode: 'multiple_of_employee', factor: Number(f.factor) || 0 };
  }
  return { mode: 'flat', amountPaise: rupeesToPaise(f.amountRupees) };
}

function formToInput(f: StateForm): StatutoryRuleInput {
  const input: StatutoryRuleInput = {};
  if (f.pt.enabled) {
    const slabs: PtRule['slabs'] = f.pt.slabs.map((s) => ({
      upToPaise: s.openEnded ? null : rupeesToPaise(s.upToRupees),
      amountPaise: rupeesToPaise(s.amountRupees),
    }));
    input.pt = { slabs };
  }
  if (f.lwf.enabled) {
    input.lwf = {
      cycle: f.lwf.cycle,
      deductionMonths: [...f.lwf.deductionMonths].sort((a, b) => a - b),
      employee: basisToInput(f.lwf.employee, false) as LwfEmployeeBasis,
      employer: basisToInput(f.lwf.employer, true) as LwfEmployerBasis,
    };
  }
  if (f.bonus.enabled) {
    const minWageByCategoryPaise: Record<string, number> = {};
    for (const c of f.bonus.categories) {
      const key = c.category.trim().toLowerCase().replace(/\s+/g, '_');
      if (key) minWageByCategoryPaise[key] = rupeesToPaise(c.minWageRupees);
    }
    input.bonus = { ratePercent: Number(f.bonus.ratePercent) || 0, minWageByCategoryPaise } as BonusRule;
  }
  return input;
}

export function StatutoryRules() {
  const { flash } = useStore();
  const [states, setStates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<StateForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [newState, setNewState] = useState('');

  const loadList = async () => {
    setLoading(true);
    try {
      const rules = await listStatutoryRules();
      setStates(rules.map((r) => r.state));
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not load statutory rules');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openState = async (state: string) => {
    try {
      setForm(ruleToForm(await getStatutoryRule(state)));
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not load state');
    }
  };

  const addState = () => {
    const name = newState.trim();
    if (!name) return flash('Enter a state name');
    setForm(blankForm(name.toLowerCase()));
    setNewState('');
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      await upsertStatutoryRule(form.state, formToInput(form));
      flash(`${title(form.state)} rules saved`);
      await loadList();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save rules');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!form) return;
    setSaving(true);
    try {
      await deleteStatutoryRule(form.state);
      flash(`${title(form.state)} rules deleted`);
      setForm(null);
      await loadList();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not delete rules');
    } finally {
      setSaving(false);
    }
  };

  const upd = (patch: Partial<StateForm>) => form && setForm({ ...form, ...patch });

  return (
    <div>
      <div style={{ background: '#EEF3F7', border: '1px solid #D5E2EC', color: '#3C5A70', borderRadius: 12, padding: '11px 15px', fontSize: 14, marginBottom: 18 }}>
        <strong>EPF & ESI are national</strong> and configured in the calculation engine. This screen covers the state-varying rules:
        Professional Tax, Labour Welfare Fund, and the Statutory Bonus minimum-wage floor.
      </div>

      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
        {/* States list */}
        <div style={{ width: 240, flexShrink: 0 }}>
          <Card style={{ padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#717171', textTransform: 'uppercase', letterSpacing: '.04em', padding: '4px 6px 10px' }}>
              Configured states
            </div>
            {loading ? (
              <EmptyRow text="Loading…" />
            ) : states.length === 0 ? (
              <div style={{ padding: '8px 6px 12px', fontSize: 14, color: '#717171' }}>None yet — add a state below.</div>
            ) : (
              states.map((s) => (
                <button
                  key={s}
                  onClick={() => openState(s)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                    padding: '9px 10px', borderRadius: 9, fontSize: 16, fontWeight: 700, marginBottom: 2,
                    background: form?.state === s ? '#E7F4FB' : 'transparent', color: form?.state === s ? '#0571A6' : '#484848',
                  }}
                >
                  {title(s)}
                </button>
              ))
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 10, paddingTop: 10, borderTop: '1px solid #EBEBEB' }}>
              <input
                value={newState}
                onChange={(e) => setNewState(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addState()}
                placeholder="Add state…"
                style={{ ...inputStyle, padding: '7px 9px', fontSize: 14 }}
              />
              <button onClick={addState} style={{ ...iconBtn, background: '#0571A6', borderRadius: 9, padding: '0 9px' }}><IconPlus size={14} /></button>
            </div>
          </Card>
        </div>

        {/* Editor */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!form ? (
            <Card><EmptyRow text="Select a state to edit its rules, or add a new one." /></Card>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
                <h2 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{title(form.state)}</h2>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 9 }}>
                  <button onClick={remove} disabled={saving} style={{ ...ghostBtn, color: '#A8475F', borderColor: '#EBD9DE' }}>Delete state</button>
                  <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save rules'}</button>
                </div>
              </div>

              <PtEditor value={form.pt} onChange={(pt) => upd({ pt })} />
              <LwfEditor value={form.lwf} onChange={(lwf) => upd({ lwf })} />
              <BonusEditor value={form.bonus} onChange={(bonus) => upd({ bonus })} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ——— Section shell ———
function Section({ title: t, sub, enabled, onToggle, children }: { title: string; sub: string; enabled: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <Card style={{ padding: '16px 18px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{t}</div>
          <div style={{ fontSize: 14, color: '#717171', marginTop: 2 }}>{sub}</div>
        </div>
        <Switch on={enabled} onToggle={onToggle} />
      </div>
      {enabled && <div style={{ marginTop: 16 }}>{children}</div>}
    </Card>
  );
}

function PtEditor({ value, onChange }: { value: StateForm['pt']; onChange: (v: StateForm['pt']) => void }) {
  const setSlab = (i: number, patch: Partial<PtSlabForm>) =>
    onChange({ ...value, slabs: value.slabs.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const addSlab = () => onChange({ ...value, slabs: [...value.slabs, { openEnded: false, upToRupees: '', amountRupees: '0' }] });
  const removeSlab = (i: number) => onChange({ ...value, slabs: value.slabs.filter((_, j) => j !== i) });

  return (
    <Section title="Professional Tax" sub="Slabs on monthly gross. One slab must be open-ended (the top band)." enabled={value.enabled} onToggle={() => onChange({ ...value, enabled: !value.enabled })}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {value.slabs.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={chipCheck}>
              <input type="checkbox" checked={s.openEnded} onChange={(e) => setSlab(i, { openEnded: e.target.checked })} /> Top band
            </label>
            <span style={{ fontSize: 14, color: '#717171' }}>Gross up to ₹</span>
            <input type="number" disabled={s.openEnded} value={s.upToRupees} onChange={(e) => setSlab(i, { upToRupees: e.target.value })} placeholder={s.openEnded ? '∞' : '25000'} style={{ ...inputStyle, width: 120, opacity: s.openEnded ? 0.5 : 1 }} />
            <span style={{ fontSize: 14, color: '#717171' }}>→ PT ₹</span>
            <input type="number" value={s.amountRupees} onChange={(e) => setSlab(i, { amountRupees: e.target.value })} style={{ ...inputStyle, width: 100 }} />
            <button onClick={() => removeSlab(i)} style={iconBtn}><IconClose size={14} /></button>
          </div>
        ))}
      </div>
      <button onClick={addSlab} style={{ ...ghostBtn, marginTop: 10, fontSize: 14, padding: '6px 12px' }}>+ Add slab</button>
    </Section>
  );
}

function BasisEditor({ label, value, onChange, allowMultiple }: { label: string; value: LwfBasisForm; onChange: (v: LwfBasisForm) => void; allowMultiple: boolean }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#484848', marginBottom: 6 }}>{label}</div>
      <select value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value as LwfBasisForm['mode'] })} style={{ ...inputStyle, marginBottom: 8 }}>
        <option value="flat">Flat amount</option>
        <option value="percentage">Percentage of gross</option>
        {allowMultiple && <option value="multiple_of_employee">Multiple of employee</option>}
      </select>
      {value.mode === 'flat' && (
        <Labeled label="Amount (₹)"><input type="number" value={value.amountRupees} onChange={(e) => onChange({ ...value, amountRupees: e.target.value })} style={inputStyle} /></Labeled>
      )}
      {value.mode === 'percentage' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <Labeled label="Percent"><input type="number" step="0.01" value={value.percent} onChange={(e) => onChange({ ...value, percent: e.target.value })} style={inputStyle} /></Labeled>
          <Labeled label="Cap (₹, optional)"><input type="number" value={value.capRupees} onChange={(e) => onChange({ ...value, capRupees: e.target.value })} style={inputStyle} /></Labeled>
        </div>
      )}
      {value.mode === 'multiple_of_employee' && (
        <Labeled label="× employee contribution"><input type="number" step="0.1" value={value.factor} onChange={(e) => onChange({ ...value, factor: e.target.value })} style={inputStyle} /></Labeled>
      )}
    </div>
  );
}

function LwfEditor({ value, onChange }: { value: StateForm['lwf']; onChange: (v: StateForm['lwf']) => void }) {
  const toggleMonth = (m: number) =>
    onChange({ ...value, deductionMonths: value.deductionMonths.includes(m) ? value.deductionMonths.filter((x) => x !== m) : [...value.deductionMonths, m] });

  return (
    <Section title="Labour Welfare Fund" sub="Amount and deduction cycle both vary by state (e.g. Haryana monthly, Delhi half-yearly)." enabled={value.enabled} onToggle={() => onChange({ ...value, enabled: !value.enabled })}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <Labeled label="Cycle" style={{ width: 180 }}>
          <select value={value.cycle} onChange={(e) => onChange({ ...value, cycle: e.target.value as 'monthly' | 'half_yearly' })} style={inputStyle}>
            <option value="monthly">Monthly</option>
            <option value="half_yearly">Half-yearly</option>
          </select>
        </Labeled>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#484848', marginBottom: 6 }}>Deduction months</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {MONTHS.map((label, idx) => {
              const m = idx + 1;
              const on = value.deductionMonths.includes(m);
              return (
                <button key={m} onClick={() => toggleMonth(m)} style={{ border: '1px solid ' + (on ? '#0571A6' : '#EBEBEB'), background: on ? '#E7F4FB' : '#fff', color: on ? '#0571A6' : '#717171', borderRadius: 8, padding: '5px 9px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 18 }}>
        <BasisEditor label="Employee contribution" value={value.employee} onChange={(employee) => onChange({ ...value, employee })} allowMultiple={false} />
        <BasisEditor label="Employer contribution" value={value.employer} onChange={(employer) => onChange({ ...value, employer })} allowMultiple />
      </div>
    </Section>
  );
}

function BonusEditor({ value, onChange }: { value: StateForm['bonus']; onChange: (v: StateForm['bonus']) => void }) {
  const setCat = (i: number, patch: Partial<BonusCatForm>) => onChange({ ...value, categories: value.categories.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const addCat = () => onChange({ ...value, categories: [...value.categories, { category: '', minWageRupees: '0' }] });
  const removeCat = (i: number) => onChange({ ...value, categories: value.categories.filter((_, j) => j !== i) });

  return (
    <Section title="Statutory Bonus" sub="Rate applied to whichever is higher of Basic or the state minimum wage for the employee's category." enabled={value.enabled} onToggle={() => onChange({ ...value, enabled: !value.enabled })}>
      <Labeled label="Rate (%)" style={{ width: 160, marginBottom: 14 }}>
        <input type="number" step="0.01" value={value.ratePercent} onChange={(e) => onChange({ ...value, ratePercent: e.target.value })} style={inputStyle} />
      </Labeled>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#484848', marginBottom: 8 }}>Monthly minimum wage by category</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {value.categories.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input value={c.category} onChange={(e) => setCat(i, { category: e.target.value })} placeholder="e.g. skilled" style={{ ...inputStyle, width: 200 }} />
            <span style={{ fontSize: 14, color: '#717171' }}>₹</span>
            <input type="number" value={c.minWageRupees} onChange={(e) => setCat(i, { minWageRupees: e.target.value })} style={{ ...inputStyle, width: 140 }} />
            <button onClick={() => removeCat(i)} style={iconBtn}><IconClose size={14} /></button>
          </div>
        ))}
      </div>
      <button onClick={addCat} style={{ ...ghostBtn, marginTop: 10, fontSize: 14, padding: '6px 12px' }}>+ Add category</button>
    </Section>
  );
}

// ——— small pieces ———
function Labeled({ label, children, style }: { label: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ flex: 1, ...style }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#484848', marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}
function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} style={{ width: 40, height: 23, borderRadius: 20, border: 'none', cursor: 'pointer', background: on ? '#0571A6' : '#EBEBEB', position: 'relative', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 19 : 2, width: 19, height: 19, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
    </button>
  );
}

const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #EBEBEB', borderRadius: 9, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const chipCheck: CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, fontSize: 14, fontWeight: 700, color: '#484848', whiteSpace: 'nowrap' };
const primaryBtn: CSSProperties = { background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const ghostBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const iconBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: 4 };
