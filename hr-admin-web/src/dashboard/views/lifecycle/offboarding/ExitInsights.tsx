// Exit insights (O4): why people leave, from the exits and the exit interviews. The answers are
// anonymised on the server (department, tenure band and month only); any group with fewer than 5
// answers stays hidden, and the open answers are never shown here, only the themes HR gave them
// (Tag answers: the text alone, with no department, tenure or month, to pick a theme for).
// A theme with fewer than 5 answers is left out too.
import { useEffect, useState } from 'react';
import { Modal } from '../shared';
import { useStore } from '../../../store';
import { Card, LoadError, PageActions, SkeletonCards, Th } from '../../../ui';
import { TH, TR, btn, btnClass, cellName } from '../../../ds';
import { IconDownload } from '../../../icons';
import { downloadCsv } from '../../../export';
import { StatTile } from '../../leaveParts';
import { getExitAnswers, getExitInsights, tagExitAnswer } from '../../../../services/lifecycleOffboarding';
import type { ExitAnswersDTO, InsightsDTO } from '../../../../services/lifecycleOffboarding';
import { LockIcon, todayKey } from './parts';
import '../../people.css';
import './offboarding.css';

const COLS = '1.4fr 0.6fr 0.9fr 0.9fr 1.2fr';
/** 1 April of this financial year. */
const fyStart = (today: string) => (Number(today.slice(5, 7)) >= 4 ? `${today.slice(0, 4)}-04-01` : `${Number(today.slice(0, 4)) - 1}-04-01`);
const rating = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)} / 5`);

function Bars({ rows, color }: { rows: { label: string; count: number; percent: number }[]; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="ob-bars">
      {rows.map((r) => (
        <div key={r.label} className="ob-bar">
          <span>{r.label}</span>
          <span className="track" aria-hidden><span className="fill" style={{ display: 'block', width: `${(r.count / max) * 100}%`, background: color }} /></span>
          <span className="n">{r.count} · {r.percent}%</span>
        </div>
      ))}
    </div>
  );
}

export function ExitInsights() {
  const today = todayKey();
  const [from, setFrom] = useState(fyStart(today));
  const [to, setTo] = useState(today);
  const [groupBy, setGroupBy] = useState<'department' | 'tenure'>('department');
  const [data, setData] = useState<InsightsDTO | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [tagging, setTagging] = useState(false);

  useEffect(() => {
    let live = true;
    setError('');
    getExitInsights(from, to, groupBy).then((d) => { if (live) setData(d); }).catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load the insights'); });
    return () => { live = false; };
  }, [from, to, groupBy, attempt]);

  const state = error ? 'error' : data ? 'ready' : 'loading';
  const exportRows = () => data && downloadCsv(`exit-insights-${groupBy}`, [
    { header: groupBy === 'tenure' ? 'Tenure' : 'Department', value: (r: InsightsDTO['groups'][number]) => r.label },
    { header: 'Left', value: (r) => r.left },
    { header: 'Exit interviews', value: (r) => r.answers },
    { header: 'Working here (of 5)', value: (r) => (r.workingHere ?? 'Hidden') as string | number },
    { header: 'Working with their manager (of 5)', value: (r) => (r.manager ?? 'Hidden') as string | number },
  ], data.groups);

  return (
    <>
      <PageActions>
        <button type="button" id="ob-tag-answers" onClick={() => setTagging(true)} className={btnClass()} style={btn()}>Tag answers{data?.untaggedAnswers ? ` · ${data.untaggedAnswers}` : ''}</button>
        <button type="button" onClick={exportRows} disabled={!data} className={btnClass()} style={btn()}><IconDownload stroke="currentColor" /> Export</button>
      </PageActions>
      {tagging && <TagAnswers from={from} to={to} onClose={() => { setTagging(false); setAttempt((n) => n + 1); }} />}
      <Card padded>
        <div className="ob-filters">
          <p className="pd-lead" style={{ flex: '1 1 380px' }}>Why people leave, from exits and exit interviews. Answers are anonymised: no one sees them against a name, and any group with fewer than 5 answers stays hidden.</p>
          <label>From <input type="date" className="pd-inp" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To <input type="date" className="pd-inp" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        {error && <LoadError compact text={error} onRetry={() => setAttempt((n) => n + 1)} />}
        {!data && !error && <SkeletonCards count={4} minWidth={200} />}
        {data && (
          <>
            <div className="ob-kpis">
              <StatTile state={state} label="People who left" value={data.left.total} sub={`${data.left.resigned} resigned · ${data.left.hrStarted} HR-started`} />
              <StatTile state={state} label="Exit interviews answered" value={`${data.answered.count} of ${data.answered.resignations}`} sub={`${data.answered.percent}% of resignations`} />
              <StatTile state={state} label="Working here" value={data.workingHere?.average != null ? `${data.workingHere.average} / 5` : 'Hidden'} sub={data.workingHere ? `Average of ${data.workingHere.answers} answers` : `Shows from ${data.minGroup} answers`} />
              <StatTile state={state} label="Would come back" value={data.comeBack ? `${data.comeBack.yes + data.comeBack.maybe} of ${data.comeBack.answered}` : 'Hidden'} sub={data.comeBack ? `${data.comeBack.yes} yes · ${data.comeBack.maybe} maybe` : `Shows from ${data.minGroup} answers`} />
            </div>
            {data.hidden && (
              <div className="ob-privacy" style={{ marginBottom: 20 }}><LockIcon /><span>Fewer than {data.minGroup} exit interviews in these dates, so the answers stay hidden. Widen the dates to see them.</span></div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20, marginBottom: 20 }}>
              <section className="pd-card">
                <div className="pd-card-h"><h3>Main reason for leaving</h3><small>{data.reasonAnswers} exit interviews · one reason each</small></div>
                {data.reasons.length ? <Bars rows={data.reasons} color="var(--accent)" /> : <div className="ob-empty">{data.hidden ? 'Hidden' : 'No reasons given yet.'}</div>}
              </section>
              <section className="pd-card">
                <div className="pd-card-h"><h3>What they would change</h3><small>Themes from the open question, grouped by HR. Quotes are not shown.</small></div>
                {data.themes.length ? <Bars rows={data.themes} color="var(--p-purple)" /> : <div className="ob-empty">{data.hidden ? 'Hidden' : data.untaggedAnswers ? `${data.untaggedAnswers} answers have no theme yet. Tag them to see the themes.` : data.hiddenThemes ? `No theme has ${data.minGroup} answers yet.` : 'No themes yet.'}</div>}
                {!data.hidden && data.themes.length > 0 && (data.hiddenThemes > 0 || data.untaggedAnswers > 0) && (
                  <div className="ob-privacy" style={{ marginTop: 10 }}><LockIcon /><span>{[data.hiddenThemes ? `${data.hiddenThemes} ${data.hiddenThemes === 1 ? 'theme has' : 'themes have'} fewer than ${data.minGroup} answers and ${data.hiddenThemes === 1 ? 'is' : 'are'} hidden` : '', data.untaggedAnswers ? `${data.untaggedAnswers} answers have no theme yet` : ''].filter(Boolean).join(' · ')}.</span></div>
                )}
              </section>
            </div>
            <section className="pd-card">
              <div className="pd-card-h">
                <h3>By {groupBy === 'tenure' ? 'time with the company' : 'department'}</h3>
                <div className="pd-seg" role="tablist" aria-label="Group by">
                  <button type="button" className={groupBy === 'department' ? 'on' : ''} onClick={() => setGroupBy('department')}>Department</button>
                  <button type="button" className={groupBy === 'tenure' ? 'on' : ''} onClick={() => setGroupBy('tenure')}>Tenure</button>
                </div>
              </div>
              <div className="ob-privacy" style={{ marginBottom: 10 }}><LockIcon /><span>Ratings show only where {data.minGroup} or more people answered.</span></div>
              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 640 }}>
                  <div style={TH(COLS)}><Th>{groupBy === 'tenure' ? 'TENURE' : 'DEPARTMENT'}</Th><Th>LEFT</Th><Th>EXIT INTERVIEWS</Th><Th>WORKING HERE</Th><Th>WORKING WITH THEIR MANAGER</Th></div>
                  {data.groups.length === 0 && <div style={{ ...TR(COLS, true), color: 'var(--ink-3)' }}>No one left in these dates.</div>}
                  {data.groups.map((g, i) => (
                    <div key={g.key} style={TR(COLS, i === data.groups.length - 1)}>
                      <div style={cellName}>{g.label}</div>
                      <div>{g.left}</div>
                      <div>{g.answers}</div>
                      <div style={{ color: g.hidden ? 'var(--ink-4)' : undefined }}>{g.hidden ? 'Hidden' : rating(g.workingHere)}</div>
                      <div style={{ color: g.hidden ? 'var(--ink-4)' : undefined }}>{g.hidden ? 'Hidden' : rating(g.manager)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}
      </Card>
    </>
  );
}

const NEW_THEME = '__new__';

/**
 * HR gives each open answer a theme: from the list, one HR added before, or a new one. Only the
 * answer's words show, with no department, tenure or month, in no particular order.
 */
function TagAnswers({ from, to, onClose }: { from: string; to: string; onClose: () => void }) {
  const s = useStore();
  const [data, setData] = useState<ExitAnswersDTO | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [adding, setAdding] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    let live = true;
    getExitAnswers(from, to).then((d) => { if (live) setData(d); }).catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load the answers'); });
    return () => { live = false; };
  }, [from, to]);
  const save = async (id: string, theme: string | null) => {
    setBusy(id);
    try {
      await tagExitAnswer(id, theme);
      setData((d) => d && {
        ...d,
        answers: d.answers.map((a) => (a.id === id ? { ...a, theme } : a)),
        custom: theme && !d.themes.includes(theme) && !d.custom.includes(theme) ? [...d.custom, theme].sort() : d.custom,
        untagged: d.answers.filter((a) => (a.id === id ? !theme : !a.theme)).length,
      });
    } catch (e) {
      s.flash(e instanceof Error ? e.message : 'Could not save the theme', 'error');
    } finally {
      setBusy('');
    }
  };
  return (
    <Modal title="Tag what they would change" width={720} onClose={onClose}
      sub="Give each answer a theme. Exit insights shows only the themes, never the words, and only themes with 5 or more answers."
      footer={<button type="button" className="pd-btn primary" onClick={onClose}>Done</button>}>
      {error && <div style={{ color: 'var(--bad)' }}>{error}</div>}
      {!data && !error && <SkeletonCards count={3} minWidth={300} />}
      {data && data.answers.length === 0 && <div className="ob-empty">No open answers in these dates.</div>}
      {data && data.answers.length > 0 && <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 8 }}>{data.untagged} of {data.answers.length} without a theme</div>}
      {data?.answers.map((a) => (
        <div key={a.id} className="ob-row" style={{ alignItems: 'flex-start' }}>
          <span className="t" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{a.text}</span>
          <span className="pd-pick" style={{ flex: 'none', width: 230 }}>
            <select className="pd-inp" aria-label="Theme" value={a.theme ?? ''} disabled={busy === a.id}
              onChange={(e) => { const v = e.target.value; if (v === NEW_THEME) setAdding({ id: a.id, text: '' }); else void save(a.id, v || null); }}>
              <option value="">No theme</option>
              {data.themes.map((t) => <option key={t} value={t}>{t}</option>)}
              {data.custom.length > 0 && <optgroup label="Added by HR">{data.custom.map((t) => <option key={t} value={t}>{t}</option>)}</optgroup>}
              <option value={NEW_THEME}>New theme…</option>
            </select>
          </span>
        </div>
      ))}
      {adding && (
        <div className="ob-row">
          <input className="pd-inp" autoFocus aria-label="New theme" placeholder="A new theme, e.g. Hybrid days" value={adding.text} maxLength={60}
            onChange={(e) => setAdding({ ...adding, text: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && adding.text.trim()) { void save(adding.id, adding.text.trim()); setAdding(null); } }} style={{ flex: 1 }} />
          <button type="button" className="pd-btn sm" onClick={() => setAdding(null)}>Cancel</button>
          <button type="button" className="pd-btn primary sm" disabled={!adding.text.trim()} onClick={() => { void save(adding.id, adding.text.trim()); setAdding(null); }}>Add theme</button>
        </div>
      )}
    </Modal>
  );
}
