# App releases ledger

Every app build that left this Mac, newest first. `tool/release_preflight.sh` reads this table
before any new build. The next build must contain the commit of the newest **live** row, so no
build can again be made from an older base. (1.4.1 (82) was built on 1.4.0 (70) and dropped 28 app
changes that 77 had shipped.)

Status words:
- `live`: on sale in the stores, so people have it.
- `pulled`: was in the stores, then halted or replaced.
- `testflight`: sent to testers only.
- `built`: made, not sent anywhere yet.
- `superseded`: never released, replaced by a later build.

App Store closes a version once one of its builds is approved: the next upload needs a higher
version (1.4.1 → 1.4.2), not only a higher build number.

After every build, add its row: `tool/release_preflight.sh --record built`. When a build goes on
sale, change its word to `live`.

| version | build | commit | branch | status | notes |
|---|---|---|---|---|---|
| 1.4.1 | 83 | 8e759007 | release-1.4.1-83 | superseded | 77 + notifications + punch-out fix; App Store refused it (1.4.1 already approved as 82, train closed), rebuilt as 1.4.2 (84) |
| 1.4.1 | 82 | 1ada1e14 | release-1.4.1-notif | pulled | WRONG BASE: 1.4.0 (70) + notifications; dropped 28 app changes from 77 |
| 1.4.1 | 81 | 7aa42bd0 | | superseded | lifecycle screens, paint-first cache |
| 1.4.1 | 80 | e9d6bf89 | | superseded | Teams tab New joiners |
| 1.4.0 | 77 | 264017c0 | build-77 | live | missed punches, tax cards, overtime preference, leave cancellation, polls without text, camera/gallery |
| 1.4.0 | 76 | 6ac3575f | | superseded | own contest photo |
| 1.4.0 | 75 | f0a567f3 | | superseded | contest entry profile photos |
| 1.4.0 | 74 | 7f1a0686 | | superseded | entrant profile photos |
| 1.4.0 | 73 | 514eff83 | | superseded | overtime compensation, Form 16 switch |
| 1.4.0 | 72 | 9d1e9aa4 | | superseded | Games logo top right, contest card |
| 1.4.0 | 71 | 04aa510b | | superseded | payroll v2, EPF + Earnings |
| 1.4.0 | 70 | 3cb56c5e | | superseded | |
