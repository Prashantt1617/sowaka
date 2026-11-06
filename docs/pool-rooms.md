# Sowaka Pool — live rooms contract (server ⇄ page)

Catalog key `pool`. Namespace `/pool` on the shared Socket.IO server (path `/connect/socket`). Ticket marker in the page head: `<!--POOL-TICKET-->` → `window.__POOL = { ticket, hopTicket }` (`pool` is in TICKETED in game-catalog.controller.ts). Rooms per org, 4-digit codes, exactly two players; a third `room:join` is refused `409 "That table has two players already."` (watchers are not in v1).

## Engine (shared, deterministic)
`backend/src/shared/pool/engine.ts` — pure, no imports, no Math.random. Exports:
- constants `L=2, W=1, R=1.125/39, POCKETS, CORNER, SIDE, MOUTH, FRICTION, VMAX`, `rack(): Ball[]`
- `simulateShot(balls: Ball[], shot: Shot): { balls: Ball[]; events: ShotEvent[]; steps: number }` — fixed step 1/240 s with sub-steps; identical output everywhere for the same input (plain floating-point arithmetic, no randomness). `shot = { aim: number (radians, world frame), power: 0..1, spin: { top: -1..1, side: -1..1 } }`.
- `resolve(state: RuleState, after: Ball[], events: ShotEvent[]): RuleOutcome` (`after` = the balls `simulateShot` returned) — the 8-ball rules exactly as the single-player page: break (kitchen, ≥4 balls to a rail or a pot, 8 on the break re-spotted), open table, group by the first legally potted ball, fouls (scratch, no contact, wrong first ball incl. the 8, no rail after contact), ball in hand (anywhere; behind the head string after a break foul), the 8 only after the group, called pocket for the 8 (`calledPocket: 0..5`), lose on an early 8 / wrong pocket / 8 with a scratch.
- Types `Ball { n, x, y, vx, vy, on }`, `ShotEvent` (`hit {a,b,v}`, `cushion {n,v}`, `pocket {n,p}`, `scratch`), `RuleState { balls, turn: 0|1, groups: [null|'solid'|'stripe', null|'solid'|'stripe'], open, inHand, kitchen, breakShot, calledPocket }`, `RuleOutcome { foul: string|null, keepTurn, winner: 0|1|null, next: RuleState, message }`.

