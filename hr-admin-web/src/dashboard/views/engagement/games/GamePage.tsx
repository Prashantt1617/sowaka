// One game's page: how to play, its leaderboard, its tournaments, analytics,
// and for Hint Relay its teams.
import { useMemo, useState } from 'react';
import { getGameDetail, type GameLine, type GamePerson, type Standing, type Tournament } from '../../../../services/engagement-games';
import { useLoad } from '../../../useLoad';
import { useAuth } from '../../../auth/AuthContext';
import { canOpen } from '../../../access';
import { EmptyRow, ListPending, LoadingFigure, SearchInput } from '../../../ui';
import { IconChevronRight, IconExternal } from '../../../icons';
import * as L from '../../look';
import { GameIcon, accentOf } from './art';
import { PersonCell, PlayAnalytics, cardStyle } from './Analytics';
import { RelayTeams } from './RelayTeams';
import { addDays, dayOf, monthName, shortDate, today, when, type Play } from './when';

type Tab = 'how' | 'lb' | 'tour' | 'an' | 'teams';
const DAY = 86_400;

export function GamePage({
  game, games, people, plays, onBack,
}: {
  game: GameLine;
  games: GameLine[];
  people: GamePerson[];
  /** This game's plays only. */
  plays: Play[];
  onBack: () => void;
}) {
  const [tab, setTab] = useState<Tab>('how');
  const detail = useLoad(() => getGameDetail(game.key), [game.key]);
  const accent = accentOf(game);
  const now = Date.now() / 1000;
  const played30 = useMemo(() => new Set(plays.filter((p) => p[2] >= now - 30 * DAY).map((p) => p[1])).size, [plays, now]);
  const plays12 = useMemo(() => plays.filter((p) => p[2] >= now - 84 * DAY).length, [plays, now]);
  const t = detail.data?.tournaments ?? [];
  const lastT = t.find((x) => x.state === 'done');
  const nextT = [...t].reverse().find((x) => x.state === 'upcoming' || x.state === 'live');
  const top = detail.data?.board.rows[0];
  const isRelay = game.key === 'hint-relay';

  const tabs: [Tab, string][] = [['how', 'How to play'], ['lb', 'Leaderboard'], ['tour', 'Tournaments'], ['an', 'Analytics'], ...(isRelay ? [['teams', 'Teams'] as [Tab, string]] : [])];
  const last30 = `${shortDate(addDays(today(), -29))} – ${shortDate(today())}`;

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <button type="button" className="lk-ghost" style={{ ...L.btnGhost, marginBottom: 12, paddingLeft: 6 }} onClick={onBack}>
        <IconChevronRight size={14} stroke="currentColor" style={{ transform: 'rotate(180deg)' }} />Back to games
      </button>
      <section style={cardStyle}>
        <div className="eg-head">
          <GameIcon game={game} size="xl" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <h1>{game.name}</h1>
              <span style={L.pill(game.liveOnly ? 'info' : 'ok')}><span style={L.pillDot} />{game.liveOnly ? 'On the app when an event is on' : 'On the app'}</span>
              <span style={L.pill('mute')}>{game.kind}</span>
            </div>
            {(game.tagline || game.description) && <div style={{ fontSize: 13.5, color: 'var(--ink-3)', marginTop: 4 }}>{game.tagline || game.description}</div>}
          </div>
        </div>
        <div className="eg-meta">
          <div><small>Played · {last30}</small><b>{played30} {played30 === 1 ? 'person' : 'people'}</b></div>
          <div><small>Plays · last 12 weeks</small><b>{plays12}</b></div>
          <div>
            <small>{detail.data?.board.by === 'best' ? 'Top score' : 'Most points'}</small>
            <b><LoadingFigure state={detail.state}>{top ? `${(detail.data!.board.by === 'best' ? top.best ?? 0 : top.points).toLocaleString('en-IN')} · ${top.name.split(' ')[0]}` : '—'}</LoadingFigure></b>
          </div>
          <div><small>Last tournament</small><b><LoadingFigure state={detail.state}>{lastT ? `${lastT.startsAt ? shortDate(dayOf(Date.parse(lastT.startsAt) / 1000)) : ''} · ${lastT.players} played` : 'None yet'}</LoadingFigure></b></div>
          <div><small>Next tournament</small><b><LoadingFigure state={detail.state}>{nextT ? (nextT.state === 'live' ? `On now · ${nextT.name}` : when(nextT.startsAt)) : 'Not planned'}</LoadingFigure></b></div>
        </div>
      </section>

      <div style={{ ...L.seg, marginBottom: 16 }} role="tablist">
        {tabs.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} style={L.segBtn(tab === k)} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'how' && <HowToPlay game={game} accent={accent} />}
      {tab === 'lb' && (
        <section style={cardStyle}>
          <CardHead title="Leaderboard" note={detail.data?.board.by === 'best'
            ? `${game.name} only · everyone’s best, ${detail.data.board.higherIsBetter ? 'highest' : 'lowest'} first`
            : `${game.name} only · engagement points this game paid`} />
          {detail.state !== 'ready' ? <ListPending state={detail.state} onRetry={detail.retry} rows={6} /> : <Board rows={detail.data!.board} />}
        </section>
      )}
      {tab === 'tour' && (
        <section style={cardStyle}>
          <CardHead title="Tournaments" note={tourNote(game)} />
          {detail.state !== 'ready' ? <ListPending state={detail.state} onRetry={detail.retry} rows={3} avatar={false} /> : <Tournaments list={t} />}
        </section>
      )}
      {tab === 'an' && <PlayAnalytics plays={plays} people={people} games={games} game={game} />}
      {tab === 'teams' && isRelay && <RelayTeams />}
    </div>
  );
}

