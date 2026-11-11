// Who's playing, who isn't, and when: for every game together or for one.
import { useMemo, useState } from 'react';
import type { GameLine, GamePerson } from '../../../../services/engagement-games';
import { Avatar, SearchInput, SelectBox } from '../../../ui';
import { LookTable, Td, Th } from '../../lookUi';
import * as L from '../../look';
import { IconDownload } from '../../../icons';
import { downloadCsv } from '../../../export';
import { CARD, CARD_PAD } from '../../../ds';
import { GameIcon, accentOf } from './art';
import {
  addDays, busiest, byDay, byHour, byMonth, byWeek, dayOf, rangeLabel, shortDate, today, when,
  type Bar, type Play,
} from './when';

const DAY = 86_400;
const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : '0%');

// ---------------------------------------------------------------- when people play

type WhenView = 'time' | 'date' | 'week' | 'month';
const VIEWS: [WhenView, string][] = [['time', 'Time-wise'], ['date', 'Date-wise'], ['week', 'Week-wise'], ['month', 'Month-wise']];
const DEFAULT_BACK: Record<Exclude<WhenView, 'month'>, number> = { time: -6, date: -13, week: -55 };
const QUICK: Record<Exclude<WhenView, 'month'>, [string, number][]> = {
  time: [['Today', 0], ['Last 7 days', -6], ['Last 30 days', -29]],
  date: [['Last 7 days', -6], ['Last 14 days', -13], ['Last 30 days', -29]],
  week: [['Last 4 weeks', -27], ['Last 8 weeks', -55], ['Last 12 weeks', -83]],
};
const HINT: Record<WhenView, string> = {
  time: 'People playing in each hour, added up across the dates',
  date: 'People playing each day',
  week: 'People playing each week (a person counts once a week)',
  month: 'People playing each month (a person counts once a month) · this month so far',
};

