// The App usage tabs built from one summary: the funnel, requests and
// approvals, active usage, active and inactive, and what they use. Each gets
// the people already narrowed to the department and location picked.
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { UsageGroup, UsageSummaryDTO } from '../../../../services/engagement-usage';
import { StatusTabs } from '../../../ui';
import { Td, Th } from '../../lookUi';
import * as L from '../../look';
import { Card, Kpis, LastOpened, PeopleList, RemindButton } from './parts';
import { GROUP_SHORT, addDays, pct, rangeLabel, sd } from './format';
import type { Col, Person } from './parts';
import { WhenPanel } from './trend';
import type { WhenLoad } from './trend';

export type TabCtx = {
  summary: UsageSummaryDTO;
  /** Everyone in the department and location picked. */
  people: Person[];
  dept: string;
  loc: string;
  nameOf: (id: string) => string;
  open: string;
  toggle: (id: string) => void;
  /** The whole range is before app activity was tracked (or nothing is tracked yet). */
  untracked: boolean;
  onRemind: (people: Person[]) => void;
  /** "When people open the app", requested by the page at the same time as the summary. */
  when: WhenLoad;
};

const lastCol = (today: string): Col => ['Last opened', (p) => <LastOpened p={p} today={today} />];
const groupCol: Col = ['Attendance', (p) => GROUP_SHORT[p.group]];

// ── 1. Adoption funnel ────────────────────────────────────────────────────
export function FunnelTab({ c }: { c: TabCtx }) {
  const P = c.people;
  const login = P.filter((p) => p.loggedIn);
  const photo = login.filter((p) => p.photo);
  const ints = photo.filter((p) => p.interests);
  const steps: { id: string; label: string; sub: string; L: Person[]; prev: Person[] | null }[] = [
    { id: 'all', label: 'On Sowaka', sub: 'Everyone in the employee list', L: P, prev: null },
    { id: 'login', label: 'Logged in', sub: 'Downloaded the app and signed in at least once', L: login, prev: P },
    { id: 'photo', label: 'Uploaded a photo', sub: 'Profile step 1', L: photo, prev: login },
    { id: 'ints', label: 'Added interests', sub: 'Profile step 2', L: ints, prev: photo },
  ];
  const top = P.length || 1;
  return (
    <Card title="Adoption funnel" note="From the employee list to a completed profile. Click “stuck” on a step to see who hasn’t got there.">
      <div className="ua-fun">
        {steps.map((s, i) => {
          const key = `f|${s.id}`;
          const on = c.open === key;
          const inStep = new Set(s.L.map((p) => p.id));
          const stuck = s.prev ? s.prev.filter((p) => !inStep.has(p.id)) : [];
          return (
            <div key={s.id} className={`ua-fs${on ? ' on' : ''}`}>
              <div className="ua-fh">
                <span className="ua-fn">{i + 1}</span>
                <div className="grow"><b>{s.label}</b><span>{s.sub}</span></div>
                <div className="ua-fbar"><i style={{ width: `${(s.L.length / top) * 100}%` }} /></div>
                <span className="ua-fc"><b>{s.L.length}</b>{s.prev ? `of ${s.prev.length} · ${pct(s.L.length, s.prev.length)}` : ''}</span>
                {i > 0 && (stuck.length
                  // Only the stuck count opens the list; the plus says it can be clicked.
                  ? <button type="button" className="ua-stuck" aria-expanded={on} aria-label={`${on ? 'Hide' : 'Show'} the ${stuck.length} stuck before ${s.label}`} onClick={() => c.toggle(key)}>
                      <span className={`ua-plus${on ? ' on' : ''}`} aria-hidden>+</span>{stuck.length} stuck
                    </button>
                  : <span style={L.pill('ok')}><span style={L.pillDot} />None stuck</span>)}
              </div>
              {i > 0 && on && (
                <PeopleList
                  people={stuck}
                  nameOf={c.nameOf}
                  onClose={() => c.toggle(key)}
                  cols={[s.id === 'login' ? groupCol : lastCol(c.summary.today), ['Stopped at', () => steps[i - 1].label]]}
                />
              )}
            </div>
          );
        })}
      </div>
      <p className="ua-note">The funnel is where everyone stands today, whatever dates are picked.</p>
    </Card>
  );
}


