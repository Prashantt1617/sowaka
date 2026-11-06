# Sowaka Pool — live rooms contract (server ⇄ page)

Catalog key `pool`. Namespace `/pool` on the shared Socket.IO server (path `/connect/socket`). Ticket marker in the page head: `<!--POOL-TICKET-->` → `window.__POOL = { ticket, hopTicket }` (add `pool` to TICKETED in game-catalog.controller.ts). Rooms per org, 4-digit codes, exactly two players; a third person may join a room only as a watcher (optional, v2).

## Engine (shared, deterministic)
`backend/src/shared/pool/engine.ts` — pure, no imports, no Math.random. Exports:
- constants `L=2, W=1, R=1.125/39, POCKETS, CORNER, SIDE, MOUTH, FRICTION, VMAX`, `rack(): Ball[]`
- `simulateShot(balls: Ball[], shot: Shot): { balls: Ball[]; events: ShotEvent[]; steps: number }` — fixed step 1/240 s with sub-steps; identical output everywhere for the same input (plain floating-point arithmetic, no randomness). `shot = { aim: number (radians, world frame), power: 0..1, spin: { top: -1..1, side: -1..1 } }`.
- `resolve(state: RuleState, shot: Shot, events: ShotEvent[]): RuleOutcome` — the 8-ball rules exactly as the single-player page: break (kitchen, ≥4 balls to a rail or a pot, 8 on the break re-spotted), open table, group by the first legally potted ball, fouls (scratch, no contact, wrong first ball incl. the 8, no rail after contact), ball in hand (anywhere; behind the head string after a break foul), the 8 only after the group, called pocket for the 8 (`calledPocket: 0..5`), lose on an early 8 / wrong pocket / 8 with a scratch.
- Types `Ball { n, x, y, vx, vy, on }`, `ShotEvent` (`hit {a,b,v}`, `cushion {n,v}`, `pocket {n,p}`, `scratch`), `RuleState { balls, turn: 0|1, groups: [null|'solid'|'stripe', null|'solid'|'stripe'], open, inHand, kitchen, breakShot, calledPocket }`, `RuleOutcome { foul: string|null, keepTurn, winner: 0|1|null, next: RuleState, message }`.

## Room view (per player, `room:state {room}`)
```
{ code, status: 'lobby'|'playing'|'over', you: userId, hostId, open, serverNow,
  players: [{ userId, name, photoUrl, online, group, pottedCount }],      // index 0 breaks the first game
  turn: 0|1, balls: [{n,x,y,on}], inHand, kitchen, open8: bool /* table open */, calledPocket,
  shotClock: { endsAt } | null,                                           // 30 s per shot, server clock
  lastShot: { seq, by: 0|1, aim, power, spin, from: {x,y}, events: ShotEvent[], balls: [...after] } | null,
  message: string|null, result: { winner: 0|1, reason } | null, gameNo, wins: [n,n], chat?: [] }
```
The page replays `lastShot` with `simulateShot` from `lastShot.from` positions (which it already has), then snaps to `lastShot.balls`.

## Events (client → server; all acked `{ok,data}|{ok:false,status,message}`)
- `room:hello` → `{ room|null, rooms: [{code, host, players, status}], invites }`
- `room:host {open}` → room · `room:join {code}` · `room:quick` · `room:leave` · `room:invite {userId}` (push scenario `pool_invite`, data `{destination:'game_challenge', gameKey:'pool', challengeId:'room:<code>'}`)
- `room:start` (host, 2 players) · `room:again` (rematch; loser breaks)
- `pool:place {x,y}` (ball in hand; validated: inside the table, not overlapping, in the kitchen when required)
- `pool:call {pocket}` (0..5; only when on the 8)
- `pool:shot {aim, power, spin}` — only on your turn, not during a replay window; the server simulates, resolves, stores, pushes.
- Timeouts: at `shotClock.endsAt` the server fouls the shooter (ball in hand to the other) — in the tick.
- Rate buckets as Tile Up (host 5/60, join 10/60, invite 1,5, move 2,6, small 5,10).

## Storage / service (copy Tile Up's shape)
`pool-store.ts` keys `pool:room:{org}:{code}`, `pool:seat:{org}:{uid}`, `pool:invites:{org}:{uid}`, `pool:lock:…`, `pool:once:…`, set `pool:live`; TTL 4 h. `pool-room.service.ts` with `configurePool({now, random, notify, recordScore, awardPoints})`, `change(org, code, fn)`, effects `feed|kicked|invite|notify|finished|delete`, the leased tick (500 ms) for the shot clock and presence. Finished: `recordServerScore(org,'pool', …)` for both players (score = potted×100 + 1000 for the win), points via `payPoints` ≤ 25, once per game.

## Page
`games-web/pool/src.html` → `games-web/pool/build.py` → `backend/game-pages/pool.html`. The build inlines (1) the Socket.IO 4.8.3 block copied from `backend/game-pages/tile-up.html` at `<!--SOCKET-IO-->`, (2) the engine: `node_modules/.bin/esbuild backend/src/shared/pool/engine.ts --bundle --format=iife --global-name=PoolEngine --minify` at `<!--POOL-ENGINE-->` (the page's own physics is replaced by `PoolEngine.simulateShot`), (3) asserts the ticket marker. Live layer as Tile Up: `blockedByPolicy` → hop reload, socket, `request()`, reconnect with `room:join {code, rejoin:true}`, `window.Sowaka.room` API, `startChallengeId = "room:4821"` → join. No `__POOL` → the single-player modes work as now and "Play a colleague" shows "needs the Sowaka app".
