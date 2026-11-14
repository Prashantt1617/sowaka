// People › Employee › Record exit: HR records that someone is leaving (kind,
// last working day, notice), picks who their team reports to next, and can end
// their access at once. Until the last working day nothing changes for them;
// the day after, their app access ends on its own (the server's hourly job).
// An exit that has not taken effect can be changed or withdrawn here.
import { useEffect, useState } from 'react';
import type { Emp } from '../seed';
import { useStore } from '../store';
import { endExitAccessNow, getExitSettings, recordExit, withdrawExit } from '../../services/hrms';
import type { ExitDTO, ExitKind, ExitRules, ExitSettingsDTO } from '../../services/hrms';
import { RULE_ROWS, asText, fromText } from './exitRules';

export const EXIT_KINDS: [ExitKind, string][] = [
  ['resigned', 'Resigned'], ['terminated', 'Terminated'], ['absconded', 'Absconded'], ['retired', 'Retired'], ['other', 'Other'],
];
const todayKey = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
/** "30 Nov 2026" from "2026-11-30". */
export const longDay = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** The line under the profile's name while an exit is recorded. */
export function ExitBanner({ exit }: { exit: ExitDTO }) {
  const left = exit.state === 'left';
  return (
    <div role="status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12, background: left ? 'var(--surface-2)' : 'var(--warn-bg)', color: left ? 'var(--ink-2)' : 'var(--warn)', fontSize: 13.5 }}>
      <strong style={{ fontWeight: 600 }}>{left ? `Left · ${exit.kindLabel.toLowerCase()}` : `On notice · ${exit.kindLabel.toLowerCase()}`}</strong>
      <span>
        Last working day {longDay(exit.lastWorkingDay)}.
        {left ? ' App access has ended.' : exit.rules.access === 'at_once' ? '' : ' App access ends the day after.'}
        {exit.rules.holdPay ? ' Pay is held until the final settlement.' : ''}
      </span>
    </div>
  );
}

