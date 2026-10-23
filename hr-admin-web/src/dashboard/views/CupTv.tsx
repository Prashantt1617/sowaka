// Connect › Tournament TV: the tournament live, for the office screen. The bracket
// from the last eight (and a line for each earlier round), the match on
// stage big — names, seeds, live scores, time left, how the bets split, the
// betting countdown — and the top tipsters. HR can void a result from here
// (the match is played again and every bet on it is refunded).
//
// It polls the same state a Cup page does (`GET /admin/cup/state`), every
// 1.5 s while the tab is visible. Dark arcade, as the Cup itself, inside the
// dashboard's frame; "Full screen" fills the TV with it.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ApiError, BASE_URL, api, getToken } from '../../services/http';
import { useStore } from '../store';
import { boardAt } from './cupBoards';

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
  /** Where each player is in the match's boards (live/solo matches, when their page reports it). */
  liveBoard?: Record<string, LiveBoard>;
  /** The match's board seed, sent with liveBoard. */
  boardSeed?: number;
  result?: Record<string, number>;
  winnerId?: string;
  decidedBy?: string;
  bettingEndsAt?: string;
  deadlineAt?: string;
  startAt?: string;
  attempt?: number;
}
interface LiveBoard { board: number; tap?: number; ok?: boolean }
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
.ctv.stream{border-radius:0;min-height:100vh;padding:22px 40px 26px;gap:16px}
.ctv.stream .ctv-wm{font-size:40px}
.ctv.stream .ctv-sub{font-size:20px}
.ctv a.ctv-ghost{text-decoration:none;color:${C.ink}}
.ctv-ghost.dim{opacity:.3;transition:opacity .2s}
.ctv-ghost.dim:hover,.ctv-ghost.dim:focus-visible{opacity:1}
.cs-duel{flex:1;display:flex;flex-direction:column;gap:18px;background:${C.panel};border-radius:28px;padding:22px 32px 30px;min-height:0}
.cs-head{display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.cs-head .ctv-pill{align-self:center;font-size:15px;padding:8px 14px}
.cs-label{font-family:var(--h);font-size:38px;line-height:1}
.cs-kick{font-size:15px;font-weight:800;letter-spacing:1.2px;color:${C.yellow}}
.cs-row{flex:1;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:64px;align-items:center}
.cs-side{display:flex;flex-direction:column;align-items:center;gap:16px;min-width:0}
.cs-who{display:flex;align-items:center;gap:16px;width:100%;min-width:0}
.cs-side.b .cs-who{flex-direction:row-reverse;text-align:right}
.cs-who .ctv-av{width:72px;height:72px;font-size:28px}
.cs-nm{flex:1;min-width:0;font-weight:800;font-size:38px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cs-sc{font-family:var(--h);font-size:80px;line-height:1;font-variant-numeric:tabular-nums}
.cs-side.lead .ctv-board{box-shadow:0 6px 0 #0C0A1C,0 0 40px -4px var(--pc)}
.cs-bl{font-size:20px;font-weight:800;letter-spacing:1px;color:${C.ink2};margin-top:6px}
.cs-bl b{color:${C.ink}}
.cs-noboard{display:grid;place-items:center;border:3px dashed ${C.panel2};border-radius:28px;font-family:var(--h);font-size:96px;color:var(--pc)}
.cs-mid{display:flex;flex-direction:column;align-items:center;gap:22px;text-align:center;width:260px}
.cs-timer{font-family:var(--h);font-size:110px;line-height:1;font-variant-numeric:tabular-nums}
.cs-timer small{display:block;font-family:'Plus Jakarta Sans',system-ui,sans-serif;font-size:16px;font-weight:800;letter-spacing:1.5px;color:${C.ink2};margin-bottom:6px}
.cs-vs{font-family:var(--h);font-size:40px;color:${C.ink2};line-height:1}
.cs-lead{font-size:24px;font-weight:800;color:${C.green}}
.cs-bets{width:100%;display:flex;flex-direction:column;gap:8px;background:#2E2652;border:3px solid ${C.yellow};border-radius:20px;padding:14px}
.cs-bets small{font-size:13px;font-weight:800;letter-spacing:1px;color:${C.ink2}}
.cs-betrow{display:flex;justify-content:space-between;font-family:var(--h);font-size:24px}
.ctv.stream .cs-between{flex:1;align-items:center}
.ctv.stream .cs-between .ctv-nm{font-size:42px}
.ctv.stream .cs-between .ctv-av{width:84px;height:84px;font-size:30px}
.ctv.stream .cs-between .ctv-sc{font-size:76px}
.ctv.stream .cs-between .ctv-timer{font-size:96px}
.ctv.stream .ctv-bp{font-size:17px}
.ctv.stream .ctv-bp b{font-size:18px}
.ctv.stream .ctv-h{font-size:26px}
@media (max-height:800px){
  .ctv.stream{padding:14px 28px 18px;gap:10px}
  .ctv.stream .ctv-wm{font-size:28px}.ctv.stream .ctv-sub{font-size:16px}
  .cs-duel{padding:16px 24px 20px;gap:12px}.cs-label{font-size:28px}
  .cs-row{gap:48px}.cs-mid{width:200px;gap:14px}
  .cs-who .ctv-av{width:52px;height:52px;font-size:20px}.cs-nm{font-size:26px}.cs-sc{font-size:56px}
  .cs-timer{font-size:76px}.cs-vs{font-size:30px}.cs-lead{font-size:18px}.cs-bl{font-size:15px}
}
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
.ctv-live{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;max-height:62vh;overflow-y:auto;padding-right:4px}
.ctv-livecount{display:flex;gap:16px;font-size:14px;font-weight:800;color:${C.ink2};margin:-6px 0 14px}
.ctv-lt{display:flex;justify-content:space-between;font-size:11px;font-weight:800;letter-spacing:.6px;color:${C.ink2};margin-bottom:6px}
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
.ctv-boards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;align-items:start}
.ctv-bside{display:flex;flex-direction:column;align-items:center;gap:12px;min-width:0}
.ctv-bside .ctv-who{width:100%}
.ctv-bside .ctv-nm{font-size:22px}
.ctv-bside .ctv-av{width:48px;height:48px;font-size:18px}
.ctv-bside .ctv-sc{font-size:46px}
.ctv-bside.lead .ctv-board{box-shadow:0 5px 0 #0C0A1C,0 0 26px -4px var(--pc)}
.ctv-board{--w:300px;--n:2;position:relative;width:var(--w);height:var(--w);padding:calc(var(--w)*.035);border-radius:calc(var(--w)*.09);background:${C.bg};border:3px solid var(--pc);box-shadow:0 5px 0 #0C0A1C;box-sizing:content-box!important;flex:none}
.ctv-board .g{display:grid;grid-template-columns:repeat(var(--n),1fr);grid-auto-rows:1fr;gap:calc(var(--w)/var(--n)*.08);width:100%;height:100%}
.ctv-board .c{display:grid;place-items:center;border-radius:calc(var(--w)/var(--n)*.2);background:${C.panel};box-shadow:0 calc(var(--w)/var(--n)*.05) 0 #0C0A1C;font-size:calc(var(--w)/var(--n)*.56);line-height:1;overflow:hidden;min-width:0;min-height:0}
.ctv-board .c i{font-style:normal;display:block}
.ctv-board .c.flip i{transform:scaleX(-1)}
.ctv-board .c.no{background:${C.coral};animation:ctv-no .6s ease-out}
.ctv-board.ok::after{content:"";position:absolute;inset:-3px;border-radius:inherit;box-shadow:0 0 0 4px ${C.green},0 0 30px ${C.green};opacity:0;animation:ctv-ok .9s ease-out;pointer-events:none}
.ctv-board .num{position:absolute;right:8%;bottom:0;transform:translateY(50%);padding:2px 9px;border-radius:99px;background:var(--pc);color:${C.bg};font-family:var(--h);font-size:max(11px,calc(var(--w)*.07))}
.ctv-bwait{display:grid;place-items:center;text-align:center;border:3px dashed ${C.panel2};border-radius:22px;color:${C.ink2};font-weight:800;font-size:13px;padding:8px}
.ctv-bm.watch{cursor:pointer}
.ctv-bm.watch:hover,.ctv-bm.watch:focus-visible{border-color:${C.cyan};outline:none}
.ctv-minib{display:grid;grid-template-columns:1fr 1fr;gap:8px;justify-items:center;margin:4px 0 8px}
.ctv-focus{background:${C.panel};color:${C.ink};border-radius:28px;padding:26px;max-width:900px;width:100%;display:flex;flex-direction:column;gap:22px;font-family:'Plus Jakarta Sans',system-ui,sans-serif;max-height:96vh;overflow:auto}
@keyframes ctv-ok{0%{opacity:1}100%{opacity:0}}
@keyframes ctv-no{0%{transform:scale(1.15)}100%{transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.ctv-board .c.no,.ctv-board.ok::after{animation:none}}
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
  // A match of a parallel round opened big from "live now" (by slot, so it follows the polls).
  const [watching, setWatching] = useState<number | null>(null);
  const onWatch = useCallback((m: Match) => setWatching(m.slot), []);
  const closeWatch = useCallback(() => setWatching(null), []);
  const [stream] = useState(streamMode);
  // Stream mode before the last eight: the live match it features (by slot), kept while it is played.
  const [featuredSlot, setFeaturedSlot] = useState<number | null>(null);
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
  const current = rounds.find((r) => r.n === event?.round);
  const entrants = event?.entrantCount ?? state?.entrants;
  const roundSec = event?.roundSec ?? 45;
  const stageSplit = stage && state?.bets?.onStage?.matchId === stage.match.id ? state?.bets?.onStage : undefined;
  const parallel = !stage && current?.kind === 'parallel' ? current : null;
  const featured = stream && parallel ? featuredOf(parallel.matches, featuredSlot) : null;
  useEffect(() => {
    const slot = featured ? featured.slot : null;
    if (slot !== featuredSlot) setFeaturedSlot(slot);
  }, [featured, featuredSlot]);
  const onAir = !stream || !event
    ? null
    : stage
      ? (isLive(stage.match) ? { match: stage.match, round: stage.round, kicker: undefined } : null)
      : parallel && featured
        ? { match: featured, round: parallel, kicker: `FEATURED · ${fmt(parallel.matches.filter(isLive).length)} LIVE` }
        : null;
  const bracketPanel = event && (
    <section className="ctv-panel" aria-label="The last eight">
      <h2 className="ctv-h">The last {event.topN}</h2>
      {sequential.length ? (
        <Bracket rounds={sequential} onStageId={stage?.match.id} onPick={hr && !stream ? (m) => setConfirming(m) : undefined} />
      ) : (
        <div className="ctv-empty">The bracket fills in as the tournament gets there.</div>
      )}
    </section>
  );

  return (
    <div ref={root} className={`ctv${stream ? ' stream' : ''}`} data-testid="cup-tv">
      <style>{CSS}</style>
      <header className="ctv-top">
        <span className="ctv-wm">{(event?.name || 'O-O-O Tournament').toUpperCase()}</span>
        <span className="ctv-sub">
          {event ? subtitle(event, entrants, serverNow) : 'Odd One Out, company-wide'}
        </span>
        {error && <span className="ctv-err" role="status">{error}</span>}
        {stream ? (
          <a className="ctv-ghost dim" href={streamUrl(false)}>Exit stream view</a>
        ) : (
          <a className="ctv-ghost" href={streamUrl(true)} target="_blank" rel="noreferrer" title="The TV alone and big, for a stream or a screen share">Stream view</a>
        )}
        <button type="button" className={`ctv-ghost${stream ? ' dim' : ''}`} onClick={fullScreen}>Full screen</button>
      </header>

      {!state && !error && <div className="ctv-empty">Loading the tournament…</div>}
      {state && !event && (
        <div className="ctv-panel">
          <div className="ctv-big">The tournament is not on</div>
          <div className="ctv-empty">When the tournament is switched on, its bracket and the match on stage show here.</div>
        </div>
      )}

      {event && stream && onAir && (
        <StreamDuel match={onAir.match} round={onAir.round} split={stage && onAir.match === stage.match ? stageSplit : undefined} serverNow={serverNow} roundSec={roundSec} kicker={onAir.kicker} />
      )}
      {event && stream && !onAir && (
        <div className="ctv-grid cs-between">
          <div className="ctv-col">
            {stage ? <Stage match={stage.match} round={stage.round} split={stageSplit} serverNow={serverNow} roundSec={roundSec} /> : <Waiting event={event} />}
            {parallel && <LiveNow round={parallel} onWatch={onWatch} />}
          </div>
          <div className="ctv-col">
            {event.phase === 'done' && state?.standings?.length ? <Standings rows={state.standings} /> : null}
            {bracketPanel}
            {!!state?.tipsters?.length && (
              <section className="ctv-panel" aria-label="Top tipsters">
                <h2 className="ctv-h">Top tipsters</h2>
                <Tipsters rows={state.tipsters} />
              </section>
            )}
          </div>
        </div>
      )}

      {event && !stream && (
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
              <Waiting event={event} />
            )}
            {!stage && current?.kind === 'parallel' && <LiveNow round={current} onWatch={onWatch} />}
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
            {bracketPanel}
            <section className="ctv-panel" aria-label="Top tipsters">
              <h2 className="ctv-h">Top tipsters</h2>
              <Tipsters rows={state?.tipsters ?? []} />
            </section>
          </div>
        </div>
      )}

      {watching != null && event && current?.kind === 'parallel' && (() => {
        const m = current.matches.find((x) => x.slot === watching);
        return m ? <WatchDialog match={m} round={current} serverNow={serverNow} roundSec={event.roundSec ?? 45} onClose={closeWatch} /> : null;
      })()}
      {confirming && <VoidDialog match={confirming} onCancel={() => setConfirming(null)} onConfirm={() => doVoid(confirming)} />}
    </div>
  );
}

/** Before the stage has a match: the tournament starting, on its way to the last eight, or over. */
function Waiting({ event }: { event: NonNullable<CupState['event']> }) {
  return (
        <div className="ctv-panel">
          <div className="ctv-big">
            {event.phase === 'scheduled' || event.phase === 'lobby' ? 'Starting soon' : event.phase === 'done' ? 'The tournament is over' : `On the way to the last ${event.topN}`}
          </div>
          <div className="ctv-empty">
            {event.phase === 'scheduled' || event.phase === 'lobby'
              ? `Round 1 starts at ${new Date(event.startAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}.`
              : event.phase === 'done'
                ? 'Thanks for playing.'
                : `From the last ${event.topN}, one match at a time, with bets. The rounds before play all at once.`}
          </div>
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
      return [people, 'The tournament is over'].filter(Boolean).join(' · ');
    default: {
      const r = event.rounds?.find((x) => x.n === event.round);
      return [people, r ? r.label : `Round ${event.round}`].filter(Boolean).join(' · ');
    }
  }
}

// —— the match on stage ————————————————————————————————————————————————————

// —— the boards ——————————————————————————————————————————————————————————————

/** Board `at.board` of a seed, read-only: what that player has in front of them (the odd tile is never marked). */
const CupBoard = memo(function CupBoard({ seed, at, size, colour }: { seed: number; at: LiveBoard; size: number; colour: string }) {
  const b = boardAt(seed, at.board);
  const wrong = at.ok === false && typeof at.tap === 'number' && at.tap !== b.at ? at.tap : -1;
  const style = { '--w': `${size}px`, '--n': b.n, '--pc': colour } as CSSProperties;
  return (
    <div className={`ctv-board${at.ok === true ? ' ok' : ''}`} style={style} role="img" aria-label={`Board ${at.board + 1}${wrong >= 0 ? ', a wrong tap' : ''}`}>
      <div className="g">
        {Array.from({ length: b.n * b.n }, (_, i) => (
          <span key={i} className={`c${b.flip && i === b.at ? ' flip' : ''}${i === wrong ? ' no' : ''}`}><i>{i === b.at ? b.odd : b.base}</i></span>
        ))}
      </div>
      <span className="num" aria-hidden="true">#{at.board + 1}</span>
    </div>
  );
});

/** A key that changes with every move, so the board is drawn afresh and its flash plays again. */
const moveKey = (at: LiveBoard) => `${at.board}:${at.tap ?? ''}:${at.ok ?? ''}`;

const hasBoards = (m: Match) => (m.status === 'live' || m.status === 'solo') && typeof m.boardSeed === 'number' && !!m.liveBoard && Object.keys(m.liveBoard).length > 0;

function BoardOrWait({ match, p, size, colour }: { match: Match; p: Player | null; size: number; colour: string }) {
  const at = p ? match.liveBoard?.[p.userId] : undefined;
  if (at && typeof match.boardSeed === 'number') return <CupBoard key={moveKey(at)} seed={match.boardSeed} at={at} size={size} colour={colour} />;
  const box = Math.round(size * 1.07 + 6);
  return <div className="ctv-bwait" style={{ width: box, height: box }}>{match.status === 'solo' ? 'Not playing' : 'Board shows when they tap'}</div>;
}

/** Both players' boards, big, with name, seed and score above each. */
function BoardsDuel({ match, size }: { match: Match; size: number }) {
  const sa = scoreOf(match, match.a);
  const sb = scoreOf(match, match.b);
  return (
    <div className="ctv-boards" aria-label="Both boards, live">
      {[match.a, match.b].map((p, i) => {
        const colour = i === 0 ? C.a : C.b;
        const s = i === 0 ? sa : sb;
        const other = i === 0 ? sb : sa;
        return (
          <div key={i} className={`ctv-bside${s > other ? ' lead' : ''}`} style={{ '--pc': colour } as CSSProperties}>
            <div className="ctv-who">
              <span className="ctv-av" style={{ background: colour }}>{p ? initials(p.name) : '?'}</span>
              <span className="ctv-nm">
                {p ? firstName(p.name) : 'To be decided'}
                {p && <span className="ctv-seed">#{p.seed}</span>}
              </span>
              <span className="ctv-sc" style={{ color: colour }}>{fmt(s)}</span>
            </div>
            <BoardOrWait match={match} p={p} size={size} colour={colour} />
          </div>
        );
      })}
    </div>
  );
}

/** How big one of two boards side by side can be: `share` of the window's width is theirs (less padding), at most `max`. */
function useBoardSize(max: number, share: number) {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1200 : window.innerWidth));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    document.addEventListener('fullscreenchange', on);
    return () => {
      window.removeEventListener('resize', on);
      document.removeEventListener('fullscreenchange', on);
    };
  }, []);
  return Math.max(110, Math.min(max, Math.floor((w * share - 40) / 2 / 1.12)));
}

/** The match's clock: the betting countdown, the start window, the 3-2-1, or the time left in play. */
function matchClock(match: Match, split: { closesAt?: string | null } | undefined, serverNow: number, roundSec: number): { label: string; text: string } | null {
  const start = ms(match.startAt);
  if (match.status === 'betting') return { label: 'BETS CLOSE IN', text: clock(ms(split?.closesAt ?? match.bettingEndsAt) - serverNow) };
  if (match.status === 'open') return { label: 'START WINDOW', text: clock(ms(match.deadlineAt) - serverNow) };
  if ((match.status === 'live' || match.status === 'solo') && Number.isFinite(start)) {
    if (serverNow < start) return { label: 'STARTS IN', text: String(Math.max(1, Math.ceil((start - serverNow) / 1000))) };
    return { label: 'LEFT', text: clock(start + roundSec * 1000 - serverNow) };
  }
  return null;
}

/** Who leads, or who went through. */
function leadLine(match: Match, round: Round): string {
  const sa = scoreOf(match, match.a);
  const sb = scoreOf(match, match.b);
  const leader = sa === sb ? null : sa > sb ? match.a : match.b;
  const decided = match.status === 'done';
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
}

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
  const timer = matchClock(match, split, serverNow, roundSec);
  // Scores only once there is a game: not in the betting lobby or the start window.
  const scored = match.status === 'live' || match.status === 'solo' || match.status === 'done';
  const decided = match.status === 'done';
  const lead = leadLine(match, round);
  const totalStake = (split?.a.stake ?? 0) + (split?.b.stake ?? 0);
  const totalPeople = (split?.a.count ?? 0) + (split?.b.count ?? 0);
  const share = totalStake > 0 ? ((split?.a.stake ?? 0) / totalStake) * 100 : 50;
  const boards = hasBoards(match);
  // The stage is 60% of the TV beside the bracket (all of it below 1100 px), inside the dashboard's frame.
  const boardSize = useBoardSize(340, typeof window !== 'undefined' && window.innerWidth > 1100 ? 0.5 : 0.8);

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

      {boards && <BoardsDuel match={match} size={boardSize} />}
      {!boards && [match.a, match.b].map((p, i) => {
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

// The round being played before the last eight: every match at once, those
// being played first, so the screen can be watched from round 1.
const LIVE_ORDER: Partial<Record<Status, number>> = { live: 0, solo: 1, open: 2, done: 3 };

const LiveNow = memo(function LiveNow({ round, onWatch }: { round: Round; onWatch: (m: Match) => void }) {
  const matches = [...round.matches].sort((x, y) => (LIVE_ORDER[x.status] ?? 4) - (LIVE_ORDER[y.status] ?? 4) || x.slot - y.slot);
  const playing = round.matches.filter((m) => m.status === 'live' || m.status === 'solo').length;
  const decided = round.matches.filter((m) => m.status === 'done').length;
  return (
    <section className="ctv-panel" aria-label={`${round.label}, live`}>
      <h2 className="ctv-h">{round.label} · live now</h2>
      <div className="ctv-livecount">
        <span style={{ color: C.coral }}>{fmt(playing)} playing</span>
        <span>{fmt(decided)}/{fmt(round.matches.length)} decided</span>
      </div>
      <div className="ctv-live">
        {matches.map((m) => {
          const boards = hasBoards(m);
          const watch = boards
            ? {
                role: 'button',
                tabIndex: 0,
                title: `Watch ${m.label} big`,
                onClick: () => onWatch(m),
                onKeyDown: (e: ReactKeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onWatch(m);
                  }
                },
              }
            : {};
          return (
          <div key={m.slot} className={`ctv-bm${m.status === 'live' || m.status === 'solo' ? ' on' : ''}${boards ? ' watch' : ''}`} {...watch}>
            <div className="ctv-lt">
              <span>{m.label}</span>
              <span style={{ color: m.status === 'done' ? C.green : m.status === 'open' ? C.ink2 : C.coral }}>
                {m.status === 'done' ? 'DONE' : m.status === 'open' ? 'WAITING' : m.status === 'solo' ? 'SOLO' : 'LIVE'}
              </span>
            </div>
            {[m.a, m.b].map((p, i) => {
              const out = m.status === 'done' && p && m.winnerId && m.winnerId !== p.userId;
              const win = m.status === 'done' && p && m.winnerId === p.userId;
              return (
                <div key={i} className={`ctv-bp${out ? ' out' : ''}${win ? ' win' : ''}`}>
                  <span>{p ? p.name : '—'}</span>
                  {p && m.status !== 'open' && <b style={{ color: i === 0 ? C.a : C.b }}>{fmt(scoreOf(m, p))}</b>}
                </div>
              );
            })}
            {boards && (
              <div className="ctv-minib">
                <BoardOrWait match={m} p={m.a} size={80} colour={C.a} />
                <BoardOrWait match={m} p={m.b} size={80} colour={C.b} />
              </div>
            )}
          </div>
          );
        })}
      </div>
    </section>
  );
});

/** One match of a parallel round, big: both boards, until closed. */
function WatchDialog({ match, round, serverNow, roundSec, onClose }: { match: Match; round: Round; serverNow: number; roundSec: number; onClose: () => void }) {
  const size = useBoardSize(360, 0.9);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const start = ms(match.startAt);
  const live = match.status === 'live' || match.status === 'solo';
  const left = live && Number.isFinite(start)
    ? serverNow < start ? `Starts in ${Math.max(1, Math.ceil((start - serverNow) / 1000))}` : `${clock(start + roundSec * 1000 - serverNow)} left`
    : match.status === 'done' ? 'Final score' : '';
  return (
    <div className="ctv-veil" role="dialog" aria-modal="true" aria-label={`${round.label} · ${match.label}`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ctv-focus">
        <div className="ctv-stagehead">
          <span style={{ fontFamily: "'Lilita One',system-ui,sans-serif", fontSize: 30 }}>{round.label} · {match.label}</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: "'Lilita One',system-ui,sans-serif", fontSize: 30, color: C.ink2 }}>{left}</span>
          <button type="button" className="ctv-ghost" onClick={onClose} autoFocus>Close</button>
        </div>
        {hasBoards(match) ? (
          <BoardsDuel match={match} size={size} />
        ) : (
          <div className="ctv-empty">
            {match.a?.name ?? '—'} {fmt(scoreOf(match, match.a))} · {match.b?.name ?? '—'} {fmt(scoreOf(match, match.b))}
            {match.status === 'done' ? '' : ' (the boards show while they play)'}
          </div>
        )}
      </div>
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

// —— stream mode (`?stream=1`) ———————————————————————————————————————————————
// The TV alone, for a stream or a screen share: the match being played big —
// both boards, scores, the clock and the round — and between matches the next
// one and the bracket. Before the last eight it features a live match itself.

/** `?stream=1` on the address. */
function streamMode(): boolean {
  try {
    const v = new URLSearchParams(window.location.search).get('stream');
    return v === '1' || v === 'true';
  } catch {
    return false;
  }
}

/** This address with stream mode on or off, the rest (the event in `?cup=`) kept. */
function streamUrl(on: boolean): string {
  const url = new URL(window.location.href);
  if (on) url.searchParams.set('stream', '1');
  else url.searchParams.delete('stream');
  return url.toString();
}

const isLive = (m: Match) => m.status === 'live' || m.status === 'solo';

/**
 * The live match a parallel round puts forward: two players before one, boards
 * before scores only, then the closest and highest-scoring (the weaker
 * player's score, then the total). The one featured stays while it is being
 * played, so the stream does not hop between matches every poll.
 */
function featuredOf(matches: Match[], keep: number | null): Match | null {
  const live = matches.filter(isLive);
  if (!live.length) return null;
  const held = keep != null ? live.find((m) => m.slot === keep) : undefined;
  if (held && !(held.status === 'solo' && live.some((m) => m.status === 'live'))) return held;
  const rank = (m: Match) => {
    const sa = scoreOf(m, m.a), sb = scoreOf(m, m.b);
    return [m.status === 'live' ? 1 : 0, hasBoards(m) ? 1 : 0, Math.min(sa, sb), sa + sb];
  };
  return [...live].sort((x, y) => {
    const rx = rank(x), ry = rank(y);
    for (let i = 0; i < rx.length; i++) if (rx[i] !== ry[i]) return ry[i]! - rx[i]!;
    return x.slot - y.slot;
  })[0]!;
}

/** One board's side in stream mode: as wide as two fit beside the clock, as tall as the screen allows. */
function useStreamBoardSize() {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [box, setBox] = useState(read);
  useEffect(() => {
    const on = () => setBox(read());
    window.addEventListener('resize', on);
    document.addEventListener('fullscreenchange', on);
    return () => {
      window.removeEventListener('resize', on);
      document.removeEventListener('fullscreenchange', on);
    };
  }, []);
  const small = box.h <= 800;
  const byWidth = (box.w - (small ? 56 : 80) - (small ? 200 : 260) - 2 * (small ? 48 : 64)) / 2;
  const byHeight = box.h - (small ? 300 : 370);
  // The board's frame is 7% padding and a 3 px border on top of its tiles.
  return Math.max(120, Math.floor(Math.min(byWidth, byHeight) / 1.07 - 6));
}

function StreamDuel({ match, round, split, serverNow, roundSec, kicker }: {
  match: Match;
  round: Round;
  split?: { a: Side; b: Side; closesAt?: string | null };
  serverNow: number;
  roundSec: number;
  kicker?: string;
}) {
  const size = useStreamBoardSize();
  const pill = STATUS_PILL[match.status];
  const timer = matchClock(match, split, serverNow, roundSec);
  const lead = leadLine(match, round);
  const sa = scoreOf(match, match.a);
  const sb = scoreOf(match, match.b);
  const boards = hasBoards(match);
  const stake = (split?.a.stake ?? 0) + (split?.b.stake ?? 0);
  const share = stake > 0 ? ((split?.a.stake ?? 0) / stake) * 100 : 50;
  const side = (p: Player | null, i: number) => {
    const colour = i === 0 ? C.a : C.b;
    const s = i === 0 ? sa : sb;
    const at = p ? match.liveBoard?.[p.userId] : undefined;
    return (
      <div className={`cs-side${i ? ' b' : ''}${s > (i === 0 ? sb : sa) ? ' lead' : ''}`} style={{ '--pc': colour } as CSSProperties}>
        <div className="cs-who">
          <span className="ctv-av" style={{ background: colour }}>{p ? initials(p.name) : '?'}</span>
          <span className="cs-nm">
            {p ? p.name : 'No opponent'}
            {p && <span className="ctv-seed">#{p.seed}</span>}
          </span>
          <span className="cs-sc" style={{ color: colour }}>{p ? fmt(s) : ''}</span>
        </div>
        {boards ? <BoardOrWait match={match} p={p} size={size} colour={colour} /> : <div className="cs-noboard" style={{ width: size * 1.07 + 6, height: size * 1.07 + 6 }}>{fmt(s)}</div>}
        {at && <span className="cs-bl">BOARD <b>{at.board + 1}</b> · {at.board} FOUND</span>}
      </div>
    );
  };
  return (
    <section className="cs-duel" aria-label="The match being played">
      <div className="cs-head">
        <span className="ctv-pill" style={{ background: pill.bg, color: pill.fg }}>
          {isLive(match) && <i aria-hidden="true" />}
          {pill.text}
        </span>
        <span className="cs-label">
          {round.label === match.label ? match.label : `${round.label} · ${match.label}`}{match.attempt ? ` · replay ${match.attempt}` : ''}
        </span>
        {kicker && <span className="cs-kick">{kicker}</span>}
      </div>
      <div className="cs-row">
        {side(match.a, 0)}
        <div className="cs-mid">
          {timer && (
            <div className="cs-timer" aria-live="off">
              <small>{timer.label}</small>
              {timer.text}
            </div>
          )}
          <span className="cs-vs">VS</span>
          {lead && <span className="cs-lead">{lead}</span>}
          {split && stake > 0 && (
            <div className="cs-bets" aria-label={`Bets: ${fmt(split.a.stake)} points on one side, ${fmt(split.b.stake)} on the other`}>
              <small>BETS</small>
              <div className="ctv-splitbar"><i style={{ width: `${share}%`, background: C.a }} /><i style={{ width: `${100 - share}%`, background: C.b }} /></div>
              <div className="cs-betrow"><span style={{ color: C.a }}>{fmt(split.a.stake)}</span><span style={{ color: C.b }}>{fmt(split.b.stake)}</span></div>
            </div>
          )}
        </div>
        {side(match.b, 1)}
      </div>
    </section>
  );
}

