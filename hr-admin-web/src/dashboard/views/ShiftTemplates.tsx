// Shifts › Templates — the only place a shift is configured. Every rule a day
// is graded by lives on a template: the window, how a half day is decided,
// grace, week-offs, how punches arrive, overtime, corrections, approvals and
// leave. One template is the org's default, and everyone not assigned to
// another one follows it. A new template starts as a copy of the default.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';
import {
  createShift, deleteShift as deleteShiftApi, getAllEmployees, getShifts, setDefaultShift, updateShift, DEFAULT_SHIFT_POLICY,
  type EmployeeDTO, type PunchFormat, type PunchMode, type ShiftDTO, type ShiftPolicyDTO,
} from '../../services/hrms';
import { downloadCsv } from '../export';
import { LeaveTypeCard } from './LeaveTypes';
import { DayOutcomeGrid, OUTCOMES, TRIGGERS } from '../components/DayOutcomeGrid';

const PUNCH_FORMATS: PunchFormat[] = [
  'Biometric',
  'Geotag (powered by Sowaka)',
  'Present by default (Auto Punch)',
  'In-app punch in',
];
const PUNCH_MODES: PunchMode[] = ['Both punches', 'Single punch'];
const APPROVERS = ['Reporting manager', 'HR', 'Reporting manager, then HR'];
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

type Mode = { kind: 'list' } | { kind: 'edit'; id: string | null };

