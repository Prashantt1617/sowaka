# Knights Tournament — build contract

Men's Day knockout on the Meow puzzle, run by the existing cup engine (`backend/src/services/cup.service.ts`,
`cup-rules.ts`, `cup-bets*.ts`, `scripts/cup-event.ts`, `game-pages/cup/*`, `hr-admin-web/.../CupTv.tsx`).
Plan page: https://claude.ai/artifact/9GnHJgE3xrnJW5CyuVwrkJ (the user's decisions). Base branch: `knights-cup`.

**Meow itself does not change anywhere** (catalog `meowdoku` / `meow-test`, its page, leaderboard, challenges).
The knight look exists only inside this tournament. Do not touch Odd One Out or Trails behaviour: every change
is behind `gameKey === 'knights'`.

## Rules (from the user)
- Puzzle: n×n grid, n colour regions; one knight per row, column and region; knights never touch (diagonals too).
  Tap: × → knight → clear; slide crosses empty squares. A clashing knight shows "!". No hints, no starting piece,
  no point penalty.
- Grids: round 1 = 6×6; semi-finals and final = 9×9; every other round = 8×8. (With ≤ 3 rounds: last two rounds
  9×9, earlier 6×6 for round 1 only.) Formula: `gridFor(round, totalRounds)`: round === totalRounds or
  totalRounds - 1 → 9; round === 1 → 6; else 8. (Round 1 of a 2-round cup is 9×9.)
- One board per match: both opponents get the same board, other matches may differ. Replay → new board.
- Match: both join → 4 s countdown. **First right board wins**; the match ends for both at once.
  **Resign** any time (confirm) → opponent wins at once. **Cap 5 min** (roundSec 300): at the cap the player
  with more knights in the right place wins; equal → replay on a new board (maxReplays 2), then the higher seed.
- Join window **30 s** (startWindowSec 30). Lone player: starts within **30 s** (soloStartSec 30) and goes through.
  Nobody: higher seed goes through (unchanged engine rule).
- Rounds before the quarter-finals: all matches together; the next round opens the moment the last match is
  decided (unchanged engine behaviour: parallel rounds).
- Quarter-finals onward (topN 8): one match at a time with betting, **bettingSec 120** (the "2-minute gap").
  Rounds with no betting start immediately. Wallet 1,000 play points (walletStart 1000), as on Mehfil day.
- Lobby draw mode (lobbyDraw true). Convrse: lobby 17:30 IST, draw + first match 18:00 IST (date to be confirmed).
- Name: **Knights Tournament** (feed card, pushes, page title). Icon ♞.

## Shared pieces (already on the base branch)
- `backend/src/content/knights-boards.json`: `{"6":[{g,s}...30], "8":[...30], "9":[...30]}`. `g` = region id per
  cell (row-major, n*n), `s` = sorted solution cell indices (one per row). Every board has exactly one answer
  (checked with `docs/knights-cup/gen_boards.py`).
- Board for a match: `boardIndex = seed % bank[n].length` where `seed` is the match's numeric `seed`
  (`newSeed()` returns an integer). The server owns `n` and the seed.
- Assets: `docs/knights-cup/assets/knight-source.png` (1122×1402 transparent cobalt knight),
  `docs/knights-cup/assets/gallop-source.mp3` (8.1 s gallop). Use the loudest single hoof beat (~0.2–0.35 s)
  as the "knight placed" sound.

## Server ↔ page contract (agent A implements the server, agent B the page; keep these exact)
- `matchView` for a knights match adds `knights: { n, g }` (regions only, **never** the solution) while the
  match is live/solo/done, and for each player `placed` (count of knights on their board) — never a correctness
  count during play. After the match is decided, add `right` per player and `solution` (indices).
- Page → server live report: `POST /cup/api/matches/:id/live` body `{ knights: number[] }` (cell indices with a
  knight, ≤ n*n, deduped; other fields optional). Throttle ~260 ms as today. The server stores the latest set
  per player per attempt, computes `right = |knights ∩ s|`, and **decides the match the moment a player's set
  equals the solution** (decidedBy `finished`). A finished board is the only way to win before the cap.
