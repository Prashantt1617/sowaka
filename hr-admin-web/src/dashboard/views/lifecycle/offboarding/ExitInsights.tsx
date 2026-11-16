// Exit insights (O4): why people leave, from the exits and the exit interviews. The answers are
// anonymised on the server (department, tenure band and month only); any group with fewer than 5
// answers stays hidden, and the open answers are never shown, only the themes HR gave them.
import { useEffect, useState } from 'react';
import { Card, LoadError, PageActions, SkeletonCards, Th } from '../../../ui';
import { TH, TR, btn, btnClass, cellName } from '../../../ds';
import { IconDownload } from '../../../icons';
import { downloadCsv } from '../../../export';
import { StatTile } from '../../leaveParts';
import { getExitInsights } from '../../../../services/lifecycleOffboarding';
import type { InsightsDTO } from '../../../../services/lifecycleOffboarding';
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
        <button type="button" onClick={exportRows} disabled={!data} className={btnClass()} style={btn()}><IconDownload stroke="currentColor" /> Export</button>
      </PageActions>
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
                {data.themes.length ? <Bars rows={data.themes} color="var(--p-purple)" /> : <div className="ob-empty">{data.hidden ? 'Hidden' : data.untaggedAnswers ? `${data.untaggedAnswers} answers have no theme yet.` : 'No themes yet.'}</div>}
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
