// Shifts › Templates — the only place a shift is configured. Every rule a day
// is graded by lives on a template: the window, how a half day is decided,
// grace, week-offs, how punches arrive, overtime, corrections, approvals and
// leave. One template is the org's default, and everyone not assigned to
// another one follows it. A new template starts as a copy of the default.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { ListPending } from '../ui';
import { PdClock } from './pdIcons';
import './people.css';
import {
  createShift, deleteShift as deleteShiftApi, getAllEmployees, getShifts, setDefaultShift, shiftHeadcount, updateShift, DEFAULT_OUTSIDE_LOCATION, DEFAULT_SHIFT_POLICY,
  type EmployeeDTO, type OutsideLocationOutcome, type PunchFormat, type PunchMode, type ShiftDTO, type ShiftPolicyDTO,
} from '../../services/hrms';
import { downloadCsv } from '../export';
import { AddLeaveType, LeaveTypeCard } from './LeaveTypes';
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
  // The first load failed: say so, with Retry, rather than "No templates yet".
  const [failed, setFailed] = useState(false);
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
      .then((rows) => { setShifts(rows); setFailed(false); })
      .catch((error: Error) => { setFailed(true); flash(error.message); })
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
    // The default template also covers everyone working who is assigned to no
    // active template — the same people its headcount counts.
    const elsewhere = new Set(shifts.filter((s) => s.id !== shift.id && s.active).flatMap((s) => s.assignedUserIds));
    const working = (person: EmployeeDTO) => !['offboarded', 'terminated'].includes(person.lifecycleStatus ?? '');
    const rows = roster.filter((person) =>
      shift.assignedUserIds.includes(person.userId) || (shift.isDefault && working(person) && !elsewhere.has(person.userId)));
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
      { header: 'Late after (min)', value: () => (p.lateMarkingEnabled === false ? 'Not marked' : p.lateGraceMinutes) },
      { header: 'Early before (min)', value: () => (p.earlyMarkingEnabled === false ? 'Not marked' : p.earlyOutGraceMinutes) },
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
        <div className="pd-head">
          <p className="pd-lead">
            Templates are where a shift is configured. Everyone not assigned to one follows the{' '}
            <strong style={{ fontWeight: 500, color: 'var(--ink-2)' }}>default</strong>. Assigning is done from{' '}
            <button onClick={() => setView('shiftbulk')} style={linkBtn}>Bulk Assign</button>.
          </p>
          <button onClick={create} className="pd-btn primary">+ Create New</button>
        </div>
        <section className="pd-card">
          <table className="pd-t">
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
                // The row names the template and its hours; the rules live
                // on the template itself, a click away.
                return (
                  <tr key={t.id} className="phm-row pd-click" onClick={() => open(t)}>
                    <Td>
                      <span className="pd-who">
                        <span style={{ width: 34, height: 34, borderRadius: 12, background: t.isDefault ? 'var(--accent-soft)' : 'var(--surface-2)', color: t.isDefault ? 'var(--accent-ink)' : 'var(--ink-2)', display: 'grid', placeItems: 'center', flex: 'none' }}><PdClock size={15} /></span>
                        <b>{t.name}</b>
                        {t.isDefault && <span style={defaultPill}>Default</span>}
                        {!t.active && <span style={inactivePill}>Inactive</span>}
                      </span>
                    </Td>
                    <Td><span style={{ fontVariantNumeric: 'tabular-nums' }}>{t.policy.startTime} – {t.policy.endTime}</span></Td>
                    <Td>
                      <span style={{ fontWeight: 500, fontSize: 14, fontVariantNumeric: 'tabular-nums', color: shiftHeadcount(t) ? 'var(--ink)' : 'var(--ink-3)' }}>
                        {shiftHeadcount(t)}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                        {shiftHeadcount(t) === 1 ? ' employee' : ' employees'}
                      </span>
                      {t.defaultedCount > 0 && (
                        <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }} title="On no template, so they follow the default">
                          {t.defaultedCount} by default
                        </div>
                      )}
                    </Td>
                    <Td right>
                      <button
                        onClick={(e) => { e.stopPropagation(); exportTemplate(t); }}
                        disabled={shiftHeadcount(t) === 0}
                        title={shiftHeadcount(t) === 0 ? 'Nobody is on this shift yet' : 'Export the people on it'}
                        className="pd-btn sm"
                      >
                        Export
                      </button>
                    </Td>
                  </tr>
                );
              })}
              {!loading && !failed && shifts.length === 0 && (
                <tr><td colSpan={4} style={emptyCell}>
                  No templates yet. Create one and make it the default — everyone follows it until assigned elsewhere.
                </td></tr>
              )}
              {(loading || (failed && shifts.length === 0)) && (
                <tr><td colSpan={4} style={{ padding: 0 }}><ListPending state={loading ? 'loading' : 'error'} onRetry={() => { setLoading(true); void reload(); }} rows={3} cols={4} avatar={false} rowHeight={56} /></td></tr>
              )}
            </tbody>
          </table>
        </section>
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
    <div className="pd-form" style={{ maxWidth: 880 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
        <button onClick={() => setMode({ kind: 'list' })} className="pd-btn ghost sm" style={{ marginLeft: -12 }}>← All templates</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {current?.isDefault && <span style={{ ...defaultPill, marginLeft: 0 }}>Default shift</span>}
          {current && !current.isDefault && <button onClick={() => void makeDefault()} className="pd-btn">Make default</button>}
          {mode.id && <button onClick={() => void remove(mode.id!)} className="pd-btn" style={{ color: 'var(--bad)' }}>Delete</button>}
          <button onClick={() => void save()} disabled={saving} className="pd-btn primary">
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </div>
      </div>

      <section className="pd-card" style={{ marginBottom: 20 }}>
        <Field label="Shift Name" required>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Night Shift" style={input} />
        </Field>
        <label style={checkRow}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} /> Active
        </label>
      </section>

      <Section title="Shift Timings">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 16, alignItems: 'end' }}>
          <Field label="Shift start time (in)">
            <input type="time" value={policy.startTime} onChange={(e) => patch({ startTime: e.target.value })} style={input} />
          </Field>
          <Field label="Shift end time (out)">
            <input type="time" value={policy.endTime} onChange={(e) => patch({ endTime: e.target.value })} style={input} />
          </Field>
          <div style={{ marginBottom: 16 }}>
            <label style={fieldLabel}>Duration</label>
            <div style={durationBox}>
              <span style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-.02em', color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{win.label}</span>
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

      {/* Each mark is a question first. "No" keeps the minutes but marks nobody,
          so a team that is never graded on time is never shown as late. */}
      <Section title="Late & early">
        <YesNoRow label="Do you want to categorise someone as late?" value={policy.lateMarkingEnabled !== false} onChange={(v) => patch({ lateMarkingEnabled: v })} />
        {policy.lateMarkingEnabled !== false && (
          <FollowUp label="Late by how many minutes?">
            <Num value={policy.lateGraceMinutes} onChange={(v) => patch({ lateGraceMinutes: v })} suffix="min" width={200} />
          </FollowUp>
        )}
        <YesNoRow label="Do you want to categorise someone as early?" value={policy.earlyMarkingEnabled !== false} onChange={(v) => patch({ earlyMarkingEnabled: v })} />
        {policy.earlyMarkingEnabled !== false && (
          <FollowUp label="Early by how many minutes?">
            <Num value={policy.earlyOutGraceMinutes} onChange={(v) => patch({ earlyOutGraceMinutes: v })} suffix="min" width={200} />
          </FollowUp>
        )}
      </Section>

      <Section title="Weekly-off">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: '6px 6px', marginLeft: -6 }}>
            <thead>
              <tr><th />{DOW.map((d) => <th key={d.long} title={d.long} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', color: 'var(--ink-3)', width: 44 }}>{d.label}</th>)}</tr>
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
                            width: 44, height: 36, borderRadius: 10, cursor: 'pointer', display: 'inline-block',
                            border: `1px solid ${on ? 'transparent' : 'var(--line)'}`, background: on ? 'var(--t-peach)' : 'var(--surface)',
                            boxShadow: on ? 'inset 0 0 0 1px color-mix(in srgb, var(--t-peach-i) 35%, transparent)' : undefined,
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
        {punchFormat === 'Geotag (powered by Sowaka)' && (
          <OutsideLocationEditor
            rules={policy.correction.outsideLocation ?? DEFAULT_OUTSIDE_LOCATION}
            onChange={(outsideLocation) => patch({ correction: { ...policy.correction, outsideLocation } })}
            onOffices={() => setView('offices')}
          />
        )}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', marginBottom: 6 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
              Do they have a leave balance?
            </div>
          </div>
          <div className="pd-seg">
            {[true, false].map((value) => {
              const on = (policy.leave.balanceTracked ?? true) === value;
              return (
                <button
                  key={String(value)}
                  onClick={() => patch({ leave: { ...policy.leave, balanceTracked: value } })}
                  className={on ? 'on' : undefined}
                >
                  {value ? 'Yes' : 'No'}
                </button>
              );
            })}
          </div>
        </div>
        {policy.leave.balanceTracked !== false && (
          <>
            {policy.leave.types.map((row, index) => (
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
                // One type has to stay, or there is nothing to apply for.
                onRemove={policy.leave.types.length > 1
                  ? () => patch({ leave: { ...policy.leave, types: policy.leave.types.filter((_, i) => i !== index) } })
                  : undefined}
              />
            ))}
            <AddLeaveType
              existing={policy.leave.types}
              onAdd={(row) => patch({ leave: { ...policy.leave, types: [...policy.leave.types, row] } })}
            />
          </>
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
    <section className="pd-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', background: 'var(--surface)', border: 'none', padding: '20px 20px', paddingBottom: open ? 4 : 20, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ink)' }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.01em', lineHeight: 1.5 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{subtitle}</div>}
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'transform .18s', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div style={{ padding: '12px 20px 20px' }}>{children}</div>}
    </section>
  );
}


function YesNoRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
      <div style={{ flex: 1, fontSize: 14, color: 'var(--ink)', fontWeight: 500 }}>{label}</div>
      <div className="pd-seg">
        {[true, false].map((v) => (
          <button key={String(v)} type="button" onClick={() => onChange(v)} className={value === v ? 'on' : undefined}>{v ? 'Yes' : 'No'}</button>
        ))}
      </div>
    </div>
  );
}