- `POST /cup/api/matches/:id/final` is not needed for knights (keep accepting it harmlessly).
- New `POST /cup/api/matches/:id/resign` → opponent wins, decidedBy `resigned`. Only a player of that match,
  only while live/solo.
- At the cap (startAt + roundSec + small grace for the last report, e.g. 3 s): decide by `right`, tie → replay.
- `match.result` for knights: `{ winnerId, decidedBy, right: {uid: n}, finishedMs?: number }`.
- `cupBoardFor` / descriptions: "Knights knockout".

## Who does what
- **A — backend** (branch `knights/engine` off `knights-cup`): cup-rules + cup.service for the above, `--game knights`
  in cup-event.ts (CUP_GAMES), defaults for knights (roundSec 300, startWindowSec 30, soloStartSec 30,
  bettingSec 120, topN 8, wallet 1000, lobbyDraw), push/feed copy "Knights Tournament", catalog
  `scoring.max` not needed (no score). Extend `npm run` cup checks (cup-check.ts) with knights cases: grid per
  round, finish decides at once, resign, cap decision, tie replay, solution never in a live view. Then a
  **bot run**: a script that starts the backend locally on a scratch DB with 64 bot players in org sowaka and
  plays a whole knights cup (bots place knights from the solution with random delays, some resign, some no-show),
  verifying it reaches a champion and every round's timing.
- **B — page** (branch `knights/page` off `knights-cup`): `backend/game-pages/cup/play-knights.js` exposing
  `window.CupKnights` with the same contract as `CupPlay`/`CupTrails` (start/stop/state/unlockAudio/boardHtml/
  drawBoard), drawing `match.knights` boards in Meow's clean look (meow-test.html colours, tap/slide/clash),
  the knight image (downscaled, small data URI — the built page must stay under build.mjs's 250 KB cap),
  the gallop beat on placing a knight, Resign button with confirm, opponent "placed" count, result screen.
  Wire it into `build.mjs` and `cup/page.html` (game name, rules copy for Knights, three-way mode choice),
  rebuild `game-pages/diwali-cup.html` locally (do not upsert anything).
- **C — TV + feed** (branch `knights/tv` off `knights-cup`): `hr-admin-web` Cup TV draws knights boards from
  `match.knights` + live `placed`, `GameCtx` gets `'knights'`; cup-event `post` copy for Knights (title, ♞ tag,
  subtitle); bets ledger labels ("Knights Tournament bet/win/refund") behind the game key.

Rules for every agent: never merge, never deploy, never upsert pages or catalog rows, never touch production
(the server, Atlas, S3). Work and test locally only. Heavy commands (tsc on the whole backend, builds, test
suites) run under `lockf -k /tmp/sowaka-heavy.lock <cmd>` (8 GB Mac). Local test servers get their own port
and a scratch DB name. Commit on your branch with a clear message and push it; report what you checked.

## Theme (from the user's GIF, docs/knights-cup/assets/knights-tournament.gif + theme-frame.png)
Deep navy background (~#060B26 → #0B1440), pale ice-blue text (~#CFE6FF), cobalt tiles (~#1F56D8, #2E77D0) with
a white ×, the cobalt knight (knight-source.png) as the piece, a heavy rounded geometric sans for headings
(e.g. Figtree 800 / Plus Jakarta Sans 800, inlined or system fallback — no external font loads in the app
WebView unless the page already does so). Region colours must stay clearly distinct on navy: use a cool
palette (cobalts, sky, teal, indigo, violet, ice) with enough lightness steps that 9 regions read apart, and a
light outline or gap between regions. Clash "!" in amber. Same look on the TV boards.

## Date
**Today, Thu 19 Nov 2026**: lobby 17:30 IST, first match 18:00 IST on Convrse (the GIF says "19 Nov · 6PM onwards").
Speed matters: build the smallest correct version first, report as soon as it works end to end.
