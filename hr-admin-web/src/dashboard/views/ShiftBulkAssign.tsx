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
import { Card } from '../ui';
import { downloadCsv } from '../export';
import { EMPTY_TARGET, FACETS, andLabel, optionsFor, queryCode, targetSummary } from '../kpiTargeting';
import type { FacetKey } from '../kpiTargeting';
import type { KpiTargeting } from '../../services/kpi';
import { RuleRow } from './kpiRuleRow';
import { ghostBtn, inputStyle, panelCard, panelTitle, primaryBtn, smallBtn, warnTag } from './kpiStyles';
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

  const assign = async () => {
    if (!picked) { flash('Pick a shift first'); return; }
    if (chosen.size === 0) { flash('Select at least one employee'); return; }
    setBusy(true);
    try {
      await assignShift(picked.id, [...chosen]);
      await reloadShifts();
      flash(`${chosen.size} employee${chosen.size === 1 ? '' : 's'} moved onto ${picked.name}`);
      setStep('rules'); setTarget(EMPTY); setActive([]); setMembers([]); setChosen(new Set()); setPicked(null);
    } catch (error) {
      flash((error as Error).message);
    } finally { setBusy(false); }
  };

  const removeAll = async (shift: ShiftDTO) => {
    if (!window.confirm(`Take all ${shift.assignedCount} employees off ${shift.name}? They go back to the org policy.`)) return;
    setBusy(true);
    try {
      await unassignShift(shift.id, shift.assignedUserIds);
      await reloadShifts();
      flash(`Everyone removed from ${shift.name}`);
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
        <div style={panelCard}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <div style={panelTitle}>Who are you putting on a shift?</div>
            <div style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 700, color: emps.length === 0 ? '#9197A2' : preview.length ? '#4F7A52' : '#A8475F' }}>
              {emps.length === 0 ? 'Loading employees…' : `${preview.length} of ${emps.length} employees match`}
            </div>
          </div>
          <div style={{ fontSize: 13, color: '#717171', marginBottom: 14, lineHeight: 1.5 }}>
            A shift overrides the org policy for the people on it. Everyone else follows{' '}
            <button onClick={() => setView('policies')} style={linkBtn}>Shifts › Policies</button>.
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
                style={{ ...inputStyle, maxWidth: 280 }}
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

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #EBEBEB' }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.03em', color: '#717171', marginBottom: 7 }}>
              RESULTING RULE
            </div>
            <code style={{ ...queryCode, display: 'block', padding: '11px 13px', background: '#F7F7F9', borderRadius: 10, lineHeight: 1.7 }}>
              {targetSummary(target, emps)}
            </code>
            {emptyRules.length > 0 && (
              <div style={{ fontSize: 13, color: '#9A6B25', fontWeight: 600, marginTop: 9 }}>
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
              style={{ ...primaryBtn, opacity: busy || blockedReason('people') ? 0.5 : 1 }}
            >
              {busy ? 'Finding…' : `Continue with ${preview.length}`}
            </button>
          </div>
        </div>
      )}

      {/* —— 2. People —————————————————————————————————————————————————— */}
      {step === 'people' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 11 }}>
            <div style={{ fontSize: 16, color: '#717171', fontWeight: 600 }}>
              {chosen.size} of {members.length} selected
            </div>
            <button onClick={() => setChosen(new Set(members.map((m) => m.userId)))} style={smallBtn}>Select all</button>
            <button onClick={() => setChosen(new Set())} style={smallBtn}>Clear</button>
            <button onClick={exportPeople} style={{ ...smallBtn, marginLeft: 'auto' }}>Export</button>
          </div>
          <Card>
            <table style={tableStyle}>
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
                        onChange={() => setChosen((prev) => {
                          const next = new Set(prev);
                          if (next.has(m.userId)) next.delete(m.userId); else next.add(m.userId);
                          return next;
                        })}
                      />
                    </Td>
                    <Td>
                      <strong>{m.name}</strong>
                      {m.employeeId && <span style={{ color: '#9197A2', marginLeft: 8, fontSize: 13 }}>{m.employeeId}</span>}
                    </Td>
                    <Td muted>{m.department || '—'}</Td>
                    <Td muted>{m.designation || '—'}</Td>
                    <Td muted>{m.location || '—'}</Td>
                    <Td>
                      {m.currentShift
                        ? <span style={movingPill} title={`Currently on ${m.currentShift.name} — assigning replaces it`}>{m.currentShift.name}</span>
                        : <span style={{ color: '#9197A2' }}>Org policy</span>}
                    </Td>
                  </tr>
                ))}
                {members.length === 0 && (
                  <tr><td colSpan={6} style={emptyCell}>No employees match those rules.</td></tr>
                )}
              </tbody>
            </table>
          </Card>
          {members.length > PAGE && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={smallBtn}>← Previous</button>
              <div style={{ fontSize: 14, color: '#717171' }}>Page {page + 1} of {pages} · {members.length} employees</div>
              <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} style={smallBtn}>Next →</button>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 11, marginTop: 18 }}>
            <button onClick={() => setStep('rules')} style={ghostBtn}>Back</button>
            <button
              onClick={() => setStep('shift')}
              disabled={Boolean(blockedReason('shift'))}
              title={blockedReason('shift') || undefined}
              style={{ ...primaryBtn, opacity: blockedReason('shift') ? 0.5 : 1 }}
            >
              Continue with {chosen.size}
            </button>
          </div>
        </>
      )}

      {/* —— 3. Shift ——————————————————————————————————————————————————— */}
      {step === 'shift' && (
        <>
          {replacing > 0 && (
            <div style={{ ...warnTag, marginBottom: 14 }}>
              <strong>{replacing}</strong> of the {chosen.size} selected are on another shift today.
              Assigning moves them — their attendance will be graded by the shift you pick from now on.
            </div>
          )}
          <Card>
            <table style={tableStyle}>
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
                    className="phm-row"
                    onClick={() => setPicked(s)}
                    style={{ cursor: 'pointer', background: picked?.id === s.id ? '#F1F8FC' : undefined }}
                  >
                    <Td><input type="radio" checked={picked?.id === s.id} onChange={() => setPicked(s)} /></Td>
                    <Td>
                      <strong style={{ color: '#222222' }}>{s.name}</strong>
                      {!s.active && <span style={inactivePill}>Inactive</span>}
                    </Td>
                    <Td muted>{s.policy.startTime} – {s.policy.endTime} · {windowLength(s.policy.startTime, s.policy.endTime)}</Td>
                    <Td muted>{s.policy.minHalfDayHours}h / {s.policy.minFullDayHours}h</Td>
                    <Td muted>{s.assignedCount === 0 ? 'Nobody yet' : `${s.assignedCount}`}</Td>
                    <Td right>
                      {s.assignedCount > 0 && (
                        <button onClick={(e) => { e.stopPropagation(); void removeAll(s); }} style={smallBtn}>Remove all</button>
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
          </Card>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 11, marginTop: 18 }}>
            <button onClick={() => setStep('people')} style={ghostBtn}>Back</button>
            <button
              onClick={() => void assign()}
              disabled={busy || !picked}
              title={picked ? undefined : 'Pick a shift'}
              style={{ ...primaryBtn, opacity: busy || !picked ? 0.5 : 1 }}
            >
              {busy ? 'Assigning…' : `Assign ${chosen.size} to ${picked?.name ?? '…'}`}
            </button>
          </div>
        </>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
      {items.map((item, i) => {
        const state = i < at ? 'done' : i === at ? 'now' : 'todo';
        // Only completed steps are clickable: going forward runs work, which
        // belongs on the buttons below.
        const disabled = state !== 'done' || busy;
        return (
          <span key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => onGo(item.key)}
              disabled={disabled}
              title={disabled ? undefined : `Back to ${item.label.toLowerCase()}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'none',
                padding: '4px 2px', font: 'inherit', cursor: disabled ? 'default' : 'pointer',
              }}
            >
              <span style={{
                width: 22, height: 22, borderRadius: '50%', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800,
                background: state === 'todo' ? '#F0F0F2' : '#0571A6',
                color: state === 'todo' ? '#9197A2' : '#fff',
              }}>
                {state === 'done' ? '✓' : i + 1}
              </span>
              <span style={{
                fontSize: 15,
                fontWeight: state === 'now' ? 800 : 600,
                color: state === 'now' ? '#222222' : state === 'todo' ? '#9197A2' : '#0571A6',
                textDecoration: disabled ? 'none' : 'underline',
                textUnderlineOffset: 3,
              }}>
                {item.label}
              </span>
            </button>
            {i < items.length - 1 && <span style={{ color: '#C7CBD2' }}>→</span>}
          </span>
        );
      })}
      {busy && <span style={{ fontSize: 14, color: '#717171', fontWeight: 600 }}>Working…</span>}
    </div>
  );
}

function Th({ children, width, right }: { children: ReactNode; width?: number; right?: boolean }) {
  return <th style={{ textAlign: right ? 'right' : 'left', width, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', color: '#717171', fontWeight: 700, padding: '11px 14px', borderBottom: '1px solid #EBEBEB' }}>{children}</th>;
}
function Td({ children, muted, right }: { children: ReactNode; muted?: boolean; right?: boolean }) {
  return <td style={{ padding: '12px 14px', textAlign: right ? 'right' : 'left', borderBottom: '1px solid #F0F0F2', color: muted ? '#717171' : '#222222' }}>{children}</td>;
}

const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 15 };
const emptyCell: CSSProperties = { padding: '30px 14px', textAlign: 'center', color: '#717171', fontSize: 15 };
const movingPill: CSSProperties = { fontSize: 12, fontWeight: 800, color: '#8A6D1F', background: '#FBF3DD', border: '1px solid #EFE0BC', borderRadius: 20, padding: '3px 10px', cursor: 'help' };
const inactivePill: CSSProperties = { marginLeft: 8, fontSize: 11.5, fontWeight: 800, color: '#9197A2', background: '#EDEDF0', borderRadius: 20, padding: '2px 9px' };
const linkBtn: CSSProperties = { background: 'none', border: 'none', padding: 0, font: 'inherit', color: '#0571A6', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' };
