# Team side shared widgets (owner: T1, branch `app-lc-t1`)

All in `mobile-app/lib/features/lifecycle/onboarding/presentation/manager/team_kit.dart`. T2 (head of department, buddy, full task list): import these; list any change you need in your report instead of editing the file.

- `TeamColors`: the design's extra colours (count red, ok green, warn amber, View-all blue-grey, reach-out orange-red).
- `TeamTaskKind` (help, approve, review, task, meet, team, goal, doc, chat): icon + tint per kind; `TeamTaskKind.of(TaskView)` maps a journey task.
- `TeamSectionPills` + `TeamPillSpec`: Teams' sideways pill row (My Team, Requests, Feedback, Joiners last), black when on, counts inside.
- `JoinerListRow`, `TeamAvatarWithPlant`, `teamStageLabel`, `teamPlantOf`: a joiner's row in Joiners (photo + plant badge, name, designation, relation line "You're the buddy" / "Reports to X" via `relation` + `relationIsYou`, stage pill).
- `TeamListCard`, `TeamListHead` ("COMING UP"), `TeamPill`, `TeamSectionTitle`, `TeamFootnote`.
- `TeamPersonHero`: the person page's top (photo, name -> profile, designation, reports line, buddy line, stage pill with plant). `buddyIsYou` for the buddy's view.
- `TeamTaskRow` + `TeamRowEnd` (tick / chevron / locked / none): one task row (icon tile, title, pair line with the joiner's mini avatar or a sub line, pill, end control).
- `TeamTasksCard`: the main blue-outlined card ("Your tasks for Priya" / "Help Priya with"), count pill, rows, View all.
- `TeamSmallTile`: the two smaller tiles (onboarding status + View progress; Reach out + Choose how).
- `TeamReachOutBlocks` + `TeamReachOutWay`: the reach-out ways as 2-up blocks. `TeamReachOutDoors` (static hooks the manager shell registers: `openGames`, `openComposer`, `openChat`).
- `TeamStatRow`, `TeamStatusRow`, `TeamDelayBanner`: View progress rows.
- `TeamVoice` + `TeamNotesField`: notes boxes with voice typing (speech_to_text), one listener per page.

Screens (T1): `manager/joiner_screen.dart` (person page, layout C + All tasks / View progress / Reach out sub-pages), `manager/team_meeting_screen.dart` (agenda, notes, voice typing, Mark as done), `manager/joiners_tab.dart` (Teams › Joiners list).
