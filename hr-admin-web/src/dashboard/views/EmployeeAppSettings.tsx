// Payroll › Dashboard › Payroll in the app: whether employees see Payroll on
// the app at all (off until HR turns it on), and the deadlines its screens
// use: until which day of a month the flexible split for that month can
// change, and when the investment declaration, its proofs and the flexible
// heads' bills are due. Dates repeat every financial year; the fields show
// them for the current one. Payroll access only: without it the card is not
// shown.
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import { getEmployeeAppSettings, saveEmployeeAppSettings } from '../../services/payroll';
import type { EmployeeAppSettings, EmployeeAppSettingsResponse } from '../../services/payroll';
import { Card, LoadError, SkeletonLines } from '../ui';
import * as Lk from './look';

type DateField = 'declarationDue' | 'proofsDue' | 'billsDue';
type FormState = { splitCutoffDay: string; declarationDue: string; proofsDue: string; billsDue: string };

const FIELDS: { key: DateField; title: string; note: string; secondYear: boolean }[] = [
  { key: 'declarationDue', title: 'Choose the regime and declare investments by', note: 'After it the declaration is read only on the app.', secondYear: false },
  { key: 'proofsDue', title: 'Upload investment proofs by', note: 'Old regime only. Between 1 January and 31 March.', secondYear: true },
  { key: 'billsDue', title: 'Upload bills for the flexible heads by', note: 'Between 1 January and 31 March.', secondYear: true },
];

const dayMonth = (mmdd: string) => new Date(`2001-${mmdd}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dateLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
const formOf = (r: EmployeeAppSettingsResponse): FormState => ({
  splitCutoffDay: String(r.settings.splitCutoffDay),
  declarationDue: r.dates.declarationDueOn,
  proofsDue: r.dates.proofsDueOn,
  billsDue: r.dates.billsDueOn,
});

export function EmployeeAppSettingsCard() {
  const { flash } = useStore();
  const [data, setData] = useState<EmployeeAppSettingsResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'hidden'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

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
        <div style={{ ...Lk.cardNote, marginTop: 2 }}>What employees see under Payroll on the app, and the deadlines it gives them.</div>
      </div>
      {data && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>FY {data.fy}</div>}
    </div>
  );
  if (state !== 'ready' || !data || !form) {
    return <Card>{head}{state === 'error' ? <LoadError compact text="The app's payroll settings could not be loaded." onRetry={() => setAttempt((n) => n + 1)} /> : <SkeletonLines lines={4} style={{ padding: '16px 20px 20px' }} />}</Card>;
  }

  const s = data.settings;
  const custom = new Set(data.customised);
  const y1 = Number(data.fy.slice(0, 4));
  const original = formOf(data);
  const dirty = (Object.keys(form) as (keyof FormState)[]).filter((k) => form[k] !== original[k]);

  const put = async (body: Parameters<typeof saveEmployeeAppSettings>[0], done: string) => {
    setSaving(true);
    try {
      const r = await saveEmployeeAppSettings(body, data.fy);
      setData(r);
      setForm(formOf(r));
      flash(done);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save the settings', 'error');
    } finally {
      setSaving(false);
    }
  };
  const save = () => {
    const body: { splitCutoffDay?: number } & Partial<Record<DateField, string>> = {};
    for (const k of dirty) {
      if (k === 'splitCutoffDay') {
        const n = Number(form.splitCutoffDay);
        if (!Number.isInteger(n) || n < 1 || n > 28) return flash('The split cutoff is a day from 1 to 28', 'error');
        body.splitCutoffDay = n;
      } else {
        if (!form[k]) return flash('Pick a date for each deadline', 'error');
        body[k] = form[k];
      }
    }
    void put(body, 'Deadlines saved');
  };
  const resetTo = (k: keyof EmployeeAppSettings) => void put({ [k]: null }, 'Back to the default');
  const defaultNote = (k: keyof EmployeeAppSettings, text: string) => (custom.has(k)
    ? <span>Default {text} · <button type="button" disabled={saving} onClick={() => resetTo(k)} style={link}>Use the default</button></span>
    : <span>The default</span>);

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
                : 'Off: employees do not see Payroll on the app. Turn it on once salaries and templates are set up.'}
            </div>
          </div>
          <span style={{ fontSize: 13, fontWeight: 500, color: s.appEnabled ? 'var(--ok)' : 'var(--ink-3)' }}>{s.appEnabled ? 'On' : 'Off'}</span>
          <button
            type="button"
            role="switch"
            aria-checked={s.appEnabled}
            aria-label="Show Payroll in the app"
            disabled={saving}
            onClick={() => void put({ appEnabled: !s.appEnabled }, s.appEnabled ? 'Payroll is off in the app' : 'Payroll is on in the app')}
            style={{ ...switchTrack, background: s.appEnabled ? 'var(--accent)' : 'var(--line-2)', justifyContent: s.appEnabled ? 'flex-end' : 'flex-start', opacity: saving ? 0.6 : 1 }}
          >
            <span style={switchKnob} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginTop: 16 }}>
          <div style={tile}>
            <div style={Lk.label}>Change the flexible split until</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>the</span>
              <input type="number" min={1} max={28} step={1} value={form.splitCutoffDay} onChange={(e) => setForm({ ...form, splitCutoffDay: e.target.value })} className="lk-in" aria-label="Split cutoff day" style={{ ...Lk.input, width: 80 }} />
              <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>of each month</span>
            </div>
            <div style={note}>A change after it applies from next month. This month: {dateLabel(data.dates.splitClosesOn)}.</div>
            <div style={note}>{defaultNote('splitCutoffDay', `the ${ordinal(data.defaults.splitCutoffDay)}`)}</div>
          </div>
          {FIELDS.map((f) => {
            const year = f.secondYear ? y1 + 1 : y1;
            return (
              <div key={f.key} style={tile}>
                <div style={Lk.label}>{f.title}</div>
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
                <div style={note}>{f.note} Repeats every year: {dayMonth(s[f.key])}.</div>
                <div style={note}>{defaultNote(f.key, dayMonth(data.defaults[f.key]))}</div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={save} disabled={saving || dirty.length === 0} className="lk-btn-p" style={{ ...Lk.btnPrimary, opacity: dirty.length === 0 ? 0.5 : 1 }}>{saving ? 'Saving…' : 'Save deadlines'}</button>
          {dirty.length > 0 && <button type="button" onClick={() => setForm(original)} disabled={saving} className="lk-btn" style={Lk.btn}>Cancel</button>}
          {data.updatedAt && <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-3)' }}>Last changed {new Date(data.updatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
        </div>
      </div>
    </Card>
  );
}

const tile: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, padding: 14, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)' };
const note: CSSProperties = { fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 };
const link: CSSProperties = { background: 'none', border: 'none', padding: 0, color: 'var(--accent-ink)', fontWeight: 500, fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' };
const switchTrack: CSSProperties = { width: 40, height: 22, borderRadius: 99, border: 'none', padding: 2, cursor: 'pointer', transition: 'background .15s', display: 'flex', flexShrink: 0 };
const switchKnob: CSSProperties = { width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.2)' };
