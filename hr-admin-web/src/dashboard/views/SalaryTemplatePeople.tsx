// Payroll › Salary templates › a template: who is on it, and putting people on
// it — the same Employees / Edit employees pair the Shift templates have
// (TemplatePeople.tsx). Being on a salary template IS having a salary, so
// adding someone asks for their annual CTC (required) and the day it applies
// from, and saves it through the salary-structure path Salary details uses
// (same checks, same breakup preview). Someone on another template moves with
// their CTC. Nobody is taken off a template except by moving to another one:
// a salaried employee always needs one.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import type { Emp } from '../seed';
import { StatusTabs } from '../ui';
import { ApiError } from '../../services/http';
import { getAllEmployees } from '../../services/hrms';
import type { EmployeeDTO } from '../../services/hrms';
import { listSalaryStructures, previewSalaryStructure, rupeesToPaise } from '../../services/payroll';
import type { ComputedStructure, PayHeadDTO, SalaryTemplateDTO } from '../../services/payroll';
import { assignTemplatePeople, dayLabel, getPeopleWithoutSalary } from '../../services/salaryTemplatePeople';
import type { PeopleWithoutSalary, StructureRowWithFrom, TemplatePersonResult } from '../../services/salaryTemplatePeople';
import { TemplateEditPeople, TemplateMembers } from './TemplatePeople';
import * as L from './look';
import './people.css';

type Tab = 'template' | 'employees' | 'edit';
type Period = PeopleWithoutSalary['current'];

const GONE = ['offboarded', 'terminated'];
const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const money = (paise: number) => '₹' + Math.round(paise / 100).toLocaleString('en-IN');

/**
 * The day a salary given now applies from: the joining date when they join in
 * this month or later (or within the current pay period), else the first day
 * of the current pay period.
 */
function defaultEffectiveFrom(joiningDate: string | undefined, current: Period | null, today = istToday()): string {
  const from = current?.from ?? `${today.slice(0, 7)}-01`;
  if (joiningDate && (joiningDate >= from || joiningDate.slice(0, 7) >= today.slice(0, 7))) return joiningDate;
  return from;
}

