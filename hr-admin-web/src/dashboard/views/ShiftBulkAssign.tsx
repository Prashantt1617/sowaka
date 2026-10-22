// Shifts › Bulk Assign — the same three steps as KPI bulk assignment: build the
// targeting rules, review exactly who they select, then pick the shift to put
// them on. Same components and styles, so the two flows read identically.
//
// Assigning is a move, not an addition: an employee follows one shift at most,
// so anyone already on another is taken off it. Those rows are listed first,
// because they are the people whose day is graded differently afterwards.
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { downloadCsv } from '../export';
import { PdCheck } from './pdIcons';
import './people.css';
import { EMPTY_TARGET, FACETS, andLabel, optionsFor, queryCode, targetSummary } from '../kpiTargeting';
import type { FacetKey } from '../kpiTargeting';
import type { KpiTargeting } from '../../services/kpi';
import { RuleRow } from './kpiRuleRow';
import {
  assignShift, getShifts, resolveShiftAudience, unassignShift,
  type ShiftAudienceMember, type ShiftDTO,
} from '../../services/hrms';

type Step = 'rules' | 'people' | 'shift';
const PAGE = 25;
const EMPTY: KpiTargeting = EMPTY_TARGET;

function windowLength(start: string, end: string): string {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  let d = m(end) - m(start);
  if (d <= 0) d += 24 * 60;
  return `${Math.floor(d / 60)}h ${String(d % 60).padStart(2, '0')}m`;
}

