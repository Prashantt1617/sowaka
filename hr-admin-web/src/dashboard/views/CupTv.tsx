// Connect › Diwali Cup TV: the Cup live, for the office screen. The bracket
// from the last eight (and a line for each earlier round), the match on
// stage big — names, seeds, live scores, time left, how the bets split, the
// betting countdown — and the top tipsters. HR can void a result from here
// (the match is played again and every bet on it is refunded).
//
// It polls the same state a Cup page does (`GET /admin/cup/state`), every
// 1.5 s while the tab is visible. Dark arcade, as the Cup itself, inside the
// dashboard's frame; "Full screen" fills the TV with it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, BASE_URL, api, getToken } from '../../services/http';
import { useStore } from '../store';

// —— the state (the Cup page's, as much as the TV draws) ————————————————————

type Status = 'pending' | 'scheduled' | 'betting' | 'open' | 'live' | 'solo' | 'done';
interface Player { userId: string; name: string; seed: number }
interface Match {
  id?: string;
  slot: number;
  label: string;
  status: Status;
  a: Player | null;
  b: Player | null;
  live?: Record<string, number>;
  result?: Record<string, number>;
  winnerId?: string;
  decidedBy?: string;
  bettingEndsAt?: string;
  deadlineAt?: string;
  startAt?: string;
  attempt?: number;
}
interface Round {
  n: number;
  label: string;
  short: string;
  kind: 'parallel' | 'sequential';
  openedAt?: string;
  closedAt?: string;
  byes?: string[];
  matches: Match[];
}
interface Side { stake: number; count: number }
interface CupState {
  serverNow: string;
  version?: number;
  event: {
    id: string;
    name: string;
    phase: 'scheduled' | 'lobby' | 'running' | 'done';
    round: number;
    lobbyAt: string;
    startAt: string;
    topN: number;
    entrantCount?: number;
    roundSec?: number;
    rounds?: Round[];
  } | null;
  entrants?: number;
  me?: { hr?: boolean };
  current?: { matchId: string; kind: 'betting' | 'live' };
  bets?: { onStage?: { matchId: string; a: Side; b: Side; closesAt?: string | null } };
  tipsters?: { userId: string; name: string; won: number; right: number; of: number }[];
  standings?: { userId: string; name: string; seed: number; reached: string; place: number }[];
}

/**
 * The event on the TV: the company's current one (the latest lobby that is
 * on), unless the address names one (`/dashboard?cup=<eventId>`), for when
 * two are on at once, e.g. a rehearsal beside the real one.
 */