const tourNote = (game: GameLine) =>
  game.kind === 'Group game'
    ? 'Tables or rooms of players; the best move up'
    : game.kind === 'Live event'
      ? 'Every time it has been run, and what is coming up'
      : 'Knockouts (pairs play, the winner moves up) and timed games on the feed';

function CardHead({ title, note }: { title: string; note?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={L.cardTitle}>{title}</div>
      {note && <div style={L.cardNote}>{note}</div>}
    </div>
  );
}

/** As the app shows it: the game's name, its line and its instructions, one step a line. */
function HowToPlay({ game, accent }: { game: GameLine; accent: string }) {
  const steps = game.instructions.split(/\n+/).map((s) => s.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim()).filter(Boolean);
  const players = game.kind === 'Group game' ? 'A room of colleagues' : game.kind === 'Live event' ? 'Everyone at the event' : '1, or 2 in a challenge';
  const scoring = game.scoring ? `${game.scoring.higherIsBetter ? 'Highest' : 'Lowest'} ${game.scoring.label} wins; your best counts` : 'Points paid when a game ends';
  return (
    <section style={cardStyle}>
      <CardHead title="How to play" note="As it’s shown in the app" />
      <div className="eg-how" style={{ ['--c' as string]: accent }}>
        <div className="eg-phone">
          <div className="eg-ph">
            <GameIcon game={game} size="lg" />
            <b>{game.name.toUpperCase()}</b>
            {game.tagline && <small>{game.tagline}</small>}
          </div>
          {steps.length > 0 ? (
            <ol className="eg-steps">
              {steps.map((s, i) => <li key={i}><i>{i + 1}</i><span>{s}</span></li>)}
            </ol>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)', textAlign: 'center' }}>No how-to-play is stored for this game.</p>
          )}
          <div className="eg-cta">Play now</div>
        </div>
        <div className="eg-facts">
          <div><small>Type</small><b>{game.kind}</b></div>
          <div><small>Players</small><b>{players}</b></div>
          <div><small>Scoring</small><b>{scoring}</b></div>
          {game.kind === 'Solo challenge' && game.scoring?.higherIsBetter !== false && <div><small>Challenges</small><b>Challenge a colleague; the winner takes the points</b></div>}
          {game.kind === 'Group game' && <div><small>Lobby</small><b>Players wait in a room until the host starts</b></div>}
          {game.description && game.description !== game.tagline && <div style={{ gridColumn: '1 / -1' }}><small>About</small><b style={{ fontWeight: 400 }}>{game.description}</b></div>}
        </div>
      </div>
    </section>
  );
}

