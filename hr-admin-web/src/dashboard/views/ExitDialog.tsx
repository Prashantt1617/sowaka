// People › Employee › Record exit, in plain words: why they are leaving, when
// they told you, their last day, the notice (worked out for you), who their
// team reports to next, and what happens next as switches. The switches start
// from Setup › Payroll › Exit settings for the reason picked; changing one here
// changes it for this person only. Until the last day nothing changes for them;
// the day after, their app turns off on its own (or right away, if switched).
// An exit that has not taken effect can be changed or withdrawn here.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Emp } from '../seed';
import { useStore } from '../store';
import { endExitAccessNow, getExitSettings, recordExit, withdrawExit } from '../../services/hrms';
import type { ExitDTO, ExitKind, ExitRules, ExitSettingsDTO } from '../../services/hrms';
import { NOTICE_PAY_INFO, NOTICE_SHORTFALL_INFO } from './exitRules';
import { InfoTip } from './InfoTip';

export const EXIT_KINDS: [ExitKind, string][] = [
  ['resigned', 'Resigned'], ['terminated', 'Terminated'], ['absconded', 'Absconded'], ['retired', 'Retired'], ['other', 'Other'],
];
const todayKey = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
/** "30 Nov 2026" from "2026-11-30". */
export const longDay = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const shortDay = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
/** Days from the first to the last, both counted. */
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** The line under the profile's name while an exit is recorded. */
export function ExitBanner({ exit }: { exit: ExitDTO }) {
  const left = exit.state === 'left';
  return (
    <div role="status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 14px', marginBottom: 16, borderRadius: 12, background: left ? 'var(--surface-2)' : 'var(--warn-bg)', color: left ? 'var(--ink-2)' : 'var(--warn)', fontSize: 13.5 }}>
      <strong style={{ fontWeight: 600 }}>{left ? `Left · ${exit.kindLabel.toLowerCase()}` : `On notice · ${exit.kindLabel.toLowerCase()}`}</strong>
      <span>
        Last day at work {longDay(exit.lastWorkingDay)}.
        {left ? ' Their app is off.' : exit.rules.access === 'at_once' ? '' : ' Their app turns off the day after.'}
        {exit.rules.holdPay ? ' Salary is held until the final settlement.' : ''}
      </span>
    </div>
  );
}

function Switch({ on, onChange, id, label }: { on: boolean; onChange: (v: boolean) => void; id: string; label: string }) {
  return (
    <button type="button" id={id} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      style={{ width: 38, height: 22, borderRadius: 99, border: 'none', padding: 2, cursor: 'pointer', transition: 'background .15s', display: 'flex', flexShrink: 0, marginTop: 1,
        background: on ? 'var(--accent)' : 'var(--line-2)', justifyContent: on ? 'flex-end' : 'flex-start' }}>
      <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.2)' }} />
    </button>
  );
}
function Row({ children, control }: { children: ReactNode; control: ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 14, color: 'var(--ink)', lineHeight: 1.45 }}>{control}<div style={{ flex: 1 }}>{children}</div></div>;
}