/** The minutes question that follows a "Yes", indented under it. */
function FollowUp({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
      <div style={{ flex: 1, fontSize: 14, color: 'var(--ink)', fontWeight: 500 }}>{label}</div>
      {children}
    </div>
  );
}

/**
 * What a geotagged shift does with a punch from outside every office, and the
 * reasons the employee may give for it. HR's own wording, so the list says
 * "Client visit" or "Site survey" as the company actually calls it.
 */
function OutsideLocationEditor({ rules, onChange, onOffices }: { rules: { outcome: OutsideLocationOutcome; reasons: string[] }; onChange: (rules: { outcome: OutsideLocationOutcome; reasons: string[] }) => void; onOffices: () => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const reason = draft.replace(/\s+/g, ' ').trim();
    if (!reason) return;
    if (rules.reasons.some((r) => r.toLowerCase() === reason.toLowerCase())) { setDraft(''); return; }
    if (rules.reasons.length >= 12) return;
    onChange({ ...rules, reasons: [...rules.reasons, reason] });
    setDraft('');
  };
  const options: { value: OutsideLocationOutcome; title: string; body: string }[] = [
    { value: 'request', title: 'Send a request to the manager', body: 'The day stays absent until the manager approves the out of location request. Rejected, it stays absent and the employee can raise a correction.' },
    { value: 'present', title: 'Mark present anyway', body: 'The day is marked present straight away, with a remark that they were out of location and the pin saved for HR to see.' },
  ];
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', marginBottom: 8 }}>If an employee punches outside the location</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {options.map((o) => {
          const on = rules.outcome === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange({ ...rules, outcome: o.value })}
              aria-pressed={on}
              style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 16, border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`, background: on ? 'var(--accent-soft)' : 'var(--surface)', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>
                <span style={{ width: 16, height: 16, borderRadius: '50%', border: `1.5px solid ${on ? 'var(--accent)' : 'var(--line-2)'}`, display: 'inline-grid', placeItems: 'center', flexShrink: 0 }}>
                  {on && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-grad)' }} />}
                </span>
                {o.title}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 5, lineHeight: 1.5 }}>{o.body}</div>
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', margin: '18px 0 4px' }}>Reasons the employee can choose</div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 10 }}>Asked in both cases. Shown in the app exactly as written here.</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {rules.reasons.map((reason) => (
          <span key={reason} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 8px 0 12px', borderRadius: 99, background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--ink-2)', fontSize: 12.5, fontWeight: 400 }}>
            {reason}
            <button
              type="button"
              onClick={() => onChange({ ...rules, reasons: rules.reasons.filter((r) => r !== reason) })}
              disabled={rules.reasons.length === 1}
              aria-label={`Remove ${reason}`}
              title={rules.reasons.length === 1 ? 'Keep at least one reason' : `Remove ${reason}`}
              style={{ border: 'none', background: 'none', color: 'inherit', fontSize: 14, lineHeight: 1, cursor: rules.reasons.length === 1 ? 'default' : 'pointer', padding: 0, width: 22, height: 22, borderRadius: '50%', opacity: rules.reasons.length === 1 ? 0.4 : 1 }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="Add a reason, e.g. Site survey"
          maxLength={40}
          style={{ ...input, width: 300 }}
        />
        <button type="button" onClick={add} disabled={!draft.trim() || rules.reasons.length >= 12} className="pd-btn">
          + Add
        </button>
        {rules.reasons.length >= 12 && <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>At most 12 reasons.</span>}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 12 }}>
        Punches are checked against the offices under <button type="button" onClick={onOffices} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 500, color: 'var(--accent-ink)', cursor: 'pointer' }}>Shifts › Offices</button>.
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
      <label style={fieldLabel}>{label}{required && <span style={{ color: 'var(--bad)' }}> *</span>}</label>
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
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'center', padding: '12px 0' }}>
      <div style={{ fontSize: 14, fontWeight: 500, color: on ? 'var(--ink)' : 'var(--ink-3)' }}>{label}</div>
      <div>{children}</div>
      <div className="pd-seg">
        {[true, false].map((v) => (
          <button key={String(v)} type="button" onClick={() => onToggle(v)} className={on === v ? 'on' : undefined}>{v ? 'On' : 'Off'}</button>
        ))}
      </div>
    </div>
  );
}
function Num({ value, onChange, suffix, step, disabled }: { value: number; onChange: (v: number) => void; suffix: string; width?: number; step?: string; disabled?: boolean }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500, color: 'var(--ink-3)' }}>
      <input type="number" min="0" step={step ?? '1'} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value) || 0)} style={{ ...input, width: 84, fontWeight: 500, fontVariantNumeric: 'tabular-nums', opacity: disabled ? 0.45 : 1 }} />
      <span style={{ whiteSpace: 'nowrap', minWidth: 28 }}>{suffix}</span>
    </label>
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
  return <th style={{ textAlign: right ? 'right' : 'left', width }}>{children}</th>;
}
function Td({ children, muted, right }: { children: ReactNode; muted?: boolean; right?: boolean }) {
  return <td style={{ textAlign: right ? 'right' : 'left', color: muted ? 'var(--ink-3)' : 'var(--ink)' }}>{children}</td>;
}

const emptyCell: CSSProperties = { padding: '40px 20px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 };
const fieldLabel: CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 400, lineHeight: 1.5, marginBottom: 6, color: 'var(--ink-2)' };
const input: CSSProperties = { width: '100%', height: 42, padding: '0 12px', border: '1px solid var(--line-2)', borderRadius: 12, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box' };
const rowHead: CSSProperties = { fontSize: 12.5, fontWeight: 500, color: 'var(--ink-2)', paddingRight: 14, whiteSpace: 'nowrap' };
const durationBox: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, minHeight: 42, whiteSpace: 'nowrap' };
const overnightTag: CSSProperties = { fontSize: 11.5, fontWeight: 500, color: 'var(--p-yellow-ink)', background: 'var(--p-yellow)', borderRadius: 99, padding: '3px 10px' };
const checkRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 500, color: 'var(--ink)', cursor: 'pointer' };
const defaultPill: CSSProperties = { display: 'inline-flex', alignItems: 'center', marginLeft: 8, fontSize: 11.5, fontWeight: 500, lineHeight: 1.5, color: '#fff', background: 'var(--p-blue)', borderRadius: 99, padding: '3px 10px' };
const inactivePill: CSSProperties = { display: 'inline-flex', marginLeft: 8, fontSize: 11.5, fontWeight: 500, lineHeight: 1.5, color: 'var(--ink-2)', background: 'var(--mute-bg)', borderRadius: 99, padding: '3px 10px' };
const linkBtn: CSSProperties = { background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 500, color: 'var(--accent-ink)', cursor: 'pointer' };
