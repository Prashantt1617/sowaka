// The App usage tabs built from one summary: the funnel, requests and
// approvals, active usage, active and inactive, and what they use. Each gets
// the people already narrowed to the department and location picked.
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { UsageGroup, UsageManagerDTO, UsageSummaryDTO } from '../../../../services/engagement-usage';
import { StatusTabs } from '../../../ui';
import { Td, Th } from '../../lookUi';
import * as L from '../../look';
import { Card, Kpis, LastOpened, PeopleList, RatioRow, RemindButton, Who } from './parts';
import { GROUPS, GROUP_COLOR, GROUP_LONG, GROUP_SHORT, addDays, pct, plural, rangeLabel, sd } from './format';
import type { Col, Person } from './parts';
import { WhenPanel } from './trend';

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

// ── 2. Requests and approvals ─────────────────────────────────────────────
const could = (P: Person[], can: (p: Person) => boolean, did: (p: Person) => boolean) => {
  // Anyone who did it could, even if their setup has changed since.
  const den = P.filter((p) => can(p) || did(p));
  const yes = den.filter(did);
  return { den, yes, no: den.filter((p) => !did(p)) };
};

export function RequestsTab({ c }: { c: TabCtx }) {
  const P = c.people;
  const today = c.summary.today;
  const appP = P.filter((p) => p.group === 'app');
  const missed = P.filter((p) => p.missed);
  const fixedN = missed.filter((p) => p.fixed).length;
  const raisedAny = (p: Person) => p.leave || p.ot || p.reimb;
  const any = could(P, (p) => p.loggedIn && p.hasManager, raisedAny);
  const types: [string, string, (p: Person) => boolean, (p: Person) => boolean][] = [
    ['Leave', 'Logged in, with a manager to approve it', (p) => p.loggedIn && p.hasManager, (p) => p.leave],
    ['Overtime', 'Logged in, and their shift, department and profile allow overtime', (p) => p.loggedIn && p.otEligible, (p) => p.ot],
    ['Reimbursement', 'Logged in, with a manager', (p) => p.loggedIn && p.hasManager, (p) => p.reimb],
  ];
  const ids = new Set(P.map((p) => p.id));
  const byId = new Map(c.summary.people.map((p) => [p.id, p]));
  const M = c.summary.managers.filter((m) => ids.has(m.id));
  const tot = M.reduce((s, m) => ({ got: s.got + m.got, app: s.app + m.app, web: s.web + m.web, wait: s.wait + m.wait }), { got: 0, app: 0, web: 0, wait: 0 });
  return (
    <>
      <Card title="Attendance on the app" note="Only people who are meant to use the app for it">
        <RatioRow
          id="r|punch" open={c.open} onToggle={c.toggle} nameOf={c.nameOf}
          label="Punched in on the app" sub="People whose shift has them punch on the app"
          n={appP.filter((p) => p.appPunch).length} d={appP.length} missing={appP.filter((p) => !p.appPunch)}
          cols={[lastCol(today), ['Face check', (p) => (p.face ? 'Set up' : <span style={L.pill('warn')}><span style={L.pillDot} />Not set up</span>)]]}
        />
        <RatioRow
          id="r|corr" open={c.open} onToggle={c.toggle} nameOf={c.nameOf}
          label="Fixed missed punch on the app"
          sub={c.summary.missedKnown ? 'People with a missed punch in these dates, as Reports › Attendance grades them' : 'Missed punches could not be graded for these dates: only people who asked are counted'}
          n={fixedN} d={missed.length} missing={missed.filter((p) => !p.fixed)}
          cols={[groupCol, lastCol(today)]}
        />
      </Card>
      <Card title="Requests raised from the app" note="People who could raise each kind of request, and who did. Every request is raised in the app.">
        <RatioRow id="r|any" open={c.open} onToggle={c.toggle} nameOf={c.nameOf} label="Raised any request" sub="Everyone who has logged in and has a manager"
          n={any.yes.length} d={any.den.length} missing={any.no} cols={[lastCol(today)]} />
        <div className="ua-sub">By type</div>
        {types.map(([t, sub, can, did]) => {
          const r = could(P, can, did);
          return <RatioRow key={t} id={`r|${t}`} open={c.open} onToggle={c.toggle} nameOf={c.nameOf} label={t} sub={sub} n={r.yes.length} d={r.den.length} missing={r.no} cols={[lastCol(today)]} />;
        })}
      </Card>
      <Card title="Approvals from the app" note="Managers with team requests raised in these dates (leave, overtime, attendance fixes), and where they were settled">
        <Kpis items={[
          ['Requests to approve', tot.got, plural(M.length, 'manager')],
          ['Approved or declined on the app', tot.app, pct(tot.app, tot.got)],
          ['On the web dashboard', tot.web, pct(tot.web, tot.got)],
          ['Still waiting', tot.wait, pct(tot.wait, tot.got)],
        ]} />
        {M.length ? (
          <div className="ua-scroll">
            <table className="lk-t" style={L.table}>
              <thead>
                <tr><Th>Manager</Th><Th right>Team</Th><Th right>To approve</Th><Th width="22%">Acted on</Th><Th right>On the app</Th><Th right>On the web</Th><Th right>Waiting</Th></tr>
              </thead>
              <tbody>
                {M.map((m: UsageManagerDTO) => {
                  const p = byId.get(m.id);
                  return (
                    <tr key={m.id}>
                      <Td>{p ? <Who p={p} /> : c.nameOf(m.id)}</Td>
                      <Td right>{p?.reports ?? 0}</Td>
                      <Td right>{m.got}</Td>
                      <Td>
                        <div className="ua-stk" title={`${m.app} on the app, ${m.web} on the web, ${m.wait} waiting`}>
                          {m.app > 0 && <i style={{ flex: m.app, background: 'var(--p-green)' }} />}
                          {m.web > 0 && <i style={{ flex: m.web, background: 'var(--accent)' }} />}
                          {m.wait > 0 && <i style={{ flex: m.wait, background: 'var(--line-2)' }} />}
                        </div>
                      </Td>
                      <Td right>{m.app}</Td>
                      <Td right>{m.web}</Td>
                      <Td right>{m.wait ? <span style={L.pill('warn')}>{m.wait}</span> : 0}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="ua-muted" style={{ margin: 0, fontSize: 13 }}>No team requests were raised in these dates.</p>}
        <div className="ua-legs">
          <span className="ua-leg"><i style={{ background: 'var(--p-green)' }} />On the app</span>
          <span className="ua-leg"><i style={{ background: 'var(--accent)' }} />On the web</span>
          <span className="ua-leg"><i style={{ background: 'var(--line-2)' }} />Waiting</span>
        </div>
        <p className="ua-note">Managers decide from the app; a decision on the web dashboard was made by HR or someone else with dashboard access. Reimbursements are left out: they are only ever decided on the dashboard. Managers are filtered by their own department and location.</p>
      </Card>
    </>
  );
}

// ── 3. Active usage ───────────────────────────────────────────────────────
export function ActiveTab({ c }: { c: TabCtx }) {
  const P = c.people;
  const rows: [string, string, string, (p: Person) => boolean, boolean][] = [
    ['a|open', 'Opened the app', '', (p) => p.opened, c.untracked],
    ['a|game', 'Played a game', 'Tile Up, Scribble, Pool, challenges, or a new best in any other game', (p) => p.game, false],
    ['a|post', 'Posted on the feed', 'A post of their own', (p) => p.post, false],
    ['a|contest', 'Took part in a contest', 'Entered, voted or nominated', (p) => p.contest, false],
    ['a|tour', 'Played in a tournament', 'Cup match, Poker table or Relay', (p) => p.tour, false],
  ];
  return (
    <Card title="Active usage" note="Out of everyone in the filter. Click a row to see who hasn’t.">
      {rows.map(([id, label, sub, did, untracked]) => (
        <RatioRow key={id} id={id} open={c.open} onToggle={c.toggle} nameOf={c.nameOf} label={label} sub={sub || undefined}
          n={P.filter(did).length} d={P.length} missing={P.filter((p) => !did(p))} cols={[lastCol(c.summary.today)]} untracked={untracked} />
      ))}
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
      </div>
      <WhenPanel from={c.summary.from} to={c.summary.to} dept={c.dept} loc={c.loc} />
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
};
const everyone = () => true;
const isManager = (p: Person) => p.reports > 0;
const ROWS: UseRow[] = [
  { area: 'Feed & fun', label: 'Created a post', sub: 'Everyone', can: everyone, did: (p) => p.post },
  { area: 'Feed & fun', label: 'Took part in a contest', sub: 'Entered, voted or nominated', can: everyone, did: (p) => p.contest },
  { area: 'Feed & fun', label: 'Played a game', sub: 'Everyone', can: everyone, did: (p) => p.game },
  { area: 'Attendance', label: 'Punched in on the app', sub: 'People whose shift has them punch on the app', can: (p) => p.group === 'app', did: (p) => p.appPunch, na: { bio: 'Not needed · device punch', present: 'Not needed · no punch' } },
  { area: 'Attendance', label: 'Fixed a missed punch', sub: 'People who missed a punch', can: (p) => p.missed, did: (p) => p.fixed, na: { present: 'Not needed · no punch' } },
  { area: 'Leave & requests', label: 'Applied for leave', sub: 'Logged in, with a manager', can: (p) => p.loggedIn && p.hasManager, did: (p) => p.leave },
  { area: 'Leave & requests', label: 'Applied for overtime', sub: 'Logged in, and allowed overtime', can: (p) => p.loggedIn && p.otEligible, did: (p) => p.ot },
  { area: 'Leave & requests', label: 'Applied for reimbursement', sub: 'Logged in, with a manager', can: (p) => p.loggedIn && p.hasManager, did: (p) => p.reimb },
  { area: 'Team', label: 'Managed their team’s requests', sub: 'Managers · decided a request on the app', can: isManager, did: (p) => p.decidedOnApp },
  { area: 'Team', label: 'Sent a review', sub: 'Managers · sent a feedback review', can: isManager, did: (p) => p.review },
  { area: 'Payroll', label: 'Opened their payslips', sub: 'Everyone', can: everyone, did: (p) => p.payslips, tracked: true },
  { area: 'Payroll', label: 'Checked salary & tax', sub: 'Everyone', can: everyone, did: (p) => p.payroll, tracked: true },
  { area: 'Payroll', label: 'Uploaded investment proofs', sub: 'Everyone', can: everyone, did: (p) => p.proofs },
];

export function UseTab({ c }: { c: TabCtx }) {
  const P = c.people;
  const GS = GROUPS.map((g) => P.filter((p) => p.group === g));
  const cell = (L2: Person[], g: UsageGroup | null, r: UseRow): ReactNode => {
    if (g && r.na?.[g]) return <span className="ua-muted">{r.na[g]}</span>;
    if (r.tracked && c.untracked) return <span className="ua-muted">Not tracked</span>;
    const den = L2.filter((p) => r.can(p) || r.did(p));
    if (!den.length) return <span className="ua-muted">—</span>;
    const n = den.filter(r.did).length;
    return (
      <div className="ua-uc">
        <div className="ua-track-bar"><i style={{ width: `${(n / den.length) * 100}%` }} /></div>
        <span><b>{n}</b> of {den.length} · {pct(n, den.length)}</span>
      </div>
    );
  };
  let last = '';
  return (
    <Card title="What they use in the app" note={`Out of the people each thing applies to, how many did it · ${rangeLabel(c.summary.from, c.summary.to)}`}>
      <div className="ua-scroll">
        <table className="lk-t ua-use" style={L.table}>
          <thead>
            <tr>
              <Th>What they did</Th>
              <Th>Everyone <small>{P.length}</small></Th>
              {GROUPS.map((g, i) => <Th key={g}><span className="ua-gd" style={{ background: GROUP_COLOR[g] }} />{GROUP_LONG[g]} <small>{GS[i].length}</small></Th>)}
            </tr>
          </thead>
          <tbody>
            {ROWS.flatMap((r) => {
              const out = [];
              if (r.area !== last) out.push(<tr key={`h|${r.area}`} className="ua-ar"><td colSpan={5} style={L.td}>{r.area}</td></tr>);
              last = r.area;
              out.push(
                <tr key={r.label}>
                  <Td><span style={{ ...L.cellName, display: 'block' }}>{r.label}</span><span style={{ ...L.cellSub, display: 'block' }}>{r.sub}</span></Td>
                  <Td>{cell(P, null, r)}</Td>
                  {GS.map((L2, i) => <Td key={GROUPS[i]}>{cell(L2, GROUPS[i], r)}</Td>)}
                </tr>,
              );
              return out;
            })}
          </tbody>
        </table>
      </div>
      <p className="ua-note">
        Each row only counts the people it applies to, so overtime is out of people allowed overtime and the team rows are out of managers (people with reports).
        Leave, overtime, reimbursement and missed punches match Requests &amp; approvals. Payslips and salary &amp; tax are counted from when app activity tracking began.
        <b> Punch on the app</b>: the daily punch brings them in. <b>Biometric</b>: they punch on a device and use the app to fix missed punches. <b>Always present</b>: no punch.
      </p>
    </Card>
  );
}

