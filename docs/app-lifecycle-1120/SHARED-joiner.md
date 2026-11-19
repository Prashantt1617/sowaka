# Shared joiner-side kit (lane J1 owns it)

Branch `app-lc-j1`. Everything below is in
`mobile-app/lib/features/lifecycle/onboarding/presentation/onboarding_kit.dart`
unless noted. Other joiner lanes: import it, don't edit it; ask for changes in
your report.

## Colours (on `OnbColors`, the artifact's values)

| Name | Value | Artifact use |
| --- | --- | --- |
| `successTint` / `successText` / `successLine` / `successDot` | #EAF9EE / #1F9D45 / #CFE3D6 / #30D158 | done, met, "You're in!", Replay borders, ticks |
| `blueTint` / `blue` | #EAF1FE / #2563EB | HR / Payroll faces, devices tile, policies task |
| `amberTint` / `amber` | #FFF4E5 / #B45309 | buddy face, tax task, "Setting up", "From Week 1" pills |
| `violetTint` / `violet` | #F3EEFF / #6B4FBB | Tasks tile icon, campus head, intro post |
| `rustTint` / `rust` | #FDECEC / #B23500 | POSH, Missed |
| `skyTint` / `skyText` | #E8F4FA / #BEEDFF | plant tile, text on blue cards |
| `tourGradient` | #CC4A12 → #B23500 → #872800, 135° | Sowaka tour card and tile |
| `spotlight` | rgba(0,0,0,.62) | the spotlight's dim |

## Widgets

- `OnbPulse(child, color, radius?, spread)`: the artifact's `pulse` ring (1.6 s), still when animations are off.
- `OnbPop(child)`: the artifact's `pop` (scale .6 → 1.08 → 1).
- `OnbBanner(icon, title, onTap, eyebrow?, subtitle?, color, gradient?, ...)`: the full-width banner with the pulsing white disc. Day 1's "Your first punch-in" (blue) and, for J2/J3, the Sowaka tour card: `OnbBanner(icon: Icons.play_arrow_rounded, eyebrow: 'SOWAKA TOUR · TOMORROW', title: lesson, subtitle: '1 min · 1 of 4 done', gradient: OnbColors.tourGradient, onTap: ...)`.
- `OnbCelebrationCard(eyebrow, title, subtitle?, art?, titleSize)`: the green card ("You're in!", and "Day 1, done!" at `titleSize: 36` with `Plant(stage: 1, size: 120, water: 3)`).
- `OnbDoneNote(title, subtitle?)`: white row with a green check tile ("Face registered").
- `OnbSpotlight(child, show, target: GlobalKey, callout, radius, onDismiss)`: dims everything but the target (ringed, still tappable) and puts the callout in a white bubble under it with an arrow.

## J1's own files (not shared, listed so others don't duplicate)

- `presentation/first_punch.dart`: `FirstPunchCard`, `FirstPunchTour` (the Actions-tab spotlight request), `PunchSpotlightCallout`, `YoureInScreen`, `openYoureIn`.
- `data/onboarding_models.dart`: `OnboardingHome.firstPunch` (`FirstPunch { at, faceEnrolled }`) and `needsFirstPunchOn(now)` (Day 1, server sent `firstPunch`, no punch yet). While it is true the home hides the `register_face` task from Up next and the list (the card stands for it).
- `onboarding_launcher.dart` now also exports `OnbSpotlight`, `OnbPulse`, `FirstPunchTour`, `PunchSpotlightCallout`, `openYoureIn`.
- Backend: `onboardingHome()` returns `firstPunch: { at?, faceEnrolled }` (backend/src/services/lifecycle/appOnboarding.ts).
- `quick_actions_screen.dart`: the Onboarding tile's Day-1 look (blue border, "Day 1" pill, pulse, "Today is your first day") and the spotlight over the Attendance card. J2 owns the Policies tile there ("3 to acknowledge", second in the grid); please keep edits to that tile only.
- `onboarding_home_screen.dart`: J1 adds only the `FirstPunchCard` slot right under the hero card (Day 1, before the first punch-in).