/** The template's tabs: the template itself (children), Employees, Edit employees. */
export function SalaryTemplateTabs({ template, templates, phByCode, onChanged, children }: {
  template: SalaryTemplateDTO;
  templates: SalaryTemplateDTO[];
  phByCode: Map<string, PayHeadDTO>;
  /** People were put on it: the list's counts are out of date. */
  onChanged: () => void;
  children: ReactNode;
}) {
  const { emps, flash } = useStore();
  const [tab, setTab] = useState<Tab>('template');
  const [structures, setStructures] = useState<StructureRowWithFrom[] | null>(null);
  const [roster, setRoster] = useState<EmployeeDTO[]>([]);
  const [current, setCurrent] = useState<Period | null>(null);
  const [asking, setAsking] = useState<string[] | null>(null);
  // A new key after a save starts Edit employees afresh (nothing ticked).
  const [editKey, setEditKey] = useState(0);

  const load = async () => {
    try {
      const [rows, people] = await Promise.all([listSalaryStructures(), getAllEmployees()]);
      setStructures(rows as StructureRowWithFrom[]);
      setRoster(people);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not load who is on this template', 'error');
    }
    getPeopleWithoutSalary().then((d) => setCurrent(d.current)).catch(() => setCurrent(null));
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byUser = useMemo(() => new Map((structures ?? []).map((s) => [s.userId, s])), [structures]);
  const nameOf = useMemo(() => new Map(templates.map((t) => [t.code, t.name])), [templates]);
  // Only people still working: someone who has left is on no template.
  const working = useMemo(() => {
    const gone = new Set(roster.filter((r) => GONE.includes(r.lifecycleStatus ?? '')).map((r) => r.userId));
    return emps.filter((e) => !gone.has(e.id));
  }, [emps, roster]);
  const onThis = useCallback((e: Emp) => {
    const s = byUser.get(e.id);
    return s?.status === 'active' && s.salaryTemplateCode === template.code;
  }, [byUser, template.code]);
  const members = useMemo(() => working.filter(onThis), [working, onThis]);
  const placement = useCallback((e: Emp) => {
    const s = byUser.get(e.id);
    const on = onThis(e);
    const live = s?.status === 'active' && s.salaryTemplateCode;
    return { on, elsewhere: on || !live ? undefined : nameOf.get(s.salaryTemplateCode!) ?? s.salaryTemplateCode };
  }, [byUser, onThis, nameOf]);
  // People with no live salary first: they are the ones a run leaves out.
  const editList = useMemo(() => {
    const live = (e: Emp) => { const s = byUser.get(e.id); return s?.status === 'active' && !!s.salaryTemplateCode; };
    return [...working].sort((a, b) => Number(live(a)) - Number(live(b)));
  }, [working, byUser]);
  const withoutSalary = editList.filter((e) => { const s = byUser.get(e.id); return !(s?.status === 'active' && s.salaryTemplateCode); }).length;

  const extra = (e: Emp) => {
    const s = byUser.get(e.id);
    if (!s) return '—';
    return <span title="Annual CTC · on this template from">{money(s.annualCtcPaise)} a year{s.effectiveFrom ? ` · from ${dayLabel(s.effectiveFrom)}` : ''}</span>;
  };

  const loaded = structures !== null;
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <StatusTabs<Tab> options={['template', 'employees', 'edit']} active={tab} onSelect={setTab}
          labels={{ template: 'Template', employees: 'Employees', edit: 'Edit employees' }} counts={loaded ? { employees: members.length } : undefined} />
      </div>
      {tab === 'template' && children}
      {tab === 'employees' && (
        loaded
          ? <TemplateMembers members={members} extra={extra} extraLabel="ANNUAL CTC · FROM" emptyText="Nobody is on this template yet. Add people in Edit employees, with each person’s annual CTC." />
          : <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Loading…</div>
      )}
      {tab === 'edit' && (
        loaded ? (
          <TemplateEditPeople
            key={editKey}
            emps={editList}
            placement={placement}
            addWord="Add"
            onAdd={async (ids) => {
              if (!template.active) { flash(`${template.name} is inactive: make it active (Edit) before putting people on it`, 'error'); return false; }
              setAsking(ids);
              return false;
            }}
            note={<>
              {!template.active && <><strong style={{ color: 'var(--bad)', fontWeight: 600 }}>This template is inactive:</strong> make it active (Template › Edit) before putting people on it. </>}
              Adding someone gives them a salary on {template.name}: you enter each person’s <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>annual CTC</strong> and the day it applies from next.
              {' '}Someone on another template moves here with their CTC.
              {withoutSalary > 0 && <> <strong style={{ color: 'var(--warn)', fontWeight: 600 }}>{withoutSalary} {withoutSalary === 1 ? 'person has' : 'people have'} no salary yet</strong> and {withoutSalary === 1 ? 'is' : 'are'} listed first (“None” under Now): pay runs leave them out until they are on a template.</>}
            </>}
            removeBlocked="A salaried employee always needs a salary template, so nobody is taken off one here. To change someone’s template, open the template they should be on › Edit employees › Add: they move there with their CTC."
          />
        ) : <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Loading…</div>
      )}
      {asking && (
        <AssignSalaryDialog
          template={template}
          people={asking.map((id) => working.find((e) => e.id === id)).filter((e): e is Emp => !!e)}
          byUser={byUser}
          nameOf={nameOf}
          phByCode={phByCode}
          current={current}
          onClose={() => setAsking(null)}
          onSaved={async (saved, left) => {
            await load();
            onChanged();
            if (left.length === 0) { setAsking(null); setEditKey((k) => k + 1); }
            else setAsking(left);
            if (saved > 0) flash(`${saved} ${saved === 1 ? 'person is' : 'people are'} on ${template.name}`);
          }}
        />
      )}
    </div>
  );
}

type Row = { ctc: string; from: string };

