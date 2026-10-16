# Secret Squad: rules and protocol

A live team game for a whole office at once. Everyone in an office's lobby
gets a secret word. Words in the same category make one squad. Players walk
around, scan each other's QR codes and try to find their whole squad before
the round clock runs out. Each office plays its own rounds in its own lobby,
and all points go to one org leaderboard.

This file is the contract between the game page and the server. The rules
are the "Secret Squad — Developer Handoff" (16 Oct 2026), with the user's
later decisions folded in. The code is in `backend/src/services/secret-squad-*.ts`.

## Rules (v2, 16 Oct 2026)

### A game

| | |
|---|---|
| Session | One office, a start time, a lobby length (default **5:00**), and rounds played back to back. Each round has a squad size, a hunt length, a break length and a list of categories (from the office's plan). |
| Lobby | Opens 5 minutes before the start. A push goes to everyone in that office. Anyone who joins before the start plays round 1. Anyone who joins during a break plays from the next round. Joining mid-round means waiting for the next one. Players can leave the lobby (`squad:leave`), which removes them. |
| Minimum | 4 players for a round, or that round is skipped. |
| Word reveal | At the start of each round squads are made and words dealt (`status: "dealing"`). "Hunt starts in" counts down **10 s** (`clock.revealEndsAt`), then the hunt starts by itself. |
| Hunt | The round's length (`clock.huntEndsAt`). It ends at 0:00, **or as soon as every squad in the office is complete** (or can't be: only one member left in the game), whichever comes first. |
| Break | The round's break length (`clock.breakEndsAt`), showing the round's results. Then the next round is dealt by itself. |
| Final | After the last round, `status: "over"` with the final results. The game's leaderboard points (score ÷ 100, at most 25, never below 0) go to the org leaderboard now. |

### Squads

- Made **fresh every round** from everyone in the lobby. A count is made of `k = max(2, round(n / size))` squads, with sizes as even as possible (they differ by at most one). No squad is bigger than 10, the most words a category has. With 13 people in pairs that gives five pairs and one trio. With 43 in 6s it gives one 7 and six 6s.
- **No repeat partners (best effort).** The cost of two people sharing a squad is 1000 × the earlier rounds they've already shared, plus 1 if they're in the same department. The server places the people who have met the most first, each into the open squad where they add the least cost (emptier squads first, then random). Then any two people in different squads swap while that lowers the total. This runs from several random starts (60 for ≤ 30 people, fewer for big offices) and keeps the cheapest. It stops early once no pair repeats. Checked: 14 people over 5 pair rounds always get 5 different partners. 13 people over 5 rounds (pairs and a trio) never repeat a pair. HQ's squads of 5 in round 2 share no pair with round 1's squads of 10.

### Words

- The bank is `backend/src/services/secret-squad-packs.ts`: 42 categories, 7–10 words each, every word different.
- **One category per squad. A squad of n takes the category's first n words, in the listed order**, so pairs always get the first two words. Member i holds word i. Since no two categories share a word, a word is used at most once per round.
- **Which categories:** each round's `categories` list (copied from the office plan when scheduled). Squads take them in list order, largest squad first. Each category must have at least as many words as its squad.
- **Fallback when the list is short** (more people came than planned, or a round was scheduled by hand with no list): the rest of the bank fills in, in bank order (families sit next to each other there). The server first takes categories that no round of this session plays. Next come categories a *later* round plans to use. Last come categories an *earlier* round already played, because seeing the same words twice would give squads away. If the whole bank isn't enough (more than 42 squads), there are fewer, bigger squads instead.
- The **category stays secret** until your squad is complete or the round ends.
- Players see their own word, their squad's size, and the name and word of everyone they've linked with. They also see the word of any away teammate.

### Scanning