export function ShiftBulkAssign() {
  const { flash, emps, setView } = useStore();
  const [step, setStep] = useState<Step>('rules');
  const [target, setTarget] = useState<KpiTargeting>(EMPTY);
  const [active, setActive] = useState<FacetKey[]>([]);
  const [members, setMembers] = useState<ShiftAudienceMember[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [shifts, setShifts] = useState<ShiftDTO[]>([]);
  const [picked, setPicked] = useState<ShiftDTO | null>(null);
  const [busy, setBusy] = useState(false);

  const reloadShifts = () =>
    getShifts()
      .then((rows) => { setShifts(rows); setPicked((p) => (p ? rows.find((r) => r.id === p.id) ?? null : null)); })
      .catch((error: Error) => flash(error.message));

  useEffect(() => {
    void reloadShifts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeFacets = useMemo(() => FACETS.filter((f) => active.includes(f.key)), [active]);
  const unusedFacets = useMemo(() => FACETS.filter((f) => !active.includes(f.key)), [active]);
  const emptyRules = activeFacets.filter((f) => target[f.key].length === 0);

  // What the rules select, computed locally so the count moves as you type.
  const preview = useMemo(
    () => emps.filter((e) => FACETS.every((f) => {
      const values = target[f.key];
      return values.length === 0 || values.includes(f.valueOf(e));
    })),
    [emps, target],
  );

  const setFacet = (key: FacetKey, values: string[]) =>
    setTarget((t: KpiTargeting) => ({ ...t, [key]: values }));
  const addRule = (key: FacetKey) => setActive((a) => [...a, key]);
  const removeRule = (key: FacetKey) => {
    setActive((a) => a.filter((k) => k !== key));
    setFacet(key, []);
  };

  const findPeople = async () => {
    setBusy(true);
    try {
      const result = await resolveShiftAudience(target);
      const sorted = [...result.members].sort((a, b) => {
        const aMoved = a.currentShift ? 0 : 1;
        const bMoved = b.currentShift ? 0 : 1;
        return aMoved - bMoved || a.name.localeCompare(b.name);
      });
      setMembers(sorted);
      setChosen(new Set(sorted.map((m) => m.userId)));
      setPage(0);
      setStep('people');
    } catch (error) {
      flash((error as Error).message);
    } finally { setBusy(false); }
  };

  /** "2026-09-26" -> "26 Sep". */
  const fromDay = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  const assign = async () => {
    if (!picked) { flash('Pick a shift first'); return; }
    if (chosen.size === 0) { flash('Select at least one employee'); return; }
    setBusy(true);
    try {
      const result = await assignShift(picked.id, [...chosen]);
      await reloadShifts();
      flash(
        `${chosen.size} employee${chosen.size === 1 ? '' : 's'} moved onto ${picked.name}`
        + (result.effectiveFrom ? ` — from ${fromDay(result.effectiveFrom)}. Days already worked keep their old shift.` : ''),
      );
      setStep('rules'); setTarget(EMPTY); setActive([]); setMembers([]); setChosen(new Set()); setPicked(null);
    } catch (error) {
      flash((error as Error).message);
    } finally { setBusy(false); }
  };

  const removeAll = async (shift: ShiftDTO) => {
    if (!window.confirm(`Take all ${shift.assignedCount} employees off ${shift.name}? They go back to the org policy.`)) return;
    setBusy(true);
    try {
      const result = await unassignShift(shift.id, shift.assignedUserIds);
      await reloadShifts();
      flash(
        `Everyone removed from ${shift.name}`
        + (result.effectiveFrom ? ` — from ${fromDay(result.effectiveFrom)}. Days already worked keep it.` : ''),
      );
    } catch (error) {
      flash((error as Error).message);
    } finally { setBusy(false); }
  };

  const exportPeople = () => {
    const p = picked?.policy;
    downloadCsv(`${(picked?.name ?? 'shift').replace(/\s+/g, '-').toLowerCase()}-assignment`, [
      { header: 'Employee ID', value: (m: ShiftAudienceMember) => m.employeeId },
      { header: 'Name', value: (m: ShiftAudienceMember) => m.name },
      { header: 'Department', value: (m: ShiftAudienceMember) => m.department },
      { header: 'Designation', value: (m: ShiftAudienceMember) => m.designation },
      { header: 'Location', value: (m: ShiftAudienceMember) => m.location },
      { header: 'Reports to', value: (m: ShiftAudienceMember) => m.managerName },
      { header: 'Current shift', value: (m: ShiftAudienceMember) => m.currentShift?.name ?? 'Org policy' },
      { header: 'Selected', value: (m: ShiftAudienceMember) => (chosen.has(m.userId) ? 'Yes' : 'No') },
      { header: 'Assigning to', value: () => picked?.name ?? '' },
      { header: 'Window', value: () => (p ? `${p.startTime}-${p.endTime}` : '') },
      { header: 'Half day (hrs)', value: () => p?.minHalfDayHours ?? '' },
      { header: 'Full day (hrs)', value: () => p?.minFullDayHours ?? '' },
      { header: 'Late grace (min)', value: () => p?.lateGraceMinutes ?? '' },
      { header: 'Early-out grace (min)', value: () => p?.earlyOutGraceMinutes ?? '' },
    ], members);
  };

  /** Why the next step cannot be reached yet, or empty when it can. */
  const blockedReason = (to: Step): string => {
    if (to === 'people' && emptyRules.length === activeFacets.length && activeFacets.length > 0) {
      return 'Choose a value for at least one rule';
    }
    if (to === 'people' && preview.length === 0) return 'No employees match these rules';
    if (to === 'shift' && chosen.size === 0) return 'Select at least one employee';
    return '';
  };

  const goTo = (to: Step) => {
    if (to === step || busy) return;
    if (to === 'rules') { setStep('rules'); return; }
    if (to === 'people') { if (members.length) setStep('people'); else void findPeople(); return; }
    if (!blockedReason('shift')) setStep('shift');
  };

  const pageRows = members.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(members.length / PAGE));
  const replacing = members.filter((m) => m.currentShift && m.currentShift.id !== picked?.id && chosen.has(m.userId)).length;

  return (
    <div>
      <Steps step={step} busy={busy} onGo={goTo} />

      {/* —— 1. Rules ——————————————————————————————————————————————————— */}
      {step === 'rules' && (
        <section className="pd-card">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-.01em' }}>Who are you putting on a shift?</h3>
            <div style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 500, color: emps.length === 0 ? 'var(--ink-3)' : preview.length ? 'var(--ok)' : 'var(--bad)' }}>
              {emps.length === 0 ? 'Loading employees…' : `${preview.length} of ${emps.length} employees match`}
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', margin: '2px 0 16px', lineHeight: 1.5 }}>
            Everyone not assigned to a shift follows the org's <strong>default</strong> template.
          </div>

          {activeFacets.map((f, i) => (
            <RuleRow
              key={f.key}
              facet={f}
              first={i === 0}
              values={target[f.key]}
              options={optionsFor(f, emps)}
              emps={emps}
              onChange={(v: string[]) => setFacet(f.key, v)}
              onRemove={() => removeRule(f.key)}
            />
          ))}

          {unusedFacets.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: activeFacets.length ? 12 : 0 }}>
              <span style={{ ...andLabel, marginTop: 0, visibility: activeFacets.length ? 'visible' : 'hidden' }}>AND</span>
              <select
                value=""
                onChange={(e) => {
                  const f = FACETS.find((x) => x.key === e.target.value);
                  if (f) addRule(f.key);
                }}
                className="pd-inp"
                style={{ width: '100%', maxWidth: 280, height: 40, borderRadius: 999 }}
              >
                <option value="">+ Add a rule…</option>
                {unusedFacets.map((f) => {
                  const n = optionsFor(f, emps).length;
                  return (
                    <option key={f.key} value={f.key} disabled={n === 0}>
                      {f.label}{n === 0 ? ' — no values on the roster' : ` (${n})`}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
            <div className="pd-eyebrow" style={{ marginBottom: 8 }}>
              RESULTING RULE
            </div>
            <code style={{ ...queryCode, display: 'block', padding: '12px 14px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 14, lineHeight: 1.7 }}>
              {targetSummary(target, emps)}
            </code>
            {emptyRules.length > 0 && (
              <div style={{ fontSize: 12.5, color: 'var(--warn)', fontWeight: 400, marginTop: 9 }}>
                {emptyRules.map((f) => f.label).join(' and ')}{' '}
                {emptyRules.length === 1 ? 'has' : 'have'} no value chosen yet, so{' '}
                {emptyRules.length === 1 ? 'it is' : 'they are'} not narrowing anything.
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
            <button
              onClick={() => void findPeople()}
              disabled={busy || Boolean(blockedReason('people'))}
              title={blockedReason('people') || undefined}
              className="pd-btn primary"
            >
              {busy ? 'Finding…' : `Continue with ${preview.length}`}
            </button>
          </div>
        </section>
      )}

      {/* —— 2. People —————————————————————————————————————————————————— */}
      {step === 'people' && (
        <section className="pd-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <div className="pd-countline" style={{ marginRight: 4 }}>
              <b>{chosen.size}</b> of {members.length} selected
            </div>
            <button onClick={() => setChosen(new Set(members.map((m) => m.userId)))} className="pd-chip sm"><PdCheck size={14} /> Select all</button>
            <button onClick={() => setChosen(new Set())} className="pd-chip sm">Clear</button>
            <button onClick={exportPeople} className="pd-btn sm" style={{ marginLeft: 'auto' }}>Export</button>
          </div>
          <div>
            <table className="pd-t">
              <thead>
                <tr>
                  <Th width={44}>{' '}</Th>
                  <Th>Employee</Th><Th>Department</Th><Th>Designation</Th><Th>Location</Th><Th>Current shift</Th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((m) => (
                  <tr key={m.userId} className="phm-row">
                    <Td>
                      <input
                        type="checkbox"
                        checked={chosen.has(m.userId)}
                        style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
                        onChange={() => setChosen((prev) => {
                          const next = new Set(prev);
                          if (next.has(m.userId)) next.delete(m.userId); else next.add(m.userId);
                          return next;
                        })}
                      />
                    </Td>
                    <Td>
                      <span className="pd-who" style={{ display: 'block' }}>
                        <b>{m.name}</b>
                        {m.employeeId && <span className="sub">{m.employeeId}</span>}
                      </span>
                    </Td>
                    <Td>{m.department ? <span className="pd-tag">{m.department}</span> : '—'}</Td>
                    <Td>{m.designation || '—'}</Td>
                    <Td>{m.location || '—'}</Td>
                    <Td>
                      {m.currentShift
                        ? <span style={movingPill} title={`Currently on ${m.currentShift.name} — assigning replaces it`}>{m.currentShift.name}</span>
                        : <span style={{ color: 'var(--ink-3)' }}>Org policy</span>}
                    </Td>
                  </tr>
                ))}
                {members.length === 0 && (
                  <tr><td colSpan={6} style={emptyCell}>No employees match those rules.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {members.length > PAGE && (
            <div className="pd-pager">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>← Previous</button>
              <div>Page {page + 1} of {pages} · {members.length} employees</div>
              <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}>Next →</button>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
            <button onClick={() => setStep('rules')} className="pd-btn">Back</button>
            <button
              onClick={() => setStep('shift')}
              disabled={Boolean(blockedReason('shift'))}
              title={blockedReason('shift') || undefined}
              className="pd-btn primary"
            >
              Continue with {chosen.size}
            </button>
          </div>
        </section>
      )}

      {/* —— 3. Shift ——————————————————————————————————————————————————— */}
      {step === 'shift' && (
        <section className="pd-card">
          {replacing > 0 && (
            <div className="pd-note" style={{ marginBottom: 16, background: 'var(--warn-bg)', borderColor: 'transparent', color: 'var(--warn)' }}>
              <span>
                <strong style={{ color: 'inherit' }}>{replacing}</strong> of the {chosen.size} selected are on another shift today.
                Assigning moves them — their attendance will be graded by the shift you pick from now on.
              </span>
            </div>
          )}
          <div>
            <table className="pd-t">
              <thead>
                <tr>
                  <Th width={44}>{' '}</Th>
                  <Th>Shift</Th><Th>Window</Th><Th>Half / full day</Th><Th>On it today</Th><Th right>{' '}</Th>
                </tr>
              </thead>
              <tbody>
                {shifts.filter((s) => s.policy).map((s) => (
                  <tr
                    key={s.id}
                    className="phm-row pd-click"
                    onClick={() => setPicked(s)}
                    style={{ background: picked?.id === s.id ? 'color-mix(in srgb, var(--accent-soft) 60%, transparent)' : undefined }}
                  >
                    <Td><input type="radio" checked={picked?.id === s.id} onChange={() => setPicked(s)} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} /></Td>
                    <Td>
                      <b>{s.name}</b>
                      {!s.active && <span style={inactivePill}>Inactive</span>}
                    </Td>
                    <Td>{s.policy.startTime} – {s.policy.endTime} · {windowLength(s.policy.startTime, s.policy.endTime)}</Td>
                    <Td>{s.policy.minHalfDayHours}h / {s.policy.minFullDayHours}h</Td>
                    <Td>{s.assignedCount === 0 ? <span style={{ color: 'var(--ink-3)' }}>Nobody yet</span> : `${s.assignedCount}`}</Td>
                    <Td right>
                      {s.assignedCount > 0 && (
                        <button onClick={(e) => { e.stopPropagation(); void removeAll(s); }} className="pd-btn sm">Remove all</button>
                      )}
                    </Td>
                  </tr>
                ))}
                {shifts.length === 0 && (
                  <tr><td colSpan={6} style={emptyCell}>
                    No shifts yet. Create one under{' '}
                    <button onClick={() => setView('shifttypes')} style={linkBtn}>Shifts › Templates</button>.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
            <button onClick={() => setStep('people')} className="pd-btn">Back</button>
            <button
              onClick={() => void assign()}
              disabled={busy || !picked}
              title={picked ? undefined : 'Pick a shift'}
              className="pd-btn primary"
            >
              {busy ? 'Assigning…' : `Assign ${chosen.size} to ${picked?.name ?? '…'}`}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

/** The step strip, which is also how you move between steps. */
function Steps({ step, busy, onGo }: { step: Step; busy: boolean; onGo: (target: Step) => void }) {
  const items: { key: Step; label: string }[] = [
    { key: 'rules', label: 'Build the rules' },
    { key: 'people', label: 'Review the people' },
    { key: 'shift', label: 'Pick a shift' },
  ];
  const at = items.findIndex((i) => i.key === step);

  return (
    <div className="pd-steps" style={{ marginBottom: 20, alignItems: 'center' }}>
      {items.map((item, i) => {
        const state = i < at ? 'done' : i === at ? 'now' : 'todo';
        // Only completed steps are clickable: going forward runs work, which
        // belongs on the buttons below.
        const disabled = state !== 'done' || busy;
        return (
          <button
            key={item.key}
            onClick={() => onGo(item.key)}
            disabled={disabled}
            title={disabled ? undefined : `Back to ${item.label.toLowerCase()}`}
            className={state === 'now' ? 'pd-step on' : state === 'done' ? 'pd-step done' : 'pd-step'}
            style={state === 'done' && !busy ? { opacity: 1, cursor: 'pointer' } : state === 'now' ? { opacity: 1 } : undefined}
          >
            <i>{state === 'done' ? '✓' : i + 1}</i>
            {item.label}
          </button>
        );
      })}
      {busy && <span style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 400 }}>Working…</span>}
    </div>
  );
}

function Th({ children, width, right }: { children: ReactNode; width?: number; right?: boolean }) {
  return <th style={{ textAlign: right ? 'right' : 'left', width }}>{children}</th>;
}
function Td({ children, muted, right }: { children: ReactNode; muted?: boolean; right?: boolean }) {
  return <td style={{ textAlign: right ? 'right' : 'left', color: muted ? 'var(--ink-3)' : 'var(--ink)' }}>{children}</td>;
}

const emptyCell: CSSProperties = { padding: '30px 14px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 };
const movingPill: CSSProperties = { display: 'inline-flex', fontSize: 11.5, fontWeight: 500, lineHeight: 1.5, color: 'var(--p-yellow-ink)', background: 'var(--p-yellow)', borderRadius: 99, padding: '3px 10px', cursor: 'help' };
const inactivePill: CSSProperties = { marginLeft: 8, fontSize: 11.5, fontWeight: 500, color: 'var(--ink-2)', background: 'var(--mute-bg)', borderRadius: 99, padding: '3px 10px' };
const linkBtn: CSSProperties = { background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--accent-ink)', fontWeight: 500, cursor: 'pointer', textDecoration: 'underline' };
