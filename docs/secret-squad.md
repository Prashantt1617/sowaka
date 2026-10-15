# Secret Squad: rules and protocol

A live team game for a whole office at once. Everyone in an office's lobby
gets one word; a few colleagues hold words that share a secret theme with it.
People walk around, check each other's codes, and link up their whole squad
before the clock runs out. The design is the "Secret Squad Game Plan" artifact;
this file is the contract between the game page and the server.

## Decisions (15 Oct 2026)

- The game is a web page (rules and content change without updates). The next
  app release adds the animated feed card and QR scanning in the app through
  the game bridge (`Sowaka.scanQr()`); without it, players type codes. Opened
  in a phone browser it signs in by email code and can scan with the camera.
- Everything is configured per **session** later: office, start time, lobby
  length, and a list of rounds (squad size, hunt length, break, lock, points).
  Example: squads of 20, then 5, then 2.
- One lobby per office. A person's office comes from the office list loaded
  with `src/scripts/secret-squad.ts offices`, else their profile location.
- Each office plays together however big (Gurgaon is ~155).
- Sessions start at scheduled times set from the backend; nobody starts one
  from the app. A feed post per office announces it; the Games tab joins too.
- Points follow Hint Relay by default: 40 per member of your linked group,
  plus half the seconds left when your squad finished (both configurable).

## Rules

| | |
|---|---|
| Session | One office, a start time, a lobby length (default 3:00), and rounds played back to back. |
| Lobby | Opens before the start. A push goes to everyone in that office. Anyone who joins before it closes plays; anyone who joins during a break plays from the next round. |
| Minimum | 4 players for a round, or it is skipped ("Not enough players"). |
| Dealing | 0:10 to read your word; checks start after it. |
| Hunt | Per round (default 17:00). |
| Break | Per round (default 2:00) showing that round's results, then the next round deals. The last round ends with the session results. |
| Squads | For a round's squad size `s`: `k = max(2, round(n / s))` squads, sizes as even as possible (never more than `s + ceil(s/5)`, never fewer than 2). People from the same department are dealt round-robin so they spread across squads. |
| Words | Each squad gets one theme with at least as many words as members; each member a different word of it. Whole packs are used together where possible, because a pack's themes are written to mislead each other. Packs used in an org recently are skipped while others remain. Themes carry up to 24 words so squads of 20 work. |
| Code | Each player shows a 4-digit code that changes every 20 s. Codes never clash inside a round. The current and the previous code are accepted. |
| Check | A types (or scans) B's code. B is asked to Allow (20 s to answer). Allow → the server compares squads. |
| Same squad | Linked. The link joins both groups. Both see each other's word. |
| Different | Both are locked from checking for the round's lock time (default 45 s). A locked player can still be checked by others. |
| Already linked | Answered at once, no Allow, no lock. |
| One at a time | A player has at most one open check, sent or received. |
| Finished | A squad is finished when every member still in the game is in one linked group. Its members' codes stop working; they can watch. |
| Away | 60 s offline during the hunt marks a player away: their squad needs one fewer, and their word is shown to their squad. Their links still count. Back before the end: present again but unlinked (their links are dropped), unless the squad already finished. |
| Squad of one | A squad with one member still in the game can't finish. |
| Round end | At 0:00, or once every squad has finished or can't. Places by finish time; unfinished squads after, by group size. Every theme and word is revealed. |
| Points | Per player per round: `pointsPerMember` (40) × size of their squad's largest linked group (0 if alone), plus `floor(secondsLeft × timeBonusPerSecond)` (0.5) if the squad finished. Paid at the end of each round, once, to `users.points` and `point_events` as `game_challenge` / `gameKey: 'secret-squad'`. |

## Transport

Socket.IO namespace `/squad` on path `/connect/socket` (same server as
Scribble). The handshake carries `auth.ticket` (in the app, minted into the
page) or `auth.token` (a session token from the browser sign-in).

Requests are emitted with an ack callback. The ack is `{ ok: true, data }` or
`{ ok: false, status, message }`; `message` is written for the player.

### Page → server

| Event | Payload | Ack data | Notes |
|---|---|---|---|
| `squad:join` | `{}` | `{}` | Only while the lobby is open. |
| `squad:leave` | `{}` | `{}` | Lobby only; in the hunt, closing the page is "away". |
| `squad:check` | `{ code: "4817" }` or `{ qr: "<scanned text>" }` | `{ askId }` | 409 if locked, already asking, or being asked. 404 for a code nobody holds. |
| `squad:answer` | `{ askId, allow: true \| false }` | `{}` | |
| `squad:sync` | `{}` | `{}` | Asks for a fresh `squad:state`. |

### Server → page

`squad:state` (to one player, on every change that alters what they see, and
every 20 s for the new code):

