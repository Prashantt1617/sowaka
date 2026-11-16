// Setup › Payroll › Exit settings: what each kind of exit does, for this company.
// The notice period exits start from, then one row per kind (Resigned,
// Terminated…) and one column per rule (salary during notice, when the app
// turns off, notice pay, notice shortfall), each with an (i). Gratuity follows the law and leave
// encashment each leave type's rule, so neither is here. These
// are the starting point when HR records an exit; HR can still change any of
// them for that one person. Saved on the company (/admin/exit-settings).
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../store';
import { Card, LoadError, SkeletonForm, Th } from '../ui';
import { TH, TR, btn, btnClass, cellName, cellSub } from '../ds';
import { getExitSettings, saveExitSettings } from '../../services/hrms';
import type { ExitNoticeSettings, ExitRuleKind, ExitRules, ExitSettingsDTO } from '../../services/hrms';
import { NOTICE_PAY_INFO, NOTICE_SHORTFALL_INFO, RULE_KIND_LABEL, RULE_KINDS, RULE_ROWS, asText, fromText } from './exitRules';
import './people.css';
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
  // How the notice lines of a settlement are worked out, and when a leaving manager's team is told.
  const [amounts, setAmounts] = useState<ExitNoticeSettings | null>(null);

  useEffect(() => {
    let live = true;
    setError('');
    getExitSettings().then((d) => { if (live) { setData(d); setDraft(draftOf(d)); setNotice(d.noticeDays == null ? '' : String(d.noticeDays)); setAmounts({ ...d.notice }); } }).catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load exit settings'); });
    return () => { live = false; };
  }, [attempt]);

  if (error) return <Card><LoadError text={error} onRetry={() => setAttempt((n) => n + 1)} /></Card>;
  if (!data || !draft || !amounts) return <Card style={{ padding: 22 }}><SkeletonForm fields={6} /></Card>;

  const saved = draftOf(data);
  const changed = RULE_KINDS.filter((k) => !same(draft[k], saved[k]));
  const savedNotice = data.noticeDays == null ? '' : String(data.noticeDays);
  const noticeChanged = notice !== savedNotice;
  const amountsChanged = JSON.stringify(amounts) !== JSON.stringify(data.notice);
  const dirty = changed.length > 0 || noticeChanged || amountsChanged;
  const set = (kind: ExitRuleKind, key: keyof ExitRules, text: string) =>
    setDraft({ ...draft, [kind]: { ...draft[kind], [key]: fromText(key, text) } });
  const isDefault = (kind: ExitRuleKind) => same(draft[kind], data.defaults[kind]);

  const save = async () => {
    setSaving(true);
    try {
      // A kind put back exactly as the default is stored as "the default".
      const body = Object.fromEntries(changed.map((k) => [k, isDefault(k) ? null : draft[k]]));
      if (notice !== '' && Number(notice) > 365) { flash('Notice period is 0 to 365 days', 'error'); setSaving(false); return; }
      const next = await saveExitSettings(body, noticeChanged ? (notice === '' ? null : Number(notice)) : undefined, amountsChanged ? amounts : undefined);
      setData(next);
      setDraft(draftOf(next));
      setAmounts({ ...next.notice });
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
        <div style={{ display: 'grid', gap: 14, paddingTop: 18, borderTop: '1px solid var(--line)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Money for notice days</div>
          <SentenceRow label="Someone leaves before their notice is over. For each day short, take back" info={<InfoTip label="Notice shortfall" text={NOTICE_SHORTFALL_INFO} />}>
            <span className="pd-pick" style={{ width: 260 }}>
              <select id="exit-recovery-basis" value={amounts.recoveryBasis} onChange={(e) => setAmounts({ ...amounts, recoveryBasis: e.target.value as ExitNoticeSettings['recoveryBasis'] })} className="pd-inp" style={{ height: 38 }}>
                <option value="basic_30">a day’s Basic pay</option>
                <option value="gross_30">a day’s full salary</option>
                <option value="basic_month">a day’s Basic, by days in the month</option>
              </select>
            </span>
          </SentenceRow>
          <SentenceRow label="You let someone go before their notice is over. For each day they don’t work, pay" info={<InfoTip label="Notice pay" text={NOTICE_PAY_INFO} />}>
            <span className="pd-pick" style={{ width: 260 }}>
              <select id="exit-pay-basis" value={amounts.noticePayBasis} onChange={(e) => setAmounts({ ...amounts, noticePayBasis: e.target.value as ExitNoticeSettings['noticePayBasis'] })} className="pd-inp" style={{ height: 38 }}>
                <option value="gross_30">a day’s full salary</option>
                <option value="basic_30">a day’s Basic pay</option>
                <option value="gross_month">a day’s full salary, by days in the month</option>
              </select>
            </span>
          </SentenceRow>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.5 }}>
            <button type="button" id="exit-leave-covers" role="switch" aria-checked={amounts.leaveCoversShortfall} aria-label="Use unused leave for the days short" onClick={() => setAmounts({ ...amounts, leaveCoversShortfall: !amounts.leaveCoversShortfall })}
              style={{ width: 38, height: 22, borderRadius: 99, border: 'none', padding: 2, cursor: 'pointer', transition: 'background .15s', display: 'flex', flexShrink: 0, marginTop: 1, background: amounts.leaveCoversShortfall ? 'var(--accent)' : 'var(--line-2)', justifyContent: amounts.leaveCoversShortfall ? 'flex-end' : 'flex-start' }}>
              <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.2)' }} />
            </button>
            <div>
              Use their unused leave for the days short first
              <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>5 days short with 8 days of leave left: nothing is taken back, and 3 days of leave are paid out.</span>
            </div>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginTop: 6 }}>When a manager leaves</div>
          <SentenceRow label="Tell their team about their new manager">
            <input id="exit-team-days" inputMode="numeric" value={String(amounts.teamNoticeDays)} onChange={(e) => setAmounts({ ...amounts, teamNoticeDays: Number(e.target.value.replace(/[^0-9]/g, '').slice(0, 2) || 0) })} className="pd-inp" style={{ width: 64, height: 38, textAlign: 'center' }} aria-label="Days before the last day" />
            <span style={{ fontSize: 13.5, color: 'var(--ink)' }}>days before the manager’s last day</span>
          </SentenceRow>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" disabled={saving || !dirty} onClick={() => void save()} className={btnClass('primary')} style={btn('primary')}>{saving ? 'Saving…' : 'Save'}</button>
          {dirty && <button type="button" onClick={() => { setDraft(draftOf(data)); setNotice(savedNotice); setAmounts({ ...data.notice }); }} className={btnClass()} style={btn()}>Undo changes</button>}
          <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>A choice in bold differs from the default.</span>
        </div>
      </div>
    </Card>
  );
}

const COLS = '1.25fr 1fr 1fr 1fr 1fr';

/** A setting read as a sentence: the words, then the choice. */
function SentenceRow({ label, info, children }: { label: string; info?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.5 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{label}{info}</span>
      {children}
    </div>
  );
}
