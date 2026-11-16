# Pre-boarding portal (`preboarding-web`)

The candidate's web page from the offer email link to the end of week 1 (employee
lifecycle, `docs/lifecycle/CONTRACT.md` › Portal). Vite + React + TypeScript, mobile
first; from 960 px it switches to the W (desktop) layouts, and screens drawn only for
mobile (About you, Meet us, closed screens, date request, password reset) stay centred
at 430 px.

## Running it

```bash
cd preboarding-web
npm install                 # its own node_modules (not part of the root workspaces)
npm run dev                 # http://localhost:5181, talks to VITE_API_BASE_URL
npm run dev:mock            # same, with fixture data for every state (no backend)
npm run typecheck
npm run build               # dist/ (static files; serve with SPA fallback to index.html)
```

| Env | Default | What |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:4000` | Backend origin; calls go to `${base}/portal/*` |
| `VITE_MOCK` | — | `1` = fixture data (dev server only; dropped from production builds) |
| `VITE_APP_LINK` | `https://go.getsowaka.com/open` | "Open the app" link |

The backend builds email links with `PORTAL_BASE_URL` (default `http://localhost:5181`)
and must allow it in CORS. The portal JWT lives in `sessionStorage` and goes out as
`Authorization: Bearer`; a 401 sends the candidate back to sign in.

### Mock mode

`npm run dev:mock`, then open:

- Offer links: `/o/demo`, `/o/demo-v2` (revised offer), `/o/accepted`, `/o/finalised`,
  `/o/declined`, `/o/expired`, `/o/replaced`, `/o/not-joining`
- Signed in: `/?mock=tasks_open` (or `offer_updated`, `letter_ready`, `pass_unlocked`,
  `joined`, `moved_to_app`, `not_joining`); then `/documents`, `/about`, `/meet`,
  `/letters`, `/pass`, `/date-request`, `/offer`
- Sign in with any email; password `wrong` shows the error, `locked` the lock message.

A "Mock" chip (bottom left) jumps between states; add `?clean=1` to hide it.

## Routes

| Path | Screen |
|---|---|
| `/o/:token` · `/o/:token/letter` | P2/W2 Congratulations → P3/W3 offer letter (PDF + agree) → P4/P5/W4 accepted / all set; closed screens for declined · expired · replaced · not joining |
| `/sign-in` · `/forgot` · `/reset/:token` | P6/W6 sign in, forgot password, set a new password |
| `/` | P7/W7 home: tasks open · offer updated · letter ready · pass unlocked · joined (W15); P16/PX when closed |
| `/offer` | P3 v2 from home (signed in) |
| `/documents` | P8 reels (phone) / W8 list + panel (desktop) |
| `/about` | P9 emergency contact + PF |
| `/meet` | P10 Meet us reels |
| `/letters` · `/letters/:id` | P12/W12 appointment letter & NDA |
| `/pass` | P14/W14 Day-1 pass + .ics |
| `/date-request` | P7a Can't make it? |

Tests: there is no test runner in the repo for this app yet (vitest is not installed);
`npm run typecheck` and `npm run build` are the checks.
