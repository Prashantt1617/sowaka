// People › Employees › Add employee.
//   1 Basic details · 2 Personal details · 3 Payment information
//   · 4 Shift template · 5 Feedback parameters
//
// Basic details is where the employee record is actually created; the steps
// after it attach things to a person who already exists, so each saves on its
// own and a wizard abandoned halfway still leaves a usable record behind.
//
// Salary details is deliberately not in the flow — the step is kept below,
// unrendered, until payroll is wired up.
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { IconClose, IconPlus } from '../icons';
import { createEmployee, getShifts, assignShift, type ShiftDTO } from '../../services/hrms';
import { assignKpis, listKpiParameters, listKpiTemplates } from '../../services/kpi';
import type { KpiParameterDTO, KpiTemplateDTO } from '../../services/kpi';
import { evenWeights, weightError, weightTotal } from '../weights';

const STEPS = ['Basic details', 'Personal details', 'Payment information', 'Shift template', 'Feedback parameters'];

const GENDERS = ['Male', 'Female', 'Other', 'Prefer not to say'];

type Basic = {
  firstName: string;
  middleName: string;
  lastName: string;
  employeeId: string;
  doj: string;
  payrollInclusion: 'this' | 'next';
  workEmail: string;
  mobile: string;
  isDirector: boolean;
  gender: string;
  workLocation: string;
  designation: string;
  department: string;
  manager: string;
};

const EMPTY_BASIC: Basic = {
  firstName: '', middleName: '', lastName: '', employeeId: '', doj: '',
  payrollInclusion: 'this', workEmail: '', mobile: '', isDirector: false,
  gender: '', workLocation: '', designation: '', department: '', manager: '',
};

/** Dropdown values taken from who is already on the roster. */
type RosterOptions = {
  locations: string[];
  designations: string[];
  departments: string[];
  managers: { userId: string; name: string }[];
  thisMonth: string;
  nextMonth: string;
};

