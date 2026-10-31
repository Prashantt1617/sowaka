// Payroll › Dashboard › Payroll in the app: whether employees see Payroll on
// the app at all (off until HR turns it on), and the deadlines its screens
// use: until which day of a month the flexible split for that month can
// change, and when the investment declaration, its proofs and the flexible
// heads' bills are due. Every value is what HR saved: there are no defaults,
// so a deadline not set shows "Not set", and the server refuses to switch
// Payroll on until all of them are. Dates repeat every financial year; the
// fields show them for the current one. Payroll access only: without it the
// card is not shown.
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import { getEmployeeAppSettings, saveEmployeeAppSettings } from '../../services/payroll';
import type { EmployeeAppDeadline, EmployeeAppSettingsResponse } from '../../services/payroll';
import { Card, LoadError, SkeletonLines } from '../ui';
import * as Lk from './look';

type DateField = Exclude<EmployeeAppDeadline, 'splitCutoffDay'>;
type FormState = Record<EmployeeAppDeadline, string>;

const FIELDS: { key: DateField; title: string; note: string; secondYear: boolean }[] = [
  { key: 'declarationDue', title: 'Choose the regime and declare investments by', note: 'Between 1 April and 31 December. After it the declaration is read only on the app.', secondYear: false },
  { key: 'proofsDue', title: 'Upload investment proofs by', note: 'Old regime only. Between 1 January and 31 March.', secondYear: true },
  { key: 'billsDue', title: 'Upload bills for the flexible heads by', note: 'Between 1 January and 31 March.', secondYear: true },
];
const NAMES: Record<EmployeeAppDeadline, string> = {
  splitCutoffDay: 'the split cutoff day', declarationDue: 'the declaration date', proofsDue: 'the proofs date', billsDue: 'the bills date',
};