- **Scan only.** Each player shows a QR (`me.qr`) that changes every **20 s**. The QR from just before a change still scans. A typed `{ code }` is refused with 400 (`rules.typedCodes: false`). To bring typed codes back, set `SQUAD.typedCodes = true` in `secret-squad-engine.ts`. The state then carries `me.code` too.
- A scan **resolves at once on both phones**. There is no Allow step.
- **Same squad → Right:** you're linked. Links chain: if A is linked with B and B with C, then A is linked with C.
- **Different squads → Wrong:** both lose points. **Nothing is locked or paused, ever.**
- **Already linked** (directly or through the chain): costs nothing, and says so (`result: "already"`, to the scanner only).
- The **scanned person** gets the same Right or Wrong result and the same points, with the scanner's name on it ("[Name] scanned you", `role: "scanned"`).
- **Complete squad:** a squad is complete when every member still in the game is in one linked group. Its members' QRs stop working (scanning one is refused with 409, no points). Its members can't scan any more this round.

### Scoring

| Event | Points | Who gets them |
|---|---|---|
| Right scan | **+100** | both players |
| Wrong scan | **−25** | both players |
| Squad complete | **+200** squad bonus | every member of the complete group |
| Squad complete, time left | **+floor(seconds left × 0.5)** time bonus | every member of the complete group |

- **Odd-sized squads:** squad bonus = `200 + 100 × (round's squad size − this squad's size)`, never below 0. A squad of 4 in a round of 5s gets +300. A trio in a round of pairs gets +100. So a complete squad's members can reach the same score whatever their squad's size.
- **Time bonus:** the seconds left on the round clock when the squad completes, × 0.5, rounded down. With 90 s left, each member gets +200 +45. Squads that never complete get no time bonus.
- Scores **can go below 0**.
- Points are earned **live** in the game (`totalPoints` moves on every scan, and can go below 0). The org leaderboard is paid **once, when the game ends**, the way the other games pay: each player gets their game score ÷ 100, rounded, **at most 25 and never below 0**. A game that ends negative adds 0; the leaderboard never loses points to Secret Squad. That means `users.points` `$inc` plus a `point_events` row (`source: "game_challenge"`, `reason: "game"`, `gameKey: "secret-squad"`, `refId: "<session>"`). Exactly-once comes from a row in `secret_squad_payouts` with `_id: "<session>:final"`. It is written before paying, so a second instance, or the same one after a restart, can't pay twice. A cancelled game is not paid.
- The surprise rewards are never named on any screen.

### Away

- Offline under 60 s: the page shows "Reconnecting…". Links, word and points are kept.
- Offline 60 s or more in the hunt: **away**. Their squad needs one fewer person, and their word is shown to their squad (`squad.awayMembers`). An away member who was already linked into the complete group gets the squad bonus. One who wasn't linked doesn't.
- Back before the round ends: present again but unlinked (their links drop; points they earned stay), unless the squad already completed.
- A squad with one member left in the game can't complete (`notice.kind: "squad_left"`).

## Office plans

