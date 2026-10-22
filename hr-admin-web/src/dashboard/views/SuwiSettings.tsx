// Suwi › Settings & activity: on or off, this month's budget, how much Suwi
// may do in each area (admins change it), the rules that always apply, and
// what it has done lately.
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import { Card } from '../ui';
import { getSuwiActivity, getSuwiSettings, saveSuwiSettings, type SuwiActivityRow, type SuwiLevel, type SuwiSettingsDTO } from '../../services/suwi';
import { SuwiOrb } from '../suwi/SuwiPanel';

const RULES = [
  'Sees only what the signed-in person can see; managers get their own team, and pay is hidden from roles without pay access.',
  'Never changes anything on its own. Every prepared action shows a "What will happen" card, and only your Confirm saves it.',
  'Every confirmed action is recorded here and in the audit log as "via Suwi", with Undo where it is possible.',
  'Shows the dates and data behind every answer; says "empty" and "not allowed to see" differently.',
  "Doesn't invent policy or tax rules: if no rule exists, it says so.",
  'Wellbeing figures only for groups of 10 or more. Never removes reported content; moderation stays human.',
];

export function SuwiSettings() {
  const s = useStore();
  const [data, setData] = useState<SuwiSettingsDTO | null>(null);
  const [activity, setActivity] = useState<SuwiActivityRow[]>([]);
  const [budget, setBudget] = useState('');
  const [saving, setSaving] = useState(false);
  const load = () => {
    getSuwiSettings().then((d) => { setData(d); setBudget(String(d.settings.monthlyBudgetUsd)); }).catch((e) => s.flash(e instanceof ApiError ? e.message : 'Could not load Suwi settings', 'error'));
    getSuwiActivity().then(setActivity).catch(() => undefined);
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (patch: Parameters<typeof saveSuwiSettings>[0], done: string) => {
    if (!data?.canEdit) { s.flash('Only a dashboard admin can change Suwi settings', 'error'); return; }
    setSaving(true);
    try {
      const settings = await saveSuwiSettings(patch);
      setData((d) => (d ? { ...d, settings: { ...d.settings, ...settings } } : d));
      s.flash(done);
      getSuwiActivity().then(setActivity).catch(() => undefined);
    } catch (e) {
      s.flash(e instanceof ApiError ? e.message : 'Could not save', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!data) return <div style={{ color: 'var(--ink-3)', padding: 24 }}>Loading…</div>;
  const { settings, areas, levelLabels, service, canEdit } = data;
  const levels: SuwiLevel[] = ['answer', 'suggest', 'act'];
  const pct = settings.monthlyBudgetUsd > 0 ? Math.min(100, Math.round((settings.spentThisMonthUsd / settings.monthlyBudgetUsd) * 100)) : 0;

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 1100 }}>
      <section className="sora-card" style={{ padding: '20px 22px' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <SuwiOrb size={48} />
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 17, fontWeight: 600 }}>Suwi, your HR assistant</div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 2 }}>
              {service.ready ? `Running on ${service.provider === 'gemini' ? 'Google Gemini' : 'Anthropic Claude'} (${service.model}).` : 'Not set up on this server yet: no AI key.'} Suwi only sees what each person's role allows and never acts without a confirmation.
            </div>
          </div>
          <button type="button" onClick={() => s.setSuwiOpen(true)} style={primary}>Ask Suwi</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, marginTop: 18 }}>
          <div style={tile}>
            <div style={label}>Suwi is</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button type="button" role="switch" aria-checked={settings.enabled} disabled={!canEdit || saving} onClick={() => void save({ enabled: !settings.enabled }, settings.enabled ? 'Suwi turned off' : 'Suwi turned on')}
                style={{ width: 44, height: 26, borderRadius: 999, border: 'none', background: settings.enabled ? 'var(--ok-solid)' : 'var(--line-2)', position: 'relative', cursor: canEdit ? 'pointer' : 'default', flexShrink: 0 }}>
                <span style={{ position: 'absolute', top: 3, left: settings.enabled ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
              </button>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{settings.enabled ? 'On' : 'Off'}</span>
              <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>for everyone with dashboard access</span>
            </div>
          </div>
          <div style={tile}>
            <div style={label}>This month's budget</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>${settings.spentThisMonthUsd.toFixed(2)}</span>
              <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>of</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>$<input value={budget} onChange={(e) => setBudget(e.target.value)} disabled={!canEdit || saving} inputMode="decimal" aria-label="Monthly budget in US dollars" style={{ width: 70, height: 32, borderRadius: 999, border: '1px solid var(--line-2)', background: 'var(--surface)', color: 'var(--ink)', padding: '0 10px', font: 'inherit', fontSize: 13.5 }} /></span>
              {canEdit && Number(budget) !== settings.monthlyBudgetUsd && <button type="button" disabled={saving} onClick={() => void save({ monthlyBudgetUsd: Number(budget) }, 'Budget saved')} style={ghost}>Save</button>}
            </div>
            <div style={{ height: 6, borderRadius: 99, background: 'var(--line)', overflow: 'hidden', marginTop: 8 }}><div style={{ width: `${pct}%`, height: '100%', borderRadius: 99, background: pct >= 90 ? 'var(--bad-solid)' : 'var(--brand)', transition: 'width .4s ease' }} /></div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>{pct}% used · Suwi stops answering at the limit until next month. About ₹2 a question.</div>
          </div>
        </div>
      </section>

      <Card>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>What Suwi may do</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>Answer only: facts. Suggest: also the next step. Act after you confirm: it prepares the change and you confirm it.{!canEdit && ' Only a dashboard admin can change these.'}</div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
          <thead><tr><th style={th}>Area</th><th style={th}>Covers</th><th style={th}>Suwi may</th></tr></thead>
          <tbody>{areas.map((a) => (
            <tr key={a.key}>
              <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{a.label}</td>
              <td style={{ ...td, color: 'var(--ink-3)' }}>{a.covers}</td>
              <td style={td}>
                <div role="radiogroup" aria-label={`${a.label}: what Suwi may do`} style={{ display: 'inline-flex', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 999, padding: 3, gap: 2 }}>
                  {levels.map((l) => {
                    const on = settings.levels[a.key] === l;
                    return <button key={l} type="button" role="radio" aria-checked={on} disabled={!canEdit || saving || on} onClick={() => void save({ levels: { [a.key]: l } }, `${a.label}: ${levelLabels[l]}`)}
                      style={{ height: 28, padding: '0 11px', borderRadius: 999, border: 'none', fontSize: 12.5, fontWeight: 500, cursor: canEdit && !on ? 'pointer' : 'default', background: on ? 'var(--sel)' : 'transparent', color: on ? 'var(--on-sel)' : 'var(--ink-2)', font: 'inherit' }}>{levelLabels[l]}</button>;
                  })}
                </div>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, alignItems: 'start' }}>
        <Card style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Rules that always apply</div>
          <ul className="sora-rules">{RULES.map((r) => <li key={r}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m5 12.5 4.5 4.5L19 7.5" /></svg><span>{r}</span></li>)}</ul>
        </Card>
        <Card>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Recent Suwi activity</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>{canEdit ? "Everyone's questions, confirmed actions and settings changes." : 'Your questions, plus every confirmed action and settings change.'}</div>
          </div>
          {activity.length === 0 ? <div style={{ padding: 22, color: 'var(--ink-3)', fontSize: 13 }}>Nothing yet. Ask Suwi something.</div> : (
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {activity.map((r, i) => (
                <div key={i} style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600 }}>{r.who}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: r.kind === 'action' ? 'var(--hi)' : 'var(--ink-3)' }}>{r.kind === 'question' ? 'asked' : r.kind === 'action' ? 'via Suwi' : 'settings'}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-3)' }}>{new Date(r.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div style={{ marginTop: 2, color: 'var(--ink)' }}>{r.text}</div>
                  {r.tools && r.tools.length > 0 && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>Checked: {r.tools.join(' · ')}{typeof r.costUsd === 'number' ? ` · $${r.costUsd.toFixed(4)}` : ''}</div>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

const tile: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: '12px 14px' };
const label: CSSProperties = { fontSize: 11.5, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 };
const th: CSSProperties = { textAlign: 'left', fontSize: 11.5, fontWeight: 500, color: 'var(--ink-3)', padding: '10px 18px', borderBottom: '1px solid var(--line)', background: 'var(--surface-2)' };
const td: CSSProperties = { padding: '10px 18px', borderBottom: '1px solid var(--line)', verticalAlign: 'middle' };
const ghost: CSSProperties = { height: 32, padding: '0 12px', borderRadius: 999, border: '1px solid var(--line-2)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', font: 'inherit' };
const primary: CSSProperties = { height: 38, padding: '0 18px', borderRadius: 999, border: 'none', background: 'var(--accent)', color: 'var(--on-accent)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', font: 'inherit' };