```jsonc
{
  "v": 42,                       // session version; ignore anything older
  "now": 1792070000000,          // server clock, ms: use it to correct the phone's clock
  "office": "Gurgaon",
  "me": { "userId": "…", "name": "Tanvi", "initials": "T" },
  "next": null | { "sessionId", "lobbyOpensAt", "startsAt", "rounds": [{ "squadSize", "huntMs" }] },
  "session": null | {
    "id": "…",
    "status": "lobby" | "dealing" | "hunt" | "break" | "over" | "cancelled",
    "lobbyOpensAt": 0, "startsAt": 0,
    "phaseEndsAt": 0,                               // end of the lobby, dealing, hunt or break
    "roundIndex": 0, "roundCount": 3,               // which round (0-based) is dealing / hunting / in its break
    "rounds": [{ "squadSize": 20, "huntMs": 1020000 }],
    "joined": true, "playing": true,                // playing = in the current round (false if joined mid-round)
    "players": 91,
    "faces": [{ "userId", "name", "initials", "photoUrl" }],   // up to 12, lobby only
    "totalPoints": 0,                               // what you have earned this session so far
    "round": null | {                               // the current (or just finished) round
      "player": null | {
        "word": "MARS",
        "code": "4817", "codeExpiresAt": 0,         // null when finished or away
        "qr": "SQ1:<session>:<round>:<code>",
        "lockedUntil": 0,                           // 0 when free
        "away": false
      },
      "squad": null | {
        "size": 5, "needed": 5,                     // needed = members still in the game
        "linked": [{ "userId", "name", "initials", "word", "me": true, "away": false }],
        "awayWords": [{ "name", "word" }],          // away members not linked to you
        "unknown": 2,                               // members you have not found yet
        "finishedAt": 0, "place": 0,                // 0 until finished
        "theme": null | "Chocolate bars"            // only once finished, or in the break / over
      },
      "board": { "squads": 26, "finished": 3, "hunting": 22, "stuck": 1 },
      "ask": null | { "id", "fromName", "fromInitials", "expiresAt" },        // someone wants to check with you
      "asking": null | { "id", "toName", "expiresAt" },                       // you are waiting for them
      "result": null | {                            // the last check you were part of
        "id", "kind": "match" | "miss" | "already" | "declined" | "expired",
        "otherName", "otherWord", "at"
      },
      "notice": null | { "kind": "teammate_away" | "teammate_back" | "squad_left", "name", "word", "at" },
      "results": null | {                           // in the break and when over
        "squads": [{ "place", "theme", "words": ["…"], "finishedAt", "linked", "size", "mine" }],
        "trickiest": null | { "word", "checks" },
        "points": 0                                 // what you earned this round
      }
    }
  }
}
```

`squad:fatal` `{ code: "not_allowed" | "no_office" }` — the page shows the
message and stops reconnecting.

## Pages and sign-in

- In the app: catalog game `secret-squad`, served by `/play/secret-squad` with
  `<!--SQUAD-TICKET-->` replaced by `window.__SQUAD = { ticket, hopTicket }`,
  and the same policy hop as Scribble (`?ticket=<hop>`).
- In a browser: `GET /squad` serves the same page with
  `window.__SQUAD = { web: true }`. The page signs in with
  `POST /auth/request-otp {email}` and `POST /auth/verify-otp {email, otp}`
  (same origin), keeps the token in `localStorage`, and connects with
  `auth.token`.
- The camera is offered only where `navigator.mediaDevices.getUserMedia`
  works; typing a code always works.

## Operating it

```
# who plays in which office (CSV: email,office)
node --env-file=.env --import tsx src/scripts/secret-squad.ts offices convrse offices.csv
# schedule a session: rounds as size:huntMinutes[:breakMinutes], comma-separated
node --env-file=.env --import tsx src/scripts/secret-squad.ts schedule convrse Gurgaon 2026-10-17T16:00+05:30 --rounds 20:17,5:12,2:8
#   options: --lobby 3 (minutes)  --lock 45 (seconds)  --points 40  --bonus 0.5  --post (feed card)
node --env-file=.env --import tsx src/scripts/secret-squad.ts edit <id> --rounds 5:17 --at 2026-10-17T16:30+05:30
node --env-file=.env --import tsx src/scripts/secret-squad.ts list convrse
node --env-file=.env --import tsx src/scripts/secret-squad.ts cancel <id>
```

## Feed card (app release)

Scheduling with `--post` (or later `secret-squad.ts post <id>`) publishes one
Connect post per session, type `secret_squad`, to that office's people only:

```jsonc
"body": {
  "sessionId": "…", "office": "Gurgaon",
  "title": "Secret Squad", "subtitle": "Your word is a clue to find your secret squad.",
  "kicker": "SQUAD HUNT", "rewards": "SURPRISE REWARDS", "rewardsNote": "For the top squads to link up",
  "lobbyOpensAt": "ISO", "startsAt": "ISO",
  "gameKey": "secret-squad",                        // Let's Play opens this catalog game in the app
  "webUrl": "https://…/squad"                       // older apps: opens the web lobby in the browser
}
```

The app draws the "Secret Squad Feed Card" design (animated envelope, live
countdown to `lobbyOpensAt`, then "Lobby open" / "Playing now" / "Ended").