## Room view (per player, `room:state {room}`)
```
{ code, status: 'lobby'|'playing'|'over', you: userId, hostId, open, serverNow,
  players: [{ userId, name, photoUrl, online, group, pottedCount }],      // index 0 breaks the first game
  invited: [{ userId, name, photoUrl }],
  turn: 0|1, balls: [{n,x,y,on}], inHand, kitchen, open8: bool /* table open */, breakShot, calledPocket,
  onEight: bool,                                                          // the shooter must call a pocket
  shotClock: { endsAt } | null,                                           // 30 s per shot, server clock, counted from the end of the replay
  replayUntil: epochMs,                                                   // the last shot is still rolling until then; a shot before it is refused
  lastShot: { seq, by: 0|1, aim, power, spin, from: {x,y}, events: ShotEvent[], balls: [...after], steps, at } | null,
  message: string|null, result: { winner: 0|1, reason: 'eight'|'foul'|'left'|'away' } | null, gameNo, wins: [n,n] }
```
The page replays `lastShot` with `simulateShot` from `lastShot.from` positions (which it already has), then snaps to `lastShot.balls`. `lastShot.steps` is how many 1/240 s steps the engine ran (the replay's length); `at` is the server time the shot was taken. The server starts the next shot clock at `replayUntil = at + steps/240 s + 300 ms` (20 s at most) and fouls the shooter 1.5 s after `shotClock.endsAt`, so a shot sent at 0 still counts. `balls` is empty in the lobby. The breaker starts with ball in hand in the kitchen (`inHand`, `kitchen`, `breakShot` all true): a `pool:place` before the break is optional. No chat in v1.

`result.reason`: `eight` the 8 potted in its called pocket; `foul` the 8 lost (early, wrong pocket, or with a scratch); `left` the other player left mid-game; `away` the other player was offline 90 s mid-game. `wins` counts games won in this room per seat.

## Events (client → server; all acked `{ok,data}|{ok:false,status,message}`)
- `room:hello` → `{ room|null, rooms: [{code, host: {userId,name}|null, players: [{userId,name,photoUrl}], status, seatFree, createdAt}], invites: [{code, from: {userId,name,photoUrl}, players, createdAt, expiresAt}] }` (`rooms` = the company's open rooms, those with a seat first)
- `room:host {open}` → room · `room:join {code, rejoin?}` → room (a `rejoin` only puts back someone still seated: 404 otherwise) · `room:quick` → room (the oldest open lobby with a seat, else a new open room of your own) · `room:leave` · `room:invite {userId}` → `{invited:true}` (same company only; push scenario `pool_invite`, data `{destination:'game_challenge', gameKey:'pool', challengeId:'room:<code>'}`)
- `room:start` (host, 2 players, both online) · `room:again` (either player, from `over`: with both at the table a new game starts at once and the loser breaks; with the other player offline the room goes back to its lobby; `409 "There is no finished game to replay."` in a lobby, `409 "The game is still on."` mid-game)
- `pool:place {x,y}` → room (ball in hand, your turn; validated: inside the table, not overlapping, in the kitchen when required; may be moved again until the shot; accepted during the replay)
- `pool:call {pocket}` → room (0..5; only when on the 8; accepted during the replay)
- `pool:shot {aim, power, spin: {top, side}}` → room — only on your turn, not before `replayUntil`; the server simulates, resolves, stores `lastShot`, pushes `room:state` to both. Power and spin are clamped as the engine clamps them.
- Server → client: `room:state {room|null}` (null when the room is gone), `room:feed {kind: 'join'|'leave'|'host'|'foul'|'timeout', userId?, name?, text?}`, `room:invite {from, code, expiresAt}`, `room:fatal {code, message}`.
- Timeouts: at `shotClock.endsAt` (+1.5 s) the server fouls the shooter (ball in hand to the other; behind the head string if the break is still to come) — in the tick. Offline 90 s mid-game while the other player is online forfeits (`away`); both offline 90 s abandons the game: no winner, nothing scored, the room back in its lobby with a message. Leaving mid-game forfeits (`left`: scored and tallied). Whenever a player leaves a running or finished room, it goes back to the lobby for the one who stays, who is seat 0 and host: the table, turn, `lastShot` and `result` are gone (they were indexed by the old seats), `wins` and `gameNo` stay, and a forfeit's `message` stays. A seat is only ever taken in the lobby (`room:join`, `room:invite`, quick join): a running or finished room answers `409`.
- Rate buckets as Tile Up (host 5/60, join 10/60, invite 1,5, move 2,6 for place/shot, small 5,10 for the rest).

## Storage / service (copy Tile Up's shape)
`pool-store.ts` keys `pool:room:{org}:{code}`, `pool:seat:{org}:{uid}`, `pool:invites:{org}:{uid}`, `pool:lock:…`, `pool:once:…`, set `pool:live`; TTL 4 h. `pool-rooms-engine.ts` (pure: the room record, the view, start/place/call/shot/timeout/forfeit, `advance`) and `pool-room.service.ts` with `configurePool({now, random, notify, recordScore, awardPoints})`, `change(org, code, fn)`, effects `feed|invite|notify|finished|delete` (no kick in v1), the leased tick (500 ms) for the shot clock and presence. Finished: `recordServerScore(org,'pool', …)` for both players (score = own balls potted×100 + 1000 for the win; a 0 is not recorded), points = score ÷ 70 rounded, ≤ 25, via `payPoints` once per game (`claimOnce`). Check: `npm run pool:check` (`MONGODB_DB=pool_check`, no `REDIS_URL`), an in-process server on port 4321.

## Page
`games-web/pool/src.html` → `games-web/pool/build.py` → `backend/game-pages/pool.html`. The build inlines (1) the Socket.IO 4.8.3 block copied from `backend/game-pages/tile-up.html` at `<!--SOCKET-IO-->`, (2) the engine: `node_modules/.bin/esbuild backend/src/shared/pool/engine.ts --bundle --format=iife --global-name=PoolEngine --minify` at `<!--POOL-ENGINE-->` (the page's own physics is replaced by `PoolEngine.simulateShot`), (3) asserts the ticket marker. Live layer as Tile Up: `blockedByPolicy` → hop reload, socket, `request()`, reconnect with `room:join {code, rejoin:true}`, `window.Sowaka.room` API, `startChallengeId = "room:4821"` → join. No `__POOL` → the single-player modes work as now and "Play a colleague" shows "needs the Sowaka app".
