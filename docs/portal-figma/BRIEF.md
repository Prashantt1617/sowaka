# Pre-boarding portal from Figma — brief

Figma file `iR1u5kUixarUHeVIU6jiHn` (Sowaka Connect). 39 frames, 393×852 (phone), named like "App · 1 Sign in with work email". The user: **each page must match the design exactly**. Base branch: `portal-figma` (off main 5dee0f55).

Where: `preboarding-web/` (React + Vite; screens in src/screens, the current look is the A1 set: A1Shell.tsx, A1Home.tsx, A1Profile.tsx, A1Sections.tsx, A1About.tsx, styles/a1.css; API in src/api). The portal is served at /onboarding/ (built with `VITE_API_BASE_URL`).

## Groups (one agent each; the order is the flow order)
- **G1**: 4967:92574, 4967:92599, 4967:92642, 4967:92722, 4967:92809, 4967:92891, 4967:92990, 4967:93155, 4967:93226, 4967:93303
- **G2**: 4967:93357, 4967:93433, 4967:93530, 4967:93612, 4967:93675, 4967:93718, 4967:93759, 4967:93809, 4967:93854, 4967:93905
- **G3**: 4967:93936, 4967:93985, 4967:94069, 4967:94182, 4967:94290, 4967:94393, 4967:94513, 4967:94687, 4967:94766, 4967:94851
- **G4**: 4967:94913, 4967:94997, 4967:95102, 4967:95192, 4967:95263, 4967:95306, 4967:95347, 4967:95397, 4967:95442

## Rules to avoid stepping on each other
- Branch `portal-figma/g<N>` off `origin/portal-figma`. Commit only your screens.
- **G1 owns the shared shell and tokens** (`styles/a1.css` tokens, A1Shell, shared components like buttons, fields, upload tiles, top bar, progress bar). Others: put screen CSS in `styles/fig-g<N>.css` and new components in `src/components/fig/G<N>*.tsx`; if you need a shared change, write it in your report (file + exact change), don't edit G1's files.
- Reuse the existing API calls and routes; keep every behaviour that works today (sign-in by code, profile save, uploads, offer accept, etc.). If a design needs data the API lacks, list it in your report; no backend edits.
- Local test stack (shared, already running; never stop it): backend http://localhost:4123 on mongod 127.0.0.1:27133, DB el_demo_portal (seeded demo). Sign in with dev.choudhary@example.com, code 123456 (also aditya.narang@example.com). Run your own vite: `cd preboarding-web && VITE_API_BASE_URL=http://localhost:4123 npx vite --port 530<N> --strictPort` (CORS allows 5301–5304).
- Verify exactly: for every frame, render the built screen at 393×852 in headless Chrome (puppeteer-core at /private/tmp/claude-501/-Users-kritik-sowaka/58eab287-5a56-46ff-961a-427d5ab396c1/scratchpad/pt/node_modules/puppeteer-core, Chrome at /Applications/Google Chrome.app) and compare against the Figma screenshot side by side; fix until spacing, sizes, colours and copy match. Save pairs to /private/tmp/claude-501/-Users-kritik-sowaka/58eab287-5a56-46ff-961a-427d5ab396c1/scratchpad/portal-figma/g<N>/<node>-{design,built}.png.
- The Mac has 8 GB and is swapping: run builds, type-checks and Chrome under `lockf -k /tmp/sowaka-heavy.lock <cmd>`; quit Chrome after each batch; stop your vite when done.
- Never merge, deploy, upload or touch production. Type-check: `cd preboarding-web && npx tsc --noEmit -p tsconfig.app.json` (or the tsconfig the project uses).
- Report: per frame — which route/screen, match notes (what still differs and why), files changed, the shared changes you need from G1.

## Icons (the user: "make sure each icon is picked perfectly")
Use the design's own icons: take them from Figma (get_design_context asset URLs or download_assets) as SVG and inline them; never swap in a similar icon from a library or draw one by eye. Same size, stroke and colour as the frame. Put shared ones in `src/components/fig/icons/` (one file per icon, named after the Figma layer) — G1 creates the folder; others add their own files there with a `g<N>-` prefix if the icon is only theirs.
