# Blue/green restarts for the backend

Deploys today restart the only API process (`pm2 restart sowaka-backend`). nginx returns 502 for
about 15–30 s while the new process boots, connects to Mongo and Redis, and warms up. With
blue/green, the new build starts **beside** the old one, nginx is pointed at it only once it is
ready, and only then is the old one drained and stopped.

```
            ┌──────── nginx :80 ────────┐
            │ upstream sowaka_api {      │
            │   include sowaka-upstream  │──►  127.0.0.1:4000  sowaka-blue   (dist-blue)
            │ }                          │     127.0.0.1:4001  sowaka-green  (dist-green)
            └────────────────────────────┘
```

Only one colour runs at rest. A deploy:

1. builds the idle colour (`dist-<idle>`; the active colour's build is not touched, so it is the
   rollback);
2. runs the live check (`deploy/bluegreen/live-check.js`) and the memory check;
3. starts `sowaka-<idle>` on its port and waits for `GET /health/ready` = 200: Mongo answers, Redis
   is connected, and the boot warm-up (Suwi's inputs and notices, then one Engagement / Time office /
   lifecycle round) is done;
4. rewrites `/etc/nginx/sowaka-upstream.conf` to the new port, runs `nginx -t`, then
   `nginx -s reload` (graceful: new workers use the new upstream, old workers finish what they have);
5. waits 3 s, then stops the old colour: it says "not ready", drains HTTP (`SHUTDOWN_DRAIN_MS`,
   25 s), closes its sockets (phones reconnect, through nginx, to the new copy), waits for its game
   clocks and background jobs to finish, lets the background-jobs lease go, closes Redis and Mongo;
6. the new copy takes the lease (within ~1 s) and starts the background jobs.

Everything is in `deploy/bluegreen/bluegreen.sh` (`status`, `deploy`, `rollback`, `switch PORT`,
`migrate`).

## Background jobs: one process, via a lease

`backend/src/services/leader.ts`: one document in Mongo (`leases`, `_id: "background-jobs"`) with
its holder and expiry. The holder renews every 5 s (TTL 30 s); another process takes it only once it
has expired or been released. A holder whose renewals fail for 18 s stops its jobs, well before
anyone may take over, and `isLeader()` turns false the moment its last renewal could have lapsed.
Starting and stopping the jobs never holds up a renewal, and the lease is still renewed while a
stopping holder's last runs finish. Mongo rather than Redis because the server cannot run without Mongo but runs
on without Redis, and this Redis evicts keys with a TTL under memory pressure (`volatile-lru`).

`leader-jobs.ts` / `background-jobs.ts` run, on the lease holder only:

