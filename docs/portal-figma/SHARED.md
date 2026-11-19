# Shared pieces (G1) — reuse these, don't rebuild

Branch: `portal-figma-g1` (git can't hold `portal-figma/g1` next to the existing `portal-figma` branch).
Merge it into yours: `git fetch origin && git merge origin/portal-figma-g1`.

## Tokens and CSS — `preboarding-web/src/styles/fig.css`
- Root class `.fig` carries the Figma variables by their own names: `--color-bg-*`, `--color-text-*`,
  `--color-border-*`, `--space-2…40`, `--radius-md|lg|xl|full`. Use them in your `fig-g<N>.css`.
- Type classes: `fig-display` 28/36 bold, `fig-heading` 22/28 bold, `fig-title` 18/24 semi, `fig-subtitle` 16/22 semi,
  `fig-body` 14/20, `fig-body-strong`, `fig-label` 12/16, `fig-label-strong`, `fig-caption` 11/16, `fig-caption-strong`;
  colour helpers `fig-t2`, `fig-t3`, `fig-brand`, `fig-success`.
- Layout: `fig-body-col` (a section body: 16 px gutter, 16 top, 32 bottom, 16 gaps).

## Shell — `preboarding-web/src/components/fig/FigShell.tsx`
- `FigPage` — the 393 px phone column (`surface` = white page; default canvas grey). Imports fig.css.
- `FigHomeHeader` — Header · company (36 px logo tile + name), as on App · 3 Home.
- `FigBackHeader` — Header · section: 40 px tinted back button (`FigBack` 22 px) + 18/24 title.
  Props: `back` (route) or `onBack`, `side` (right text, e.g. "Step 3 of 7"), `flat` (no border), `below` (e.g. step segments under the row).
- App host: when `<html data-host="app">` (the /app WebView entry), fig.css hides `FigHomeHeader` (`.fig-head--brand`)
  and the old `.a1-web-head` / `.a1-web-foot`; `FigBackHeader` stays (in-page back). Don't add other top chrome
  of your own — if you must, give it `fig-head--brand` so it hides too.
- `FigLogo`, `FigPowered` ("Your company's app is powered by SOWAKA"), `FigLoading`.

## Components — `preboarding-web/src/components/fig/FigUi.tsx`
- `FigField` — label 12/16 semi, 44 px input (canvas bg, 1 px border, r12, focus = brand border), help 11/16, error.
  CSS for raw inputs: `.fig-input`.
- `FigIntro` — 32 px 3D icon + 14/20 secondary text (the line under every section header).
- `FigNote` — canvas note with the 16 px info icon, 12/16 text.
- `FigList` (+ `as="dl"`) and `FigKv` (label tertiary / value semibold right), `FigRow` (link row: lead, title, sub, chevron).
- `FigChip` (tones success | info | warning | neutral | brand), `FigProgress` (8 px; `white` track), `FigPdf` (40×48 tile).
- `FigActions` — bottom actions (48 px primary + a note line); `bar` = sticky white bar with top border.
- Buttons are CSS: `.fig-btn` (48 px primary, r16, 15/20), `.fig-btn--outline` (42 px, border, brand 14), `.fig-btn--white`
  (40 px on tinted tiles), `.fig-btn--inline`, `.fig-link`.
- Other CSS bits: `.fig-card`, `.fig-lead` (40 px round grey lead), `.fig-done` (24 px green check circle), `.fig-bullet`, `.fig-note`.

## Icons — `preboarding-web/src/components/fig/icons/` (import from `./icons`)
Paths copied from the frames' SVG exports; `size` scales, `stroke` overrides the px stroke; colour = `currentColor`.
- `FigBack` 22 · `FigChevronRight` 20 · `FigCheck` 18 · `FigCheckSmall` 14 · `FigMail` 32 · `FigEye` 18 · `FigDownload` 18
- `FigInfo` 16 · `FigCalendarPlus` 18 · `FigClock` 20 · `FigPin` 20 · `FigPass` 20 · `FigMessageCircle` 18
- `FigShield` 22 · `FigCalendar` 22 · `FigFileText` 26 · `FigPlay` 24 (filled) · `FigWavingHand` 24 (colour)
- `FigIcon3D name=…` — the 3D PNGs (`src/assets/fig3d/`): bank, calendar, document-approved, id-card, phone, team, user, write.
  Need another 3D icon? Download it (192 px, `sips -Z 192`) into `src/assets/fig3d/` and add it to `Icon3D.tsx` — tell G1.
- Your own icons: `icons/g<N>-Name.tsx` using `FigSvg` from `icons/svg.tsx`.

## Host (app WebView vs browser)
- `isAppHost()` (FigShell) — true under `<html data-host="app">`. Use it only where the App and Web frames draw
  different content (sign-in copy, offer reply chip, About first-person card, buddy label, "Step N of 7").
- CSS: `fig-g3.css` hides `.g3-web` in the app and `.g3-app-only` on the web; on the web `FigHomeHeader` and
  `FigPowered` give way to G3's header/footer.
- Fields: `.fig-input` is canvas on white pages (sign in); white inside cards (`.fig-card .fig-input`,
  `.fig-input--white`, G2's `.g2-card .fig-input`); `[readonly]` is subtle grey. `.fig-link`'s padding reset is
  zero-specificity (`:where`), so screen CSS can pad links.

## G2 pieces (shared)
- `components/fig/G2Steps.tsx` — `G2Steps segs` (7 × 4 px segments): `<FigBackHeader below={<G2Steps segs={…} />} />`.
- `components/fig/G2Upload.tsx` — `G2UploadTile` (dashed upload tile), `G2FileRow` (uploaded file + status + action),
  `G2DocUpload` (a template document: rows, HR's note, upload/replace).
- `components/fig/G2ProfileSections.tsx` — `G2SectionForm`: all seven profile sections (step header, done note,
  intro, cards, Save and continue / Save and finish later). Personal, contact and emergency were added by G1.
- `components/fig/G2Profile.tsx` — `G2PrivacyNote`, `G2PhotoTip`, `G2MonthInput`; `G2Story.tsx` — the stories.

## G3 pieces (web-only chrome; each hides itself in the app)
- `components/fig/G3WebShell.tsx` — `G3WebHeader` (sign in, code), `G3WebTop` / `G3WebBottom` (signed-in pages),
  `G3Crumb`, `G3SectionHead` (crumb on the web, `FigBackHeader` in the app; `white` for About).
- `components/fig/G3Install.tsx` — the web install page when `me.view === 'joined'` (home returns it on the web).