function askedEvent(): string | null {
  try {
    const id = new URLSearchParams(window.location.search).get('cup');
    return id && /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * The state, read fresh. Not through `api()`: its reads are kept for 20 s,
 * and a read with a signal counts as a write there (forgetting everything
 * the dashboard has read), which a poll every 1.5 s should not do.
 */
async function readState(signal: AbortSignal): Promise<CupState> {
  const token = getToken();
  const asked = askedEvent();
  const res = await fetch(`${BASE_URL}/admin/cup/${asked ? `${encodeURIComponent(asked)}/state` : 'state'}`, { signal, headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
  const data = (await res.json().catch(() => ({}))) as CupState & { message?: string };
  if (!res.ok) throw new ApiError(res.status, data.message || `Request failed (${res.status})`);
  return data;
}

// —— the look ———————————————————————————————————————————————————————————————

const C = {
  bg: '#15122B',
  panel: '#221C44',
  panel2: '#2A2350',
  yellow: '#F5B82E',
  yellowShadow: '#B9861A',
  coral: '#FF6B57',
  cyan: '#6FD3F2',
  green: '#3DDC97',
  ink: '#F4F1FF',
  ink2: '#B9B2D9',
  a: '#FF8A7A',
  b: '#6FD3F2',
};

const CSS = `
.ctv{--h:'Lilita One',system-ui,sans-serif;background-color:${C.bg};background-image:radial-gradient(rgba(255,255,255,.06) 1px,transparent 1px);background-size:18px 18px;color:${C.ink};font-family:'Plus Jakarta Sans',system-ui,sans-serif;border-radius:24px;padding:24px;min-height:calc(100vh - 160px);box-sizing:border-box;display:flex;flex-direction:column;gap:20px}
.ctv:fullscreen{border-radius:0;min-height:100vh;padding:36px 44px;overflow:auto}
.ctv *{box-sizing:border-box}
.ctv button{font:inherit;color:inherit;cursor:pointer}
.ctv-top{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.ctv-wm{font-family:var(--h);font-size:34px;letter-spacing:.5px;color:${C.yellow};line-height:1}
.ctv-sub{font-size:14px;font-weight:700;color:${C.ink2};flex:1;min-width:160px}
.ctv-pill{align-self:flex-start;display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:800;letter-spacing:1px;border-radius:99px;padding:6px 12px;white-space:nowrap}
.ctv-pill i{width:8px;height:8px;border-radius:50%;background:currentColor}
.ctv-ghost{border:0;background:${C.panel2};border-radius:14px;padding:10px 14px;font-size:13px;font-weight:800}
.ctv-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:20px;align-items:start}
@media (max-width:1100px){.ctv-grid{grid-template-columns:minmax(0,1fr)}}
.ctv-col{display:flex;flex-direction:column;gap:20px;min-width:0}
.ctv-panel{background:${C.panel};border-radius:24px;padding:22px}
.ctv-h{font-family:var(--h);font-size:20px;letter-spacing:.5px;margin:0 0 14px;font-weight:400}
.ctv-stage{display:flex;flex-direction:column;gap:20px}
.ctv-stagehead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.ctv-timer{font-family:var(--h);font-size:64px;line-height:1;text-align:right}
.ctv-timer small{display:block;font-family:'Plus Jakarta Sans',system-ui,sans-serif;font-size:12px;font-weight:800;letter-spacing:1px;color:${C.ink2}}
.ctv-row{display:flex;flex-direction:column;gap:10px}
.ctv-who{display:flex;align-items:center;gap:14px;min-width:0}
.ctv-av{width:64px;height:64px;border-radius:50%;display:grid;place-items:center;font-family:var(--h);font-size:24px;color:${C.bg};flex:none}
.ctv-nm{font-weight:800;font-size:28px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ctv-seed{font-size:13px;font-weight:800;letter-spacing:.5px;background:${C.panel2};color:${C.ink2};border-radius:99px;padding:4px 10px;margin-left:10px;vertical-align:5px}
.ctv-won{font-size:12px;font-weight:800;letter-spacing:1px;background:${C.green};color:${C.bg};border-radius:99px;padding:4px 10px;margin-left:8px;vertical-align:5px}
.ctv-sc{font-family:var(--h);font-size:56px;line-height:1}
.ctv-bar{height:20px;border-radius:99px;background:${C.bg};overflow:hidden}
.ctv-bar i{display:block;height:100%;border-radius:99px;transition:width .6s ease}
.ctv-lead{font-size:16px;font-weight:700;color:${C.green};text-align:center}
.ctv-split{display:flex;flex-direction:column;gap:10px;background:#2E2652;border:3px solid ${C.yellow};border-radius:22px;padding:18px}
.ctv-split small{font-size:12px;font-weight:800;letter-spacing:1px;color:${C.ink2}}
.ctv-splitbar{display:flex;height:26px;border-radius:99px;overflow:hidden;background:${C.bg}}
.ctv-splitbar i{display:block;height:100%;transition:width .6s ease}
.ctv-splitrow{display:flex;justify-content:space-between;gap:12px;font-weight:800;font-size:15px}
.ctv-splitrow b{font-family:var(--h);font-weight:400;font-size:26px;display:block}
.ctv-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.ctv-st{background:${C.panel2};border-radius:18px;padding:14px;display:flex;flex-direction:column;gap:4px}
.ctv-st b{font-family:var(--h);font-size:28px;font-weight:400}
.ctv-st span{font-size:12px;font-weight:700;color:${C.ink2}}
.ctv-void{align-self:flex-start;border:2px solid ${C.coral};background:transparent;color:${C.coral};border-radius:14px;padding:10px 16px;font-size:14px;font-weight:800}
.ctv-bracket{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;align-items:center}
.ctv-bcol{display:flex;flex-direction:column;gap:10px;justify-content:space-around;height:100%}
.ctv-bcol h4{margin:0;font-size:11px;font-weight:800;letter-spacing:1px;color:${C.ink2};text-align:center}
.ctv-bm{background:${C.panel2};border-radius:14px;padding:8px 10px;display:flex;flex-direction:column;gap:4px;border:2px solid transparent;text-align:left;width:100%}
.ctv-bm.on{border-color:${C.yellow}}
.ctv-bm.hr{cursor:pointer}
.ctv-bp{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;min-width:0}
.ctv-bp span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ctv-bp em{font-style:normal;font-size:10px;color:${C.ink2};font-weight:800}
.ctv-bp b{font-family:var(--h);font-weight:400;font-size:14px}
.ctv-bp.out{opacity:.45}
.ctv-bp.win span{color:${C.green}}
.ctv-tips{display:flex;flex-direction:column;gap:8px}
.ctv-tip{display:flex;align-items:center;gap:12px;background:${C.panel2};border-radius:16px;padding:10px 14px}
.ctv-rank{font-family:var(--h);font-size:22px;width:28px;text-align:center;color:${C.yellow}}
.ctv-tip .tx{flex:1;min-width:0;display:flex;flex-direction:column}
.ctv-tip .tx span{font-weight:800;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ctv-tip .tx small{font-size:12px;font-weight:700;color:${C.ink2}}
.ctv-tip b{font-family:var(--h);font-weight:400;font-size:22px}
.ctv-rounds{display:flex;gap:10px;flex-wrap:wrap}
.ctv-rd{background:${C.panel2};border-radius:14px;padding:10px 14px;display:flex;flex-direction:column;gap:2px;flex:1 1 110px}
.ctv-rd b{font-family:var(--h);font-weight:400;font-size:18px}
.ctv-rd span{font-size:12px;font-weight:700;color:${C.ink2}}
.ctv-empty{color:${C.ink2};font-size:15px;font-weight:700;text-align:center;padding:24px 0}
.ctv-big{font-family:var(--h);font-size:44px;line-height:1.05;text-align:center;margin:30px 0 8px}
.ctv-veil{position:fixed;inset:0;background:rgba(10,8,24,.72);display:grid;place-items:center;z-index:50;padding:16px}
.ctv-dialog{background:${C.panel};color:${C.ink};border-radius:24px;padding:24px;max-width:440px;width:100%;display:flex;flex-direction:column;gap:14px;font-family:'Plus Jakarta Sans',system-ui,sans-serif}
.ctv-dialog h3{font-family:'Lilita One',system-ui,sans-serif;font-weight:400;font-size:26px;margin:0}
.ctv-dialog p{margin:0;color:${C.ink2};font-size:14px;line-height:1.5}
.ctv-actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}
.ctv-yellow{border:0;background:${C.yellow};color:${C.bg};border-radius:14px;padding:12px 18px;font-size:14px;font-weight:800;box-shadow:0 4px 0 ${C.yellowShadow}}
.ctv-danger{border:0;background:${C.coral};color:${C.bg};border-radius:14px;padding:12px 18px;font-size:14px;font-weight:800;box-shadow:0 4px 0 #B8443A}
.ctv-err{color:${C.coral};font-size:13px;font-weight:700}
`;

const FONTS = 'https://fonts.googleapis.com/css2?family=Lilita+One&family=Plus+Jakarta+Sans:wght@500;700;800&display=swap';

function useCupFonts() {
  useEffect(() => {
    if (document.querySelector(`link[href="${FONTS}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONTS;
    document.head.appendChild(link);
  }, []);
}

// —— small helpers ——————————————————————————————————————————————————————————

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
const firstName = (name: string) => name.split(/\s+/)[0] || name;
const ms = (iso?: string | null) => (iso ? new Date(iso).getTime() : Number.NaN);

function clock(msLeft: number): string {
  const s = Math.max(0, Math.ceil(msLeft / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const scoreOf = (m: Match, p: Player | null) => (p ? m.result?.[p.userId] ?? m.live?.[p.userId] ?? 0 : 0);

const STATUS_PILL: Record<Status, { text: string; bg: string; fg: string }> = {
  pending: { text: 'UP NEXT', bg: C.panel2, fg: C.ink2 },
  scheduled: { text: 'UP NEXT', bg: C.cyan, fg: C.bg },
  betting: { text: 'BETS OPEN', bg: C.yellow, fg: C.bg },
  open: { text: 'PLAYERS JOINING', bg: C.cyan, fg: C.bg },
  live: { text: 'LIVE', bg: C.coral, fg: C.bg },
  solo: { text: 'LIVE · ONE PLAYER', bg: C.coral, fg: C.bg },
  done: { text: 'RESULT', bg: C.green, fg: C.bg },
};

/** The match the TV puts on stage: the engine's current one, else the last decided top-8 match, else the next to come. */
function stageOf(state: CupState): { match: Match; round: Round } | null {
  const rounds = state.event?.rounds ?? [];
  const top = rounds.filter((r) => r.kind === 'sequential');
  const all = top.flatMap((round) => round.matches.map((match) => ({ match, round })));
  if (state.current) {
    const on = all.find((x) => x.match.id === state.current!.matchId);
    if (on) return on;
  }
  const active = all.find((x) => ['betting', 'open', 'live', 'solo'].includes(x.match.status));
  if (active) return active;
  const done = all.filter((x) => x.match.status === 'done');
  if (done.length) return done[done.length - 1]!;
  return all.find((x) => x.match.status === 'scheduled') ?? null;
}

// —— the page ———————————————————————————————————————————————————————————————

export function CupTv() {
  useCupFonts();
  const { flash } = useStore();
  const [state, setState] = useState<CupState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [confirming, setConfirming] = useState<Match | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // The poll: a fresh read each time (the signal keeps it out of the dashboard's read cache).
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let ctrl: AbortController | null = null;
    const poll = async () => {
      ctrl = new AbortController();
      try {
        const next = await readState(ctrl.signal);
        if (stopped) return;
        setState(next);
        setSkew(ms(next.serverNow) - Date.now());
        setError(null);
      } catch (e) {
        if (stopped || (e instanceof DOMException && e.name === 'AbortError')) return;
        setError(e instanceof ApiError ? e.message : 'The Cup could not be reached');
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return;
      }
      if (!stopped) timer = window.setTimeout(poll, document.hidden ? 4000 : 1500);
    };
    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      ctrl?.abort();
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const serverNow = now + skew;
  const stage = useMemo(() => (state ? stageOf(state) : null), [state]);
  const hr = state?.me?.hr === true;

  const fullScreen = useCallback(() => {
    const el = root.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => undefined);
  }, []);

  const doVoid = async (match: Match) => {
    if (!match.id) return;
    try {
      await api(`/admin/cup/matches/${encodeURIComponent(match.id)}/void`, { method: 'POST', body: {} });
      flash(`${match.label} voided: it will be played again, and its bets refunded`);
      setConfirming(null);
    } catch (e) {
      throw e instanceof ApiError ? e : new Error('Could not void that result');
    }
  };

  const event = state?.event ?? null;
  const rounds = event?.rounds ?? [];
  const sequential = rounds.filter((r) => r.kind === 'sequential');
  const earlier = rounds.filter((r) => r.kind === 'parallel');
  const entrants = event?.entrantCount ?? state?.entrants;

  return (
    <div ref={root} className="ctv" data-testid="cup-tv">
      <style>{CSS}</style>
      <header className="ctv-top">
        <span className="ctv-wm">DIWALI CUP</span>
        <span className="ctv-sub">
          {event ? subtitle(event, entrants, serverNow) : 'Odd One Out, company-wide'}
        </span>
        {error && <span className="ctv-err" role="status">{error}</span>}
        <button type="button" className="ctv-ghost" onClick={fullScreen}>Full screen</button>
      </header>

      {!state && !error && <div className="ctv-empty">Loading the tournament…</div>}
      {state && !event && (
        <div className="ctv-panel">
          <div className="ctv-big">The tournament is not on</div>
          <div className="ctv-empty">When the tournament is switched on, its bracket and the match on stage show here.</div>
        </div>
      )}

      {event && (
        <div className="ctv-grid">
          <div className="ctv-col">
            {stage ? (
              <Stage
                match={stage.match}
                round={stage.round}
                split={state?.bets?.onStage?.matchId === stage.match.id ? state?.bets?.onStage : undefined}
                serverNow={serverNow}
                roundSec={event.roundSec ?? 45}
                onVoid={hr && stage.match.id && ['live', 'solo', 'done'].includes(stage.match.status) ? () => setConfirming(stage.match) : undefined}
              />
            ) : (
              <div className="ctv-panel">
                <div className="ctv-big">
                  {event.phase === 'scheduled' || event.phase === 'lobby' ? 'Starting soon' : event.phase === 'done' ? 'The Cup is over' : `On the way to the last ${event.topN}`}
                </div>
                <div className="ctv-empty">
                  {event.phase === 'scheduled' || event.phase === 'lobby'
                    ? `Round 1 starts at ${new Date(event.startAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}.`
                    : event.phase === 'done'
                      ? 'Thanks for playing.'
                      : `From the last ${event.topN}, one match at a time, with bets. The rounds before play all at once.`}
                </div>
              </div>
            )}
            {earlier.length > 0 && (
              <section className="ctv-panel" aria-label="Earlier rounds">
                <h2 className="ctv-h">Earlier rounds</h2>
                <div className="ctv-rounds">
                  {earlier.map((r) => <RoundChip key={r.n} round={r} />)}
                </div>
              </section>
            )}
          </div>
          <div className="ctv-col">
            {event.phase === 'done' && state?.standings?.length ? <Standings rows={state.standings} /> : null}
            <section className="ctv-panel" aria-label="The last eight">
              <h2 className="ctv-h">The last {event.topN}</h2>
              {sequential.length ? (
                <Bracket rounds={sequential} onStageId={stage?.match.id} onPick={hr ? (m) => setConfirming(m) : undefined} />
              ) : (
                <div className="ctv-empty">The bracket fills in as the tournament gets there.</div>
              )}
            </section>
            <section className="ctv-panel" aria-label="Top tipsters">
              <h2 className="ctv-h">Top tipsters</h2>
              <Tipsters rows={state?.tipsters ?? []} />
            </section>
          </div>
        </div>
      )}

      {confirming && <VoidDialog match={confirming} onCancel={() => setConfirming(null)} onConfirm={() => doVoid(confirming)} />}
    </div>
  );
}

function subtitle(event: NonNullable<CupState['event']>, entrants: number | undefined, serverNow: number): string {
  const people = entrants ? `${fmt(entrants)} players` : '';
  switch (event.phase) {
    case 'scheduled':
      return [people, `Lobby opens in ${clock(ms(event.lobbyAt) - serverNow)}`].filter(Boolean).join(' · ');
    case 'lobby':
      return [people, `Round 1 in ${clock(ms(event.startAt) - serverNow)}`].filter(Boolean).join(' · ');
    case 'done':
      return [people, 'The Cup is over'].filter(Boolean).join(' · ');
    default: {
      const r = event.rounds?.find((x) => x.n === event.round);
      return [people, r ? r.label : `Round ${event.round}`].filter(Boolean).join(' · ');
    }
  }
}

// —— the match on stage ————————————————————————————————————————————————————

function Stage({ match, round, split, serverNow, roundSec, onVoid }: {
  match: Match;
  round: Round;
  split?: { a: Side; b: Side; closesAt?: string | null };
  serverNow: number;
  roundSec: number;
  onVoid?: () => void;
}) {
  const pill = STATUS_PILL[match.status];
  const sa = scoreOf(match, match.a);
  const sb = scoreOf(match, match.b);
  const top = Math.max(sa, sb, 1);
  const width = (s: number) => `${Math.max(2, Math.min(100, (s / top) * 88))}%`;
  const start = ms(match.startAt);
  const timer = (() => {
    if (match.status === 'betting') return { label: 'BETS CLOSE IN', text: clock(ms(split?.closesAt ?? match.bettingEndsAt) - serverNow) };
    if (match.status === 'open') return { label: 'START WINDOW', text: clock(ms(match.deadlineAt) - serverNow) };
    if ((match.status === 'live' || match.status === 'solo') && Number.isFinite(start)) {
      if (serverNow < start) return { label: 'STARTS IN', text: String(Math.max(1, Math.ceil((start - serverNow) / 1000))) };
      return { label: 'LEFT', text: clock(start + roundSec * 1000 - serverNow) };
    }
    return null;
  })();
  const leader = sa === sb ? null : sa > sb ? match.a : match.b;
  // Scores only once there is a game: not in the betting lobby or the start window.
  const scored = match.status === 'live' || match.status === 'solo' || match.status === 'done';
  const decided = match.status === 'done';
  const lead = (() => {
    if (!match.a || !match.b) return '';
    if (decided) {
      const w = match.winnerId === match.a.userId ? match.a : match.winnerId === match.b.userId ? match.b : null;
      if (!w) return '';
      const how = match.decidedBy === 'absent' ? ' (neither played: the better seed goes through)' : match.decidedBy === 'solo' ? ' (the other player did not show)' : '';
      return `${firstName(w.name)} ${round.short === 'F' ? 'wins the tournament' : 'goes through'}${how}`;
    }
    if (match.status !== 'live' && match.status !== 'solo') return '';
    if (!leader) return sa === 0 ? 'Get ready…' : `Level on ${fmt(sa)}`;
    return `${firstName(leader.name)} leads by ${fmt(Math.abs(sa - sb))}`;
  })();
  const totalStake = (split?.a.stake ?? 0) + (split?.b.stake ?? 0);
  const totalPeople = (split?.a.count ?? 0) + (split?.b.count ?? 0);
  const share = totalStake > 0 ? ((split?.a.stake ?? 0) / totalStake) * 100 : 50;

  return (
    <section className="ctv-panel ctv-stage" aria-label="The match on stage">
      <div className="ctv-stagehead">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="ctv-pill" style={{ background: pill.bg, color: pill.fg }}>
            {(match.status === 'live' || match.status === 'solo') && <i aria-hidden="true" />}
            {pill.text}
          </span>
          <span style={{ fontFamily: "'Lilita One',system-ui,sans-serif", fontSize: 30 }}>
            {round.label === match.label ? match.label : `${round.label} · ${match.label}`}{match.attempt ? ` · replay ${match.attempt}` : ''}
          </span>
        </div>
        {timer && (
          <div className="ctv-timer" aria-live="off">
            <small>{timer.label}</small>
            {timer.text}
          </div>
        )}
      </div>

      {[match.a, match.b].map((p, i) => {
        const colour = i === 0 ? C.a : C.b;
        const s = i === 0 ? sa : sb;
        const won = decided && p && match.winnerId === p.userId;
        return (
          <div className="ctv-row" key={i}>
            <div className="ctv-who">
              <span className="ctv-av" style={{ background: colour }}>{p ? initials(p.name) : '?'}</span>
              <span className="ctv-nm">
                {p ? p.name : 'To be decided'}
                {p && <span className="ctv-seed">#{p.seed}</span>}
                {won && <span className="ctv-won">THROUGH</span>}
              </span>
              <span className="ctv-sc" style={{ color: colour }}>{p && scored ? fmt(s) : ''}</span>
            </div>
            {scored && (
              <div className="ctv-bar" role="img" aria-label={p ? `${p.name} ${fmt(s)}` : 'No player yet'}>
                <i style={{ width: p && (s > 0 || decided) ? width(s) : '0%', background: colour }} />
              </div>
            )}
          </div>
        );
      })}
      {lead && <span className="ctv-lead">{lead}</span>}

      {split && match.a && match.b && totalPeople === 0 && (
        <div className="ctv-split" aria-label="Bets">
          <small>{match.status === 'betting' ? 'BETS ARE OPEN' : 'BETS ON THIS MATCH'}</small>
          <span style={{ fontWeight: 800, fontSize: 18 }}>
            {match.status === 'betting' ? 'No bets yet. Open the tournament in the app to back a player: a right pick pays double.' : 'Nobody bet on this match.'}
          </span>
        </div>
      )}
      {split && match.a && match.b && totalPeople > 0 && (
        <div className="ctv-split" aria-label="How the bets split">
          <small>{match.status === 'betting' ? 'BETS SO FAR' : 'BETS ON THIS MATCH'}</small>
          <div className="ctv-splitbar" role="img" aria-label={`${fmt(split.a.stake)} points on ${match.a.name}, ${fmt(split.b.stake)} on ${match.b.name}`}>
            <i style={{ width: `${share}%`, background: C.a }} />
            <i style={{ width: `${100 - share}%`, background: C.b }} />
          </div>
          <div className="ctv-splitrow">
            <span style={{ color: C.a }}>
              <b>{fmt(split.a.stake)} pts</b>
              {firstName(match.a.name)} · {split.a.count} {split.a.count === 1 ? 'person' : 'people'}
            </span>
            <span style={{ color: C.b, textAlign: 'right' }}>
              <b>{fmt(split.b.stake)} pts</b>
              {firstName(match.b.name)} · {split.b.count} {split.b.count === 1 ? 'person' : 'people'}
            </span>
          </div>
        </div>
      )}
      {split && totalPeople > 0 && (
        <div className="ctv-stats">
          <div className="ctv-st"><b>{fmt(totalStake)}</b><span>points riding</span></div>
          <div className="ctv-st"><b>{fmt(totalPeople)}</b><span>{totalPeople === 1 ? 'person has bet' : 'people have bet'}</span></div>
          <div className="ctv-st"><b>2×</b><span>a right pick pays</span></div>
        </div>
      )}
      {onVoid && (
        <button type="button" className="ctv-void" onClick={onVoid}>Void result</button>
      )}
    </section>
  );
}

// —— the bracket ——————————————————————————————————————————————————————————

function Bracket({ rounds, onStageId, onPick }: { rounds: Round[]; onStageId?: string; onPick?: (m: Match) => void }) {
  return (
    <div className="ctv-bracket" style={{ gridTemplateColumns: `repeat(${rounds.length}, minmax(0,1fr))` }}>
      {rounds.map((r) => (
        <div className="ctv-bcol" key={r.n}>
          <h4>{r.short === 'F' ? 'FINAL' : r.label.toUpperCase()}</h4>
          {r.matches.map((m) => {
            const voidable = !!onPick && !!m.id && ['live', 'solo', 'done'].includes(m.status);
            const body = (
              <>
                {[m.a, m.b].map((p, i) => {
                  const out = m.status === 'done' && p && m.winnerId && m.winnerId !== p.userId;
                  const win = m.status === 'done' && p && m.winnerId === p.userId;
                  const s = scoreOf(m, p);
                  return (
                    <div key={i} className={`ctv-bp${out ? ' out' : ''}${win ? ' win' : ''}`}>
                      <em>{p ? `#${p.seed}` : ''}</em>
                      <span>{p ? p.name : '—'}</span>
                      {p && m.status !== 'pending' && m.status !== 'scheduled' && m.status !== 'betting' && <b>{fmt(s)}</b>}
                    </div>
                  );
                })}
              </>
            );
            const cls = `ctv-bm${m.id && m.id === onStageId ? ' on' : ''}${voidable ? ' hr' : ''}`;
            return voidable ? (
              <button key={m.slot} type="button" className={cls} title={`Void ${m.label}`} onClick={() => onPick!(m)}>{body}</button>
            ) : (
              <div key={m.slot} className={cls}>{body}</div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function RoundChip({ round }: { round: Round }) {
  const total = round.matches.length;
  const done = round.matches.filter((m) => m.status === 'done').length;
  const byes = round.byes?.length ?? 0;
  const state = round.closedAt || (total > 0 && done === total) ? 'done' : round.openedAt ? `${done}/${total} decided` : 'to come';
  return (
    <div className="ctv-rd">
      <b>{round.label}</b>
      <span>{fmt(total)} {total === 1 ? 'match' : 'matches'}{byes ? ` · ${byes} free ${byes === 1 ? 'pass' : 'passes'}` : ''}</span>
      <span style={{ color: state === 'done' ? C.green : state === 'to come' ? C.ink2 : C.yellow }}>{state}</span>
    </div>
  );
}

function Tipsters({ rows }: { rows: NonNullable<CupState['tipsters']> }) {
  if (!rows.length) return <div className="ctv-empty">Bets settle as each top-8 match ends. The best tipsters show here.</div>;
  return (
    <div className="ctv-tips">
      {rows.slice(0, 6).map((t, i) => (
        <div className="ctv-tip" key={t.userId}>
          <span className="ctv-rank">{i + 1}</span>
          <div className="tx">
            <span>{t.name}</span>
            <small>{t.right} right of {t.of}</small>
          </div>
          <b style={{ color: t.won > 0 ? C.green : t.won < 0 ? C.coral : C.ink }}>{t.won > 0 ? '+' : ''}{fmt(t.won)}</b>
        </div>
      ))}
    </div>
  );
}

function Standings({ rows }: { rows: NonNullable<CupState['standings']> }) {
  const champ = rows.find((r) => r.place === 1);
  return (
    <section className="ctv-panel" aria-label="Final standings">
      {champ && <div className="ctv-big" style={{ color: C.yellow, marginTop: 6 }}>{champ.name} wins the tournament!</div>}
      <div className="ctv-tips">
        {rows.filter((r) => r.place > 1).slice(0, 7).map((r) => (
          <div className="ctv-tip" key={r.userId}>
            <span className="ctv-rank">{r.place}</span>
            <div className="tx"><span>{r.name}</span><small>{r.reached} · seed #{r.seed}</small></div>
          </div>
        ))}
      </div>
    </section>
  );
}

// —— HR's void ————————————————————————————————————————————————————————————

function VoidDialog({ match, onCancel, onConfirm }: { match: Match; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const names = match.a && match.b ? `${match.a.name} v ${match.b.name}` : match.label;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);
  return (
    <div className="ctv-veil" role="dialog" aria-modal="true" aria-labelledby="ctv-void-title" onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div className="ctv-dialog">
        <h3 id="ctv-void-title">Void {match.label}?</h3>
        <p>
          {names}{match.status === 'done' ? ' has a result.' : ' is being played.'} Voiding it throws the result out:
          the match is played again from the start, and every bet on it gets its stake back (a win already paid is taken back).
        </p>
        {err && <span className="ctv-err" role="alert">{err}</span>}
        <div className="ctv-actions">
          <button type="button" className="ctv-ghost" onClick={onCancel} disabled={busy}>Keep the result</button>
          <button
            type="button"
            className="ctv-danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try { await onConfirm(); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not void that result'); setBusy(false); }
            }}
          >
            {busy ? 'Voiding…' : 'Void and replay'}
          </button>
        </div>
      </div>
    </div>
  );
}