/** Each person's annual CTC and effective-from date, with the monthly breakup on request; then saved together. */
function AssignSalaryDialog({ template, people, byUser, nameOf, phByCode, current, onClose, onSaved }: {
  template: SalaryTemplateDTO;
  people: Emp[];
  byUser: Map<string, StructureRowWithFrom>;
  nameOf: Map<string, string>;
  phByCode: Map<string, PayHeadDTO>;
  current: Period | null;
  onClose: () => void;
  /** `left`: the people not saved (refused), still to fix. */
  onSaved: (saved: number, left: string[]) => Promise<void>;
}) {
  const { flash } = useStore();
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(people.map((e) => {
    const s = byUser.get(e.id);
    return [e.id, { ctc: s && s.annualCtcPaise > 0 ? String(s.annualCtcPaise / 100) : '', from: defaultEffectiveFrom(e.joiningDate || undefined, current) }];
  })));
  // The current pay period may arrive after the dialog opened: dates nobody has touched follow it.
  const touched = useRef(new Set<string>());
  useEffect(() => {
    if (!current) return;
    setRows((r) => Object.fromEntries(Object.entries(r).map(([id, row]) => {
      if (touched.current.has(id)) return [id, row];
      const e = people.find((p) => p.id === id);
      return [id, { ...row, from: defaultEffectiveFrom(e?.joiningDate || undefined, current) }];
    })));
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [everyone, setEveryone] = useState('');

  const set = (id: string, patch: Partial<Row>) => {
    if (patch.from !== undefined) touched.current.add(id);
    setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
    setErrors((x) => { const n = { ...x }; delete n[id]; return n; });
  };
  const ctcPaise = (id: string) => (Number(rows[id]?.ctc) > 0 ? rupeesToPaise(rows[id].ctc) : 0);
  const missing = people.filter((e) => !(ctcPaise(e.id) > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(rows[e.id]?.from ?? ''));

  // Components whose monthly amount is set per person ("Set per employee"): they start at ₹0 here.
  const perPerson = template.components
    .filter((c) => c.calculation.mode === 'flat_amount' && c.payHeadCode !== template.balancingComponentCode && phByCode.get(c.payHeadCode)?.recurrence !== 'one_time')
    .map((c) => phByCode.get(c.payHeadCode)?.name ?? c.payHeadCode);

  const save = async () => {
    if (missing.length > 0) {
      setErrors(Object.fromEntries(missing.map((e) => [e.id, !(ctcPaise(e.id) > 0) ? 'Enter the annual CTC' : 'Pick the effective-from date'])));
      return flash(`${missing.length === 1 ? `${missing[0].name} needs` : `${missing.length} people need`} an annual CTC and a date`, 'error');
    }
    setSaving(true);
    try {
      const r = await assignTemplatePeople(template.code, people.map((e) => ({ userId: e.id, annualCtcPaise: ctcPaise(e.id), effectiveFrom: rows[e.id].from })));
      const refused = r.results.filter((x: TemplatePersonResult) => !x.ok);
      setErrors(Object.fromEntries(refused.map((x) => [x.userId, x.message ?? 'Not saved'])));
      if (refused.length) flash(`${refused.length} not saved: see the rows marked in red`, 'error');
      await onSaved(r.saved, refused.map((x) => x.userId));
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save the salaries', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 14px' }}>
      <div onClick={() => !saving && onClose()} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)', animation: 'ovl .2s ease both' }} />
      <div className="scry" role="dialog" aria-modal="true" aria-labelledby="assign-salary-title" style={{ ...L.modalSheet, maxWidth: 980 }}>
        <div style={L.modalHeadBar}>
          <div>
            <div id="assign-salary-title" style={L.modalTitle}>Put {people.length} {people.length === 1 ? 'person' : 'people'} on {template.name}</div>
            <div style={{ ...L.cardNote, marginTop: 2 }}>Each needs an annual CTC. The salary is live once saved, and the next pay run includes them.</div>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="pd-btn ghost sm" aria-label="Close">✕</button>
        </div>

        <div style={{ ...L.modalBody, overflowY: 'auto', display: 'grid', gap: 12 }}>
          {people.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, color: 'var(--ink-2)' }}>
              Same effective-from date for everyone:
              <input type="date" value={everyone} onChange={(e) => setEveryone(e.target.value)} className="lk-in" style={{ ...dateInput, width: 160 }} />
              <button type="button" className="pd-btn sm" disabled={!everyone} onClick={() => { for (const e of people) set(e.id, { from: everyone }); }}>Apply to all</button>
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table className="lk-t" style={{ ...L.table, minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={th}>Employee</th>
                  <th style={th}>Now</th>
                  <th style={th}>Annual CTC <span style={{ color: 'var(--bad)' }}>*</span></th>
                  <th style={th}>Effective from <span style={{ color: 'var(--bad)' }}>*</span></th>
                  <th style={th}>{''}</th>
                </tr>
              </thead>
              <tbody>
                {people.map((e) => {
                  const s = byUser.get(e.id);
                  const now = s?.salaryTemplateCode
                    ? `${nameOf.get(s.salaryTemplateCode) ?? s.salaryTemplateCode}${s.status === 'active' ? '' : ' (not live)'}`
                    : 'No salary template';
                  const moving = !!s?.salaryTemplateCode && s.salaryTemplateCode !== template.code;
                  const paise = ctcPaise(e.id);
                  return (
                    <Fragment key={e.id}>
                      <tr>
                        <td style={td}>
                          <div style={{ ...L.cellName, fontSize: 13.5 }}>{e.name}</div>
                          <div style={L.cellSub}>{[e.employeeId, e.joiningDate ? `Joined ${dayLabel(e.joiningDate)}` : ''].filter(Boolean).join(' · ') || '—'}</div>
                        </td>
                        <td style={{ ...td, fontSize: 12.5, color: s?.salaryTemplateCode ? 'var(--ink-2)' : 'var(--warn)' }}>
                          {now}
                          {moving && <div style={L.cellSub}>Moves here{s && s.annualCtcPaise > 0 ? ' with this CTC' : ''}</div>}
                        </td>
                        <td style={td}>
                          <span style={{ ...pairBox, borderColor: errors[e.id] && !(paise > 0) ? 'var(--bad)' : 'var(--line-2)' }}>
                            <span style={pairPrefix}>₹</span>
                            <input type="number" min={0} inputMode="numeric" aria-label={`Annual CTC for ${e.name}`} value={rows[e.id]?.ctc ?? ''} placeholder="per year"
                              onChange={(ev) => set(e.id, { ctc: ev.target.value })} style={pairInput} />
                          </span>
                          <div style={L.cellSub}>{paise > 0 ? `${money(Math.round(paise / 12))} a month` : ' '}</div>
                        </td>
                        <td style={td}>
                          <input type="date" aria-label={`Effective from for ${e.name}`} value={rows[e.id]?.from ?? ''} onChange={(ev) => set(e.id, { from: ev.target.value })} className="lk-in" style={dateInput} />
                          <div style={L.cellSub}>{e.joiningDate && rows[e.id]?.from && rows[e.id].from < e.joiningDate ? 'Before their joining date' : ' '}</div>
                        </td>
                        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button type="button" className="pd-btn ghost sm" disabled={!(paise > 0)} onClick={() => setOpen(open === e.id ? null : e.id)}>
                            {open === e.id ? 'Hide breakup' : 'Monthly breakup'}
                          </button>
                        </td>
                      </tr>
                      {errors[e.id] && (
                        <tr><td colSpan={5} style={{ ...td, paddingTop: 0, color: 'var(--bad)', fontSize: 12.5, borderBottom: 'none' }}>{errors[e.id]}</td></tr>
                      )}
                      {open === e.id && paise > 0 && (
                        <tr><td colSpan={5} style={{ ...td, background: 'var(--surface-2)' }}>
                          <Breakup userId={e.id} templateCode={template.code} annualCtcPaise={paise} moving={moving} />
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {perPerson.length > 0 && (
            <div style={{ ...L.note, display: 'block', fontSize: 12.5 }}>
              {template.name} has amounts set per person ({perPerson.join(', ')}): they start at ₹0 here. Set them on each person’s Salary details.
            </div>
          )}
          <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
            The default date is the joining date for people joining this month or later, else the first day of the current pay period{current ? ` (${dayLabel(current.from)})` : ''}.
            A new CTC is recorded in the person’s salary history from this date. A pay run works the month out on the salary saved when it is calculated; a joiner is paid from their joining date.
          </div>
        </div>

        <div style={L.modalFootBar}>
          <span style={{ fontSize: 12.5, color: missing.length ? 'var(--warn)' : 'var(--ink-3)' }}>
            {missing.length ? `${missing.length} still without a CTC or date` : 'Ready to save'}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} disabled={saving} className="pd-btn">Cancel</button>
          <button type="button" id="assign-salary-save" onClick={() => void save()} disabled={saving} className="pd-btn primary">
            {saving ? 'Saving…' : `Save ${people.length} ${people.length === 1 ? 'salary' : 'salaries'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The person's monthly breakup on this template at this CTC, from the same preview Salary details uses. */
function Breakup({ userId, templateCode, annualCtcPaise, moving }: { userId: string; templateCode: string; annualCtcPaise: number; moving: boolean }) {
  const [computed, setComputed] = useState<ComputedStructure | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setError('');
    const t = setTimeout(() => {
      previewSalaryStructure(userId, { salaryTemplateCode: templateCode, annualCtcPaise, ...(moving ? { overrides: {} } : {}) })
        .then((r) => { if (live) setComputed(r.computed); })
        .catch((e) => { if (live) setError(e instanceof ApiError ? e.message : 'Could not work out the breakup'); });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [userId, templateCode, annualCtcPaise, moving]);

  if (error) return <div style={{ fontSize: 12.5, color: 'var(--bad)' }}>{error}</div>;
  if (!computed) return <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Working out the breakup…</div>;
  const lines = [...computed.earnings, ...(computed.reimbursements ?? [])].filter((l) => l.monthlyPaise > 0 && l.showInPayslip !== false);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '4px 28px', fontSize: 12.5 }}>
      {lines.map((l) => <Line key={l.code} label={l.payslipName || l.name} paise={l.monthlyPaise} />)}
      <Line label="Gross pay" paise={computed.grossMonthlyPaise} strong />
      <Line label="Employee deductions (PF, ESI, PT…)" paise={computed.employeeDeductionsMonthlyPaise} />
      <Line label="Net before income tax" paise={computed.netMonthlyPaise} strong />
      <Line label="Cost to company" paise={computed.employerCostMonthlyPaise} />
      {computed.overBudget && <div style={{ gridColumn: '1 / -1', color: 'var(--bad)' }}>This CTC is too small for the template’s fixed components.</div>}
    </div>
  );
}

function Line({ label, paise, strong }: { label: string; paise: number; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontWeight: strong ? 600 : 400, color: 'var(--ink)' }}>
      <span style={{ color: strong ? 'var(--ink)' : 'var(--ink-2)' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(paise)} <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>/ mo</span></span>
    </div>
  );
}

const th: CSSProperties = { ...L.th, padding: '8px 10px' };
const td: CSSProperties = { ...L.td, padding: '10px', verticalAlign: 'top' };
const dateInput: CSSProperties = { ...L.input, height: 34, width: 150, padding: '0 10px', fontSize: 13 };
const pairBox: CSSProperties = { display: 'inline-flex', alignItems: 'stretch', height: 34, border: '1px solid var(--line-2)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' };
const pairPrefix: CSSProperties = { display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: 12.5, color: 'var(--ink-2)', background: 'var(--surface-2)', borderRight: '1px solid var(--line-2)' };
const pairInput: CSSProperties = { border: 'none', outline: 'none', padding: '0 10px', fontSize: 13, width: 130, color: 'var(--ink)', fontFamily: 'inherit', background: 'transparent' };
