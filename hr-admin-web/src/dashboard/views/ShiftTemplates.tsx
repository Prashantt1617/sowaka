// Shifts › Templates — a named override of the org policy, and the people it
// covers. A template opens as a copy of the policy in Shifts › Policies and
// every field is editable from there; saving writes to the template alone, so
// the org policy is never touched. Anyone the template is not assigned to stays
// on the org policy.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';
import {
  createShift, deleteShift as deleteShiftApi, getAllEmployees, getShiftPolicy, getShifts, updateShift,
  type DayMark, type EmployeeDTO, type LeaveTypeRule, type PunchFormat, type ShiftDTO, type ShiftPolicyDTO,
} from '../../services/hrms';
import { downloadCsv } from '../export';

const MARK_OPTIONS: DayMark[] = ['Absent', 'Half Day', 'Present', 'Pending Regularisation'];
const PUNCH_FORMATS: PunchFormat[] = ['Biometric', 'Geotag (powered by Sowaka)', 'Present by default (Auto Punch)'];
const APPROVERS = ['Reporting manager', 'HR', 'Reporting manager, then HR'];
const TRIGGERS = ['Missing punch-in', 'Missing punch-out', 'Both punches missing'];
const DOW = [
  { key: 0, label: 'M', long: 'Mon' }, { key: 1, label: 'T', long: 'Tue' },
  { key: 2, label: 'W', long: 'Wed' }, { key: 3, label: 'T', long: 'Thu' },
  { key: 4, label: 'F', long: 'Fri' }, { key: 5, label: 'S', long: 'Sat' },
  { key: 6, label: 'S', long: 'Sun' },
];
const WEEKS = [1, 2, 3, 4, 5];

function toMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  return h > 23 || min > 59 ? null : h * 60 + min;
}
function formatDuration(mins: number): string {
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}
function clock(base: string, delta: number): string {
  const at = toMinutes(base);
  if (at == null) return '—';
  const m = (at + delta + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

type Mode = { kind: 'list' } | { kind: 'edit'; id: string | null };

export function ShiftTemplates() {
  const { flash, setView } = useStore();
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [shifts, setShifts] = useState<ShiftDTO[]>([]);
  const [orgPolicy, setOrgPolicy] = useState<ShiftPolicyDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [policy, setPolicy] = useState<ShiftPolicyDTO | null>(null);
  /** The roster, so an export can name the people a shift covers. */
  const [roster, setRoster] = useState<EmployeeDTO[]>([]);

  const reload = () =>
    Promise.all([getShifts(), getShiftPolicy()])
      .then(([rows, org]) => { setShifts(rows); setOrgPolicy(org); })
      .catch((error: Error) => flash(error.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    void reload();
    getAllEmployees().then(setRoster).catch(() => setRoster([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = (shift: ShiftDTO) => {
    setName(shift.name); setActive(shift.active); setPolicy(shift.policy);
    setMode({ kind: 'edit', id: shift.id });
  };
  const create = () => {
    if (!orgPolicy) { flash('The org policy has not loaded yet'); return; }
    setName(''); setActive(true);
    // A new template starts as a copy of the policy everyone is on today.
    setPolicy(JSON.parse(JSON.stringify(orgPolicy)) as ShiftPolicyDTO);
    setMode({ kind: 'edit', id: null });
  };

  const patch = (change: Partial<ShiftPolicyDTO>) =>
    setPolicy((p) => (p ? { ...p, ...change } : p));

  const save = async () => {
    if (!name.trim()) { flash('Give the shift a name'); return; }
    if (!policy) return;
    setSaving(true);
    try {
      const input = { name: name.trim(), active, policy };
      const saved = mode.kind === 'edit' && mode.id
        ? await updateShift(mode.id, input)
        : await createShift(input);
      await reload();
      flash(`${saved.name} saved — it does not change the org policy`);
      setMode({ kind: 'list' });
    } catch (error) {
      flash((error as Error).message);
    } finally { setSaving(false); }
  };

  const exportTemplate = (shift: ShiftDTO) => {
    const p = shift.policy;
    const rows = roster.filter((person) => shift.assignedUserIds.includes(person.userId));
    downloadCsv(`${shift.name.replace(/\s+/g, '-').toLowerCase()}-employees`, [
      { header: 'Employee ID', value: (e: EmployeeDTO) => e.employeeId ?? '' },
      { header: 'Name', value: (e: EmployeeDTO) => e.name },
      { header: 'Department', value: (e: EmployeeDTO) => e.department ?? '' },
      { header: 'Designation', value: (e: EmployeeDTO) => e.designation ?? '' },
      { header: 'Location', value: (e: EmployeeDTO) => e.location ?? '' },
      { header: 'Reports to', value: (e: EmployeeDTO) => e.managerName ?? '' },
      { header: 'Shift', value: () => shift.name },
      { header: 'Window', value: () => `${p.startTime}-${p.endTime}` },
      { header: 'Half day (hrs)', value: () => p.minHalfDayHours },
      { header: 'Full day (hrs)', value: () => p.minFullDayHours },
      { header: 'Late grace (min)', value: () => p.lateGraceMinutes },
      { header: 'Early-out grace (min)', value: () => p.earlyOutGraceMinutes },
      { header: 'Punch format', value: () => p.correction.punchFormat },
      { header: 'Leave approver', value: () => p.leave.approver },
      { header: 'Overtime eligible', value: () => (p.overtime.eligible ? 'Yes' : 'No') },
    ], rows);
  };

  const remove = async (id: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    try {
      await deleteShiftApi(id);
      await reload();
      flash('Shift deleted');
      setMode({ kind: 'list' });
    } catch (error) { flash((error as Error).message); }
  };

  if (mode.kind === 'list') {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: '#717171', maxWidth: 620, lineHeight: 1.5 }}>
            A template overrides the org policy for the people it is assigned to. Everyone else
            follows Shifts › Policies. Assigning is done from{' '}
            <button onClick={() => setView('shiftbulk')} style={linkBtn}>Bulk Assign</button>.
          </div>
          <button onClick={create} style={{ ...primaryBtn, marginLeft: 'auto' }}>+ Create New</button>
        </div>
        <Card>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>Template</Th>
                <Th width={230}>Shift window</Th>
                <Th width={200}>Employees using it</Th>
                <Th width={120} right>{' '}</Th>
              </tr>
            </thead>
            <tbody>
              {shifts.filter((t) => t.policy).map((t) => {
                const sm = toMinutes(t.policy.startTime); const em = toMinutes(t.policy.endTime);
                let d = sm != null && em != null ? em - sm : 0;
                if (d <= 0) d += 24 * 60;
                return (
                  <tr key={t.id} className="phm-row" onClick={() => open(t)} style={{ cursor: 'pointer' }}>
                    <Td>
                      <span style={{ fontWeight: 800, color: '#0571A6' }}>{t.name}</span>
                      {!t.active && <span style={inactivePill}>Inactive</span>}
                      <div style={{ fontSize: 13.5, color: '#717171', marginTop: 3, lineHeight: 1.45 }}>
                        half day {t.policy.minHalfDayHours}h · full day {t.policy.minFullDayHours}h ·
                        grace {t.policy.lateGraceMinutes}/{t.policy.earlyOutGraceMinutes} min
                      </div>
                    </Td>
                    <Td muted>{t.policy.startTime} – {t.policy.endTime} · {formatDuration(d)}</Td>
                    <Td>
                      <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: t.assignedCount ? '#222222' : '#9197A2' }}>
                        {t.assignedCount}
                      </span>
                      <span style={{ fontSize: 14, color: '#9197A2' }}>
                        {t.assignedCount === 1 ? ' employee' : ' employees'}
                      </span>
                    </Td>
                    <Td right>
                      <button
                        onClick={(e) => { e.stopPropagation(); exportTemplate(t); }}
                        disabled={t.assignedCount === 0}
                        title={t.assignedCount === 0 ? 'Nobody is on this shift yet' : 'Export the people on it'}
                        style={{ ...smallBtn, opacity: t.assignedCount === 0 ? 0.45 : 1 }}
                      >
                        Export
                      </button>
                    </Td>
                  </tr>
                );
              })}
              {!loading && shifts.length === 0 && (
                <tr><td colSpan={4} style={emptyCell}>
                  No templates yet. Everyone follows the org policy in Shifts › Policies.
                </td></tr>
              )}
              {loading && <tr><td colSpan={4} style={emptyCell}>Loading…</td></tr>}
            </tbody>
          </table>
        </Card>
      </div>
    );
  }

  if (!policy) return <div style={emptyCell}>Loading policy…</div>;

  const win = (() => {
    const s = toMinutes(policy.startTime); const e = toMinutes(policy.endTime);
    if (s == null || e == null) return { label: '—', overnight: false };
    let d = e - s; let overnight = false;
    if (d <= 0) { d += 1440; overnight = true; }
    return { label: formatDuration(d), overnight };
  })();

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <button onClick={() => setMode({ kind: 'list' })} style={ghostBtn}>← All templates</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 9 }}>
          {mode.id && <button onClick={() => void remove(mode.id!)} style={dangerBtn}>Delete</button>}
          <button onClick={() => void save()} disabled={saving} style={primaryBtn}>
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </div>
      </div>

      <div style={banner}>
        <span style={{ fontSize: 16, lineHeight: 1.3 }}>ℹ️</span>
        <div style={{ fontSize: 14, color: '#3A5A6B', lineHeight: 1.55 }}>
          This started as a copy of your <strong>org policy</strong> and every field below is
          editable. Saving writes to <strong>this template only</strong> — the org policy is a
          separate document and is not changed. It applies to the employees you assign it to;
          everyone else stays on the org policy.
        </div>
      </div>

      <Card style={{ padding: '16px 20px', marginBottom: 14 }}>
        <Field label="Shift Name" required>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Night Shift" style={input} />
        </Field>
        <label style={checkRow}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
        </label>
      </Card>

      <Section title="Working window" subtitle="When this shift opens and closes.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 16, alignItems: 'end' }}>
          <Field label="Shift start time (in)">
            <input type="time" value={policy.startTime} onChange={(e) => patch({ startTime: e.target.value })} style={input} />
          </Field>
          <Field label="Shift end time (out)">
            <input type="time" value={policy.endTime} onChange={(e) => patch({ endTime: e.target.value })} style={input} />
          </Field>
          <div style={{ marginBottom: 12 }}>
            <label style={fieldLabel}>Duration</label>
            <div style={durationBox}>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#0571A6', fontVariantNumeric: 'tabular-nums' }}>{win.label}</span>
              {win.overnight && <span style={overnightTag}>overnight · +1 day</span>}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Day thresholds" subtitle="Worked hours that earn a half day and a full day.">
        <Grid2>
          <Field label="Min hours for half day">
            <Num value={policy.minHalfDayHours} onChange={(v) => patch({ minHalfDayHours: v })} suffix="hrs" step="0.5" />
          </Field>
          <Field label="Min hours for full day">
            <Num value={policy.minFullDayHours} onChange={(v) => patch({ minFullDayHours: v })} suffix="hrs" step="0.5" />
          </Field>
        </Grid2>
        <div style={note}>
          {policy.minFullDayHours}h or more is a full day; {policy.minHalfDayHours}h up to{' '}
          {policy.minFullDayHours}h is a half day; anything shorter is flagged for correction.
        </div>
      </Section>

      <Section title="Late & early grace" subtitle="Measured against this shift's own start and end.">
        <Grid2>
          <Field label="Mark as late if late by">
            <Num value={policy.lateGraceMinutes} onChange={(v) => patch({ lateGraceMinutes: v })} suffix="min" />
          </Field>
          <Field label="Mark early-out if leaves early by">
            <Num value={policy.earlyOutGraceMinutes} onChange={(v) => patch({ earlyOutGraceMinutes: v })} suffix="min" />
          </Field>
        </Grid2>
        <div style={note}>
          On this {policy.startTime}–{policy.endTime} shift, arriving after{' '}
          {clock(policy.startTime, policy.lateGraceMinutes)} is late, and leaving before{' '}
          {clock(policy.endTime, -policy.earlyOutGraceMinutes)} is an early-out.
        </div>
      </Section>

      <Section title="Weekly-off" subtitle="Per week of the month — the 2nd Saturday can be off while the 1st is not.">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: '8px 8px' }}>
            <thead>
              <tr><th />{DOW.map((d) => <th key={d.long} title={d.long} style={{ fontSize: 13, fontWeight: 800, color: '#717171', width: 34 }}>{d.label}</th>)}</tr>
            </thead>
            <tbody>
              {WEEKS.map((w) => (
                <tr key={w}>
                  <td style={rowHead}>Week {w}</td>
                  {DOW.map((d) => {
                    const on = (policy.weeklyOff?.[String(w)] ?? []).includes(d.key);
                    return (
                      <td key={d.long} style={{ textAlign: 'center' }}>
                        <button
                          title={`${d.long} — week ${w}`}
                          onClick={() => {
                            const current = new Set(policy.weeklyOff?.[String(w)] ?? []);
                            if (current.has(d.key)) current.delete(d.key); else current.add(d.key);
                            patch({ weeklyOff: { ...policy.weeklyOff, [String(w)]: [...current].sort((a, b) => a - b) } });
                          }}
                          style={{
                            width: 30, height: 30, borderRadius: 8, cursor: 'pointer', display: 'inline-block',
                            border: `1px solid ${on ? '#0571A6' : '#DADFE4'}`, background: on ? '#0571A6' : '#fff',
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Attendance correction" subtitle="Missing punches, what can be corrected, and by whom.">
        <SubLabel>Missing punches</SubLabel>
        <Grid2>
          <Field label="Punch-in missing — mark as">
            <Select value={policy.missingPunchIn} onChange={(v) => patch({ missingPunchIn: v })} options={MARK_OPTIONS} />
          </Field>
          <Field label="Punch-out missing — mark as">
            <Select value={policy.missingPunchOut} onChange={(v) => patch({ missingPunchOut: v })} options={MARK_OPTIONS} />
          </Field>
          <Field label="Both punches missing — mark as">
            <Select value={policy.missingBoth} onChange={(v) => patch({ missingBoth: v })} options={MARK_OPTIONS} />
          </Field>
        </Grid2>

        <SubLabel>Punch format</SubLabel>
        <Select
          value={policy.correction.punchFormat}
          onChange={(v) => patch({ correction: { ...policy.correction, punchFormat: v } })}
          options={PUNCH_FORMATS}
        />

        <SubLabel>A correction can be raised when a day is marked</SubLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {TRIGGERS.map((t) => {
            const on = policy.correction.triggers.includes(t);
            return (
              <button
                key={t}
                onClick={() => patch({
                  correction: {
                    ...policy.correction,
                    triggers: on ? policy.correction.triggers.filter((x) => x !== t) : [...policy.correction.triggers, t],
                  },
                })}
                style={chip(on)}
              >{t}</button>
            );
          })}
        </div>

        <SubLabel>Approval</SubLabel>
        <Field label="Who approves a correction?">
          <Select
            value={policy.correction.approver}
            onChange={(v) => patch({ correction: { ...policy.correction, approver: v } })}
            options={APPROVERS}
          />
        </Field>
        <QRow label="Can HR override the decision?">
          <YesNo value={policy.correction.hrOverride} onChange={(v) => patch({ correction: { ...policy.correction, hrOverride: v } })} />
        </QRow>
        <QRow label="Can a manager correct attendance without the employee applying?">
          <YesNo value={policy.correction.managerWithoutEmployee} onChange={(v) => patch({ correction: { ...policy.correction, managerWithoutEmployee: v } })} />
        </QRow>
        <Field label="How far back can a correction be raised?">
          <Num value={policy.correction.backdateDays} onChange={(v) => patch({ correction: { ...policy.correction, backdateDays: v } })} suffix="days" width={220} />
        </Field>
      </Section>

      <Section title="Overtime" subtitle="Whether this shift qualifies, and how far back a claim can reach.">
        <QRow label="Are employees on this shift eligible for overtime?">
          <YesNo value={policy.overtime.eligible} onChange={(v) => patch({ overtime: { ...policy.overtime, eligible: v } })} />
        </QRow>
        <Field label="How far back can overtime be claimed?">
          <Num value={policy.overtime.backdateDays} onChange={(v) => patch({ overtime: { ...policy.overtime, backdateDays: v } })} suffix="days" width={220} />
        </Field>
        <div style={note}>
          Overtime is claimed as a full day or a half day. Approved overtime earns comp-off —
          a full day adds 1, a half day 0.5.
        </div>
      </Section>

      <Section title="Leave" subtitle="Approval, and each type's accrual, window and year-end handling.">
        <Field label="Who approves a leave request?">
          <Select
            value={policy.leave.approver}
            onChange={(v) => patch({ leave: { ...policy.leave, approver: v } })}
            options={APPROVERS}
          />
        </Field>
        <QRow label="Can HR override the decision?">
          <YesNo value={policy.leave.hrOverride} onChange={(v) => patch({ leave: { ...policy.leave, hrOverride: v } })} />
        </QRow>
        {policy.leave.types.map((type, index) => (
          <LeaveTypeBlock
            key={type.key}
            type={type}
            onChange={(change) => patch({
              leave: {
                ...policy.leave,
                types: policy.leave.types.map((t, i) => (i === index ? { ...t, ...change } : t)),
              },
            })}
          />
        ))}
      </Section>
    </div>
  );
}

function LeaveTypeBlock({ type, onChange }: { type: LeaveTypeRule; onChange: (c: Partial<LeaveTypeRule>) => void }) {
  const isCompOff = type.key === 'comp_off';
  return (
    <div style={{ border: '1px solid #EDEDF0', borderRadius: 10, padding: '14px 16px', marginTop: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>{type.name}</div>
      <Grid2>
        {!isCompOff && (
          <Field label="Leaves earned per month">
            <Num value={type.perMonth} onChange={(v) => onChange({ perMonth: v })} suffix="/ month" step="0.5" />
          </Field>
        )}
        <Field label="Balance processed at">
          <Select
            value={type.resetOn}
            onChange={(v) => onChange({ resetOn: v })}
            options={['calendar_year', 'financial_year'] as const}
            render={(v) => (v === 'calendar_year' ? 'End of calendar year' : 'End of financial year')}
          />
        </Field>
        <Field label="Carry forward up to">
          <Num value={type.carryForwardDays} onChange={(v) => onChange({ carryForwardDays: v })} suffix="days" />
        </Field>
        <Field label="What happens to the rest">
          <Select
            value={type.encashment}
            onChange={(v) => onChange({ encashment: v })}
            options={['all', 'limit', 'none'] as const}
            render={(v) => (v === 'all' ? 'Encash all of it' : v === 'limit' ? 'Encash up to a limit' : 'Nothing — it lapses')}
          />
        </Field>
        {type.encashment === 'limit' && (
          <Field label="Encashment limit">
            <Num value={type.encashLimitDays} onChange={(v) => onChange({ encashLimitDays: v })} suffix="days" />
          </Field>
        )}
        <Field label="Can be applied up to">
          <Num value={type.advanceDays} onChange={(v) => onChange({ advanceDays: v })} suffix="days ahead" />
        </Field>
      </Grid2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
        <div style={fieldLabel}>Allow backdated applications</div>
        <YesNo value={type.allowBackdated} onChange={(v) => onChange({ allowBackdated: v })} />
        {type.allowBackdated && (
          <Num value={type.backdatedDays} onChange={(v) => onChange({ backdatedDays: v })} suffix="days back" width={160} />
        )}
      </div>
      <div style={{ ...note, marginTop: 12 }}>Any balance still left after that will lapse.</div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', background: '#FBFBFC', border: 'none', borderBottom: open ? '1px solid #EBEBEB' : 'none', padding: '15px 20px', cursor: 'pointer' }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.2px' }}>{title}</div>
          {subtitle && <div style={{ fontSize: 13, color: '#717171', marginTop: 2 }}>{subtitle}</div>}
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9197A2" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'transform .18s', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div style={{ padding: '16px 20px' }}>{children}</div>}
    </Card>
  );
}

function Grid2({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>{children}</div>;
}
function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={fieldLabel}>{label}{required && <span style={{ color: '#C4382E' }}> *</span>}</label>
      {children}
    </div>
  );
}
function QRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0', borderTop: '1px solid #F4F4F6' }}>
      <div style={{ flex: 1, fontSize: 15, color: '#333333', fontWeight: 600 }}>{label}</div>
      {children}
    </div>
  );
}
function SubLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#9197A2', margin: '18px 0 8px' }}>{children}</div>;
}
function Num({ value, onChange, suffix, width, step }: { value: number; onChange: (v: number) => void; suffix: string; width?: number; step?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #EBEBEB', borderRadius: 9, overflow: 'hidden', background: '#fff', width: width ?? '100%' }}>
      <input type="number" min="0" step={step ?? '1'} value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} style={{ border: 'none', outline: 'none', padding: '9px 11px', fontSize: 16, width: '100%', color: '#222222', background: 'transparent' }} />
      <span style={{ padding: '9px 12px', color: '#717171', borderLeft: '1px solid #EBEBEB', fontSize: 14, whiteSpace: 'nowrap' }}>{suffix}</span>
    </div>
  );
}
function Select<T extends string>({ value, onChange, options, render }: { value: T; onChange: (v: T) => void; options: readonly T[]; render?: (v: T) => string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} style={{ ...input, cursor: 'pointer' }}>
      {options.map((o) => <option key={o} value={o}>{render ? render(o) : o}</option>)}
    </select>
  );
}
function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'inline-flex', border: '1px solid #EBEBEB', borderRadius: 10, overflow: 'hidden' }}>
      {[{ v: true, l: 'Yes' }, { v: false, l: 'No' }].map((o) => (
        <button key={o.l} onClick={() => onChange(o.v)} style={{
          padding: '7px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer', border: 'none',
          borderLeft: o.v ? 'none' : '1px solid #EBEBEB',
          background: value === o.v ? '#0571A6' : '#fff', color: value === o.v ? '#fff' : '#484848',
        }}>{o.l}</button>
      ))}
    </div>
  );
}
function Th({ children, width, right }: { children: ReactNode; width?: number; right?: boolean }) {
  return <th style={{ textAlign: right ? 'right' : 'left', width, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', color: '#717171', fontWeight: 700, padding: '11px 16px', borderBottom: '1px solid #EBEBEB' }}>{children}</th>;
}
function Td({ children, muted, right }: { children: ReactNode; muted?: boolean; right?: boolean }) {
  return <td style={{ padding: '13px 16px', textAlign: right ? 'right' : 'left', borderBottom: '1px solid #F0F0F2', color: muted ? '#717171' : '#222222' }}>{children}</td>;
}

const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 16 };
const emptyCell: CSSProperties = { padding: '44px 20px', textAlign: 'center', color: '#9197A2', fontSize: 15 };
const fieldLabel: CSSProperties = { display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 5, color: '#484848' };
const input: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 9, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const rowHead: CSSProperties = { fontSize: 14, fontWeight: 700, color: '#333333', paddingRight: 14, whiteSpace: 'nowrap' };
const durationBox: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', minHeight: 40, border: '1px solid #E7F0F5', borderRadius: 9, background: '#F1F8FC', whiteSpace: 'nowrap' };
const overnightTag: CSSProperties = { fontSize: 12, fontWeight: 700, color: '#8A6D1F', background: '#FBF3DD', borderRadius: 20, padding: '2px 9px' };
const checkRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600, color: '#333333', cursor: 'pointer' };
const banner: CSSProperties = { display: 'flex', gap: 10, alignItems: 'flex-start', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 12, padding: '13px 16px', marginBottom: 14 };
const note: CSSProperties = { marginTop: 12, fontSize: 13, color: '#3A5A6B', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 10, padding: '11px 14px', lineHeight: 1.55 };
const chip = (on: boolean): CSSProperties => ({ padding: '9px 15px', borderRadius: 10, border: `1px solid ${on ? '#0571A6' : '#EBEBEB'}`, background: on ? '#0571A6' : '#fff', color: on ? '#fff' : '#484848', fontWeight: 700, fontSize: 14, cursor: 'pointer' });
const ghostBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '8px 14px', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' };
const smallBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '6px 12px', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer' };
const inactivePill: CSSProperties = { marginLeft: 8, fontSize: 11.5, fontWeight: 800, color: '#9197A2', background: '#EDEDF0', borderRadius: 20, padding: '2px 9px' };
const dangerBtn: CSSProperties = { background: '#fff', color: '#C4382E', border: '1px solid #F0D6D3', padding: '9px 15px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const linkBtn: CSSProperties = { background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, color: '#0571A6', cursor: 'pointer' };
const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
