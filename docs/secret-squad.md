# Secret Squad: rules and protocol

A live team game for a whole office at once. Everyone in an office's lobby
gets one word; a few colleagues hold words that share a secret theme with it.
People walk around, check each other's codes, and link up their whole squad
before the clock runs out. The design is the "Secret Squad Game Plan" artifact;
this file is the contract between the game page and the server.

## Decisions (15 Oct 2026)

- Web only: a game page, no app release. Inside the app's Games tab it plays
  with typed 4-digit codes; opened in a phone browser it signs in by email code
  and can also scan QR codes with the camera.
- One lobby per office. A person's office comes from the office list loaded
  with `src/scripts/secret-squad.ts offices`, else their profile location.
- Each office plays as one round however big (Gurgaon is ~155: ~26 squads).
- Rounds start at scheduled times set from the backend; nobody starts one
  from the app.
- Points follow Hint Relay: 40 per member of your linked group, plus half the
  seconds left when your squad finished.

## Rules

| | |
|---|---|
| Lobby | Opens 3:00 before the start. A push goes to everyone in that office. Anyone who joins before it closes plays. |
| Minimum | 4 players, or the round is called off ("Not enough players"). |
| Dealing | 0:10 to read your word; scanning starts after it. |
| Hunt | 17:00. |
| Squads | `k = max(2, ceil(n / 6))` squads, sizes as even as possible: 20 → 4×5, 23 → 6,6,6,5, 7 → 4,3, 4 → 2,2, 155 → 26 squads of 5–6. People from the same department are dealt round-robin so they spread across squads. |
| Words | Each squad gets one theme from the word packs; each member a different word of it. Whole packs are used together, because a pack's themes are written to mislead each other. Packs used in an org recently are skipped while others remain. |
| Code | Each player shows a 4-digit code that changes every 20 s. Codes never clash inside a round. The current and the previous code are accepted. |
| Check | A types (or scans) B's code. B is asked to Allow (20 s to answer). Allow → the server compares squads. |
| Same squad | Linked. The link joins both groups. Both see each other's word. |
| Different | Both are locked from checking for 45 s. A locked player can still be checked by others. |
| Already linked | Answered at once, no Allow, no lock. |
| One at a time | A player has at most one open check, sent or received. |
| Finished | A squad is finished when every member still in the game is in one linked group. Its members' codes stop working; they can watch. |
| Away | 60 s offline during the hunt marks a player away: their squad needs one fewer, and their word is shown to their squad. Their links still count. Back before the end: present again but unlinked (their links are dropped), unless the squad already finished. |
| Squad of one | A squad with one member still in the game can't finish. |
| End | At 0:00, or once every squad has finished or can't. Places by finish time; unfinished squads after, by group size. Every theme and word is revealed. |
| Points | Per player: 40 × size of their squad's largest linked group (0 if alone), plus `floor(secondsLeft / 2)` if the squad finished. Paid once, to `users.points` and `point_events` as `game_challenge` / `gameKey: 'secret-squad'`. |

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
  "v": 42,                       // round version; ignore anything older
  "now": 1792070000000,          // server clock, ms: use it to correct the phone's clock
  "office": "Gurgaon",
  "me": { "userId": "…", "name": "Tanvi", "initials": "T" },
  "next": { "lobbyOpensAt": 0, "startsAt": 0 } | null,   // next scheduled round, when none is live
  "round": null | {
    "id": "…",
    "status": "lobby" | "dealing" | "hunt" | "over" | "cancelled",
    "lobbyOpensAt": 0, "startsAt": 0, "huntStartsAt": 0, "endsAt": 0,
    "joined": true,
    "players": 17,                                  // in the lobby / in the round
    "faces": [{ "userId", "name", "initials", "photoUrl" }],   // up to 12, lobby only
    "player": null | {                              // once squads are made
      "word": "MARS",
      "code": "4817", "codeExpiresAt": 0,           // null when finished or away
      "qr": "SQ1:<round>:<code>",
      "lockedUntil": 0,                             // 0 when free
      "away": false
    },
    "squad": null | {
      "size": 5, "needed": 5,                       // needed = members still in the game
      "linked": [{ "userId", "name", "initials", "word", "me": true, "away": false }],
      "awayWords": [{ "name", "word" }],            // away members not linked to you
      "unknown": 2,                                 // members you have not found yet
      "finishedAt": 0, "place": 0,                  // 0 until finished
      "theme": null | "Chocolate bars"              // only once finished or over
    },
    "board": { "squads": 26, "finished": 3, "hunting": 22, "stuck": 1 },
    "ask": null | { "id", "fromName", "fromInitials", "expiresAt" },        // someone wants to check with you
    "asking": null | { "id", "toName", "expiresAt" },                       // you are waiting for them
    "result": null | {                              // the last check you were part of
      "id", "kind": "match" | "miss" | "already" | "declined" | "expired",
      "otherName", "otherWord", "at"
    },
    "notice": null | { "kind": "teammate_away" | "teammate_back" | "squad_left", "name", "word", "at" },
    "results": null | {                             // when over
      "squads": [{ "place", "theme", "words": ["…"], "finishedAt", "linked", "size", "mine" }],
      "trickiest": null | { "word", "checks" },
      "points": 0                                   // what you earned
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
# schedule a round (lobby opens 3 minutes before)
node --env-file=.env --import tsx src/scripts/secret-squad.ts schedule convrse Gurgaon 2026-10-17T16:00+05:30
node --env-file=.env --import tsx src/scripts/secret-squad.ts list convrse
node --env-file=.env --import tsx src/scripts/secret-squad.ts cancel <id>
```