export function ExitDialog({ emp, exit, emps, onClose, onSaved }: { emp: Emp; exit: ExitDTO | null; emps: Emp[]; onClose: () => void; onSaved: () => void }) {
  const { flash } = useStore();
  const team = emps.filter((e) => e.managerId === emp.id && e.id !== emp.id);
  const others = emps.filter((e) => e.id !== emp.id).sort((a, b) => a.name.localeCompare(b.name));
  const [kind, setKind] = useState<ExitKind>(exit?.kind ?? 'resigned');
  const [noticeFrom, setNoticeFrom] = useState(exit?.noticeFrom ?? '');
  const [lastDay, setLastDay] = useState(exit?.lastWorkingDay ?? '');
  const [noticeDays, setNoticeDays] = useState(exit?.noticeDays != null ? String(exit.noticeDays) : '');
  const [note, setNote] = useState(exit?.note ?? '');
  const [manager, setManager] = useState(emp.managerId && emp.managerId !== emp.id ? emp.managerId : '');
  // The company's rules per kind (Setup › Payroll › Exit settings); this exit starts from its kind's and can change any.
  const [settings, setSettings] = useState<ExitSettingsDTO | null>(null);
  const [rules, setRules] = useState<ExitRules | null>(exit?.rules ?? null);
  useEffect(() => {
    let live = true;
    getExitSettings().then((d) => { if (live) setSettings(d); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  const kindRules = settings?.kinds.find((k) => k.kind === kind)?.rules ?? null;
  // A new exit, or a changed kind, starts from the kind's rules.
  useEffect(() => { if (kindRules && (!exit || kind !== exit.kind)) setRules({ ...kindRules }); }, [kind, settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const endNow = rules?.access === 'at_once';
  const [busy, setBusy] = useState<'' | 'save' | 'withdraw' | 'end'>('');
  const [confirm, setConfirm] = useState<'' | 'withdraw' | 'end'>('');
  const pastDay = !!lastDay && lastDay < todayKey();
  const ready = !!lastDay && (team.length === 0 || !!manager) && !!rules;

  const act = async (what: 'save' | 'withdraw' | 'end') => {
    setBusy(what);
    try {
      if (what === 'save') {
        await recordExit(emp.id, {
          kind, lastWorkingDay: lastDay, ...(noticeFrom ? { noticeFrom } : {}), noticeDays: noticeDays === '' ? null : Number(noticeDays),
          note: note.trim(), ...(team.length ? { newManagerUserId: manager } : {}), ...(rules ? { rules } : {}),
        });
        flash(endNow || pastDay ? `${emp.name}'s exit is recorded and their access has ended` : `${emp.name}'s exit is recorded`);
      } else if (what === 'withdraw') {
        await withdrawExit(emp.id);
        flash(`${emp.name}'s exit is withdrawn`);
      } else {
        await endExitAccessNow(emp.id);
        flash(`${emp.name} can no longer use the app`);
      }
      onSaved();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save', 'error');
      setBusy('');
      setConfirm('');
    }
  };

  return (
    <div onClick={onClose} className="pd-scrim" style={{ zIndex: 70, background: 'rgba(20, 16, 50, 0.38)' }}>
      <div onClick={(e) => e.stopPropagation()} className="pd-modal" role="dialog" aria-labelledby="exit-h" style={{ width: 'min(560px, 100%)' }}>
        <div className="pd-md-h"><h3 id="exit-h">{exit ? `Change ${emp.name}'s exit` : `Record ${emp.name}'s exit`}</h3></div>
        {confirm ? (
          <>
            <div className="pd-md-b">
              {confirm === 'withdraw'
                ? <div>{emp.name} stays employed as before: the last working day and notice are cleared.</div>
                : <div>{emp.name} is signed out of the app now and can't sign in again. Payroll still pays them up to {longDay(lastDay || exit?.lastWorkingDay || todayKey())}.</div>}
            </div>
            <div className="pd-md-f">
              <button type="button" onClick={() => setConfirm('')} className="pd-btn">Back</button>
              <button type="button" disabled={!!busy} onClick={() => void act(confirm)} className="pd-btn danger">
                {busy ? 'Saving…' : confirm === 'withdraw' ? 'Withdraw exit' : 'End access now'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="pd-md-b" style={{ display: 'grid', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <label className="pd-label">
                  <span>Why they are leaving</span>
                  <select id="exit-kind" value={kind} onChange={(e) => setKind(e.target.value as ExitKind)} className="pd-inp">
                    {EXIT_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </label>
                <label className="pd-label">
                  <span>Last working day</span>
                  <input id="exit-last" type="date" value={lastDay} onChange={(e) => setLastDay(e.target.value)} className="pd-inp" />
                </label>
                <label className="pd-label">
                  <span>Notice from (optional)</span>
                  <input id="exit-from" type="date" value={noticeFrom} max={lastDay || undefined} onChange={(e) => setNoticeFrom(e.target.value)} className="pd-inp" />
                </label>
                <label className="pd-label">
                  <span>Notice period, days (optional)</span>
                  <input id="exit-days" inputMode="numeric" value={noticeDays} onChange={(e) => setNoticeDays(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} className="pd-inp" placeholder="e.g. 30" />
                </label>
              </div>
              {team.length > 0 && (
                <label className="pd-label">
                  <span>{team.length} {team.length === 1 ? 'person reports' : 'people report'} to {emp.name}. Who do they report to next?</span>
                  <select id="exit-manager" value={manager} onChange={(e) => setManager(e.target.value)} className="pd-inp">
                    <option value="">Pick a manager</option>
                    {others.map((e) => <option key={e.id} value={e.id}>{e.name}{e.employeeId ? ` · ${e.employeeId}` : ''}</option>)}
                  </select>
                </label>
              )}
              <label className="pd-label">
                <span>Note (optional)</span>
                <textarea id="exit-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="pd-inp" style={{ resize: 'vertical', minHeight: 60 }} />
              </label>
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 13.5, fontWeight: 600 }}>Rules for this exit</strong>
                  <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>From Exit settings for this kind; change any for {emp.name} only.</span>
                </div>
                {!rules ? <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Loading the rules…</div> : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                    {RULE_ROWS.map((row) => {
                      const value = asText(rules[row.key]);
                      const changed = !!kindRules && value !== asText(kindRules[row.key]);
                      const options = (row.key === 'access' ? row.options.filter(([v]) => v !== 'never') : row.options) as [unknown, string][];
                      return (
                        <label key={row.key} className="pd-label">
                          <span>{row.label}{changed && <em style={{ fontStyle: 'normal', color: 'var(--accent-ink)', marginLeft: 6 }}>changed</em>}</span>
                          <select id={`exit-rule-${row.key}`} value={value} onChange={(e) => setRules({ ...rules, [row.key]: fromText(row.key, e.target.value) })} className="pd-inp" style={{ fontWeight: changed ? 600 : 400 }}>
                            {options.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                )}
                {pastDay && <div style={{ fontSize: 12.5, color: 'var(--warn)' }}>The last working day has passed, so access ends as you save.</div>}
              </div>
            </div>
            <div className="pd-md-f">
              {exit && exit.state !== 'left' && (
                <>
                  <button type="button" onClick={() => setConfirm('withdraw')} className="pd-btn ghost">Withdraw exit</button>
                  <button type="button" onClick={() => setConfirm('end')} className="pd-btn ghost" style={{ color: 'var(--bad)' }}>End access now</button>
                </>
              )}
              <span style={{ flex: 1 }} />
              <button type="button" onClick={onClose} className="pd-btn">Cancel</button>
              <button type="button" disabled={!ready || !!busy} onClick={() => void act('save')} className="pd-btn primary">{busy === 'save' ? 'Saving…' : exit ? 'Save changes' : 'Record exit'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