| Job | How it runs |
| --- | --- |
| Notifications hourly (exits, portal, offboarding, 10:00 / 14:00 / Fri 16:00 messages) | slot: each IST hour |
| Notifications 5-min (punch-in reminders, grouped pushes, contests, lifecycle meetings and day jobs) | slot: every 5 min |
| Connect lifecycle posts + leave year-end, 07:00 IST | slot: each IST day |
| Care journal digest, 21:00 IST | slot: each IST day |
| Diwali Cup runner | loop, 1 s |
| Game-challenge sweeper | loop, 60 s |
| Engagement warm-up (with Suwi's pre-asks) | loop, 4 min |

Each slot is claimed in `job_runs` (`_id: "<job>:<slot>"`, unique) before it runs, so a slot runs
once however many processes and handovers there are. A process that takes over runs the current slot
at once if nobody claimed it, it is within its grace (15 min hourly, 5 min, 30 min daily) and the
slot before it was claimed (so the first start after the old single-process server, which claimed
nothing, does not repeat a slot that server may have run). Loops need no ledger: each pass decides
what is due, and every Cup move is a conditional update.

Suwi's model-made pre-asks (`prepareRecent`, `prepareFrequent`) run only on the lease holder; their
answers are kept in Redis, so the other copy reads them. The rest of the warm-up (reads into this
process's memory) runs in every process: the new copy warms itself before it is ready.

Game clocks are **not** leader-only: each realtime tick runs in every process, every room / table /
session is leased per pass in Redis (`poker:lock`, `tileup:lock`, …), and each process moves the
players whose sockets it holds.

## Kept answers across two processes

Each process keeps answers in memory (swr-cache, the lifecycle read cache, Engagement). The new copy
warms while the old one still takes every write; without help it could serve an answer from before
an HR change after the switch. `cache-bus.ts` publishes every drop (`dropSwr`, `forgetSwr`,
`forgetSwrExcept`, `dropSwrForPerson`, a board patch as a drop, `forgetEngagement`) on the Redis
channel `sowaka:cache-drop`; the other process applies it to its own memory. Suwi's Redis copies are
already keyed by a shared data version. Caches filled only by requests (auth, people) start empty in
the new copy, which has had no traffic.

## What survives a switch

| | Survives | Why / what a player sees |
| --- | --- | --- |
| Speed Poker rooms and tables, shootouts (events) | yes | tables, floor, rooms in Redis; events and results in Mongo; per-table/room leases. Socket drops and reconnects in ~1 s; a seat sits out only after 10 s offline |
| Hint Relay | yes | progress and presence in Redis, events in Mongo, start claimed in Mongo; the first tick on the new copy sends each player their screen again |
| Pool, Tile Up, Scribble rooms | yes | room, seats, strokes in Redis with compare-and-set; reconnect puts each player back (host 30 s, drawer 10 s, player 90 s before anything happens). A Pool shot whose result was being sent at the very moment of the switch can time out as a missed shot |
| Secret Squad | yes | sessions in Redis with a version CAS; openings claimed |
| Connect sockets | yes | they reconnect and rejoin their rooms; a change pushed in the reconnect second is seen on the next refresh |
| Diwali Cup in its lobby or running | **no** | live scores and boards are held in the serving process and written to the match every few seconds: `live-check.js` refuses the switch (`WAIT_FOR_LIVE` to wait, `FORCE=1` to override) |
| Anything, if `REDIS_URL` is unset | **no** | the stores fall back to process memory: refused |

`STRICT_ROOMS=1` restores the old rule (no switch while any poker or pool room is open).

## Rollback

`bluegreen.sh rollback`: start the other colour from its untouched build, wait until ready, switch,
stop the current one: the same zero-downtime path. `bluegreen.sh switch 4000|4001` only flips nginx
(for when both copies are up). The colour's build is overwritten only by the deploy after next.

## Memory (t3.small, 1.9 GB + 2 GB swap)

Measured 18 Nov: the single process is ~236 MB RSS three minutes after a start and ~534 MB after
18 h; 931 MB was available with it at 534 MB (1,297 MB with a fresh one). The overlap adds one fresh
process (~250–350 MB) for about a minute, so it fits with ~500 MB to spare. The deploy builds
**before** it starts the second process (tsc is given 1.3 GB) and refuses to start one with less
than `MIN_FREE_MB` (500) available. If processes are routinely past ~900 MB, restart before deploying
or move to a t3.medium.

## Production changes (once)

1. Merge, then on the server `git pull` main.
2. `bluegreen.sh migrate`: copies the current `dist` to `dist-blue`, writes
   `/etc/nginx/sowaka-upstream.conf` (`server 127.0.0.1:4000;`), installs `docs/deploy/nginx-sowaka.conf`
   (the upstream now `include`s that file), `nginx -t`, reload. Nothing moves: still :4000.
3. First `bluegreen.sh deploy`: builds `dist-green`, holds the lease in the old app's name
   (`lease.js hold-legacy`: the old `sowaka-backend` runs its jobs without asking), starts
   `sowaka-green` on :4001, switches, stops and deletes `sowaka-backend`, releases the hold,
   `pm2 save`.
4. pm2 now has `sowaka-green` from `deploy/bluegreen/ecosystem.config.js` (`kill_timeout` 75 s,
   `SHUTDOWN_DRAIN_MS` 25 s, `JOBS_STOP_WAIT_MS` 45 s, `APP_COLOR`, `PORT`). `/home/ubuntu/ecosystem.config.js`
   is no longer used.
5. No `.env` change: `PORT` comes from pm2 and wins over the file's `PORT=4000`.
6. The deploy recipe becomes `ssm-run.sh 'bash /home/ubuntu/app/sowaka/deploy/bluegreen/bluegreen.sh deploy' 900`.

## Checks

`npm run bluegreen:check -w backend` (local mongod and redis-server only), and
`npm run shutdown:check -w backend` for the drain itself.