export function ExitDialog({ emp, exit, emps, onClose, onSaved }: { emp: Emp; exit: ExitDTO | null; emps: Emp[]; onClose: () => void; onSaved: () => void }) {
  const { flash } = useStore();
  const name = firstName(emp.name);
  const team = emps.filter((e) => e.managerId === emp.id && e.id !== emp.id && !e.exit?.left);
  const others = emps.filter((e) => e.id !== emp.id && !e.exit?.left).sort((a, b) => a.name.localeCompare(b.name));
  const [kind, setKind] = useState<ExitKind>(exit?.kind ?? 'resigned');
  const [noticeFrom, setNoticeFrom] = useState(exit?.noticeFrom ?? (exit ? '' : todayKey()));
  const [lastDay, setLastDay] = useState(exit?.lastWorkingDay ?? '');
  const [noticeDays, setNoticeDays] = useState(exit?.noticeDays != null ? String(exit.noticeDays) : '');
  const [note, setNote] = useState(exit?.note ?? '');
  const [showNote, setShowNote] = useState(!!exit?.note);
  const [manager, setManager] = useState(emp.managerId && emp.managerId !== emp.id ? emp.managerId : '');
  const [busy, setBusy] = useState<'' | 'save' | 'withdraw' | 'end'>('');
  const [confirm, setConfirm] = useState<'' | 'withdraw' | 'end'>('');
  // The company's starting point per reason (Exit settings); this exit's own copy once changed.
  const [settings, setSettings] = useState<ExitSettingsDTO | null>(null);
  const [rules, setRules] = useState<ExitRules | null>(exit?.rules ?? null);
  useEffect(() => {
    let live = true;
    getExitSettings().then((d) => {
      if (!live) return;
      setSettings(d);
      if (!exit && d.noticeDays != null) setNoticeDays(String(d.noticeDays));
    }).catch(() => undefined);
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const kindRules = settings?.kinds.find((k) => k.kind === kind)?.rules ?? null;
  // A new exit, or a changed reason, starts from that reason's settings.
  useEffect(() => { if (kindRules && (!exit || kind !== exit.kind)) setRules({ ...kindRules }); }, [kind, settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<ExitRules>) => rules && setRules({ ...rules, ...p });

  const pastDay = !!lastDay && lastDay < todayKey();
  const owed = noticeDays === '' ? null : Number(noticeDays);
  const served = noticeFrom && lastDay && lastDay >= noticeFrom ? daysBetween(noticeFrom, lastDay) : null;
  const short = owed != null && served != null ? Math.max(0, owed - served) : null;
  const ready = !!lastDay && (team.length === 0 || !!manager) && !!rules && !(noticeFrom && lastDay && lastDay < noticeFrom);
  // Turning the shortfall back on uses the reason's own mode (the whole notice for an absconding), else the unserved days.
  const recoveryMode: ExitRules['noticeRecovery'] = kindRules && kindRules.noticeRecovery !== 'none' ? kindRules.noticeRecovery : 'days_not_served';

  const act = async (what: 'save' | 'withdraw' | 'end') => {
    setBusy(what);
    try {
      if (what === 'save') {
        await recordExit(emp.id, {
          kind, lastWorkingDay: lastDay, ...(noticeFrom ? { noticeFrom } : {}), noticeDays: owed,
          note: note.trim(), ...(team.length ? { newManagerUserId: manager } : {}), ...(rules ? { rules } : {}),
        });
        flash(rules?.access === 'at_once' || pastDay ? `${emp.name}'s exit is saved and their app is off` : `${emp.name}'s exit is saved`);
      } else if (what === 'withdraw') {
        await withdrawExit(emp.id);
        flash(`${emp.name} is no longer leaving`);
      } else {
        await endExitAccessNow(emp.id);
        flash(`${emp.name}'s app is off`);
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
      <div onClick={(e) => e.stopPropagation()} className="pd-modal" role="dialog" aria-labelledby="exit-h" style={{ width: 'min(600px, 100%)', maxHeight: 'calc(100vh - 40px)', display: 'flex', flexDirection: 'column' }}>
        <div className="pd-md-h"><h3 id="exit-h">{exit ? `Change ${emp.name}'s exit` : `${emp.name} is leaving`}</h3></div>
        {confirm ? (
          <>
            <div className="pd-md-b">
              {confirm === 'withdraw'
                ? <div>{name} stays, as before. The last day and notice are cleared.</div>
                : <div>{name} is signed out of the app now and can't sign in again. Salary is still worked out up to {longDay(lastDay || exit?.lastWorkingDay || todayKey())}.</div>}
            </div>
            <div className="pd-md-f">
              <button type="button" onClick={() => setConfirm('')} className="pd-btn">Back</button>
              <button type="button" disabled={!!busy} onClick={() => void act(confirm)} className="pd-btn danger">
                {busy ? 'Saving…' : confirm === 'withdraw' ? `${name} is staying` : 'Turn off the app now'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="pd-md-b" style={{ display: 'grid', gap: 18, overflowY: 'auto' }}>
              <Question label="Why are they leaving?">
                <div role="radiogroup" aria-label="Why are they leaving?" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {EXIT_KINDS.map(([k, l]) => (
                    <button key={k} type="button" role="radio" aria-checked={kind === k} id={`exit-kind-${k}`} onClick={() => setKind(k)} style={pill(kind === k)}>{l}</button>
                  ))}
                </div>
              </Question>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <Question label={kind === 'terminated' ? 'When did you tell them?' : kind === 'absconded' ? 'Last seen' : 'When did they tell you?'}>
                  <input id="exit-from" type="date" value={noticeFrom} max={lastDay || undefined} onChange={(e) => setNoticeFrom(e.target.value)} className="pd-inp" />
                </Question>
                <Question label="Last day at work">
                  <input id="exit-last" type="date" value={lastDay} onChange={(e) => setLastDay(e.target.value)} className="pd-inp" />
                </Question>
              </div>

              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13.5, color: 'var(--ink-2)' }}>
                  Notice for this role:
                  <input id="exit-days" inputMode="numeric" value={noticeDays} placeholder="days" onChange={(e) => setNoticeDays(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} className="pd-inp" style={{ width: 70, height: 32, padding: '0 8px' }} aria-label="Notice period in days" />
                  days
                </div>
                {served != null && (
                  <div style={{ fontSize: 13, color: short ? 'var(--warn)' : 'var(--ok)' }}>
                    {owed == null
                      ? `${name} will work ${served} days after telling you.`
                      : short
                        ? `${name} will work ${served} of ${owed} days, so ${short} ${short === 1 ? 'day is' : 'days are'} short.`
                        : `${name} will work ${served} days, so nothing is short.`}
                  </div>
                )}
                {noticeFrom && lastDay && lastDay < noticeFrom && <div style={{ fontSize: 13, color: 'var(--bad)' }}>The last day can't be before they told you.</div>}
              </div>

              {team.length > 0 && (
                <Question label={`${name} leads ${team.length} ${team.length === 1 ? 'person' : 'people'}. Who will they report to?`}>
                  <span className="pd-pick">
                    <select id="exit-manager" value={manager} onChange={(e) => setManager(e.target.value)} className="pd-inp">
                      <option value="">Pick a manager</option>
                      {others.map((e) => <option key={e.id} value={e.id}>{e.name}{e.employeeId && e.employeeId !== '—' ? ` · ${e.employeeId}` : ''}</option>)}
                    </select>
                  </span>
                  <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{team.map((t) => firstName(t.name)).join(', ')} will report to them.</span>
                </Question>
              )}

              <Question label="What happens next">
                {!rules ? <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Loading…</div> : (
                  <div style={{ display: 'grid', gap: 12 }}>
                    <Row control={<Switch id="exit-hold" label="Hold salary" on={rules.holdPay} onChange={(v) => set({ holdPay: v })} />}>
                      Hold {name}'s salary{noticeFrom ? ` from ${shortDay(noticeFrom)}` : ''} and pay it all in the final settlement
                    </Row>
                    <Row control={<Switch id="exit-access" label="Turn off the app right away" on={rules.access === 'at_once' || pastDay} onChange={(v) => set({ access: v ? 'at_once' : 'day_after' })} />}>
                      Turn off {name}'s app right away
                      <span style={hint}>{pastDay ? 'The last day has passed, so it turns off as you save.' : 'Otherwise it turns off the day after their last day.'}</span>
                    </Row>
                    <Row control={<Switch id="exit-notice-pay" label="Pay for notice they won't work" on={rules.noticePay === 'pay'} onChange={(v) => set({ noticePay: v ? 'pay' : 'none' })} />}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>Pay for the notice {name} won't work <InfoTip label="Notice pay" text={NOTICE_PAY_INFO} /></span>
                    </Row>
                    <Row control={<Switch id="exit-recovery" label="Take back pay for notice they didn't give" on={rules.noticeRecovery !== 'none'} onChange={(v) => set({ noticeRecovery: v ? recoveryMode : 'none' })} />}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>Take back pay for notice {name} didn't give <InfoTip label="Notice shortfall" text={NOTICE_SHORTFALL_INFO} /></span>
                      {rules.noticeRecovery !== 'none' && <span style={hint}>{rules.noticeRecovery === 'whole_notice' ? 'The whole notice period.' : short ? `${short} ${short === 1 ? 'day' : 'days'}, from the final settlement.` : 'Nothing is short right now.'}</span>}
                    </Row>
                  </div>
                )}
              </Question>

              {showNote ? (
                <Question label="Note (only HR sees it)">
                  <textarea id="exit-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="pd-inp" style={{ resize: 'vertical', minHeight: 56 }} />
                </Question>
              ) : (
                <button type="button" onClick={() => setShowNote(true)} className="pd-btn ghost sm" style={{ justifySelf: 'start' }}>+ Add a note</button>
              )}
            </div>
            <div className="pd-md-f">
              {exit && exit.state !== 'left' && (
                <>
                  <button type="button" onClick={() => setConfirm('withdraw')} className="pd-btn ghost">{name} is staying</button>
                  {exit.rules.access !== 'at_once' && <button type="button" onClick={() => setConfirm('end')} className="pd-btn ghost" style={{ color: 'var(--bad)' }}>Turn off app now</button>}
                </>
              )}
              <span style={{ flex: 1 }} />
              <button type="button" onClick={onClose} className="pd-btn">Cancel</button>
              <button type="button" disabled={!ready || !!busy} onClick={() => void act('save')} className="pd-btn primary">{busy === 'save' ? 'Saving…' : 'Save exit'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Question({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{label}</div>
      {children}
    </div>
  );
}
const pill = (on: boolean): CSSProperties => ({
  height: 34, padding: '0 14px', borderRadius: 999, fontSize: 13.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
  border: `1px solid ${on ? 'var(--sel)' : 'var(--line-2)'}`, background: on ? 'var(--sel)' : 'var(--surface)', color: on ? 'var(--on-sel)' : 'var(--ink)',
});
const hint: CSSProperties = { display: 'block', fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 };