// ── 4. Active and inactive ────────────────────────────────────────────────
type St = 'act' | 'quiet' | 'never';
const ST: Record<St, [string, string, string]> = {
  act: ['Active', 'Opened the app in these dates', 'var(--ua-act)'],
  quiet: ['Gone quiet', 'Logged in before, not in these dates', 'var(--ua-quiet)'],
  never: ['Never logged in', 'Hasn’t signed in once', 'var(--ua-never)'],
};
const stOf = (p: Person): St => (!p.loggedIn ? 'never' : p.opened ? 'act' : 'quiet');

export function StatusTab({ c }: { c: TabCtx }) {
  const [st, setSt] = useState<St>('act');
  const [by, setBy] = useState<'dept' | 'loc' | 'mgr'>('dept');
  const P = c.people;
  const today = c.summary.today;
  const G = useMemo(() => {
    const g: Record<St, Person[]> = { act: [], quiet: [], never: [] };
    for (const p of P) g[stOf(p)].push(p);
    return g;
  }, [P]);
  const since = (n: number) => P.filter((p) => p.lastOpen && p.lastOpen >= addDays(today, -n) && p.lastOpen <= today).length;
  const d1 = since(0);
  const d7 = since(6);
  const d30 = since(29);
  const tot = P.length;
  const groups = useMemo(() => {
    const m = new Map<string, Record<St, number> & { n: number }>();
    for (const p of P) {
      const k = by === 'mgr' ? (p.mgr ? c.nameOf(p.mgr) : 'No manager') : p[by];
      const row = m.get(k) ?? { n: 0, act: 0, quiet: 0, never: 0 };
      row.n += 1;
      row[stOf(p)] += 1;
      m.set(k, row);
    }
    return [...m.entries()].sort((a, b) => a[1].act / a[1].n - b[1].act / b[1].n || b[1].n - a[1].n);
  }, [P, by, c]);
  const list = G[st];
  const tracked = c.summary.trackingSince;
  return (
    <Card title="Active and inactive" note="Everyone falls in one of three groups for the dates you picked">
      {c.untracked ? (
        <p className="ua-muted" style={{ margin: '0 0 6px', fontSize: 13 }}>
          {tracked ? `App opens are tracked from ${sd(tracked)}. Pick dates from then to see who was active.` : 'App opens are not tracked yet: they start counting from the first time someone opens the app.'}
        </p>
      ) : (
        <>
          <div className="ua-stbar" role="img" aria-label={(Object.keys(ST) as St[]).map((k) => `${ST[k][0]} ${G[k].length}`).join(', ')}>
            {(Object.keys(ST) as St[]).map((k) => (G[k].length ? <i key={k} style={{ flex: G[k].length, background: ST[k][2] }} title={`${ST[k][0]}: ${G[k].length}`} /> : null))}
          </div>
          <div className="ua-sts">
            {(Object.keys(ST) as St[]).map((k) => (
              <button key={k} type="button" className={`ua-st${st === k ? ' on' : ''}`} style={{ ['--c' as string]: ST[k][2] }} onClick={() => setSt(k)} aria-pressed={st === k}>
                <span><i />{ST[k][0]}</span>
                <b>{G[k].length}</b>
                <small>{pct(G[k].length, tot)} · {ST[k][1]}</small>
              </button>
            ))}
          </div>
        </>
      )}
      <div style={{ marginTop: 16 }}>
        <Kpis items={[
          [`Opened on ${sd(today)}`, d1, pct(d1, tot)],
          [`Opened ${rangeLabel(addDays(today, -6), today)}`, d7, pct(d7, tot)],
          [`Opened ${rangeLabel(addDays(today, -29), today)}`, d30, pct(d30, tot)],
          ['Come back daily', pct(d1, d30), `${sd(today)} ÷ ${rangeLabel(addDays(today, -29), today)}`],
        ]} />
        {tracked && tracked > addDays(today, -29) && <p className="ua-note" style={{ marginTop: -4 }}>Tracking since {sd(tracked)}: the 7- and 30-day counts only cover the days since.</p>}
        {c.summary.estimatedUntil && c.summary.estimatedUntil >= addDays(today, -29) && <p className="ua-note" style={{ marginTop: -4 }}>Days up to {sd(c.summary.estimatedUntil)} are estimated from what people did in the app (punches, requests, posts, games…).</p>}
      </div>
      <WhenPanel from={c.summary.from} to={c.summary.to} load={c.when} />
      <div className="ua-sec">
        <h4>
          By group
          <StatusTabs options={['dept', 'loc', 'mgr']} active={by} onSelect={setBy} labels={{ dept: 'Department', loc: 'Location', mgr: 'Manager' }} />
        </h4>
        <div className="ua-scroll">
          <table className="lk-t" style={L.table}>
            <thead><tr><Th>{by === 'dept' ? 'Department' : by === 'loc' ? 'Location' : 'Manager'}</Th><Th right>People</Th><Th width="38%">Split</Th><Th right>Active</Th><Th right>Inactive</Th></tr></thead>
            <tbody>
              {groups.map(([k, g]) => (
                <tr key={k}>
                  <Td>{k}</Td>
                  <Td right>{g.n}</Td>
                  <Td>
                    <div className="ua-stk" title={(Object.keys(ST) as St[]).map((s) => `${ST[s][0]} ${g[s]}`).join(', ')}>
                      {(Object.keys(ST) as St[]).map((s) => (g[s] ? <i key={s} style={{ flex: g[s], background: ST[s][2] }} /> : null))}
                    </div>
                  </Td>
                  <Td right>{c.untracked ? '—' : pct(g.act, g.n)}</Td>
                  <Td right>{c.untracked ? '—' : g.n - g.act}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {!c.untracked && (
        <div className="ua-sec">
          <h4>{ST[st][0]} · {list.length}<small>Names are shown to HR admins</small></h4>
          <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r)', overflow: 'hidden' }}>
            <PeopleList
              people={list}
              nameOf={c.nameOf}
              cols={[groupCol, lastCol(today)]}
              action={st === 'quiet' ? (shown) => <RemindButton count={shown.length} onClick={() => c.onRemind(shown)} /> : undefined}
            />
          </div>
        </div>
      )}
    </Card>
  );
}

// ── 5. What they use ──────────────────────────────────────────────────────
type UseRow = {
  area: string;
  label: string;
  sub: string;
  can: (p: Person) => boolean;
  did: (p: Person) => boolean;
  /** Groups it does not apply to, and what the cell says instead. */
  na?: Partial<Record<UsageGroup, string>>;
  /** Built from app activity. */
  tracked?: boolean;
  /** A screen opened: only known on tracked days, not on days estimated from app activity. */
  screen?: boolean;
  /** Left out of the pie: it sums rows already in it, or would drown them. */
  noPie?: boolean;
};
const everyone = () => true;
const isManager = (p: Person) => p.reports > 0;
const ROWS: UseRow[] = [
  { area: 'App', label: 'Opened the app', sub: 'Everyone', can: everyone, did: (p) => p.opened, tracked: true, noPie: true },
  { area: 'Feed & fun', label: 'Created a post', sub: 'Everyone', can: everyone, did: (p) => p.post },
  { area: 'Feed & fun', label: 'Took part in a contest', sub: 'Entered, voted or nominated', can: everyone, did: (p) => p.contest },
  { area: 'Feed & fun', label: 'Played a game', sub: 'Everyone', can: everyone, did: (p) => p.game },
  { area: 'Feed & fun', label: 'Played in a tournament', sub: 'A games tournament (Trails, Odd One Out, Speed Poker), Hint Relay or Secret Squad', can: everyone, did: (p) => p.tour },
  { area: 'Attendance', label: 'Punched in on the app', sub: 'People whose shift has them punch on the app', can: (p) => p.group === 'app', did: (p) => p.appPunch, na: { bio: 'Not needed · device punch', present: 'Not needed · no punch' } },
  { area: 'Attendance', label: 'Fixed missed punch on the app', sub: 'People who missed a punch', can: (p) => p.missed, did: (p) => p.fixed, na: { present: 'Not needed · no punch' } },
  { area: 'Leave & requests', label: 'Raised any request', sub: 'Leave, overtime or reimbursement · logged in, with a manager', can: (p) => p.loggedIn && p.hasManager, did: (p) => p.leave || p.ot || p.reimb, noPie: true },
  { area: 'Leave & requests', label: 'Applied for leave', sub: 'Logged in, with a manager', can: (p) => p.loggedIn && p.hasManager, did: (p) => p.leave },
  { area: 'Leave & requests', label: 'Applied for overtime', sub: 'Logged in, and allowed overtime', can: (p) => p.loggedIn && p.otEligible, did: (p) => p.ot },
  { area: 'Leave & requests', label: 'Applied for reimbursement', sub: 'Logged in, with a manager', can: (p) => p.loggedIn && p.hasManager, did: (p) => p.reimb },
  { area: 'Team', label: 'Approved a request from the app', sub: 'Managers · approved or declined a team request on their phone', can: isManager, did: (p) => p.decidedOnApp },
  { area: 'Team', label: 'Sent a review', sub: 'Managers · sent a feedback review', can: isManager, did: (p) => p.review },
  { area: 'Payroll', label: 'Opened their payslips', sub: 'Everyone', can: everyone, did: (p) => p.payslips, tracked: true, screen: true },
  { area: 'Payroll', label: 'Checked salary & tax', sub: 'Everyone', can: everyone, did: (p) => p.payroll, tracked: true, screen: true },
  { area: 'Payroll', label: 'Uploaded investment proofs', sub: 'Everyone', can: everyone, did: (p) => p.proofs },
];

/** One colour per area of the app, from the dashboard's palette. */
const AREA_COLOR: Record<string, string> = {
  'Feed & fun': 'var(--p-purple)',
  Attendance: 'var(--p-green)',
  'Leave & requests': 'var(--p-blue)',
  Team: 'var(--p-orange)',
  Payroll: 'var(--p-yellow)',
};

/**
 * What people do most: every "did it" in the table, added up by area. A slice
 * is a share of all the things people did, not of people, since one person
 * can do several.
 */
function UseDonut({ rows }: { rows: { area: string; label: string; n: number }[] }) {
  const areas = Object.keys(AREA_COLOR).map((area) => {
    const own = rows.filter((r) => r.area === area);
    const n = own.reduce((t, r) => t + r.n, 0);
    const top = own.slice().sort((x, y) => y.n - x.n)[0];
    return { area, n, top: top && top.n ? top.label : '' };
  }).filter((x) => x.n > 0).sort((x, y) => y.n - x.n);
  const total = areas.reduce((t, x) => t + x.n, 0);
  if (!total) return <p className="ua-muted" style={{ margin: 0 }}>Nothing done on the app in these dates yet.</p>;
  const R = 54, W = 16, C = 2 * Math.PI * R;
  let at = 0;
  return (
    <div className="ua-donut">
      <svg viewBox="0 0 140 140" width="150" height="150" role="img" aria-label={`What people do most on the app: ${areas.map((x) => `${x.area} ${pct(x.n, total)}`).join(', ')}`}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--surface-2)" strokeWidth={W} />
        {areas.map((x) => {
          const len = (x.n / total) * C;
          const el = <circle key={x.area} cx="70" cy="70" r={R} fill="none" stroke={AREA_COLOR[x.area]} strokeWidth={W}
            strokeDasharray={`${Math.max(len - 2, 0.5)} ${C}`} strokeDashoffset={-at} transform="rotate(-90 70 70)"><title>{`${x.area}: ${x.n} (${pct(x.n, total)})`}</title></circle>;
          at += len;
          return el;
        })}
        <text x="70" y="68" textAnchor="middle" style={{ fontSize: 22, fontWeight: 600, fill: 'var(--ink)' }}>{total.toLocaleString('en-IN')}</text>
        <text x="70" y="86" textAnchor="middle" style={{ fontSize: 10.5, fill: 'var(--ink-3)' }}>things done</text>
      </svg>
      <ul className="ua-dl">
        {areas.map((x) => (
          <li key={x.area}>
            <i style={{ background: AREA_COLOR[x.area] }} />
            <span><b>{x.area}</b>{x.top && <small>Most: {x.top}</small>}</span>
            <span className="ua-dn">{x.n.toLocaleString('en-IN')}</span>
            <span className="ua-dp">{pct(x.n, total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function UseTab({ c }: { c: TabCtx }) {
  const P = c.people;
  const est = c.summary.estimatedUntil;
  // A screen is only known from tracked days: none in a range that is all estimates.
  const live = (r: UseRow) => !(r.tracked && c.untracked) && !(r.screen && est && c.summary.to <= est);
  const cell = (r: UseRow): ReactNode => {
    if (!live(r)) return <span className="ua-muted">Not tracked</span>;
    const den = P.filter((p) => r.can(p) || r.did(p));
    if (!den.length) return <span className="ua-muted">—</span>;
    const n = den.filter(r.did).length;
    return (
      <div className="ua-uc">
        <div className="ua-track-bar"><i style={{ width: `${(n / den.length) * 100}%` }} /></div>
        <span><b>{n}</b> of {den.length} · {pct(n, den.length)}</span>
      </div>
    );
  };
  const done = ROWS.filter((r) => live(r) && !r.noPie).map((r) => ({ area: r.area, label: r.label, n: P.filter(r.did).length }));
  let last = '';
  return (
    <>
      <Card title="What people do most on the app" note={`Everything people did on the app, by area · ${rangeLabel(c.summary.from, c.summary.to)}`}>
        <UseDonut rows={done} />
        <p className="ua-note">Each slice adds up the people who did each thing in that area, so someone who applied for leave and fixed a missed punch counts in both.</p>
      </Card>
      <Card title="What they use in the app" note={`Out of the people each thing applies to, how many did it · ${rangeLabel(c.summary.from, c.summary.to)} · click a row to see who hasn’t`}>
        <div className="ua-scroll">
          <table className="lk-t ua-use" style={L.table}>
            <thead>
              <tr>
                <Th>What they did</Th>
                <Th>People <small>{P.length}</small></Th>
              </tr>
            </thead>
            <tbody>
              {ROWS.flatMap((r) => {
                const out = [];
                if (r.area !== last) out.push(<tr key={`h|${r.area}`} className="ua-ar"><td colSpan={2} style={L.td}>{r.area}</td></tr>);
                last = r.area;
                const key = `u|${r.label}`;
                const on = c.open === key;
                const missing = live(r) ? P.filter((p) => (r.can(p) || r.did(p)) && !r.did(p)) : [];
                // A row opens who hasn't done it, as the old Active usage rows did.
                out.push(
                  <tr key={r.label} className={missing.length ? 'ua-userow' : undefined} onClick={missing.length ? () => c.toggle(key) : undefined} aria-expanded={missing.length ? on : undefined}>
                    <Td><span style={{ ...L.cellName, display: 'block' }}>{missing.length > 0 && <span className={`ua-chev${on ? ' on' : ''}`} aria-hidden>›</span>}{r.label}</span><span style={{ ...L.cellSub, display: 'block' }}>{r.sub}{r.screen && est && c.summary.from <= est && c.summary.to > est ? ` · counted from ${sd(addDays(est, 1))}` : ''}</span></Td>
                    <Td>{cell(r)}</Td>
                  </tr>,
                );
                if (on && missing.length) out.push(
                  <tr key={`${r.label}|list`}><td colSpan={2} style={{ padding: 0 }}>
                    <PeopleList people={missing} nameOf={c.nameOf} onClose={() => c.toggle(key)}
                      cols={r.label === 'Punched in on the app' ? [lastCol(c.summary.today), ['Face check', (p) => (p.face ? 'Set up' : <span style={L.pill('warn')}><span style={L.pillDot} />Not set up</span>)]] : [lastCol(c.summary.today)]} />
                  </td></tr>,
                );
                return out;
              })}
            </tbody>
          </table>
        </div>
        <p className="ua-note">
          Each row only counts the people it applies to, so overtime is out of people allowed overtime, punching on the app is out of people whose shift has them punch on the app, and the team rows are out of managers (people with reports).
          Opening the app, payslips and salary &amp; tax are counted from when app activity tracking began. A games tournament, Hint Relay and Secret Squad all count as tournaments.
        </p>
      </Card>
    </>
  );
}