export function AddEmployeeWizard({ onClose }: { onClose: () => void }) {
  const { flash, emps, user, cycle, reload } = useStore();
  const [step, setStep] = useState(0);
  const [invite, setInvite] = useState(false);
  const [done, setDone] = useState(false);
  const [basic, setBasic] = useState<Basic>(EMPTY_BASIC);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /** Set once the employee exists on the server; every later step needs it. */
  const [createdUserId, setCreatedUserId] = useState<string | null>(null);

  // Step 4 and 5 attach to the person created in step 1.
  const [shifts, setShifts] = useState<ShiftDTO[]>([]);
  const [shiftId, setShiftId] = useState<string>('');
  const [kpiTemplates, setKpiTemplates] = useState<KpiTemplateDTO[]>([]);
  const [kpiParams, setKpiParams] = useState<KpiParameterDTO[]>([]);
  const [kpiTemplateId, setKpiTemplateId] = useState<string>('');
  const [pickedParams, setPickedParams] = useState<string[]>([]);
  const [kpiWeights, setKpiWeights] = useState<Record<string, number>>({});

  useEffect(() => {
    getShifts().then(setShifts).catch(() => setShifts([]));
    listKpiTemplates().then(setKpiTemplates).catch(() => setKpiTemplates([]));
    listKpiParameters().then(setKpiParams).catch(() => setKpiParams([]));
  }, []);

  const options = useMemo<RosterOptions>(() => {
    const uniq = (values: (string | undefined)[]) =>
      [...new Set(values.map((v) => (v ?? '').trim()).filter(Boolean))].sort();
    const monthName = (period: string) => {
      const [y, m] = period.split('-').map(Number);
      return `${new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' })
        .format(new Date(Date.UTC(y, m - 1, 1)))} ${y}`;
    };
    return {
      locations: uniq(emps.map((e) => e.location)),
      designations: uniq(emps.map((e) => e.role)),
      departments: uniq(emps.map((e) => e.team)),
      // Anyone already managing someone is offered as a reporting manager.
      managers: [...new Map(
        emps.filter((e) => emps.some((other) => other.managerId === e.id))
          .map((e) => [e.id, { userId: e.id, name: e.name }]),
      ).values()].sort((a, b) => a.name.localeCompare(b.name)),
      thisMonth: monthName(cycle.period),
      nextMonth: monthName(cycle.next),
    };
  }, [emps, cycle]);

  const set = <K extends keyof Basic>(k: K, v: Basic[K]) => setBasic({ ...basic, [k]: v });

  const missing = {
    firstName: !basic.firstName.trim(),
    lastName: !basic.lastName.trim(),
    employeeId: !basic.employeeId.trim(),
    doj: !basic.doj.trim(),
    workEmail: !basic.workEmail.trim(),
    gender: !basic.gender.trim(),
    designation: !basic.designation.trim(),
    department: !basic.department.trim(),
  };
  const fullName = `${basic.firstName.trim()} ${basic.lastName.trim()}`.trim();

  const saveAndContinue = async () => {
    setError('');
    if (step === 0) {
      // Basic details is the only step that must be complete: everything after
      // it attaches to a record that has to exist first.
      setTouched(true);
      if (Object.values(missing).some(Boolean)) {
        setError('Fill the fields marked with an asterisk before continuing.');
        return;
      }
      setInvite(true);
      return;
    }
    if (step === 3) {
      // Shift template — assigning is a move, so skipping leaves them on the
      // org policy, which is the correct default.
      if (shiftId && createdUserId) {
        setSaving(true);
        try { await assignShift(shiftId, [createdUserId]); }
        catch (e) { setError((e as Error).message); setSaving(false); return; }
        setSaving(false);
      }
      setStep(step + 1);
      return;
    }
    if (step === STEPS.length - 1) {
      if (createdUserId && pickedParams.length > 0) {
        const problem = weightError(pickedParams, kpiWeights);
        if (problem) { setError(problem); return; }
        setSaving(true);
        try {
          // Assignments land in the next cycle: the live one is frozen so a
          // manager scoring right now never has the form change under them.
          await assignKpis({
            userId: createdUserId,
            period: cycle.next,
            parameterIds: pickedParams,
            weights: kpiWeights,
          });
        } catch (e) { setError((e as Error).message); setSaving(false); return; }
        setSaving(false);
      }
      await reload();
      setDone(true);
      return;
    }
    setStep(step + 1);
    setTouched(false);
  };

  /** Picking a template pre-fills the set; it stays editable per employee. */
  const applyTemplate = (templateId: string) => {
    setKpiTemplateId(templateId);
    const template = kpiTemplates.find((t) => t.id === templateId);
    if (!template) { setPickedParams([]); setKpiWeights({}); return; }
    setPickedParams(template.parameterIds);
    setKpiWeights(
      template.weights && Object.keys(template.weights).length
        ? { ...template.weights }
        : evenWeights(template.parameterIds),
    );
  };

  const toggleParam = (id: string) => {
    const next = pickedParams.includes(id)
      ? pickedParams.filter((p) => p !== id)
      : [...pickedParams, id];
    setPickedParams(next);
    // Re-spread evenly: a set whose weights no longer sum to 100 is refused.
    setKpiWeights(evenWeights(next));
  };

  // Reset the whole wizard to add another employee from the success screen.
  const addAnother = () => {
    setBasic(EMPTY_BASIC);
    setStep(0);
    setInvite(false);
    setTouched(false);
    setDone(false);
    setCreatedUserId(null);
    setShiftId('');
    setKpiTemplateId('');
    setPickedParams([]);
    setKpiWeights({});
    setError('');
  };

  // Sending the invite is where the user is actually created; the wizard then
  // continues into the steps that attach things to them.
  const sendInvite = async () => {
    setSaving(true); setError('');
    try {
      const created = await createEmployee({
        name: fullName,
        email: basic.workEmail.trim(),
        employeeId: basic.employeeId.trim() || undefined,
        designation: basic.designation || undefined,
        department: basic.department || undefined,
        location: basic.workLocation || undefined,
        gender: basic.gender || undefined,
        mobile: basic.mobile.trim() || undefined,
        joiningDate: basic.doj || undefined,
        managerUserId: options.managers.find((m) => m.name === basic.manager)?.userId,
      });
      setCreatedUserId(created.userId);
      flash(`${created.name} created — invitation sent to ${created.email}`);
      setInvite(false);
      setStep(1);
      setTouched(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '18px 22px 0' }}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{invite ? 'Create user' : 'Add employee'}</div>
          <button onClick={onClose} style={iconBtn}><IconClose size={18} /></button>
        </div>

        {done ? (
          <>
            <div style={{ padding: '26px 40px', overflowY: 'auto', flex: 1 }}>
              <SuccessScreen name={fullName || 'this employee'} employeeId={basic.employeeId} designation={basic.designation} department={basic.department} orgName={user?.company ?? 'your organisation'} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 22px', borderTop: '1px solid #EBEBEB' }}>
              <button onClick={addAnother} style={ghostBtn}>Add another employee</button>
              <button onClick={onClose} style={{ ...primaryBtn, marginLeft: 'auto' }}>Done</button>
            </div>
          </>
        ) : invite ? (
          <>
            <div style={{ padding: '26px 40px', overflowY: 'auto', flex: 1 }}>
              <InviteScreen name={fullName || 'this employee'} email={basic.workEmail} employeeId={basic.employeeId} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 22px', borderTop: '1px solid #EBEBEB' }}>
              <button onClick={() => { setInvite(false); setError(''); }} style={ghostBtn}>← Back</button>
              {error && <div style={{ fontSize: 14, fontWeight: 600, color: '#A32B2B' }}>{error}</div>}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
                <button onClick={onClose} style={ghostBtn}>Cancel</button>
                <button onClick={() => void sendInvite()} disabled={saving} style={primaryBtn}>
                  {saving ? 'Creating…' : 'Send invitation & create user'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Progress bar */}
            <div style={{ padding: '20px 22px 10px', borderBottom: '1px solid #F0F0F2' }}>
              <Progress step={step} onJump={(i) => { setStep(i); setTouched(false); }} />
            </div>

            {/* Body */}
            <div style={{ padding: '26px 40px', overflowY: 'auto', flex: 1 }}>
              <div style={{ width: '100%', maxWidth: 1040, margin: '0 auto' }}>
                {step === 0 ? (
                  <BasicStep basic={basic} set={set} touched={touched} missing={missing} options={options} />
                ) : step === 1 ? (
                  <PersonalStep />
                ) : step === 2 ? (
                  <PaymentStep holderName={fullName} />
                ) : step === 3 ? (
                  <ShiftTemplateStep shifts={shifts} chosen={shiftId} onChoose={setShiftId} name={fullName} />
                ) : (
                  <FeedbackParametersStep
                    templates={kpiTemplates}
                    parameters={kpiParams}
                    templateId={kpiTemplateId}
                    picked={pickedParams}
                    weights={kpiWeights}
                    period={cycle.next}
                    onTemplate={applyTemplate}
                    onToggle={toggleParam}
                    onWeight={(id, value) => setKpiWeights({ ...kpiWeights, [id]: value })}
                  />
                )}
              </div>
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 22px', borderTop: '1px solid #EBEBEB' }}>
              {step > 0 && <button onClick={() => { setStep(step - 1); setTouched(false); setError(''); }} style={ghostBtn}>← Back</button>}
              <button onClick={() => void saveAndContinue()} disabled={saving} style={primaryBtn}>
                {saving ? 'Saving…' : step < STEPS.length - 1 ? 'Save and Continue' : 'Save & Finish'}
              </button>
              <button onClick={onClose} style={ghostBtn}>Cancel</button>
              <div style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 600, color: error ? '#A32B2B' : '#C4382E' }}>
                {error || <><span style={{ color: '#C4382E' }}>*</span> indicates mandatory fields</>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function InviteScreen({ name, email, employeeId }: { name: string; email: string; employeeId: string }) {
  const shownEmail = email || 'their work email';
  return (
    <div style={{ maxWidth: 620, margin: '10px auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: '#F7F7F9', color: '#0571A6', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2.5" />
            <path d="M3.5 6.5 12 13l8.5-6.5" />
          </svg>
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#222222' }}>Send login credentials to {name}</div>
        <div style={{ fontSize: 16, color: '#717171', marginTop: 8, lineHeight: 1.55, maxWidth: 500 }}>
          Clicking <strong style={{ color: '#484848' }}>Send invitation</strong> creates this user and emails them a link with login credentials to sign in to their Sowaka Connect portal.
        </div>
      </div>

      {/* Email preview card */}
      <div style={{ marginTop: 26, border: '1px solid #EBEBEB', borderRadius: 14, overflow: 'hidden', background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', borderBottom: '1px solid #F0F0F2', background: '#F7F7F9' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#717171', letterSpacing: '.03em', textTransform: 'uppercase' }}>To</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#222222' }}>{shownEmail}</span>
          {employeeId && <span style={{ marginLeft: 'auto', fontSize: 14, color: '#717171' }}>{employeeId}</span>}
        </div>
        <div style={{ padding: '16px 18px' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#222222' }}>Welcome to Sowaka Connect 👋</div>
          <div style={{ fontSize: 14, color: '#484848', marginTop: 8, lineHeight: 1.6 }}>
            Hi {name}, an account has been created for you at Convrse Spaces. Use the button below to set your
            password and sign in to view payslips, submit IT declarations and raise reimbursement claims.
          </div>
          <div style={{ marginTop: 14 }}>
            <span style={{ display: 'inline-block', background: '#0571A6', color: '#fff', fontSize: 14, fontWeight: 700, padding: '9px 16px', borderRadius: 10 }}>Set password &amp; sign in</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginTop: 16, fontSize: 12, color: '#717171' }}>
        <span>Nothing is sent until you press <strong style={{ color: '#717171' }}>Send invitation</strong>.</span>
      </div>
    </div>
  );
}

// —— Shift template step —————————————————————————————————————————————
// Skipping leaves them on the org policy, which is what everyone unassigned
// follows — so "none" is a real answer, not an unfinished one.
function ShiftTemplateStep({ shifts, chosen, onChoose, name }: {
  shifts: ShiftDTO[];
  chosen: string;
  onChoose: (id: string) => void;
  name: string;
}) {
  const withPolicy = shifts.filter((s) => s.policy && s.active);
  return (
    <div>
      <StepHeading
        title="Which shift is this employee on?"
        sub={`A shift decides how ${name || 'their'} attendance is graded — the working window, what counts as a half or full day, and the grace before an arrival is late.`}
      />
      <button onClick={() => onChoose('')} style={pickRow(chosen === '')}>
        <span style={pickDot(chosen === '')} />
        <span style={{ flex: 1 }}>
          <span style={pickTitle}>Follow the org policy</span>
          <span style={pickSub}>The default in Shifts › Policies. Nothing to assign.</span>
        </span>
      </button>
      {withPolicy.map((s) => (
        <button key={s.id} onClick={() => onChoose(s.id)} style={pickRow(chosen === s.id)}>
          <span style={pickDot(chosen === s.id)} />
          <span style={{ flex: 1 }}>
            <span style={pickTitle}>{s.name}</span>
            <span style={pickSub}>
              {s.policy.startTime}–{s.policy.endTime} · half day {s.policy.minHalfDayHours}h ·
              full day {s.policy.minFullDayHours}h · {s.assignedCount} already on it
            </span>
          </span>
        </button>
      ))}
      {withPolicy.length === 0 && (
        <div style={emptyNote}>No shift templates yet — everyone follows the org policy.</div>
      )}
    </div>
  );
}

// —— Feedback parameters step ————————————————————————————————————————
// Starts from a template and stays editable for this one person, the same way
// a per-employee assignment works everywhere else.
function FeedbackParametersStep({
  templates, parameters, templateId, picked, weights, period, onTemplate, onToggle, onWeight,
}: {
  templates: KpiTemplateDTO[];
  parameters: KpiParameterDTO[];
  templateId: string;
  picked: string[];
  weights: Record<string, number>;
  period: string;
  onTemplate: (id: string) => void;
  onToggle: (id: string) => void;
  onWeight: (id: string, value: number) => void;
}) {
  const total = weightTotal(picked, weights);
  const byId = new Map(parameters.map((p) => [p.id, p]));
  return (
    <div>
      <StepHeading
        title="What will they be scored on?"
        sub={`Start from a template, then adjust it for this person. Assignments take effect from the ${period} cycle — the live one is frozen.`}
      />
      <Field label="Start from a template">
        <select value={templateId} onChange={(e) => onTemplate(e.target.value)} style={inputStyle}>
          <option value="">No template — pick parameters yourself</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name} ({t.parameterIds.length} parameters)</option>
          ))}
        </select>
      </Field>

      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#9197A2', margin: '18px 0 8px' }}>
        Parameters {picked.length > 0 && `· ${picked.length} chosen`}
      </div>
      {parameters.length === 0 ? (
        <div style={emptyNote}>No KPI parameters exist yet — add them under Performance › KPI Parameters.</div>
      ) : (
        <div style={{ border: '1px solid #EDEDF0', borderRadius: 12, overflow: 'hidden' }}>
          {parameters.map((p, i) => {
            const on = picked.includes(p.id);
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderTop: i === 0 ? 'none' : '1px solid #F4F4F6', background: on ? '#F7FBFD' : '#fff' }}>
                <input type="checkbox" checked={on} onChange={() => onToggle(p.id)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#222222' }}>{p.title}</div>
                  {p.subtitle && <div style={{ fontSize: 13, color: '#717171', marginTop: 2 }}>{p.subtitle}</div>}
                </div>
                {on && (
                  <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #EBEBEB', borderRadius: 9, overflow: 'hidden', background: '#fff', width: 108 }}>
                    <input
                      type="number" min="0" max="100"
                      value={weights[p.id] ?? 0}
                      onChange={(e) => onWeight(p.id, Number(e.target.value) || 0)}
                      style={{ border: 'none', outline: 'none', padding: '7px 9px', fontSize: 15, width: '100%', background: 'transparent' }}
                    />
                    <span style={{ padding: '7px 9px', color: '#717171', borderLeft: '1px solid #EBEBEB', fontSize: 13 }}>%</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {picked.length > 0 && (
        <div style={{ ...emptyNote, marginTop: 12, color: total === 100 ? '#4F7A52' : '#9A6B25', background: total === 100 ? '#EAF3EA' : '#FBF3DD', borderColor: total === 100 ? '#D6E8D6' : '#EFE0BC' }}>
          Weights total <strong>{total}%</strong>
          {total === 100 ? ' — ready to assign.' : ' — they must add up to 100 before this can be saved.'}
          {' '}Scored parameters: {picked.map((id) => byId.get(id)?.title).filter(Boolean).join(', ')}.
        </div>
      )}
    </div>
  );
}

function StepHeading({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 19, fontWeight: 800, color: '#222222' }}>{title}</div>
      <div style={{ fontSize: 14.5, color: '#717171', marginTop: 6, lineHeight: 1.55 }}>{sub}</div>
    </div>
  );
}

const pickRow = (on: boolean): CSSProperties => ({
  display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%', textAlign: 'left',
  padding: '14px 16px', marginBottom: 10, cursor: 'pointer',
  border: `1px solid ${on ? '#0571A6' : '#EBEBEB'}`, borderRadius: 12,
  background: on ? '#F1F8FC' : '#fff', font: 'inherit',
});
const pickDot = (on: boolean): CSSProperties => ({
  width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 2,
  border: `${on ? 5 : 1.5}px solid ${on ? '#0571A6' : '#C7CBD2'}`, background: '#fff',
});
const pickTitle: CSSProperties = { display: 'block', fontSize: 16, fontWeight: 700, color: '#222222' };
const pickSub: CSSProperties = { display: 'block', fontSize: 13.5, color: '#717171', marginTop: 3, lineHeight: 1.5 };
const emptyNote: CSSProperties = {
  fontSize: 13.5, color: '#3A5A6B', background: '#F1F8FC', border: '1px solid #E0EEF6',
  borderRadius: 10, padding: '11px 14px', lineHeight: 1.55,
};

function SuccessScreen({ name, employeeId, designation, department, orgName }: { name: string; employeeId: string; designation: string; department: string; orgName: string }) {
  return (
    <div style={{ maxWidth: 560, margin: '18px auto', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#E4EDE0', color: '#4F7A52', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5 9.5 18 20 6.5" /></svg>
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: '#222222' }}>
        Successfully added {name} to {orgName}
      </div>
      <div style={{ fontSize: 16, color: '#717171', marginTop: 10, lineHeight: 1.55, maxWidth: 480 }}>
        Their employee record is now live. You can review or edit it any time from the Employees list, and payroll will pick them up on their first eligible pay run.
      </div>

      {(employeeId || designation || department) && (
        <div style={{ marginTop: 24, width: '100%', border: '1px solid #EBEBEB', borderRadius: 14, background: '#fff', padding: '16px 18px', display: 'flex', gap: 14, alignItems: 'center', textAlign: 'left' }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#F7F7F9', color: '#0571A6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800, flexShrink: 0 }}>
            {name.slice(0, 1).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#222222' }}>{name}</div>
            <div style={{ fontSize: 14, color: '#717171', marginTop: 2 }}>
              {[employeeId, designation, department].filter(Boolean).join('  ·  ')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Progress({ step, onJump }: { step: number; onJump: (i: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {STEPS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        const filled = done || active;
        return (
          <Fragment key={label}>
            <button onClick={() => onJump(i)} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              <span style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 800,
                background: filled ? '#0571A6' : '#fff',
                color: filled ? '#fff' : '#9197A2',
                border: `2px solid ${filled ? '#0571A6' : '#EBEBEB'}`,
              }}>
                {done ? '✓' : i + 1}
              </span>
              <span style={{ fontSize: 16, fontWeight: active ? 800 : 600, color: active ? '#0571A6' : done ? '#484848' : '#717171', whiteSpace: 'nowrap' }}>{label}</span>
            </button>
            {i < STEPS.length - 1 && (
              <span style={{ width: 52, height: 2, background: done ? '#0571A6' : '#F7F7F9', margin: '0 16px', flexShrink: 0 }} />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

function BasicStep({ basic, set, touched, missing, options }: {
  basic: Basic;
  set: <K extends keyof Basic>(k: K, v: Basic[K]) => void;
  touched: boolean;
  missing: Record<string, boolean>;
  options: RosterOptions;
}) {
  return (
    <div>
      {/* Employee name */}
      <div style={grid3}>
        <Field label="First name" required error={touched && missing.firstName}>
          <input autoFocus value={basic.firstName} onChange={(e) => set('firstName', e.target.value)} placeholder="e.g. Ananya" style={inputStyle} />
        </Field>
        <Field label="Middle name">
          <input value={basic.middleName} onChange={(e) => set('middleName', e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Last name" required error={touched && missing.lastName}>
          <input value={basic.lastName} onChange={(e) => set('lastName', e.target.value)} placeholder="e.g. Rao" style={inputStyle} />
        </Field>
      </div>

      {/* Employee ID + joining date */}
      <div style={grid2}>
        <Field label="Employee ID" required error={touched && missing.employeeId}>
          <input value={basic.employeeId} onChange={(e) => set('employeeId', e.target.value.toUpperCase())} placeholder="e.g. 1234" style={inputStyle} />
        </Field>
        <Field label="Date of Joining" required error={touched && missing.doj}>
          <input type="date" value={basic.doj} onChange={(e) => set('doj', e.target.value)} style={inputStyle} />
        </Field>
      </div>

      {/* Payroll inclusion — appears once a joining date is chosen. */}
      {basic.doj && (
        <div style={{ background: '#F7F7F9', border: '1px solid #EBEBEB', borderRadius: 12, padding: '14px 16px', marginBottom: 18, animation: 'fade .2s ease both' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#484848', marginBottom: 3 }}>Include in payroll from</div>
          <div style={{ fontSize: 14, color: '#717171', marginBottom: 10 }}>This joining date falls in the current pay period — choose when payroll should start.</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <RadioCard checked={basic.payrollInclusion === 'this'} onClick={() => set('payrollInclusion', 'this')} title={`This month · ${options.thisMonth}`} sub="Employee is paid in the current run (pro-rated from joining date)." />
            <RadioCard checked={basic.payrollInclusion === 'next'} onClick={() => set('payrollInclusion', 'next')} title={`Next month · ${options.nextMonth}`} sub="Employee starts in next month's payroll run." />
          </div>
        </div>
      )}

      {/* Work email + mobile */}
      <div style={grid2}>
        <Field label="Work Email" required error={touched && missing.workEmail}>
          <input type="email" value={basic.workEmail} onChange={(e) => set('workEmail', e.target.value)} placeholder="name@convrse.ai" style={inputStyle} />
        </Field>
        <Field label="Mobile Number">
          <input value={basic.mobile} onChange={(e) => set('mobile', e.target.value)} placeholder="+91 98765 43210" style={inputStyle} />
        </Field>
      </div>

      {/* Email info callout */}
      <div style={infoCallout}>
        <span style={infoIcon}>i</span>
        <span>You cannot change this <strong>Email</strong> address later on, as it will be used to send payslips and for the employee to sign in to their portal, where they can view / download their payslips.</span>
      </div>

      {/* Director */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 16, fontWeight: 600, color: '#484848', cursor: 'pointer', margin: '20px 0' }}>
        <input type="checkbox" checked={basic.isDirector} onChange={(e) => set('isDirector', e.target.checked)} />
        <span>Employee is a <strong>Director / person with substantial interest</strong> in the company.</span>
        <InfoDot text="Directors / persons with substantial interest are reported in Form 12BA (statement of perquisites). Enabling this changes their tax treatment and payroll output." />
      </label>

      {/* Gender + work location */}
      <div style={grid2}>
        <Field label="Gender" required error={touched && missing.gender}>
          <Select value={basic.gender} onChange={(v) => set('gender', v)} placeholder="Select gender" options={GENDERS} />
        </Field>
        <Field label="Work Location" required>
          <Select value={basic.workLocation} onChange={(v) => set('workLocation', v)} placeholder="Select location" options={options.locations} />
        </Field>
      </div>

      {/* Designation + department */}
      <div style={grid2}>
        <Field label="Designation" required error={touched && missing.designation}>
          <Select value={basic.designation} onChange={(v) => set('designation', v)} placeholder="Select designation" options={options.designations} />
        </Field>
        <Field label="Department" required error={touched && missing.department}>
          <Select value={basic.department} onChange={(v) => set('department', v)} placeholder="Select department" options={options.departments} />
        </Field>
      </div>

      {/* Reporting manager */}
      <div style={grid2}>
        <Field label="Manager Name">
          <Select value={basic.manager} onChange={(v) => set('manager', v)} placeholder="Select reporting manager" options={options.managers.map((m) => m.name)} />
        </Field>
        <div />
      </div>
    </div>
  );
}

type SalaryGroup = 'statutory' | 'structure' | 'benefits';
const SALARY_GROUPS: { key: SalaryGroup; title: string; sub?: string }[] = [
  { key: 'statutory', title: 'Statutory Components' },
  { key: 'structure', title: 'Salary Structure' },
  { key: 'benefits', title: 'Other Benefits', sub: 'Optional add-ons to the employee salary structure.' },
];

type SalaryData = {
  epf: boolean;
  pfAccountNumber: string;
  uan: string;
  contributeEps: boolean;
  esi: boolean;
  esiNumber: string;
  lwf: boolean;
  statutoryBonus: boolean;
  bonusCategory: string;
  salaryTemplate: string;
  annualCtc: string;
};
const EMPTY_SALARY: SalaryData = { epf: false, pfAccountNumber: '', uan: '', contributeEps: true, esi: false, esiNumber: '', lwf: false, statutoryBonus: false, bonusCategory: '', salaryTemplate: '', annualCtc: '1200000' };
const BONUS_CATEGORIES = ['Highly skilled', 'Skilled', 'None'];

function inrRupees(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}
function inrPlain(n: number): string {
  return Math.round(n).toLocaleString('en-IN');
}

// Mock salary templates (mirror the Salary Templates screen). Each carries the
// statutory defaults that get prefilled when the template is selected. (Salary
// component prefill will happen in the Salary Structure group later.)
type TemplateStatutory = { epf: boolean; esi: boolean; lwf: boolean; statutoryBonus: boolean };
const SALARY_TEMPLATES: Record<string, TemplateStatutory> = {
  Standard: { epf: true, esi: true, lwf: true, statutoryBonus: false },
  'Junior — Below Taxable': { epf: true, esi: true, lwf: true, statutoryBonus: true },
  'Senior Management': { epf: true, esi: false, lwf: false, statutoryBonus: false },
  'Contract / Consultant': { epf: false, esi: false, lwf: false, statutoryBonus: false },
};

/**
 * Kept, unrendered, until payroll is wired up: the design is finished and
 * throwing it away would mean rebuilding it. Exported so it stays compiled
 * rather than rotting behind a lint suppression.
 */
export function SalaryStep() {
  const [open, setOpen] = useState<SalaryGroup | ''>('statutory');
  const [saved, setSaved] = useState<Record<SalaryGroup, boolean>>({ statutory: false, structure: false, benefits: false });
  const [sal, setSal] = useState<SalaryData>(EMPTY_SALARY);
  const set = <K extends keyof SalaryData>(k: K, v: SalaryData[K]) => setSal((s) => ({ ...s, [k]: v }));

  const saveGroup = (key: SalaryGroup) => {
    setSaved((s) => ({ ...s, [key]: true }));
    const idx = SALARY_GROUPS.findIndex((g) => g.key === key);
    const next = SALARY_GROUPS[idx + 1];
    setOpen(next ? next.key : '');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {SALARY_GROUPS.map((g) => {
        const isOpen = open === g.key;
        const isSaved = saved[g.key];
        return (
          <div key={g.key} style={{ border: '1px solid #EBEBEB', borderRadius: 14, background: '#fff', overflow: 'hidden' }}>
            <button
              onClick={() => setOpen(isOpen ? '' : g.key)}
              style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: '16px 20px', background: isOpen ? '#F7F7F9' : '#fff', border: 'none', cursor: 'pointer', textAlign: 'left' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: isOpen ? '#0571A6' : '#222222' }}>{g.title}</span>
                  {isSaved && !isOpen && <span style={{ fontSize: 12, fontWeight: 700, color: '#4F7A52', background: '#E4EDE0', borderRadius: 20, padding: '2px 9px' }}>Saved</span>}
                </div>
                {g.sub && <div style={{ fontSize: 12, color: '#717171', marginTop: 3 }}>{g.sub}</div>}
                {isSaved && !isOpen && g.key === 'statutory' && <StatutorySummary sal={sal} />}
              </div>
              <span style={{ fontSize: 20, color: '#9197A2', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .18s' }}>›</span>
            </button>
            {isOpen && (
              <div style={{ padding: '18px 20px 20px', borderTop: '1px solid #F0F0F2' }}>
                {g.key === 'statutory' ? (
                  <StatutoryComponents sal={sal} set={set} />
                ) : g.key === 'structure' ? (
                  <SalaryStructureGroup sal={sal} set={set} />
                ) : (
                  <OtherBenefitsGroup sal={sal} />
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18, paddingTop: 16, borderTop: '1px solid #F0F0F2' }}>
                  <button onClick={() => saveGroup(g.key)} style={primaryBtn}>Save</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatutorySummary({ sal }: { sal: SalaryData }) {
  const items: [string, boolean][] = [
    ["Employees' Provident Fund", sal.epf],
    ["Employees' State Insurance", sal.esi],
    ['Labour Welfare Fund', sal.lwf],
    ['Statutory Bonus', sal.statutoryBonus],
  ];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
      {sal.salaryTemplate && (
        <span style={{ fontSize: 12, fontWeight: 700, color: '#0571A6' }}>Template: {sal.salaryTemplate} ·</span>
      )}
      {items.map(([label, on]) => (
        <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: on ? '#4F7A52' : '#717171' }}>
          <span style={{ fontWeight: 800 }}>{on ? '✓' : '✕'}</span>
          {label}
        </span>
      ))}
      {sal.bonusCategory && (
        <span style={{ fontSize: 12, fontWeight: 600, color: '#717171' }}>· Category: {sal.bonusCategory}</span>
      )}
    </div>
  );
}

function StatutoryComponents({ sal, set }: { sal: SalaryData; set: <K extends keyof SalaryData>(k: K, v: SalaryData[K]) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Salary template — selecting it auto-applies and locks the components. */}
      <SalaryTemplatePicker sal={sal} set={set} />

      <div style={{ borderTop: '1px solid #F0F0F2' }} />

      {/* EPF */}
      <div>
        <CheckRow checked={sal.epf} onChange={(v) => set('epf', v)} label="Employees' Provident Fund" />
        {sal.epf && (
          <div style={subPanel}>
            <div style={grid2}>
              <Field label="PF Account Number">
                <input value={sal.pfAccountNumber} onChange={(e) => set('pfAccountNumber', e.target.value.toUpperCase())} placeholder="e.g. KA/BNG/0012345/000/0001234" style={inputStyle} />
              </Field>
              <Field label="Universal Account Number">
                <input value={sal.uan} onChange={(e) => set('uan', e.target.value)} placeholder="12-digit UAN" style={inputStyle} />
              </Field>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 16, fontWeight: 600, color: '#484848', cursor: 'pointer' }}>
              <input type="checkbox" checked={sal.contributeEps} onChange={(e) => set('contributeEps', e.target.checked)} />
              <span>Contribute to <strong>Employee Pension Scheme</strong></span>
              <InfoDot text="Employees enrolled in the Provident Fund on or before 1 September 2014, and employees who join after 1 September 2014 drawing monthly wages up to ₹15,000, must contribute to the Employee Pension Scheme (Employees' Pension Scheme, 1995). Employees drawing more than ₹15,000 a month need not contribute — their share goes entirely to their provident fund account." />
            </label>
          </div>
        )}
      </div>

      {/* ESI */}
      <div>
        <CheckRow checked={sal.esi} onChange={(v) => set('esi', v)} label="Employees' State Insurance" />
        {sal.esi && (
          <div style={subPanel}>
            <div style={grid2}>
              <Field label="ESI Insurance Number">
                <input value={sal.esiNumber} onChange={(e) => set('esiNumber', e.target.value)} placeholder="17-digit ESI number" style={inputStyle} />
              </Field>
              <div />
            </div>
            <div style={{ fontSize: 14, color: '#717171', lineHeight: 1.55 }}>
              ESI deductions will be made only if the monthly salary is less than or equal to ₹21,000 (Employees'
              State Insurance Act, 1948). If the employee gets a salary revision, they continue making ESI contributions
              until the contribution period in which the salary was revised ends.
            </div>
          </div>
        )}
      </div>

      {/* LWF */}
      <CheckRow checked={sal.lwf} onChange={(v) => set('lwf', v)} label="Labour Welfare Fund" />

      {/* Statutory Bonus */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 16, fontWeight: 700, color: '#222222', cursor: 'pointer' }}>
        <input type="checkbox" checked={sal.statutoryBonus} onChange={(e) => set('statutoryBonus', e.target.checked)} />
        Statutory Bonus
        <InfoDot text="Statutory bonus is mandatory for employees drawing a monthly salary of ₹21,000 or less, under the Payment of Bonus Act, 1965." />
      </label>

      {/* Employee category — independent of the above */}
      <div style={grid2}>
        <Field label="Employee category">
          <Select value={sal.bonusCategory} onChange={(v) => set('bonusCategory', v)} placeholder="Select category" options={BONUS_CATEGORIES} />
        </Field>
        <div />
      </div>
    </div>
  );
}

function SalaryTemplatePicker({ sal, set }: { sal: SalaryData; set: <K extends keyof SalaryData>(k: K, v: SalaryData[K]) => void }) {
  const applyTemplate = (name: string) => {
    set('salaryTemplate', name);
    if (!name) return;
    const t = SALARY_TEMPLATES[name];
    // Prefill the statutory settings from the template (adjustable below).
    set('epf', t.epf);
    set('esi', t.esi);
    set('lwf', t.lwf);
    set('statutoryBonus', t.statutoryBonus);
  };
  return (
    <div>
      <div style={grid2}>
        <Field label="Salary Template">
          <Select value={sal.salaryTemplate} onChange={applyTemplate} placeholder="Select a template" options={Object.keys(SALARY_TEMPLATES)} />
        </Field>
        <div />
      </div>

      {sal.salaryTemplate && (
        <div style={{ animation: 'fade .2s ease both', display: 'flex', gap: 10, alignItems: 'flex-start', background: '#E4EDE0', border: '1px solid #CFE0C6', borderRadius: 10, padding: '11px 14px', fontSize: 14, color: '#40663F', lineHeight: 1.5 }}>
          <span style={{ fontWeight: 800 }}>✓</span>
          <span>The <strong>{sal.salaryTemplate}</strong> template has been applied — its EPF, ESI and other statutory settings are prefilled below. Salary components will be prefilled in the Salary Structure step.</span>
        </div>
      )}
    </div>
  );
}

const SR_COLS = '2.2fr 1.9fr 1.05fr 1.05fr';

function SRHead({ label, tag }: { label: string; tag?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '11px 16px', background: '#F7F7F9', borderBottom: '1px solid #F0F0F2' }}>
      <span style={{ fontSize: 14, fontWeight: 800, color: '#0571A6' }}>{label}</span>
      {tag && <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', color: '#9197A2' }}>{tag}</span>}
    </div>
  );
}

function SRRow({ name, sub, info, extra, calc, monthly, annual }: { name: string; sub?: string; info?: string; extra?: ReactNode; calc: ReactNode; monthly: ReactNode; annual: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: SR_COLS, gap: 12, padding: '12px 16px', borderBottom: '1px solid #F0F0F2', alignItems: 'center' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, color: '#222222' }}>{name}{info && <InfoDot text={info} />}</div>
        {sub && <div style={{ fontSize: 12, color: '#717171', marginTop: 2 }}>{sub}</div>}
        {extra}
      </div>
      <div style={{ fontSize: 14, color: '#484848' }}>{calc}</div>
      <div style={{ textAlign: 'right', fontSize: 14, color: '#222222', fontVariantNumeric: 'tabular-nums' }}>{monthly}</div>
      <div style={{ textAlign: 'right', fontSize: 14, color: '#222222', fontVariantNumeric: 'tabular-nums' }}>{annual}</div>
    </div>
  );
}

const srInput: CSSProperties = { width: 84, padding: '6px 9px', border: '1px solid #EBEBEB', borderRadius: 8, fontSize: 14, textAlign: 'right', fontFamily: 'inherit', background: '#fff', color: '#222222' };
const srPct: CSSProperties = { width: 54, padding: '6px 8px', border: '1px solid #EBEBEB', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const srUnit: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', border: '1px solid #EBEBEB', borderRadius: 8, fontSize: 14, background: '#F7F7F9', color: '#484848', whiteSpace: 'nowrap' };
const sysCalc = <span style={{ fontSize: 12, color: '#717171' }}>System Calculated</span>;

// Voluntary benefits configured for the org that can be added to an employee's
// structure. Each may depend on a statutory component being enabled — e.g. VPF is
// a voluntary top-up of the PF account, so it only makes sense when EPF is on.
// (Statutory-driven contributions like ESI / LWF are NOT here — they're governed
// by the checkboxes in Statutory Components, so offering them again would conflict.)
type BenefitOption = { label: string; requires?: keyof SalaryData; requiresLabel?: string };
const BENEFIT_OPTIONS: BenefitOption[] = [
  { label: 'Voluntary Provident Fund', requires: 'epf', requiresLabel: "Employees’ Provident Fund" },
  { label: 'National Pension System - Employer Contribution' },
  { label: 'Food / Meal Coupons' },
  { label: 'Group Health Insurance' },
  { label: 'Group Personal Accident Insurance' },
];

function SalaryStructureGroup({ sal, set }: { sal: SalaryData; set: <K extends keyof SalaryData>(k: K, v: SalaryData[K]) => void }) {
  if (!sal.salaryTemplate) {
    return (
      <div style={{ padding: '24px 0', textAlign: 'center', color: '#717171', fontSize: 14 }}>
        Select a <strong style={{ color: '#484848' }}>Salary Template</strong> in Statutory Components — the components will be prefilled here.
      </div>
    );
  }
  const ctc = Number(sal.annualCtc) || 0;
  const basicM = Math.round((ctc * 0.5) / 12);
  const basicA = basicM * 12;
  const hraM = Math.round(basicM * 0.5);
  const hraA = hraM * 12;

  return (
    <div>
      <div style={{ fontSize: 14, color: '#717171', marginBottom: 16 }}>Set how the employee&rsquo;s salary is divided for accurate pay calculation.</div>

      <div style={grid2}>
        <Field label="Salary Template">
          <input value={sal.salaryTemplate} disabled style={{ ...inputStyle, background: '#F7F7F9', color: '#717171' }} />
        </Field>
        <Field label="Annual CTC" required>
          <input type="number" value={sal.annualCtc} onChange={(e) => set('annualCtc', e.target.value)} placeholder="e.g. 1000000" style={inputStyle} />
        </Field>
      </div>

      <div style={{ border: '1px solid #EBEBEB', borderRadius: 12, overflow: 'hidden' }}>
        {/* Column header */}
        <div style={{ display: 'grid', gridTemplateColumns: SR_COLS, gap: 12, padding: '11px 16px', background: '#F7F7F9', borderBottom: '1px solid #F0F0F2', fontSize: 12, fontWeight: 700, letterSpacing: '.03em', color: '#717171', textTransform: 'uppercase' }}>
          <div>Salary Components</div>
          <div>Calculation Type</div>
          <div style={{ textAlign: 'right' }}>Monthly Amount</div>
          <div style={{ textAlign: 'right' }}>Annual Amount</div>
        </div>

        {/* One Time Earnings */}
        <SRHead label="One Time Earnings" tag="YEARLY" />
        <SRRow name="Bonus" calc="Fixed amount" monthly={<span style={{ color: '#9197A2' }}>—</span>} annual={<input readOnly value="0" style={srInput} />} />

        {/* Fixed CTC subtotal */}
        <div style={{ display: 'grid', gridTemplateColumns: SR_COLS, gap: 12, padding: '12px 16px', borderBottom: '1px solid #F0F0F2', alignItems: 'center' }}>
          <div style={{ gridColumn: '1 / 3', borderLeft: '3px solid #0571A6', paddingLeft: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#222222' }}>Fixed CTC <span style={{ fontWeight: 500, color: '#717171' }}>(Annual CTC − One Time Earnings)</span></div>
            <div style={{ fontSize: 12, color: '#717171', marginTop: 3, lineHeight: 1.45 }}>Earnings based on the Cost to Company (CTC) are calculated using the Fixed CTC.</div>
          </div>
          <div />
          <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 700, color: '#222222', fontVariantNumeric: 'tabular-nums' }}>{inrPlain(ctc)}</div>
        </div>

        {/* Earnings */}
        <SRHead label="Earnings" />
        <SRRow
          name="Basic"
          calc={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input readOnly value="50" style={srPct} /><span style={srUnit}>% of CTC</span></div>}
          monthly={<input readOnly value={inrPlain(basicM)} style={srInput} />}
          annual={inrPlain(basicA)}
        />
        <SRRow
          name="House Rent Allowance"
          calc={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input readOnly value="50" style={srPct} /><span style={srUnit}>% of Basic</span></div>}
          monthly={<input readOnly value={inrPlain(hraM)} style={srInput} />}
          annual={inrPlain(hraA)}
        />
        <SRRow
          name="Fixed Allowance"
          sub="Monthly CTC − Sum of all other components"
          info="The balancing component. It absorbs whatever is left of the monthly CTC after every other component is allocated."
          calc="Fixed amount"
          monthly={sysCalc}
          annual={sysCalc}
        />
        <SRRow
          name="Statutory Bonus"
          sub="Employment category: None"
          info="Statutory bonus is mandatory for employees drawing a monthly salary of ₹21,000 or less, under the Payment of Bonus Act, 1965."
          calc="8.33% of Statutory Bonus Wages"
          monthly={sysCalc}
          annual={sysCalc}
        />

        {/* Reimbursements */}
        <SRHead label="Reimbursements" />
        <SRRow name="Fuel Reimbursement" sub="Amount : ₹2,000.00" calc="Fixed amount" monthly={<input readOnly value="0" style={srInput} />} annual="0" />
        <SRRow name="Books and Periodicals Reimbursement" sub="Amount : ₹3,000.00" calc="Fixed amount" monthly={<input readOnly value="0" style={srInput} />} annual="0" />
        <SRRow name="Internet Reimbursement" sub="Amount : ₹1,800.00" calc="Fixed amount" monthly={<input readOnly value="0" style={srInput} />} annual="0" />

        {/* Flexible Benefit Plan Components */}
        <SRHead label="Flexible Benefit Plan Components" />
        <SRRow name="Meal Card" sub="Max Amount : ₹8,800" calc="Max Amount ₹8,800.00" monthly={<input readOnly value="0" style={srInput} />} annual="0" />

        {/* Benefits */}
        <SRHead label="Benefits" />
        <SRRow
          name="EPF - Employer Contribution"
          sub="Restricted to ₹15,000"
          extra={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, color: '#484848' }}><input type="checkbox" checked readOnly /> Contribute to Employee Pension Scheme</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, color: '#484848' }}><input type="checkbox" checked readOnly /> Contribute EPS at actual PF Wages</label>
            </div>
          }
          calc={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input readOnly value="15000" style={srInput} /><span style={srUnit}>Restricted PF Wage ▾</span></div>}
          monthly={sysCalc}
          annual={sysCalc}
        />
        <SRRow
          name="Gratuity - Deduction - Employer Contribution"
          calc={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input readOnly value="4.81" style={srPct} /><span style={srUnit}>% of Basic ▾</span></div>}
          monthly={inrPlain(2004)}
          annual={inrPlain(24048)}
        />

        {/* System Calculated total */}
        <div style={{ display: 'grid', gridTemplateColumns: SR_COLS, gap: 12, padding: '12px 16px', background: '#EAF2FB', borderTop: '1px solid #EBEBEB', alignItems: 'center' }}>
          <div style={{ gridColumn: '1 / 3', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#41597A' }}>
            <span style={infoIcon}>i</span>
            System Calculated Components&rsquo; Total <span style={{ color: '#5A8FD1', fontWeight: 700, cursor: 'pointer' }}>(Preview)</span>
          </div>
          <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 700, color: '#41597A', fontVariantNumeric: 'tabular-nums' }}>{inrPlain(18828)}</div>
          <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 700, color: '#41597A', fontVariantNumeric: 'tabular-nums' }}>{inrPlain(225936)}</div>
        </div>

        {/* Cost to Company */}
        <div style={{ display: 'grid', gridTemplateColumns: SR_COLS, gap: 12, padding: '14px 16px', background: '#E7F4FB', alignItems: 'center' }}>
          <div style={{ gridColumn: '1 / 3', fontSize: 16, fontWeight: 800, color: '#222222' }}>Cost to Company</div>
          <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 800, color: '#0571A6', fontVariantNumeric: 'tabular-nums' }}>{inrRupees(Math.round(ctc / 12))}</div>
          <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 800, color: '#0571A6', fontVariantNumeric: 'tabular-nums' }}>{inrRupees(ctc)}</div>
        </div>
      </div>
    </div>
  );
}

function OtherBenefitsGroup({ sal }: { sal: SalaryData }) {
  // Benefits already configured for this employee are derived from the statutory
  // setup (EPF employer contribution only if EPF is on; Gratuity is standard).
  // Extra voluntary benefits can be added from the configured catalog — gated so
  // they never contradict the statutory selections.
  const [benefits, setBenefits] = useState<string[]>(
    [sal.epf && "Employees’ Provident Fund - Employer Contribution", 'Gratuity - Employer Contribution'].filter(Boolean) as string[],
  );
  const [adding, setAdding] = useState(false);

  // A benefit is addable if it isn't already added; its gate decides whether it's
  // selectable or shown disabled with the reason.
  const remaining = BENEFIT_OPTIONS.filter((b) => !benefits.includes(b.label));
  const isEnabled = (b: BenefitOption) => !b.requires || Boolean(sal[b.requires]);
  const anySelectable = remaining.some(isEnabled);

  return (
    <div>
      <div style={{ border: '1px solid #EBEBEB', borderRadius: 12, overflow: 'hidden' }}>
        {benefits.map((b) => (
          <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid #F0F0F2' }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: '#F7F7F9', color: '#0571A6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6l-8-4z" /><path d="m9 12 2 2 4-4" /></svg>
            </div>
            <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: '#222222' }}>{b}</div>
            <button onClick={() => setBenefits((x) => x.filter((v) => v !== b))} title="Remove" style={{ display: 'inline-flex', background: 'none', border: 'none', cursor: 'pointer', color: '#9197A2', padding: 4 }}><IconClose size={15} /></button>
          </div>
        ))}

        <div style={{ padding: '12px 16px' }}>
          {adding ? (
            <select
              autoFocus
              value=""
              onChange={(e) => { if (e.target.value) { setBenefits((x) => [...x, e.target.value]); setAdding(false); } }}
              onBlur={() => setAdding(false)}
              style={{ ...inputStyle, maxWidth: 460 }}
            >
              <option value="">Select a benefit to add…</option>
              {remaining.map((o) => (
                <option key={o.label} value={o.label} disabled={!isEnabled(o)}>
                  {o.label}{isEnabled(o) ? '' : `  — requires ${o.requiresLabel}`}
                </option>
              ))}
            </select>
          ) : (
            <button
              onClick={() => setAdding(true)}
              disabled={!anySelectable}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: anySelectable ? 'pointer' : 'not-allowed', color: anySelectable ? '#0571A6' : '#9197A2', fontSize: 14, fontWeight: 700, padding: 0 }}
            >
              <IconPlus size={15} /> Add Benefit
            </button>
          )}
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#717171', marginTop: 10 }}>
        Only benefits configured for your organisation appear here. Some depend on a statutory component — e.g. Voluntary Provident Fund needs Employees&rsquo; Provident Fund enabled, so it stays disabled until you turn EPF on in Statutory Components.
      </div>
    </div>
  );
}

function CheckRow({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 16, fontWeight: 700, color: '#222222', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

const subPanel: CSSProperties = { marginTop: 14, marginLeft: 26, padding: '16px 18px', background: '#F7F7F9', border: '1px solid #EBEBEB', borderRadius: 12 };

// —— Payment information step ————————————————————————————————————————
// No Direct Deposit: Sowaka does not move money, so offering an "automated
// process" would promise a disbursement that never happens. The remaining
// three record how the employee was paid elsewhere.
type PayMode = 'bank' | 'cheque' | 'cash';
const PAY_MODES: { key: PayMode; title: string; sub: string; icon: ReactNode }[] = [
  {
    key: 'bank',
    title: 'Bank Transfer (Manual Process)',
    sub: "Download Bank Advice and process the payment through your bank's website.",
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5 12 4l9 5.5" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" /><path d="M3 20h18" /></svg>,
  },
  {
    key: 'cheque',
    title: 'Cheque',
    sub: "Record the employee's pay as paid by cheque.",
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6 12h6M6 15h3" /><circle cx="17" cy="13" r="2" /></svg>,
  },
  {
    key: 'cash',
    title: 'Cash',
    sub: "Record the employee's pay as paid in cash.",
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M6 9v6M18 9v6" /></svg>,
  },
];
function PaymentStep({ holderName }: { holderName: string }) {
  const [mode, setMode] = useState<PayMode>('bank');

  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 800, color: '#222222', marginBottom: 4 }}>
        How would you like to pay this employee?<span style={{ color: '#C4382E', marginLeft: 3 }}>*</span>
      </div>
      <div style={{ fontSize: 14, color: '#717171', marginBottom: 18 }}>Choose the mode Sowaka Connect uses to record or disburse this employee&rsquo;s pay.</div>

      <div style={{ border: '1px solid #EBEBEB', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
        {PAY_MODES.map((m, i) => {
          const selected = mode === m.key;
          // Bank Transfer needs account details, shown inline once selected.
          const showBank = selected && m.key === 'bank';
          return (
            <div key={m.key}>
              <button
                onClick={() => setMode(m.key)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', cursor: 'pointer',
                  background: selected ? '#F7F7F9' : '#fff', border: 'none',
                  borderTop: i === 0 ? 'none' : '1px solid #F0F0F2', padding: '16px 18px',
                }}
              >
                <span style={{
                  width: 42, height: 42, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: selected ? '#F7F7F9' : '#F7F7F9', color: selected ? '#0571A6' : '#717171',
                }}>
                  {m.icon}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 16, fontWeight: 700, color: '#222222' }}>{m.title}</span>
                  <span style={{ display: 'block', fontSize: 14, color: '#717171', marginTop: 2, lineHeight: 1.45 }}>{m.sub}</span>
                </span>
                <span style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: `2px solid ${selected ? '#0571A6' : '#EBEBEB'}`,
                  background: selected ? '#0571A6' : '#fff', color: '#fff',
                }}>
                  {selected && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5 10 17.5 19 7" /></svg>}
                </span>
              </button>

              {showBank && (
                <div style={{ padding: '4px 18px 20px' }}>
                  <BankDetailsForm holderName={holderName} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const ACCOUNT_TYPES = ['Savings', 'Current'];

function BankDetailsForm({ holderName }: { holderName: string }) {
  const [accType, setAccType] = useState('Savings');
  return (
    <div style={{ ...subPanel, marginLeft: 0, marginTop: 6 }}>
      <Field label="Account Holder Name" required>
        <input defaultValue={holderName} placeholder="As printed on the passbook" style={inputStyle} />
      </Field>
      <Field label="Bank Name" required>
        <input placeholder="e.g. HDFC Bank" style={inputStyle} />
      </Field>
      <div style={grid2}>
        <Field label="Account Number" required>
          <input placeholder="e.g. 001234567890" style={inputStyle} />
        </Field>
        <Field label="Re-enter Account Number" required>
          <input placeholder="Confirm account number" style={inputStyle} />
        </Field>
      </div>
      <div style={grid2}>
        <Field label="IFSC" required>
          <input placeholder="AAAA0000000" maxLength={11} style={{ ...inputStyle, textTransform: 'uppercase', letterSpacing: '.05em' }} />
        </Field>
        <Field label="Account Type" required>
          <div style={{ display: 'flex', gap: 24, alignItems: 'center', height: 42 }}>
            {ACCOUNT_TYPES.map((t) => {
              const on = accType === t;
              return (
                <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 16, fontWeight: 600, color: '#222222' }}>
                  <span style={{
                    width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                    border: `2px solid ${on ? '#0571A6' : '#9197A2'}`,
                    background: on ? 'radial-gradient(circle, #0571A6 42%, #fff 46%)' : '#fff',
                  }} />
                  <input type="radio" name="accType" checked={on} onChange={() => setAccType(t)} style={{ display: 'none' }} />
                  {t}
                </label>
              );
            })}
          </div>
        </Field>
      </div>
      <div style={{ ...infoCallout, marginTop: 4 }}>
        <span style={infoIcon}>i</span>
        <span>Double-check the account number and IFSC — payouts to a wrong account can&rsquo;t be reversed.</span>
      </div>
    </div>
  );
}

/** Placeholder body for a step whose fields are not defined yet. */
export function StepStub({ title }: { title: string }) {
  return (
    <div style={{ padding: '48px 20px', textAlign: 'center', color: '#717171' }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: '#484848' }}>{title}</div>
      <div style={{ fontSize: 14, marginTop: 8 }}>Fields for this step are being defined next.</div>
    </div>
  );
}

// —— Personal details step ————————————————————————————————————————————
type PersonalData = {
  dob: string;
  fatherName: string;
  pan: string;
  differentlyAbled: string;
  personalEmail: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pin: string;
};
const EMPTY_PERSONAL: PersonalData = { dob: '', fatherName: '', pan: '', differentlyAbled: 'None', personalEmail: '', addressLine1: '', addressLine2: '', city: '', state: '', pin: '' };

const DISABILITY_TYPES = ['None', 'Visual impairment', 'Hearing impairment', 'Speech impairment', 'Locomotor disability', 'Intellectual disability', 'Multiple disabilities', 'Other'];
const IN_STATES = ['Andhra Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Odisha', 'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];

function ageFromDob(dob: string): string {
  if (!dob) return '';
  const b = new Date(dob);
  if (Number.isNaN(b.getTime())) return '';
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age >= 0 && age < 120 ? String(age) : '';
}

function PersonalStep() {
  const [p, setP] = useState<PersonalData>(EMPTY_PERSONAL);
  const set = <K extends keyof PersonalData>(k: K, v: PersonalData[K]) => setP((s) => ({ ...s, [k]: v }));
  const age = ageFromDob(p.dob);

  return (
    <div>
      {/* Date of birth + age */}
      <div style={grid2}>
        <Field label="Date of Birth" required>
          <input type="date" value={p.dob} onChange={(e) => set('dob', e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Age">
          <input value={age} readOnly placeholder="—" style={{ ...inputStyle, background: '#F7F7F9', color: '#717171' }} />
        </Field>
      </div>

      {/* Father's name + PAN */}
      <div style={grid2}>
        <Field label="Father's Name" required>
          <input value={p.fatherName} onChange={(e) => set('fatherName', e.target.value)} placeholder="e.g. Arvind Jadhav" style={inputStyle} />
        </Field>
        <Field label="PAN">
          <input value={p.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} placeholder="e.g. AOQPJ8884F" maxLength={10} style={{ ...inputStyle, textTransform: 'uppercase', letterSpacing: '.05em' }} />
        </Field>
      </div>

      {/* Differently abled + personal email */}
      <div style={grid2}>
        <Field label="Differently Abled Type">
          <Select value={p.differentlyAbled} onChange={(v) => set('differentlyAbled', v)} placeholder="None" options={DISABILITY_TYPES} />
        </Field>
        <Field label="Personal Email Address">
          <input type="email" value={p.personalEmail} onChange={(e) => set('personalEmail', e.target.value)} placeholder="e.g. name@gmail.com" style={inputStyle} />
        </Field>
      </div>

      {/* Residential address */}
      <Field label="Residential Address">
        <input value={p.addressLine1} onChange={(e) => set('addressLine1', e.target.value)} placeholder="Flat / house no., building, street, area" style={{ ...inputStyle, marginBottom: 10 }} />
        <input value={p.addressLine2} onChange={(e) => set('addressLine2', e.target.value)} placeholder="Landmark (optional)" style={{ ...inputStyle, marginBottom: 10 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <input value={p.city} onChange={(e) => set('city', e.target.value)} placeholder="City" style={inputStyle} />
          <Select value={p.state} onChange={(v) => set('state', v)} placeholder="Select State" options={IN_STATES} />
          <input value={p.pin} onChange={(e) => set('pin', e.target.value.replace(/\D/g, ''))} placeholder="PIN code" maxLength={6} style={inputStyle} />
        </div>
      </Field>
    </div>
  );
}

// —— Small building blocks ————————————————————————————————————————————
function Field({ label, required, error, children }: { label: string; required?: boolean; error?: boolean; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 5, color: '#484848' }}>
        {label}{required && <span style={{ color: '#C4382E', marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {error && <div style={{ fontSize: 14, color: '#A8475F', marginTop: 4, fontWeight: 600 }}>This field is required</div>}
    </div>
  );
}

function Select({ value, onChange, placeholder, options }: { value: string; onChange: (v: string) => void; placeholder: string; options: string[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, color: value ? '#222222' : '#717171' }}>
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o} value={o} style={{ color: '#222222' }}>{o}</option>)}
    </select>
  );
}

function RadioCard({ checked, onClick, title, sub }: { checked: boolean; onClick: () => void; title: string; sub: string }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, minWidth: 220, textAlign: 'left', cursor: 'pointer',
      border: `1.5px solid ${checked ? '#0571A6' : '#EBEBEB'}`,
      background: checked ? '#F7F7F9' : '#fff',
      borderRadius: 11, padding: '10px 12px', display: 'flex', gap: 9, alignItems: 'flex-start',
    }}>
      <span style={{
        width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 1,
        border: `2px solid ${checked ? '#0571A6' : '#9197A2'}`,
        background: checked ? 'radial-gradient(circle, #0571A6 42%, #fff 46%)' : '#fff',
      }} />
      <span>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: '#222222' }}>{title}</span>
        <span style={{ display: 'block', fontSize: 12, color: '#717171', marginTop: 2, lineHeight: 1.4 }}>{sub}</span>
      </span>
    </button>
  );
}

function InfoDot({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 16, height: 16, borderRadius: '50%', border: '1px solid #9197A2',
          color: '#717171', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontStyle: 'italic',
        }}
      >
        i
      </span>
      {open && (
        <span style={{
          position: 'absolute', bottom: 'calc(100% + 9px)', left: '50%', transform: 'translateX(-50%)',
          width: 250, background: '#222222', color: '#fff', fontSize: 14, fontWeight: 500, fontStyle: 'normal',
          lineHeight: 1.45, padding: '9px 12px', borderRadius: 9, boxShadow: '0 10px 24px rgba(34,34,34,.32)', zIndex: 5,
        }}>
          {text}
          <span style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: '6px solid #222222' }} />
        </span>
      )}
    </span>
  );
}

const overlay: CSSProperties = { position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(34,34,34,.42)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'stretch', justifyContent: 'center', padding: 22 };
const modalCard: CSSProperties = { width: '100%', maxWidth: 1440, height: '100%', display: 'flex', flexDirection: 'column', background: '#F7F7F9', border: '1px solid #EBEBEB', borderRadius: 18, boxShadow: '0 30px 70px rgba(34,34,34,.32)' };
const inputStyle: CSSProperties = { width: '100%', padding: '11px 12px', border: '1px solid #EBEBEB', borderRadius: 10, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const iconBtn: CSSProperties = { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#717171' };
const primaryBtn: CSSProperties = { background: '#0571A6', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const ghostBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const grid2: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 };
const grid3: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 18 };
const infoCallout: CSSProperties = { display: 'flex', gap: 10, alignItems: 'flex-start', background: '#EAF2FB', border: '1px solid #CFE0F2', borderRadius: 10, padding: '12px 14px', fontSize: 14, color: '#41597A', lineHeight: 1.5 };
const infoIcon: CSSProperties = { flexShrink: 0, width: 18, height: 18, borderRadius: '50%', background: '#5A8FD1', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, fontStyle: 'italic', marginTop: 1 };