const dayMonth = (mmdd: string) => new Date(`2001-${mmdd}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dateLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const formOf = (r: EmployeeAppSettingsResponse): FormState => ({
  splitCutoffDay: r.settings.splitCutoffDay == null ? '' : String(r.settings.splitCutoffDay),
  declarationDue: r.dates.declarationDueOn ?? '',
  proofsDue: r.dates.proofsDueOn ?? '',
  billsDue: r.dates.billsDueOn ?? '',
});
const listOf = (keys: EmployeeAppDeadline[]) => {
  const names = keys.map((k) => NAMES[k]);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

export function EmployeeAppSettingsCard() {
  const { flash } = useStore();
  const [data, setData] = useState<EmployeeAppSettingsResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'hidden'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  // The server's answer when it refused to switch Payroll on.
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setState('loading');
    getEmployeeAppSettings()
      .then((r) => { if (live) { setData(r); setForm(formOf(r)); setState('ready'); } })
      // Not theirs to see (no payroll access), or a server without it yet: no card.
      .catch((e: unknown) => { if (live) setState(e instanceof ApiError && (e.status === 403 || e.status === 404) ? 'hidden' : 'error'); });
    return () => { live = false; };
  }, [attempt]);

  if (state === 'hidden') return null;
  const head = (
    <div style={{ display: 'flex', alignItems: 'center', padding: '20px 20px 4px' }}>
      <div style={{ flex: 1 }}>
        <div style={Lk.cardTitle}>Payroll in the app</div>
        <div style={{ ...Lk.cardNote, marginTop: 2 }}>What employees see under Payroll on the app, and the deadlines it gives them. Nothing is filled in for you: each deadline is what you set here.</div>
      </div>
      {data && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>FY {data.fy}</div>}
    </div>
  );
  if (state !== 'ready' || !data || !form) {
    return <Card>{head}{state === 'error' ? <LoadError compact text="The app's payroll settings could not be loaded." onRetry={() => setAttempt((n) => n + 1)} /> : <SkeletonLines lines={4} style={{ padding: '16px 20px 20px' }} />}</Card>;
  }

  const s = data.settings;
  const missing = new Set(data.missing);
  const y1 = Number(data.fy.slice(0, 4));
  const original = formOf(data);
  const dirty = (Object.keys(form) as EmployeeAppDeadline[]).filter((k) => form[k] !== original[k]);

  const put = async (body: Parameters<typeof saveEmployeeAppSettings>[0], done: string) => {
    setSaving(true);
    try {
      const r = await saveEmployeeAppSettings(body, data.fy);
      setData(r);
      setForm(formOf(r));
      setRefusal(null);
      flash(done);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : 'Could not save the settings';
      if (e instanceof ApiError && e.status === 409) setRefusal(message);
      flash(message, 'error');
    } finally {
      setSaving(false);
    }
  };
  const save = () => {
    const body: { splitCutoffDay?: number | null } & Partial<Record<DateField, string | null>> = {};
    for (const k of dirty) {
      if (k === 'splitCutoffDay') {
        if (form.splitCutoffDay.trim() === '') { body.splitCutoffDay = null; continue; }
        const n = Number(form.splitCutoffDay);
        if (!Number.isInteger(n) || n < 1 || n > 28) return flash('The split cutoff is a day from 1 to 28', 'error');
        body.splitCutoffDay = n;
      } else {
        body[k] = form[k] || null;
      }
    }
    void put(body, 'Deadlines saved');
  };
  const notSet = <span style={{ color: 'var(--warn)', fontWeight: 500 }}>Not set</span>;

  return (
    <Card>
      {head}
      <div style={{ padding: '8px 20px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 0', borderBottom: '1px solid var(--line)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>Show Payroll in the app</div>
            <div style={Lk.cardNote}>
              {s.appEnabled
                ? 'On: employees see their pay, missing punches, flexible split, tax declaration and proofs.'
                : data.missing.length > 0
                  ? `Off. It can be switched on once every deadline below is set: ${listOf(data.missing)} ${data.missing.length === 1 ? 'is' : 'are'} not set yet.`
                  : 'Off: employees do not see Payroll on the app. Every deadline is set, so it can be switched on.'}
            </div>
          </div>
          <span style={{ fontSize: 13, fontWeight: 500, color: s.appEnabled ? 'var(--ok)' : 'var(--ink-3)' }}>{s.appEnabled ? 'On' : 'Off'}</span>
          <button
            type="button"
            role="switch"
            aria-checked={s.appEnabled}
            aria-label="Show Payroll in the app"
            disabled={saving}
            title={!s.appEnabled && data.missing.length > 0 ? 'Set every deadline first' : undefined}
            onClick={() => void put({ appEnabled: !s.appEnabled }, s.appEnabled ? 'Payroll is off in the app' : 'Payroll is on in the app')}
            style={{ ...switchTrack, background: s.appEnabled ? 'var(--accent)' : 'var(--line-2)', justifyContent: s.appEnabled ? 'flex-end' : 'flex-start', opacity: saving ? 0.6 : 1 }}
          >
            <span style={switchKnob} />
          </button>
        </div>
        {refusal && (
          <div role="alert" style={{ ...Lk.note, marginTop: 14, background: 'var(--warn-bg)', borderColor: 'transparent', color: 'var(--ink)' }}>
            <span aria-hidden style={{ fontWeight: 700, color: 'var(--warn)' }}>!</span>
            <span><strong style={{ fontWeight: 600 }}>Not switched on.</strong> {refusal}</span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginTop: 16 }}>
          <div style={{ ...tile, ...(missing.has('splitCutoffDay') ? tileMissing : null) }}>
            <div style={Lk.label}>Change the flexible split until {missing.has('splitCutoffDay') && <>· {notSet}</>}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>the</span>
              <input type="number" min={1} max={28} step={1} value={form.splitCutoffDay} placeholder="Not set" onChange={(e) => setForm({ ...form, splitCutoffDay: e.target.value })} className="lk-in" aria-label="Split cutoff day" style={{ ...Lk.input, width: 96 }} />
              <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>of each month</span>
            </div>
            <div style={note}>
              1 to 28. A change after it applies from next month.
              {data.dates.splitClosesOn ? ` This month: ${dateLabel(data.dates.splitClosesOn)}.` : ' Until it is set, nobody can change their split.'}
            </div>
          </div>
          {FIELDS.map((f) => {
            const year = f.secondYear ? y1 + 1 : y1;
            const isMissing = missing.has(f.key);
            const stored = s[f.key];
            return (
              <div key={f.key} style={{ ...tile, ...(isMissing ? tileMissing : null) }}>
                <div style={Lk.label}>{f.title} {isMissing && <>· {notSet}</>}</div>
                <input
                  type="date"
                  value={form[f.key]}
                  min={f.secondYear ? `${year}-01-01` : `${year}-04-01`}
                  max={f.secondYear ? `${year}-03-31` : `${year}-12-31`}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  className="lk-in"
                  aria-label={f.title}
                  style={Lk.input}
                />
                <div style={note}>{f.note}{stored ? ` Repeats every year: ${dayMonth(stored)}.` : ''}</div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={save} disabled={saving || dirty.length === 0} className="lk-btn-p" style={{ ...Lk.btnPrimary, opacity: dirty.length === 0 ? 0.5 : 1 }}>{saving ? 'Saving…' : 'Save deadlines'}</button>
          {dirty.length > 0 && <button type="button" onClick={() => setForm(original)} disabled={saving} className="lk-btn" style={Lk.btn}>Cancel</button>}
          {data.missing.length > 0 && <span style={{ fontSize: 12.5, color: 'var(--warn)' }}>{data.missing.length} {data.missing.length === 1 ? 'deadline' : 'deadlines'} not set</span>}
          {data.updatedAt && <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-3)' }}>Last changed {new Date(data.updatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
        </div>
      </div>
    </Card>
  );
}

const tile: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, padding: 14, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)' };
const tileMissing: CSSProperties = { border: '1px solid var(--warn)', background: 'var(--warn-bg)' };
const note: CSSProperties = { fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 };
const switchTrack: CSSProperties = { width: 40, height: 22, borderRadius: 99, border: 'none', padding: 2, cursor: 'pointer', transition: 'background .15s', display: 'flex', flexShrink: 0 };
const switchKnob: CSSProperties = { width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.2)' };
