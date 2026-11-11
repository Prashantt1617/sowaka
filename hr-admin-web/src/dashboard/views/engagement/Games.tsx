// Dashboard › Engagement › Games: the games on the app in the app's order,
// who plays them and when, the org board, and a page per game (how to play,
// leaderboard, tournaments with the Tournament TV, analytics, relay teams).
// Read only: which games a company has is set by Sowaka, not from here.
import { useMemo, useState } from 'react';
import { getGamesOverview, type GameLine } from '../../../services/engagement-games';
import { useLoad } from '../../useLoad';
import { Card, EmptyRow, LoadError, SearchInput, SkeletonCards, SkeletonRows, SummaryCard } from '../../ui';
import { IconChevronRight } from '../../icons';
import * as L from '../look';
import '../look.css';
import './games/games.css';
import { GameIcon } from './games/art';
import { PersonCell, PlayAnalytics, cardStyle } from './games/Analytics';
import { GamePage } from './games/GamePage';
import { addDays, shortDate, today, type Play } from './games/when';

type Tab = 'games' | 'an' | 'lb';
const DAY = 86_400;

export function Games() {
  const load = useLoad(getGamesOverview, []);
  const [tab, setTab] = useState<Tab>('games');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const data = load.data;

  const plays = (data?.plays ?? []) as Play[];
  const people = data?.people ?? [];
  const games = data?.games ?? [];
  const stats = useMemo(() => {
    const now = Date.now() / 1000;
    const m30 = now - 30 * DAY;
    const first = new Map<string, number>();
    const perGame = games.map(() => ({ recent: new Set<number>(), fresh: 0 }));
    const anyone = new Set<number>();
    for (const p of plays) {
      const k = `${p[0]}|${p[1]}`;
      if (!first.has(k)) first.set(k, p[2]);
      if (p[2] >= m30) {
        perGame[p[0]]?.recent.add(p[1]);
        if (!people[p[1]]?.left) anyone.add(p[1]);
      }
    }
    for (const [k, at] of first) if (at >= m30) perGame[Number(k.split('|')[0])].fresh += 1;
    return { perGame, anyone: anyone.size, everyone: people.filter((p) => !p.left).length };
  }, [plays, people, games]);

  if (load.state === 'error') return <Card><LoadError text="The games could not be loaded." onRetry={load.retry} /></Card>;
  if (load.state === 'loading' || !data) {
    return (
      <div>
        <SkeletonCards count={4} style={{ marginBottom: 20 }} />
        <Card><SkeletonRows rows={6} cols={2} /></Card>
      </div>
    );
  }

  const open = openKey ? games.find((g) => g.key === openKey) : null;
  if (open) {
    const gi = games.indexOf(open);
    return (
      <GamePage
        key={open.key}
        game={open}
        games={games}
        people={people}
        plays={plays.filter((p) => p[0] === gi)}
        onBack={() => setOpenKey(null)}
      />
    );
  }

  const now = today();
  const last30 = `${shortDate(addDays(now, -29))} – ${shortDate(now)}`;
  const board = [...data.board].sort((a, b) => b[1] - a[1]);
  const lead = board[0] ? people[board[0][0]] : null;
  const upcoming = games.reduce((n, g) => n + g.tournamentsOpen, 0);
  const playingPct = stats.everyone ? Math.round((stats.anyone / stats.everyone) * 100) : 0;

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16, marginBottom: 20 }}>
        <SummaryCard label="Games on the app" value={games.length} sub={games.some((g) => g.liveOnly) ? `${games.filter((g) => g.liveOnly).length} only during events` : undefined} />
        <SummaryCard label="People who played" value={`${playingPct}%`} sub={`${stats.anyone} of ${stats.everyone} · ${last30}`} />
        <SummaryCard label="Tournaments on or coming up" value={upcoming} />
        <SummaryCard label="Leads the org board" value={lead ? lead.name.split(' ')[0] : '—'} sub={lead ? `${board[0][1].toLocaleString('en-IN')} pts from games` : 'Nobody has game points yet'} />
      </div>

      <div style={{ ...L.seg, marginBottom: 16 }} role="tablist" aria-label="Section">
        {([['games', 'Games'], ['an', 'Analytics'], ['lb', 'Org leaderboard']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} style={L.segBtn(tab === k)} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'games' && (
        <section style={cardStyle}>
          <div style={{ marginBottom: 8 }}>
            <div style={L.cardTitle}>Games on the app</div>
            <div style={L.cardNote}>In the order employees see them. Open a game for how to play, its leaderboard, tournaments and who’s playing.</div>
          </div>
          {games.length === 0 ? (
            <EmptyRow text="Your company has no games on the app yet." />
          ) : (
            games.map((g, i) => <GameRow key={g.key} game={g} played={stats.perGame[i]?.recent.size ?? 0} fresh={stats.perGame[i]?.fresh ?? 0} last30={last30} onOpen={() => setOpenKey(g.key)} />)
          )}
        </section>
      )}
      {tab === 'an' && <PlayAnalytics plays={plays} people={people} games={games} />}
      {tab === 'lb' && <OrgBoard board={board} people={data.people} plays={plays} />}
    </div>
  );
}