`SQUAD_PLANS` in `secret-squad-packs.ts` (the handoff's word packs):

| Plan | People | Rounds | Squad size | Hunt | Break | Categories per round |
|---|---|---|---|---|---|---|
| HQ | 140 | 2 | 10 → 5 | 8 min | 1 min | 14, 28 |
| Noida | 43 | 3 | 6 → 5 → 3 | 5 min | 1 min | 7, 9, 14 |
| Kolkata | 14 | 5 | pairs | 3 min | 30 s | 7 each |
| Gurgaon | 13 | 5 | pairs (+1 trio) | 3 min | 30 s | 7 each |

`npx tsx src/scripts/secret-squad-packs-check.ts` checks the bank and the plans. Every word must be unique. Plans may name only real categories, with no category twice in a plan. Each category must have enough words for the squads its round deals at the plan's head count. Each round needs enough categories at that head count. It also notes which rounds would borrow from the bank at ±15% of the head count.

## Transport

Socket.IO namespace `/squad` on path `/connect/socket` (same server as
Scribble). The handshake carries `auth.ticket` (in the app, minted into the
page) or `auth.token` (a session token from the browser sign-in).

Requests are emitted with an ack callback. The ack is `{ ok: true, data }` or
`{ ok: false, status, message }`. The `message` is written for the player:
show it as is. Requests are rate limited per socket. A 429 says "Slow down a
little".

### Page → server

| Event | Payload | Ack `data` | Errors |
|---|---|---|---|
| `squad:join` | `{}` | `{}` | 404 no session open for your office; 409 the session has ended / lobby full |
| `squad:leave` | `{}` | `{}` | 409 mid-round ("You can leave between rounds") |
| `squad:scan` | `{ qr: "<scanned text>" }` | see below | see below |
| `squad:check` | same as `squad:scan` | same | the old name, still accepted |
| `squad:sync` | `{}` | `{}` | asks for a fresh `squad:state` |
| `squad:board` | `{ sessionId? }` | `{ sessionId, office, endsAt, results: [Standing] }` | 404 no leaderboard (or another office's game) |

`squad:scan` ack data:

```jsonc
{
  "result": "right" | "wrong" | "already",
  "delta": 100 | -25 | 0,        // what this scan moved, for each of the two players
  "total": 1245,                 // the scanner's session total now (bonuses included)
  "otherName": "Riya Sharma",
  "otherWord": "Parrot",
  "completed": false             // this scan completed the squad
}
```

`squad:scan` errors (`status`, and the message shown):

| Status | When |
|---|---|
| 400 | `{ code }` sent while typed codes are off ("Scan their QR code."); your own QR |
| 403 | you're not in this round (joined mid-round) |
| 404 | not a Secret Squad QR of this round; expired (older than the previous 20 s window), or its holder is away |
| 409 | not the hunt; your squad is complete; their squad is complete ("…their QR has stopped working"); you're away (reconnecting) |

The state push that follows carries the same result as `round.scan` on
**both** phones. The page can show the Right/Wrong screen from the ack at
once and ignore the matching `scan.id` when it arrives, or show it from the
state only.

### Server → page

`squad:fatal` `{ code: "not_allowed" | "no_office" | "setup_failed", message }`: the page
shows the message and stops reconnecting.

`squad:state` goes to each player whenever what they see changes (the server
diffs per phone and skips identical views). In the hunt it also goes every
20 s for the new QR. Watchers who haven't joined get a shared copy with no
`me` and no personal parts.

```jsonc
{
  "v": 42,                       // session version; ignore anything older
  "now": 1792070000000,          // server clock, ms: correct the phone's clock with it
  "office": "Kolkata",
  "me": { "userId": "…", "name": "Tanvi", "initials": "T", "photoUrl": "/media/…" } | null,
  "next": null | {               // no session held: the next scheduled one
    "sessionId": "…", "lobbyOpensAt": 0, "startsAt": 0,
    "rounds": [{ "squadSize": 2, "huntMs": 180000, "breakMs": 30000 }]
  },
  "session": null | Session
}
```

All times are server epoch ms. Countdowns are `<time> − (now corrected)`.

#### Session

```jsonc
{
  "id": "…",
  "status": "lobby" | "dealing" | "hunt" | "break" | "over" | "cancelled",
  "lobbyOpensAt": 0, "startsAt": 0,
  "phaseEndsAt": 0,              // end of the current phase (lobby, reveal, hunt, break)
  "roundIndex": 2,               // 0-based
  "roundNumber": 3,              // "Round 3 of 5"
  "roundCount": 5,
  "rounds": [{ "squadSize": 2, "huntMs": 180000, "breakMs": 30000 }],   // every round's settings
  "rules": {
    "right": 100, "wrong": -25, "squadBonus": 200, "perMissing": 100,
    "timeBonusPerSecond": 0.5,
    "dealMs": 10000, "qrWindowMs": 20000, "awayMs": 60000,
    "typedCodes": false
  },
  "clock": {                     // exactly one is set, for the phase you're in (all null when over/cancelled)
    "lobbyEndsAt": null | 0,     // lobby: the start
    "revealEndsAt": null | 0,    // word reveal: "Hunt starts in" (10 s)
    "huntEndsAt": null | 0,      // hunt: the round clock
    "breakEndsAt": null | 0      // break: the next round opens
  },
  "joined": true,                // in this session (lobby or later)
  "playing": true,               // dealt into the current round
  "players": 14,                 // lobby: people waiting; later: people in this round
  "faces": [{ "userId", "name", "initials", "photoUrl" }],   // lobby only, newest 12
  "totalPoints": 245,            // my session total, live (can be negative)
  "cancelReason": null | "Called off",
  "round": null | Round,         // the current (or just finished) round
  "final": null | Final          // only when status is "over"
}
```

#### Round

```jsonc
{
  "index": 2, "number": 3,
  "squadSize": 2,                // the round's standard size ("pairs")
  "skipped": false,              // too few players: no squads this round
  "dealtAt": 0, "huntStartsAt": 0, "endsAt": 0,   // endsAt: the scheduled 0:00
  "overAt": null | 0,            // when it actually ended
  "board": { "squads": 7, "complete": 3, "hunting": 4, "stuck": 0 },

  "me": null | {                 // null if you're not in this round
    "word": "Parrot",
    "qr": "SQ1:<session>:<round>:<code>" | null,  // null while dealing, once your squad is complete, or away
    "qrExpiresAt": 0 | null,     // when it changes (every 20 s)
    "code": null,                // only when typed codes are on
    "away": false,
    "roundPoints": 75            // my net this round
  },

  "squad": null | {
    "size": 2,                   // members dealt
    "bonus": 200,                // MY squad's bonus (odd sizes differ)
    "needed": 2,                 // members still in the game (size − away)
    "more": 1,                   // how many more I still need to link (0 once complete)
    "members": [                 // my linked group, me included
      { "userId", "name", "initials", "photoUrl", "word": "Dog", "me": true, "away": false }
    ],
    "awayMembers": [             // away teammates not linked to me: their words are shown
      { "userId", "name", "initials", "photoUrl", "word": "Cat" }
    ],
    "unknown": 1,                // members not found yet (not linked, not away)
    "complete": null | {         // "Squad complete"
      "at": 0, "place": 1,       // place: 1st squad to complete in the office, …
      "category": "Pets",
      "bonus": 200,              // squad bonus I got
      "timeBonus": 45,           // "+45 for time left"
      "secondsLeft": 90,
      "before": 100, "after": 345   // my total before → after both bonuses (count up)
    },
    "category": null | "Pets",   // once complete, or once the round has ended
    "words": null | ["Dog", "Parrot"]   // same: the squad's words in order
  },

  "scan": null | {               // the last scan I took part in: show once per id
    "id": "uuid",
    "result": "right" | "wrong" | "already",
    "role": "scanner" | "scanned",   // "scanned" → "[other.name] scanned you"
    "other": { "userId", "name", "initials", "photoUrl", "word": "Parrot" },
    "delta": 100,                // +100 / −25 / 0
    "before": 0, "after": 100,   // my total before → after this scan (count up / down)
    "completed": false,          // this scan completed my squad: show squad.complete next
    "at": 0
  },

  "notice": null | {             // the last thing that happened to my squad
    "kind": "teammate_away" | "teammate_back" | "squad_left",
    "name": "Riya", "word": "Cat", "at": 0
  },

  "results": null | {            // once the round has ended (break, and over)
    "skipped": false,
    "rank": 3 | null,            // my rank in the office by session total (null if never dealt in)
    "of": 14,                    // people ranked
    "roundPoints": 300,          // my net this round
    "total": 545,                // my points so far
    "squad": null | SquadCard,   // my squad this round: category, words, who held each
    "top": [Standing],           // office top 5 by total
    "squads": [{ "place", "category", "words", "size", "linked", "complete", "finishedAt", "mine" }],
    "trickiest": null | { "word": "Parrot", "scans": 4 }   // most wrongly-scanned word
  }
}
```

The squad-complete screen: show it once per round when `squad.complete`
first appears. It appears for every member at once, including those who
weren't part of the final scan. For the two people in the completing scan,
`scan.completed` is true: show Right first, then Squad complete.

#### SquadCard, Standing, Final

```jsonc
// SquadCard
{
  "roundNumber": 3, "category": "Pets", "words": ["Dog", "Parrot"],
  "size": 2, "bonus": 200, "timeBonus": 45, "complete": true, "place": 1,
  "members": [{ "userId", "name", "initials", "photoUrl", "word": "Dog", "me": true, "linked": true }]
}

// Standing: the card's body.results rows and the board's rows too
{ "userId": "…", "name": "Tanvi", "initials": "T", "photoUrl": "/media/…" | null, "points": 545, "rank": 1 }

// Final (status "over")
{
  "rank": 2 | null,              // ties: 1, 2, 2, 4
  "of": 14,
  "total": 1245,
  "lastSquad": null | SquadCard, // my squad in the last round I played
  "leaderboard": [Standing]      // everyone dealt in, most points first (negatives last)
}
```

Standings rank everyone dealt into at least one round (not people who only
sat in the lobby), most points first, then by name. Ties share a rank (1, 2,
2, 4).

### Example: the scanned phone after a right scan (hunt, Kolkata round 3)

```jsonc
"round": {
  "index": 2, "number": 3, "squadSize": 2, "skipped": false,
  "huntStartsAt": 1792070010000, "endsAt": 1792070190000, "overAt": null,
  "board": { "squads": 7, "complete": 1, "hunting": 6, "stuck": 0 },
  "me": { "word": "Elbow", "qr": null, "qrExpiresAt": null, "code": null, "away": false, "roundPoints": 345 },
  "squad": {
    "size": 2, "bonus": 200, "needed": 2, "more": 0,
    "members": [
      { "userId": "u1", "name": "Tanvi", "initials": "T", "photoUrl": null, "word": "Elbow", "me": true, "away": false },
      { "userId": "u7", "name": "Arjun", "initials": "A", "photoUrl": null, "word": "Palm", "me": false, "away": false }
    ],
    "awayMembers": [], "unknown": 0,
    "complete": { "at": 1792070100000, "place": 1, "category": "Body parts", "bonus": 200, "timeBonus": 45, "secondsLeft": 90, "before": 300, "after": 545 },
    "category": "Body parts", "words": ["Elbow", "Palm"]
  },
  "scan": {
    "id": "6f1c…", "result": "right", "role": "scanned",
    "other": { "userId": "u7", "name": "Arjun", "initials": "A", "photoUrl": null, "word": "Palm" },
    "delta": 100, "before": 200, "after": 300, "completed": true, "at": 1792070100000
  },
  "notice": null, "results": null
}
```

## Pages and sign-in

- In the app: catalog game `secret-squad`, served by `/play/secret-squad` with
  `<!--SQUAD-TICKET-->` replaced by `window.__SQUAD = { ticket, hopTicket }`,
  and the same policy hop as Scribble (`?ticket=<hop>`). `games-web/secret-squad/live.js`
  is the transport (unchanged by v2).
- In a browser: `GET /squad` serves the same page with
  `window.__SQUAD = { web: true }`. The page signs in with
  `POST /auth/request-otp {email}` and `POST /auth/verify-otp {email, otp}`
  (same origin), keeps the token in `localStorage`, and connects with
  `auth.token`.
- Scanning: in the app through the game bridge (`Sowaka.scanQr()`); in a
  browser where `navigator.mediaDevices.getUserMedia` works, with the camera.

## Operating it

Run from `backend/`. Writing here is a production change: the database is shared.

```
# who plays in which office (CSV: email,office or employeeId,office)
node --env-file=.env --import tsx src/scripts/secret-squad.ts offices convrse offices.csv [--replace]
node --env-file=.env --import tsx src/scripts/secret-squad.ts offices-list convrse

# schedule an office from its plan: with no --rounds, the plan named like the office
node --env-file=.env --import tsx src/scripts/secret-squad.ts schedule convrse HQ      2026-10-24T16:00+05:30 --post
node --env-file=.env --import tsx src/scripts/secret-squad.ts schedule convrse Noida   2026-10-24T16:00+05:30 --post
node --env-file=.env --import tsx src/scripts/secret-squad.ts schedule convrse Kolkata 2026-10-24T16:00+05:30 --post
node --env-file=.env --import tsx src/scripts/secret-squad.ts schedule convrse Gurgaon 2026-10-24T16:00+05:30 --post
# an office named differently from its plan (before the HQ / Gurgaon rename):
node --env-file=.env --import tsx src/scripts/secret-squad.ts schedule convrse Gurgaon     2026-10-24T16:00+05:30 --plan HQ --post
node --env-file=.env --import tsx src/scripts/secret-squad.ts schedule convrse "Gurgaon 2" 2026-10-24T16:00+05:30 --plan Gurgaon --post
#   --plan alone = the office's own plan; --lobby 5 (minutes, default); --post (the feed card)
#   A plan written for a very different head count (over 2× off) is refused unless --force:
#   today "Gurgaon" (146 people) would otherwise pick the 13-person Gurgaon plan.
# or rounds by hand: size:huntMinutes[:breakMinutes] (decimals ok); categories then come from the whole bank
node --env-file=.env --import tsx src/scripts/secret-squad.ts schedule sowaka Gurgaon 2026-10-17T16:00+05:30 --rounds 5:8:1,2:3

node --env-file=.env --import tsx src/scripts/secret-squad.ts edit <id> [--at <time>] [--plan [name] | --rounds 5:8] [--lobby 5]
node --env-file=.env --import tsx src/scripts/secret-squad.ts post <id>
node --env-file=.env --import tsx src/scripts/secret-squad.ts list convrse
node --env-file=.env --import tsx src/scripts/secret-squad.ts cancel <id>
node --env-file=.env --import tsx src/scripts/secret-squad.ts packs      # the bank and every plan
```

Checks (scratch database only; each refuses any other):

```
MONGODB_DB=secret_squad_scratch NOTIFY_ORGS=sowaka EMAIL_ORGS=nobody-scratch npm run -s squad:check
npx tsx src/scripts/secret-squad-packs-check.ts
MONGODB_DB=secret_squad_scratch NOTIFY_ORGS=sowaka EMAIL_ORGS=nobody-scratch npx tsx src/scripts/secret-squad-load.ts 250 60
```

## Feed card (app release)

Scheduling with `--post` (or later `secret-squad.ts post <id>`) publishes one
Connect post per session, type `secret_squad`, to that office's people only:

```jsonc
"body": {
  "sessionId": "…", "office": "Kolkata",
  "title": "Secret Squad", "subtitle": "Your word is a clue to find your secret squad.",
  "kicker": "SQUAD HUNT", "rewards": "SURPRISE REWARDS", "rewardsNote": "For the top squads to link up",
  "lobbyOpensAt": "ISO", "startsAt": "ISO",
  "rounds": [{ "squadSize": 2, "huntMs": 180000 }],
  "gameKey": "secret-squad",                        // Let's Play opens this catalog game in the app
  "webUrl": "https://…/squad",                      // older apps: opens the web lobby in the browser
  "status": "scheduled" | "lobby" | "playing" | "over" | "cancelled",
  "endsAt": "ISO",                                  // estimate until over; then the real end
  "results": [Standing]                             // once over: the final standings
}
```

The game keeps `status` in step however it ends (the clock, or the last
squad completing in a scan). At the end it writes `endsAt` (the moment the
last round ended) and `results`: every player dealt in, with
`{ userId, name, initials, photoUrl, points, rank }`. Points are session
totals and can be negative. "View Full Leaderboard" opens `board:<sessionId>`
(`squad:board`), which is limited to the viewer's own office.