function Board({ rows: board }: { rows: { by: 'best' | 'points'; label: string; rows: import('../../../../services/engagement-games').BoardRow[] } }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const rows = needle ? board.rows.filter((r) => r.name.toLowerCase().includes(needle) || r.department.toLowerCase().includes(needle)) : board.rows;
  if (!board.rows.length) return <EmptyRow text="Nobody on the board yet. Scores show once people play." />;
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <SearchInput value={q} onChange={setQ} placeholder="Search a name or department" width={280} />
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{board.rows.length} on the board</span>
      </div>
      {rows.length === 0 ? (
        <EmptyRow text="Nobody matches that search." />
      ) : (
        <div>
          {rows.map((r) => {
            const bits = [r.department, r.best !== null && board.by === 'points' ? `best ${r.best.toLocaleString('en-IN')}` : '', r.plays ? `${r.plays} play${r.plays === 1 ? '' : 's'}` : '', r.lastAt ? `last ${when(r.lastAt)}` : ''].filter(Boolean);
            return (
              <div key={r.userId} className={`eg-lr${r.rank <= 3 ? ' top' : ''}`}>
                <span className="eg-rank">#{r.rank}</span>
                <PersonCell person={{ name: r.name }} sub={bits.join(' · ')} />
                <span className="grow" />
                <span className="eg-pts">
                  {board.by === 'best'
                    ? r.best !== null ? `${r.best.toLocaleString('en-IN')} ${board.label}` : '—'
                    : `${r.points.toLocaleString('en-IN')} pts`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

const STATE: Record<Tournament['state'], [string, L.Tone]> = {
  live: ['Live now', 'ok'],
  upcoming: ['Coming up', 'info'],
  done: ['Done', 'mute'],
  cancelled: ['Cancelled', 'bad'],
};

function Tournaments({ list }: { list: Tournament[] }) {
  const { user } = useAuth();
  const tv = canOpen(user, 'cuptv');
  const [open, setOpen] = useState<string | null>(null);
  if (!list.length) return <EmptyRow text="No tournaments for this game yet." />;
  const groups: [string, Tournament[]][] = [
    ['On now', list.filter((x) => x.state === 'live')],
    ['Coming up', list.filter((x) => x.state === 'upcoming').reverse()],
    ['Past', list.filter((x) => x.state === 'done' || x.state === 'cancelled')],
  ];
  // The TV picks its event from the address (?cup=), and opens on it from there.
  const openTv = (id: string) => {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('cup', id);
    window.open(url.toString(), '_blank', 'noopener');
  };
  return (
    <div>
      {groups.filter(([, rows]) => rows.length).map(([label, rows]) => (
        <div key={label}>
          <div className="eg-grp">{label}</div>
          {rows.map((r) => {
            const key = `${r.type}:${r.id}`;
            const d = r.startsAt ? dayOf(Date.parse(r.startsAt) / 1000) : null;
            return (
              <div key={key} className="eg-tr">
                <div className="eg-date">
                  {d ? <><b>{Number(d.slice(8))}</b><small>{monthName(d)}</small></> : <small>—</small>}
                </div>
                <div className="eg-tr-b">
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={L.pill(STATE[r.state][1])}><span style={L.pillDot} />{STATE[r.state][0]}</span>
                    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{r.phase} · {r.format}</span>
                  </span>
                  <b>{r.name}</b>
                  <span className="eg-tr-s">{when(r.startsAt)}{r.endsAt ? ` – ${when(r.endsAt)}` : ''}</span>
                  {r.state !== 'upcoming' && (
                    <div className="eg-tr-st">
                      <span><b>{r.players}</b> {r.type === 'relay' && r.state === 'done' ? 'played' : r.state === 'live' ? 'in it' : 'played'}</span>
                      {r.winner && <span><b>{r.winner}</b> won</span>}
                    </div>
                  )}
                  {open === key && <Standings rows={r.standings} />}
                </div>
                <div className="eg-tr-a">
                  {r.standings.length > 0 && (
                    <button type="button" className="lk-btn" style={L.btnSm} aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>
                      {open === key ? 'Hide standings' : r.state === 'upcoming' && r.type === 'cup' ? 'Entrants' : 'Standings'}
                    </button>
                  )}
                  {r.type === 'cup' && r.tv && tv && (
                    <button type="button" className="lk-btn-p" style={L.btnSmPrimary} onClick={() => openTv(r.id)}>
                      Tournament TV<IconExternal size={13} stroke="currentColor" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Standings({ rows }: { rows: Standing[] }) {
  return (
    <div className="eg-stand">
      {rows.map((s, i) => (
        <div key={`${s.userId ?? s.name}-${i}`} className={`eg-lr${s.place <= 3 ? ' top' : ''}`} style={{ padding: '7px 2px' }}>
          <span className="eg-rank">#{s.place}</span>
          <span className="grow"><b>{s.name}</b></span>
          <span style={{ fontSize: 12.5, color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>{s.detail}</span>
        </div>
      ))}
    </div>
  );
}