function GameRow({ game, played, fresh, last30, onOpen }: { game: GameLine; played: number; fresh: number; last30: string; onOpen: () => void }) {
  return (
    <div className="eg-row">
      <button type="button" className="eg-open" onClick={onOpen} aria-label={`Open ${game.name}`}>
        <GameIcon game={game} />
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span className="eg-kind">{game.kind}{game.liveOnly ? ' · on the app while an event is on' : ''}</span>
          <span className="eg-name">{game.name}</span>
          <span className="eg-sub">
            <em className="eg-badge" style={{ fontStyle: 'normal' }}>{played} played</em>
            <span>· {last30}</span>
            {fresh > 0 && <span>· {fresh} new</span>}
            {game.tournaments > 0 && <span>· {game.tournaments} tournament{game.tournaments === 1 ? '' : 's'}</span>}
          </span>
        </span>
      </button>
      <button type="button" className="lk-btn" style={L.btnSm} onClick={onOpen}>Open<IconChevronRight size={13} stroke="currentColor" /></button>
    </div>
  );
}

/** One score across every game: the engagement points games paid each person. */
function OrgBoard({ board, people, plays }: { board: [number, number][]; people: import('../../../services/engagement-games').GamePerson[]; plays: Play[] }) {
  const [q, setQ] = useState('');
  const gamesOf = useMemo(() => {
    const m = new Map<number, Set<number>>();
    for (const p of plays) {
      let s = m.get(p[1]);
      if (!s) m.set(p[1], (s = new Set()));
      s.add(p[0]);
    }
    return m;
  }, [plays]);
  const ranked = useMemo(() => {
    let place = 0;
    return board.map(([i, pts], n) => {
      if (n === 0 || board[n - 1][1] !== pts) place = n + 1;
      return { person: people[i], i, pts, place };
    });
  }, [board, people]);
  const needle = q.trim().toLowerCase();
  const rows = needle ? ranked.filter((r) => r.person.name.toLowerCase().includes(needle)) : ranked;
  return (
    <section style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <div style={L.cardTitle}>Org leaderboard</div>
          <div style={L.cardNote}>One score across every game: the engagement points games have paid each person</div>
        </div>
        {ranked.length > 0 && <SearchInput value={q} onChange={setQ} placeholder="Search a name" width={240} />}
      </div>
      {ranked.length === 0 ? (
        <EmptyRow text="Nobody has points from games yet." />
      ) : rows.length === 0 ? (
        <EmptyRow text="Nobody matches that search." />
      ) : (
        rows.map((r) => {
          const n = gamesOf.get(r.i)?.size ?? 0;
          return (
            <div key={r.person.id} className={`eg-lr${r.place <= 3 ? ' top' : ''}`}>
              <span className="eg-rank">#{r.place}</span>
              <PersonCell person={r.person} sub={[r.person.department, n ? `${n} game${n === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')} />
              <span className="grow" />
              <span className="eg-pts">{r.pts.toLocaleString('en-IN')} pts</span>
            </div>
          );
        })
      )}
    </section>
  );
}
