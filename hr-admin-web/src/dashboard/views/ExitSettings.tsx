// Setup › Payroll › Exit settings: what each kind of exit does, for this company.
// One column per kind (Resigned, Terminated…), one row per rule (hold pay, when
// access ends, leave encashment, gratuity, notice pay, notice shortfall). These
// are the starting point when HR records an exit; HR can still change any of
// them for that one person. Saved on the company (/admin/exit-settings).
import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Card, LoadError, Pill, SkeletonForm } from '../ui';
import { btn, btnClass } from '../ds';
import { getExitSettings, saveExitSettings } from '../../services/hrms';
import type { ExitRuleKind, ExitRules, ExitSettingsDTO } from '../../services/hrms';
import { RULE_KIND_LABEL, RULE_KINDS, RULE_ROWS, asText, fromText } from './exitRules';

type Draft = Record<ExitRuleKind, ExitRules>;
const draftOf = (d: ExitSettingsDTO): Draft => Object.fromEntries(d.kinds.map((k) => [k.kind, { ...k.rules }])) as Draft;
const same = (a: ExitRules, b: ExitRules) => JSON.stringify(a) === JSON.stringify(b);

export function ExitSettings() {
  const { flash } = useStore();
  const [data, setData] = useState<ExitSettingsDTO | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    setError('');
    getExitSettings().then((d) => { if (live) { setData(d); setDraft(draftOf(d)); } }).catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load exit settings'); });
    return () => { live = false; };
  }, [attempt]);

  if (error) return <Card><LoadError text={error} onRetry={() => setAttempt((n) => n + 1)} /></Card>;
  if (!data || !draft) return <Card style={{ padding: 22 }}><SkeletonForm fields={6} /></Card>;

  const saved = draftOf(data);
  const changed = RULE_KINDS.filter((k) => !same(draft[k], saved[k]));
  const set = (kind: ExitRuleKind, key: keyof ExitRules, text: string) =>
    setDraft({ ...draft, [kind]: { ...draft[kind], [key]: fromText(key, text) } });
  const isDefault = (kind: ExitRuleKind) => same(draft[kind], data.defaults[kind]);

  const save = async () => {
    setSaving(true);
    try {
      // A kind put back exactly as the default is stored as "the default".
      const body = Object.fromEntries(changed.map((k) => [k, isDefault(k) ? null : draft[k]]));
      const next = await saveExitSettings(body);
      setData(next);
      setDraft(draftOf(next));
      flash('Exit settings saved. New exits start from these; exits already recorded keep theirs.');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card padded>
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', maxWidth: 760, lineHeight: 1.55 }}>
          What each kind of exit does at this company. When you record someone's exit, it starts from their kind's column here, and you can change any of it for that one person.
          Pay held and app access act from the day the exit is recorded; the rest are used by the final settlement.
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980, fontSize: 13.5 }}>
            <thead>
              <tr>
                <th style={th}>Rule</th>
                {RULE_KINDS.map((k) => (
                  <th key={k} style={th}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {RULE_KIND_LABEL[k]}
                      {isDefault(k) ? <Pill label="Default" tone={{ bg: 'var(--surface-2)', fg: 'var(--ink-3)' }} fontSize={10.5} padding="1px 6px" />
                        : <button type="button" onClick={() => setDraft({ ...draft, [k]: { ...data.defaults[k] } })} className="pd-btn ghost sm" style={{ padding: '0 6px', height: 22, fontSize: 11.5 }}>Use default</button>}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RULE_ROWS.map((row) => (
                <tr key={row.key}>
                  <td style={td}>
                    <div style={{ fontWeight: 500 }}>{row.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{row.hint}</div>
                  </td>
                  {RULE_KINDS.map((k) => {
                    const value = asText(draft[k][row.key]);
                    const edited = value !== asText(data.defaults[k][row.key]);
                    // Everyone who leaves loses access; only a move to consultant keeps it.
                    const options = row.key === 'access' && k !== 'consultant' ? row.options.filter(([v]) => v !== 'never') : row.options;
                    return (
                      <td key={k} style={td}>
                        <select id={`rule-${k}-${row.key}`} aria-label={`${RULE_KIND_LABEL[k]}: ${row.label}`} value={value} onChange={(e) => set(k, row.key, e.target.value)}
                          className="pd-inp" style={{ width: '100%', minWidth: 130, height: 36, fontWeight: edited ? 600 : 400 }}>
                          {(options as [unknown, string][]).map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" disabled={saving || changed.length === 0} onClick={() => void save()} className={btnClass('primary')} style={btn('primary')}>{saving ? 'Saving…' : 'Save'}</button>
          {changed.length > 0 && <button type="button" onClick={() => setDraft(draftOf(data))} className={btnClass()} style={btn()}>Undo changes</button>}
          <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>A rule in bold differs from the default. Moved to consultant is recorded from a later release.</span>
        </div>
      </div>
    </Card>
  );
}

const th = { textAlign: 'left' as const, padding: '10px 10px', fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', borderBottom: '1px solid var(--line)', verticalAlign: 'bottom' as const };
const td = { padding: '10px 10px', borderBottom: '1px solid var(--line)', verticalAlign: 'top' as const };