export function ShiftTemplates() {
  const { flash, setView } = useStore();
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [shifts, setShifts] = useState<ShiftDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [policy, setPolicy] = useState<ShiftPolicyDTO | null>(null);
  // Every template says how its people punch and whether they may claim
  // overtime — there is no org setting to inherit any more.
  const [punchFormat, setPunchFormat] = useState<PunchFormat>('Biometric');
  const [punchMode, setPunchMode] = useState<PunchMode>('Both punches');
  const [overtimeEligible, setOvertimeEligible] = useState<'yes' | 'no'>('yes');
  /** The roster, so an export can name the people a shift covers. */
  const [roster, setRoster] = useState<EmployeeDTO[]>([]);

  const reload = () =>
    getShifts()
      .then(setShifts)
      .catch((error: Error) => flash(error.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    void reload();
    getAllEmployees().then(setRoster).catch(() => setRoster([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = (shift: ShiftDTO) => {
    setName(shift.name); setActive(shift.active); setPolicy(shift.policy);
    setPunchFormat(shift.punchFormat || shift.policy.correction.punchFormat);
    setPunchMode(shift.punchMode || shift.policy.correction.punchMode);
    setOvertimeEligible((shift.overtimeEligible ?? shift.policy.overtime.eligible) === false ? 'no' : 'yes');
    setMode({ kind: 'edit', id: shift.id });
  };
  const create = () => {
    // A new template starts as a copy of the default — the shift everyone is
    // on unless assigned elsewhere — or the built-in figures for an org with none.
    const base = shifts.find((t) => t.isDefault)?.policy ?? DEFAULT_SHIFT_POLICY;
    setName(''); setActive(true);
    setPunchFormat(base.correction.punchFormat); setPunchMode(base.correction.punchMode);
    setOvertimeEligible(base.overtime.eligible === false ? 'no' : 'yes');
    setPolicy(JSON.parse(JSON.stringify(base)) as ShiftPolicyDTO);
    setMode({ kind: 'edit', id: null });
  };
  const current = mode.kind === 'edit' && mode.id ? shifts.find((t) => t.id === mode.id) : undefined;
  const makeDefault = async () => {
    if (!current) return;
    try {
      await setDefaultShift(current.id);
      await reload();
      flash(`${current.name} is now the default shift — everyone not assigned elsewhere follows it`);
    } catch (error) { flash((error as Error).message); }
  };

  const patch = (change: Partial<ShiftPolicyDTO>) =>
    setPolicy((p) => (p ? { ...p, ...change } : p));

  /**
   * Nobody punches on an auto-present shift, so there is no punch count to ask
   * for — the whole question, and the answer, are hidden rather than left
   * sitting there meaning nothing.
   */
  const autoPresent = punchFormat === 'Present by default (Auto Punch)';
  const singlePunch = !autoPresent && punchMode === 'Single punch';

  const save = async () => {
    if (!name.trim()) { flash('Give the shift a name'); return; }
    if (!policy) return;
    setSaving(true);
    try {
      const input = {
        name: name.trim(), active,
        // The template's own copy says the same as the template, so nothing
        // downstream can read a stale snapshot.
        policy: {
          ...policy,
          correction: { ...policy.correction, punchFormat, punchMode, triggers: correctableTriggers(policy, singlePunch) },
          overtime: { ...policy.overtime, eligible: overtimeEligible === 'yes' },
        },
        punchFormat, punchMode, overtimeEligible: overtimeEligible === 'yes',
      };
      const saved = mode.kind === 'edit' && mode.id
        ? await updateShift(mode.id, input)
        : await createShift(input);
      await reload();
      flash(`${saved.name} saved`);
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
      { header: 'Punch format', value: () => shift.punchFormat || p.correction.punchFormat },
      { header: 'Leave approver', value: () => p.leave.approver },
      { header: 'Overtime eligible', value: () => ((shift.overtimeEligible ?? p.overtime.eligible) === false ? 'No' : 'Yes') },
    ], rows);
  };

  const remove = async (id: string) => {
    // The same pick the server makes: the oldest remaining template, active first.
    const byAge = (a: ShiftDTO, b: ShiftDTO) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
    const others = shifts.filter((s) => s.id !== id).sort(byAge);
    const successor = others.find((s) => s.active) ?? others[0];
    const warning = current?.isDefault
      ? successor
        ? `\n\nThis is the default shift. "${successor.name}" becomes the default, and everyone not assigned elsewhere moves to it.`
        : '\n\nThis is the only shift. Everyone not assigned elsewhere falls back to the org policy until you create a new template.'
      : '';
    if (!window.confirm(`Delete "${name}"?${warning}`)) return;
    try {
      const { newDefault } = await deleteShiftApi(id);
      await reload();
      flash(newDefault ? `Shift deleted — "${newDefault}" is now the default` : 'Shift deleted');
      setMode({ kind: 'list' });
    } catch (error) { flash((error as Error).message); }
  };

  if (mode.kind === 'list') {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: '#717171', maxWidth: 620, lineHeight: 1.5 }}>
            Templates are where a shift is configured. Everyone not assigned to one follows the{' '}
            <strong>default</strong>. Assigning is done from{' '}
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
                      {t.isDefault && <span style={defaultPill}>Default</span>}
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
                  No templates yet. Create one and make it the default — everyone follows it until assigned elsewhere.
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
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 9, alignItems: 'center' }}>
          {current?.isDefault && <span style={defaultPill}>Default shift</span>}
          {current && !current.isDefault && <button onClick={() => void makeDefault()} style={ghostBtn}>Make default</button>}
          {mode.id && <button onClick={() => void remove(mode.id!)} style={dangerBtn}>Delete</button>}
          <button onClick={() => void save()} disabled={saving} style={primaryBtn}>
            {saving ? 'Saving…' : 'Save template'}
          </button>
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

      <Section title="Shift Timings">
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

      <Section title="Half day logic">
        <RuleRow label="Min hours for half day" on={policy.halfDay.minHalfDayEnabled} onToggle={(v) => patch({ halfDay: { ...policy.halfDay, minHalfDayEnabled: v } })}>
          <Num value={policy.minHalfDayHours} onChange={(v) => patch({ minHalfDayHours: v })} suffix="hrs" step="0.5" disabled={!policy.halfDay.minHalfDayEnabled} />
        </RuleRow>
        <RuleRow label="Min hours for full day" on={policy.halfDay.minFullDayEnabled} onToggle={(v) => patch({ halfDay: { ...policy.halfDay, minFullDayEnabled: v } })}>
          <Num value={policy.minFullDayHours} onChange={(v) => patch({ minFullDayHours: v })} suffix="hrs" step="0.5" disabled={!policy.halfDay.minFullDayEnabled} />
        </RuleRow>
        <RuleRow label="Check-in: half day if late by more than" on={policy.halfDay.lateArrivalEnabled} onToggle={(v) => patch({ halfDay: { ...policy.halfDay, lateArrivalEnabled: v } })}>
          <Num value={policy.halfDay.lateArrivalMinutes / 60} onChange={(v) => patch({ halfDay: { ...policy.halfDay, lateArrivalMinutes: Math.round(v * 60) } })} suffix="hrs" step="0.5" disabled={!policy.halfDay.lateArrivalEnabled} />
        </RuleRow>
        <RuleRow label="Check-out: half day if left early by more than" on={policy.halfDay.earlyLeaveEnabled} onToggle={(v) => patch({ halfDay: { ...policy.halfDay, earlyLeaveEnabled: v } })}>
          <Num value={policy.halfDay.earlyLeaveMinutes / 60} onChange={(v) => patch({ halfDay: { ...policy.halfDay, earlyLeaveMinutes: Math.round(v * 60) } })} suffix="hrs" step="0.5" disabled={!policy.halfDay.earlyLeaveEnabled} />
        </RuleRow>
      </Section>

      <Section title="Late & early grace">
        <Grid2>
          <Field label="Mark as late if late by">
            <Num value={policy.lateGraceMinutes} onChange={(v) => patch({ lateGraceMinutes: v })} suffix="min" />
          </Field>
          <Field label="Mark early-out if leaves early by">
            <Num value={policy.earlyOutGraceMinutes} onChange={(v) => patch({ earlyOutGraceMinutes: v })} suffix="min" />
          </Field>
        </Grid2>
      </Section>

      <Section title="Weekly-off">
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

      {/* Capture belongs to the template: a factory floor on a biometric
          device and a field team on geotagged punches run side by side. */}
      <Section title="Source of attendance">
        <Field label="Punch in / punch out data comes from">
          <Select value={punchFormat} onChange={setPunchFormat} options={PUNCH_FORMATS} />
        </Field>
      </Section>

      {/* What a day is marked as and what may be raised against it. A template
          is a full policy, so what it says here is what the app grades by. */}
      <Section title="Attendance status">
        {!autoPresent && (
          <Field label="How many punches does a day have?">
            <Select
              value={punchMode}
              onChange={setPunchMode}
              options={PUNCH_MODES}
              render={(m) => (m === 'Single punch' ? 'Punch in only' : 'Punch in and punch out')}
            />
          </Field>
        )}
        <div style={{ margin: '0 -20px' }}>
          <DayOutcomeGrid
            singlePunch={singlePunch}
            autoPresent={autoPresent}
            missingPunchIn={policy.missingPunchIn}
            missingPunchOut={policy.missingPunchOut}
            missingBoth={policy.missingBoth}
            onMissingPunchIn={(v) => patch({ missingPunchIn: v })}
            onMissingPunchOut={(v) => patch({ missingPunchOut: v })}
            onMissingBoth={(v) => patch({ missingBoth: v })}
            triggers={Object.fromEntries(
              TRIGGERS.map((t) => [t, policy.correction.triggers.includes(t)]),
            )}
            onTrigger={(trigger, allowed) =>
              patch({
                correction: {
                  ...policy.correction,
                  triggers: allowed
                    ? [...policy.correction.triggers, trigger]
                    : policy.correction.triggers.filter((t) => t !== trigger),
                },
              })
            }
            absentOutcomes={policy.correction.absentOutcomes ?? [...OUTCOMES]}
            onToggleOutcome={(outcome) => {
              const current = policy.correction.absentOutcomes ?? [...OUTCOMES];
              patch({
                correction: {
                  ...policy.correction,
                  absentOutcomes: current.includes(outcome)
                    ? current.filter((item) => item !== outcome)
                    : OUTCOMES.filter((item) => current.includes(item) || item === outcome),
                },
              });
            }}
          />
        </div>
        <div style={{ marginTop: 14 }}>
          <Field label="How far back can a correction be raised?">
            <Num value={policy.correction.backdateDays} onChange={(v) => patch({ correction: { ...policy.correction, backdateDays: v } })} suffix="days" width={260} />
          </Field>
        </div>
      </Section>

      {/* Overtime is its own question: it is about what these people may
          claim for hours already worked, not about how their day was recorded. */}
      <Section title="Overtime">
        <Field label="Eligible for overtime?">
          <Select
            value={overtimeEligible}
            onChange={(v) => setOvertimeEligible(v as 'yes' | 'no')}
            options={['yes', 'no'] as ('yes' | 'no')[]}
            render={(choice) => (choice === 'yes' ? 'Yes' : 'No')}
          />
        </Field>
        <Field label="How far back can overtime be claimed?">
          <Num value={policy.overtime.backdateDays} onChange={(v) => patch({ overtime: { ...policy.overtime, backdateDays: v } })} suffix="days" width={260} />
        </Field>
      </Section>

      {/* Leave belongs to the template too: a team on unlimited leave and a
          team on twelve casual days a year are both right at the same time. */}
      <Section title="Leave">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#222222' }}>
              Do they have a leave balance?
            </div>
          </div>
          <div style={{ display: 'inline-flex', border: '1px solid #EBEBEB', borderRadius: 10, overflow: 'hidden' }}>
            {[true, false].map((value) => {
              const on = (policy.leave.balanceTracked ?? true) === value;
              return (
                <button
                  key={String(value)}
                  onClick={() => patch({ leave: { ...policy.leave, balanceTracked: value } })}
                  style={{
                    padding: '8px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                    border: 'none', borderLeft: value ? 'none' : '1px solid #EBEBEB',
                    background: on ? '#0571A6' : '#fff', color: on ? '#fff' : '#484848',
                    fontFamily: 'inherit',
                  }}
                >
                  {value ? 'Yes' : 'No'}
                </button>
              );
            })}
          </div>
        </div>
        {policy.leave.balanceTracked !== false && (
          policy.leave.types.map((row, index) => (
            <LeaveTypeCard
              key={row.key}
              row={row}
              onChange={(change) =>
                patch({
                  leave: {
                    ...policy.leave,
                    types: policy.leave.types.map((item, i) =>
                      i === index ? { ...item, ...change } : item,
                    ),
                  },
                })
              }
            />
          ))
        )}
      </Section>

      <Section title="Approvals">
        <Grid2>
          <Field label="Who approves an attendance correction?">
            <Select value={policy.correction.approver} onChange={(v) => patch({ correction: { ...policy.correction, approver: v } })} options={APPROVERS} />
          </Field>
          <Field label="Who approves a leave request?">
            <Select value={policy.leave.approver} onChange={(v) => patch({ leave: { ...policy.leave, approver: v } })} options={APPROVERS} />
          </Field>
        </Grid2>
        <YesNoRow label="Can HR override a correction decision?" value={policy.correction.hrOverride} onChange={(v) => patch({ correction: { ...policy.correction, hrOverride: v } })} />
        <YesNoRow label="Can HR override a leave decision?" value={policy.leave.hrOverride} onChange={(v) => patch({ leave: { ...policy.leave, hrOverride: v } })} />
      </Section>
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


function YesNoRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0', borderTop: '1px solid #F4F4F6' }}>
      <div style={{ flex: 1, fontSize: 15, color: '#333333', fontWeight: 600 }}>{label}</div>
      <div style={{ display: 'inline-flex', border: '1px solid #EBEBEB', borderRadius: 10, overflow: 'hidden' }}>
        {[true, false].map((v) => (
          <button key={String(v)} type="button" onClick={() => onChange(v)} style={{ padding: '7px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer', border: 'none', borderLeft: v ? 'none' : '1px solid #EBEBEB', background: value === v ? '#0571A6' : '#fff', color: value === v ? '#fff' : '#484848', fontFamily: 'inherit' }}>{v ? 'Yes' : 'No'}</button>
        ))}
      </div>
    </div>
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
/**
 * A day marked a full day cannot be corrected, whatever the trigger switch
 * says — the grid locks it, and this keeps the saved policy honest too.
 */
function correctableTriggers(policy: ShiftPolicyDTO, singlePunch: boolean): string[] {
  const fullDay = new Set<string>();
  if (policy.missingPunchIn === 'Present') fullDay.add('Missing punch-in');
  if (policy.missingPunchOut === 'Present') fullDay.add('Missing punch-out');
  if (policy.missingBoth === 'Present') fullDay.add('Both punches missing');
  if (singlePunch) fullDay.add('Both punches present');
  return policy.correction.triggers.filter((t) => !fullDay.has(t));
}

function RuleRow({ label, on, onToggle, children }: { label: string; on: boolean; onToggle: (v: boolean) => void; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px auto', gap: 14, alignItems: 'center', padding: '10px 0', borderTop: '1px solid #F4F4F6' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: on ? '#222222' : '#9197A2' }}>{label}</div>
      <div>{children}</div>
      <div style={{ display: 'inline-flex', border: '1px solid #EBEBEB', borderRadius: 10, overflow: 'hidden' }}>
        {[true, false].map((v) => (
          <button key={String(v)} type="button" onClick={() => onToggle(v)} style={{ padding: '7px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', border: 'none', borderLeft: v ? 'none' : '1px solid #EBEBEB', background: on === v ? '#0571A6' : '#fff', color: on === v ? '#fff' : '#484848', fontFamily: 'inherit' }}>{v ? 'On' : 'Off'}</button>
        ))}
      </div>
    </div>
  );
}
function Num({ value, onChange, suffix, width, step, disabled }: { value: number; onChange: (v: number) => void; suffix: string; width?: number; step?: string; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #EBEBEB', borderRadius: 9, overflow: 'hidden', background: disabled ? '#F7F7F9' : '#fff', width: width ?? '100%' }}>
      <input type="number" min="0" step={step ?? '1'} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value) || 0)} style={{ border: 'none', outline: 'none', padding: '9px 11px', fontSize: 16, width: '100%', color: disabled ? '#9197A2' : '#222222', background: 'transparent' }} />
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
const ghostBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '8px 14px', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' };
const smallBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '6px 12px', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer' };
const defaultPill: CSSProperties = { marginLeft: 8, fontSize: 11.5, fontWeight: 800, color: '#0571A6', background: '#E7F4FB', borderRadius: 20, padding: '2px 9px' };
const inactivePill: CSSProperties = { marginLeft: 8, fontSize: 11.5, fontWeight: 800, color: '#9197A2', background: '#EDEDF0', borderRadius: 20, padding: '2px 9px' };
const dangerBtn: CSSProperties = { background: '#fff', color: '#C4382E', border: '1px solid #F0D6D3', padding: '9px 15px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const linkBtn: CSSProperties = { background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, color: '#0571A6', cursor: 'pointer' };
const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
