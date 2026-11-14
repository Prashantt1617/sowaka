// Setup › Payroll › Exit settings: what each kind of exit does, for this company.
// The notice period exits start from, then one row per kind (Resigned,
// Terminated…) and one column per rule (salary during notice, when the app
// turns off, notice pay, notice shortfall), each with an (i). Gratuity follows the law and leave
// encashment each leave type's rule, so neither is here. These
// are the starting point when HR records an exit; HR can still change any of
// them for that one person. Saved on the company (/admin/exit-settings).
import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Card, LoadError, SkeletonForm, Th } from '../ui';
import { TH, TR, btn, btnClass, cellName, cellSub } from '../ds';
import { getExitSettings, saveExitSettings } from '../../services/hrms';
import type { ExitRuleKind, ExitRules, ExitSettingsDTO } from '../../services/hrms';
import { RULE_KIND_LABEL, RULE_KINDS, RULE_ROWS, asText, fromText } from './exitRules';
import { InfoTip } from './InfoTip';

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
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let live = true;
    setError('');
    getExitSettings().then((d) => { if (live) { setData(d); setDraft(draftOf(d)); setNotice(d.noticeDays == null ? '' : String(d.noticeDays)); } }).catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load exit settings'); });
    return () => { live = false; };
  }, [attempt]);

  if (error) return <Card><LoadError text={error} onRetry={() => setAttempt((n) => n + 1)} /></Card>;
  if (!data || !draft) return <Card style={{ padding: 22 }}><SkeletonForm fields={6} /></Card>;

  const saved = draftOf(data);
  const changed = RULE_KINDS.filter((k) => !same(draft[k], saved[k]));
  const savedNotice = data.noticeDays == null ? '' : String(data.noticeDays);
  const noticeChanged = notice !== savedNotice;
  const set = (kind: ExitRuleKind, key: keyof ExitRules, text: string) =>
    setDraft({ ...draft, [kind]: { ...draft[kind], [key]: fromText(key, text) } });
  const isDefault = (kind: ExitRuleKind) => same(draft[kind], data.defaults[kind]);

  const save = async () => {
    setSaving(true);
    try {
      // A kind put back exactly as the default is stored as "the default".
      const body = Object.fromEntries(changed.map((k) => [k, isDefault(k) ? null : draft[k]]));
      if (notice !== '' && Number(notice) > 365) { flash('Notice period is 0 to 365 days', 'error'); setSaving(false); return; }
      const next = await saveExitSettings(body, noticeChanged ? (notice === '' ? null : Number(notice)) : undefined);
      setData(next);
      setDraft(draftOf(next));
      setNotice(next.noticeDays == null ? '' : String(next.noticeDays));
      flash('Exit settings saved. New exits start from these; exits already recorded keep theirs.');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card padded>
      <div style={{ display: 'grid', gap: 20 }}>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', maxWidth: 760, lineHeight: 1.55 }}>
          What happens when someone leaves. Recording an exit starts from these, and you can change any of them for that one person.
          Gratuity follows the law (after 5 years) and unused leave follows each leave type’s own encashment rule, so they are not set here.
        </div>
        <label className="pd-label" style={{ maxWidth: 280 }}>
          <span>Notice period, in days</span>
          <input id="exit-notice-days" inputMode="numeric" value={notice} placeholder="e.g. 30" onChange={(e) => setNotice(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} className="pd-inp" />
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>How much notice people must give. Recording an exit fills this in; you can change it for one person.</span>
        </label>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 860 }}>
            <div style={TH(COLS)}>
              <Th>WHEN SOMEONE</Th>
              {RULE_ROWS.map((row) => (
                <span key={row.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Th>{row.label.toUpperCase()}</Th><InfoTip label={row.label} text={row.info} /></span>
              ))}
            </div>
            {RULE_KINDS.map((k, i) => (
              <div key={k} style={TR(COLS, i === RULE_KINDS.length - 1)}>
                <div style={{ minWidth: 0 }}>
                  <div style={cellName}>{RULE_KIND_LABEL[k]}</div>
                  <div style={{ ...cellSub, marginTop: 2 }}>
                    {isDefault(k)
                      ? (k === 'consultant' ? 'Default · recorded from a later release' : 'Default')
                      : <button type="button" onClick={() => setDraft({ ...draft, [k]: { ...data.defaults[k] } })} style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', color: 'var(--accent-ink)', cursor: 'pointer' }}>Changed · use default</button>}
                  </div>
                </div>
                {RULE_ROWS.map((row) => {
                  const value = asText(draft[k][row.key]);
                  const edited = value !== asText(data.defaults[k][row.key]);
                  // Everyone who leaves loses access; only a move to consultant keeps it.
                  const options = row.key === 'access' && k !== 'consultant' ? row.options.filter(([v]) => v !== 'never') : row.options;
                  return (
                    <span key={row.key} className="pd-pick">
                      <select id={`rule-${k}-${row.key}`} aria-label={`${RULE_KIND_LABEL[k]}: ${row.label}`} value={value} onChange={(e) => set(k, row.key, e.target.value)}
                        className="pd-inp" style={{ height: 38, fontWeight: edited ? 600 : 400 }}>
                        {(options as [unknown, string][]).map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
                      </select>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" disabled={saving || (changed.length === 0 && !noticeChanged)} onClick={() => void save()} className={btnClass('primary')} style={btn('primary')}>{saving ? 'Saving…' : 'Save'}</button>
          {(changed.length > 0 || noticeChanged) && <button type="button" onClick={() => { setDraft(draftOf(data)); setNotice(savedNotice); }} className={btnClass()} style={btn()}>Undo changes</button>}
          <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>A choice in bold differs from the default.</span>
        </div>
      </div>
    </Card>
  );
}

const COLS = '1.25fr 1fr 1fr 1fr 1fr';