export function WhenPanel({ plays, label }: { plays: Play[]; label: string }) {
  const [view, setView] = useState<WhenView | null>(null);
  const [ranges, setRanges] = useState<Partial<Record<WhenView, [string, string]>>>({});
  const now = today();
  const range: [string, string] | null =
    view && view !== 'month' ? ranges[view] ?? [addDays(now, DEFAULT_BACK[view]), now] : null;
  const setRange = (r: [string, string]) => view && setRanges((s) => ({ ...s, [view]: r }));

  if (!view) {
    return (
      <div className="eg-when">
        <div className="eg-when-h">
          <div>
            <h4 className="eg-h4" style={{ margin: 0 }}>When people play</h4>
            <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{busiest(plays)}</span>
          </div>
          <button type="button" className="lk-btn" style={L.btnSm} onClick={() => setView('time')}>Expand</button>
        </div>
      </div>
    );
  }
  const bars: Bar[] =
    view === 'month' ? byMonth(plays) : view === 'time' ? byHour(plays, range![0], range![1]) : view === 'date' ? byDay(plays, range![0], range![1]) : byWeek(plays, range![0], range![1]);
  const max = Math.max(1, ...bars.map((b) => b.value));
  const total = view === 'month' ? null : bars.reduce((s, b) => s + b.value, 0);
  return (
    <div className="eg-when">
      <div className="eg-when-h">
        <div>
          <h4 className="eg-h4" style={{ margin: 0 }}>When people play <small>{label}</small></h4>
          <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{HINT[view]}{total != null ? ` · ${total} in total` : ''}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={L.seg} role="tablist" aria-label="View">
            {VIEWS.map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={view === k} style={L.segBtn(view === k)} onClick={() => setView(k)}>{l}</button>
            ))}
          </div>
          <button type="button" className="lk-ghost" style={L.btnGhost} onClick={() => setView(null)}>Collapse</button>
        </div>
      </div>
      {range && view !== 'month' && (
        <div className="eg-nav">
          <label>From<input type="date" value={range[0]} max={range[1]} aria-label="From date" onChange={(e) => e.target.value && e.target.value <= range[1] && setRange([e.target.value, range[1]])} /></label>
          <label>To<input type="date" value={range[1]} min={range[0]} max={now} aria-label="To date" onChange={(e) => e.target.value && e.target.value >= range[0] && e.target.value <= now && setRange([range[0], e.target.value])} /></label>
          <span className="eg-quick">
            {QUICK[view].map(([l, n]) => {
              const on = range[0] === addDays(now, n) && range[1] === now;
              return <button key={l} type="button" style={{ ...L.chip(on), height: 32 }} onClick={() => setRange([addDays(now, n), now])}>{l}</button>;
            })}
          </span>
        </div>
      )}
      <div className="eg-bars" role="img" aria-label={`When people play, ${VIEWS.find((v) => v[0] === view)![1]}`}>
        {bars.map((b) => (
          <div key={b.key} className={`eg-b${b.value === 0 ? ' zero' : ''}${b.weekend ? ' wkend' : ''}${b.current ? ' cur' : ''}`} title={b.title}>
            <i style={{ height: `${Math.round((b.value / max) * 100)}%` }} />
            <span>{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the figures

interface PersonStats {
  person: GamePerson;
  plays: number;
  plays12: number;
  first: number;
  last: number;
  games: Set<number>;
}

type Who = 'playing' | 'lapsed' | 'never';

/** Every person's plays, from the plays given (one game's or all of them). */
function statsOf(plays: Play[], people: GamePerson[]) {
  const now = Date.now() / 1000;
  const m30 = now - 30 * DAY;
  const w12 = now - 84 * DAY;
  const per = new Map<number, PersonStats>();
  for (const p of plays) {
    let s = per.get(p[1]);
    if (!s) per.set(p[1], (s = { person: people[p[1]], plays: 0, plays12: 0, first: p[2], last: p[2], games: new Set() }));
    s.plays += 1;
    if (p[2] >= w12) s.plays12 += 1;
    if (p[2] < s.first) s.first = p[2];
    if (p[2] > s.last) s.last = p[2];
    s.games.add(p[0]);
  }
  const here = people.map((person, i) => ({ person, i })).filter((x) => !x.person.left);
  const playing: PersonStats[] = [];
  const lapsed: PersonStats[] = [];
  const never: GamePerson[] = [];
  for (const { person, i } of here) {
    const s = per.get(i);
    if (!s) never.push(person);
    else if (s.last >= m30) playing.push(s);
    else lapsed.push(s);
  }
  const fresh = playing.filter((s) => s.first >= m30).length;
  const plays12 = plays.filter((p) => p[2] >= w12).length;
  return { per, playing, lapsed, never, fresh, plays12, everyone: here.length, m30 };
}

function Kpis({ items }: { items: [string, string | number, string?][] }) {
  return (
    <div className="eg-kpi">
      {items.map(([l, v, s]) => (
        <div key={l} className="eg-k">
          <span>{l}</span>
          <b>{v}</b>
          {s && <small>{s}</small>}
        </div>
      ))}
    </div>
  );
}

/** A share-per-group bar list, least-played group first. */
function GroupShare({ title, people, playingIds, field, accent }: { title: string; people: GamePerson[]; playingIds: Set<string>; field: 'department' | 'location'; accent: string }) {
  const groups = new Map<string, { n: number; p: number }>();
  for (const person of people) {
    if (person.left) continue;
    const k = person[field] || 'Not set';
    const g = groups.get(k) ?? { n: 0, p: 0 };
    g.n += 1;
    if (playingIds.has(person.id)) g.p += 1;
    groups.set(k, g);
  }
  const rows = [...groups].sort((a, b) => a[1].p / a[1].n - b[1].p / b[1].n || b[1].n - a[1].n);
  if (rows.length <= 1 && rows[0]?.[0] === 'Not set') return null;
  return (
    <div>
      <h4 className="eg-h4">{title} <small>share who played, last 30 days</small></h4>
      {rows.map(([k, v]) => (
        <div key={k} className="eg-brk">
          <span className="lb" title={k}>{k}</span>
          <div className="bar"><i style={{ width: `${v.n ? (v.p / v.n) * 100 : 0}%`, background: accent }} /></div>
          <span className="r">{v.p}/{v.n} · {pct(v.p, v.n)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The Analytics card. `games` is the line-up when this is every game (for
 * "most played" and games per player); one game's page passes `game`.
 */
export function PlayAnalytics({
  plays, people, games, game,
}: {
  plays: Play[];
  people: GamePerson[];
  games: GameLine[];
  game?: GameLine;
}) {
  const s = useMemo(() => statsOf(plays, people), [plays, people]);
  const [who, setWho] = useState<Who>('playing');
  const [dept, setDept] = useState('All');
  const [q, setQ] = useState('');
  const [more, setMore] = useState(false);
  const accent = game ? accentOf(game) : 'var(--accent)';
  const now = today();
  const last30 = rangeLabel(addDays(now, -29), now);
  const playingIds = useMemo(() => new Set(s.playing.map((x) => x.person.id)), [s]);
  const since = plays.length ? dayOf(plays[0][2]) : null;

  const kpis: [string, string | number, string?][] = game
    ? [
        [`Played · ${last30}`, s.playing.length, `${pct(s.playing.length, s.everyone)} of everyone`],
        ['Plays · last 12 weeks', s.plays12],
        ['New players · last 30 days', s.fresh, 'first play on record'],
        ['Played before, stopped', s.lapsed.length, `no play since ${shortDate(addDays(now, -29))}`],
        ['Never played', s.never.length],
      ]
    : [
        [`Played · ${last30}`, s.playing.length, `${pct(s.playing.length, s.everyone)} of everyone`],
        ['Plays · last 12 weeks', s.plays12],
        ['Games per player', s.per.size ? ([...s.per.values()].reduce((n, x) => n + x.games.size, 0) / s.per.size).toFixed(1) : '0', `of ${games.length} on the app`],
        ['Played before, stopped', s.lapsed.length, `no play since ${shortDate(addDays(now, -29))}`],
        ['Never played any game', s.never.length],
      ];

  // Most played, every game together: people who played each in the last 30 days.
  const byGame = useMemo(() => {
    if (game) return [];
    return games
      .map((g, gi) => {
        const ids = new Set<number>();
        let n = 0;
        for (const p of plays) if (p[0] === gi && p[2] >= s.m30) { ids.add(p[1]); n += 1; }
        return { g, people: ids.size, plays: n };
      })
      .sort((a, b) => b.people - a.people || b.plays - a.plays);
  }, [game, games, plays, s.m30]);
  const gameMax = Math.max(1, ...byGame.map((x) => x.people));

  const depts = useMemo(() => [...new Set(people.filter((p) => !p.left).map((p) => p.department).filter(Boolean))].sort(), [people]);
  const needle = q.trim().toLowerCase();
  const keep = (p: GamePerson) => (dept === 'All' || p.department === dept) && (!needle || p.name.toLowerCase().includes(needle));
  const statRows = (who === 'playing' ? [...s.playing].sort((a, b) => b.plays - a.plays) : [...s.lapsed].sort((a, b) => b.last - a.last)).filter((x) => keep(x.person));
  const neverRows = s.never.filter(keep).sort((a, b) => a.name.localeCompare(b.name));
  const count = who === 'never' ? neverRows.length : statRows.length;

  const exportCsv = () => {
    const rows = [
      ...[...s.per.values()].filter((x) => !x.person.left),
      ...s.never.map((person) => ({ person, plays: 0, plays12: 0, first: 0, last: 0, games: new Set<number>() })),
    ];
    downloadCsv(`${game ? game.key : 'games'}-players.csv`, [
      { header: 'Person', value: (r) => r.person.name },
      { header: 'Department', value: (r) => r.person.department },
      { header: 'Location', value: (r) => r.person.location },
      { header: 'Manager', value: (r) => r.person.manager },
      ...(game ? [] : [{ header: 'Games played', value: (r: (typeof rows)[number]) => r.games.size }]),
      { header: 'Plays (all on record)', value: (r) => r.plays },
      { header: 'Plays (12 weeks)', value: (r) => r.plays12 },
      { header: 'Last played', value: (r) => (r.last ? new Date(r.last * 1000).toISOString() : '') },
    ], rows);
  };

  return (
    <section style={{ ...cardStyle }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={L.cardTitle}>{game ? 'Analytics' : 'Analytics · all games'}</div>
          <div style={L.cardNote}>
            Who’s playing, who isn’t{game ? ', and when' : ', and what they play'}
            {since ? ` · plays on record since ${shortDate(since, true)}` : ''}
          </div>
        </div>
        <button type="button" className="lk-btn" style={L.btnSm} onClick={exportCsv}><IconDownload size={14} stroke="currentColor" />Export</button>
      </div>
      <Kpis items={kpis} />
      <WhenPanel plays={plays} label={game ? game.name : 'all games'} />
      <div className="eg-an2">
        {!game ? (
          <div>
            <h4 className="eg-h4">Most played <small>people who played, {last30}</small></h4>
            {byGame.map((x) => (
              <div key={x.g.key} className="eg-brk">
                <span className="lb" title={x.g.name}><GameIcon game={x.g} size="xs" />{x.g.name}</span>
                <div className="bar"><i style={{ width: `${(x.people / gameMax) * 100}%`, background: accentOf(x.g) }} /></div>
                <span className="r">{x.people} · {x.plays} play{x.plays === 1 ? '' : 's'}</span>
              </div>
            ))}
          </div>
        ) : (
          <GroupShare title="By location" people={people} playingIds={playingIds} field="location" accent={accent} />
        )}
        <GroupShare title={game ? 'By department' : 'Who isn’t playing, by department'} people={people} playingIds={playingIds} field="department" accent={accent} />
      </div>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
        <h4 className="eg-h4">People <small>Names are shown to HR admins</small></h4>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <div style={L.seg} role="tablist" aria-label="People">
            {([['playing', `Playing · ${s.playing.length}`], ['lapsed', `Stopped · ${s.lapsed.length}`], ['never', `Never played · ${s.never.length}`]] as [Who, string][]).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={who === k} style={L.segBtn(who === k)} onClick={() => { setWho(k); setMore(false); }}>{l}</button>
            ))}
          </div>
          {depts.length > 0 && (
            <SelectBox value={dept} onChange={setDept}>
              <option value="All">All departments</option>
              {depts.map((d) => <option key={d} value={d}>{d}</option>)}
            </SelectBox>
          )}
          <SearchInput value={q} onChange={setQ} placeholder="Search a name" width={220} />
        </div>
        {count === 0 ? (
          <p style={{ color: 'var(--ink-3)', fontSize: 13, margin: '6px 0 0' }}>Nobody matches these filters.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <LookTable>
                <thead>
                  <tr>
                    <Th>Person</Th>
                    <Th>Manager</Th>
                    {who === 'never' ? <Th>Department</Th> : (
                      <>
                        {!game && <Th right>Games</Th>}
                        <Th right>Plays</Th>
                        <Th>Last played</Th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {who === 'never'
                    ? (more ? neverRows : neverRows.slice(0, 10)).map((p) => (
                        <tr key={p.id}>
                          <Td><PersonCell person={p} /></Td>
                          <Td muted>{p.manager || '—'}</Td>
                          <Td muted>{p.department || '—'}</Td>
                        </tr>
                      ))
                    : (more ? statRows : statRows.slice(0, 10)).map((r) => (
                        <tr key={r.person.id}>
                          <Td><PersonCell person={r.person} /></Td>
                          <Td muted>{r.person.manager || '—'}</Td>
                          {!game && <Td right>{r.games.size}</Td>}
                          <Td right>{r.plays}</Td>
                          <Td muted>{when(new Date(r.last * 1000).toISOString())}</Td>
                        </tr>
                      ))}
                </tbody>
              </LookTable>
            </div>
            {count > 10 && (
              <div style={{ marginTop: 10 }}>
                <button type="button" className="lk-ghost" style={L.btnGhost} onClick={() => setMore((m) => !m)}>{more ? 'Show fewer' : `Show all ${count}`}</button>
              </div>
            )}
          </>
        )}
        <p style={{ ...L.cardNote, marginTop: 14 }}>
          A play is a finished room game or challenge, a new best score, a tournament match or table, or a round of a live event. A solo round that didn’t beat someone’s best isn’t kept, so it isn’t counted.
        </p>
      </div>
    </section>
  );
}

export function PersonCell({ person, sub }: { person: { name: string; department?: string; location?: string }; sub?: string }) {
  const line = sub ?? [person.department, person.location].filter(Boolean).join(' · ');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Avatar name={person.name} size={30} font={12} />
      <div style={{ minWidth: 0 }}>
        <div style={L.cellName}>{person.name}</div>
        {line && <div style={L.cellSub}>{line}</div>}
      </div>
    </div>
  );
}

export const cardStyle = { ...CARD, padding: CARD_PAD, marginBottom: 20 } as const;
