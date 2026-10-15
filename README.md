# NEON BLOCKS — 3D Tetris

A complete, guideline-accurate Tetris rendered in WebGL with three.js. Glossy
glass blocks, bloom, particle bursts on line clears, camera shake, and a neon
arcade HUD. Runs entirely offline — three.js is vendored, every sound is
synthesised with the Web Audio API, and the UI uses system fonts (no remote
font downloads), so there are no asset downloads.

## Run it

**Double-click `Play Tetris.bat`.** It starts the local server in the
background (no console window is left behind) and opens the game in your
browser. Double-click it again at any time — if it is already running it just
opens the browser. `Stop Tetris.bat` shuts the server down when you are done.

The game cannot be opened straight from the filesystem: it uses ES modules plus
an `<script type="importmap">`, which browsers refuse to load over `file://`.
That is why a local server is part of playing it.

Prefer the terminal, or need the flags?

```bash
npm ci --ignore-scripts --no-fund --no-audit  # optional dependency reinstall
npm start       # stages public/ and serves it on http://127.0.0.1:5199
node scripts/play.mjs --no-open   # start the server without opening a browser
node scripts/stop.mjs              # stop a server started by the launcher
```

Then open <http://127.0.0.1:5199>. The game itself is plain ES modules with no
build step; `npm start` only stages a static asset tree and serves it.

The launcher only starts a server for this project, never adopts or kills an
unrelated process: if something else already holds port 5199 it exits with an
explanation instead of opening something that is not the game, and `Stop
Tetris.bat` verifies the recorded process really is this project's
`serve.mjs` before terminating it.

## Security / launch hardening

- `npm run dev` and `npm start` use only built-in Node HTTP/filesystem modules:
  no `npx`, third-party server, subprocess, update check, clipboard access,
  or outbound network requests. With Node installed, `node scripts/serve.mjs`
  launches without installing dependencies; game dependencies are vendored.
- The server explicitly calls `listen(5199, '127.0.0.1')`. A port collision
  exits nonzero with `EADDRINUSE`; there is no alternate-port/wildcard fallback.
- Before listening, staging validates all sources, destination components,
  the generated ownership manifest, and the entire existing public inventory.
  Any unexpected/unowned file or directory, linked root/parent/leaf, malformed
  ownership data or destination collision refuses launch before staging writes.
  Unknown data is preserved, not deleted. Only fixed game asset routes and `/`
  are served; directory listings, ownership metadata and `serve.json` are never
  exposed. Each request rechecks asset components and resolved containment.
  Traversal, backslashes, NUL, malformed encoding and non-GET/HEAD methods are
  rejected. This is a local development server, not an authenticated public service.
- Fonts: the Google Fonts `<link>`/preconnects were removed; the existing CSS
  falls back to `system-ui` / `ui-monospace` stacks.
- Install caveat: dependency reinstallation is a deliberate, network-capable
  step; use the committed lockfile with `npm ci --ignore-scripts --no-fund --no-audit`.
  Nothing is installed globally. Launch itself needs no dependency download.
- Rollback: the pre-change snapshot lives at
  `C:/Users/User/AppData/Local/Temp/TetrisSecurityHardening/project-before.zip`;
  Only a known generated `public/` tree is disposable. Do not delete unknown
  data to bypass a staging failure; move/review it explicitly first.

```bash
npm test        # 74 rule/scoring/rotation regression tests, runs in Node
npm run test:security  # staging fixtures and bounded localhost security checks
```

Three suites run: `test/tetris.test.mjs` (the original suite),
`test/tetris.indep.test.mjs` (written by an independent reviewer), and
`test/rotation.test.mjs` (pins the SRS rotation cell tables). All cross-check
each other and the whole set must stay green.

## Controls

| Key | Action |
|---|---|
| `←` `→` | Move (with DAS auto-shift) |
| `↓` | Soft drop |
| `↑` / `W` | Rotate clockwise |
| `Z` / `Ctrl` | Rotate counter-clockwise |
| `Space` | Hard drop |
| `C` / `Shift` | Hold |
| `Esc` / `P` | Pause |
| `R` | Restart (after game over) |
| `M` | Mute |

On touch devices the on-screen buttons appear automatically.

## Game rules implemented

- **7-bag randomiser** — all seven pieces appear once per bag, in order.
- **SRS rotation** with the full wall/floor kick tables (separate tables for
  the I piece, as the guideline requires).
- **Hold** once per piece; resets on lock.
- **Ghost piece** showing the exact landing position.
- **Lock delay** of 0.5 s with move-reset, capped at 15 resets.
- **T-spin detection** by the 3-corner rule, including the mini variant.
- **Scoring**: guideline table with level multiplier, back-to-back 1.5×
  multiplier on tetrises and T-spins, combo bonuses, and perfect-clear bonuses.
- **Game over** by block-out and lock-out.
- Gravity accelerates on a standard level curve (10 lines per level).

## Project layout

```
index.html            markup + import map (maps "three" to the vendored copy)
Play Tetris.bat       double-click to play (starts the server + opens a browser)
Stop Tetris.bat       double-click to shut that server down
styles/main.css       HUD, overlays, responsive rules
src/
  tetris.js           pure game core — no DOM, no three.js, testable in Node
  main.js             wires core + renderer + HUD + input + audio
  input.js            keyboard/touch, DAS-ARR handling
  hud.js              DOM overlay: score, previews, labels, overlays
  audio.js            procedural Web Audio sound effects
  scene/
    renderer.js       three.js scene, camera, lighting, bloom, frame loop
    blocks.js         pooled block meshes + static board furniture
    particles.js      instanced GPU particle bursts
    palette.js        colours and materials
scripts/
  play.mjs            launcher: start the server, wait for it, open the browser
  stop.mjs            shut down a launcher-started server
  serve.mjs           dependency-free localhost static server
  stage-public.mjs    builds the allowlisted public/ tree the server serves
test/
  tetris.test.mjs     regression suite for the game core
  rotation.test.mjs   pins the SRS rotation cell tables
vendor/three/         three.js r169 (build + the addon modules used)
```

The game core (`tetris.js`) has no dependency on the renderer or the DOM, so
the rules can be tested headlessly — which is how the scoring tables and the
T-spin rules are verified.

## Notes

- Three.js addon modules import the bare specifier `"three"`, which only
  resolves through an **import map** (declared in `index.html`). Without it the
  page fails to load.
- Blocks are pooled (240 pre-allocated meshes) and rebuilt from the grid each
  frame; nothing is allocated per frame during play.
- Retune the entire look from `src/scene/palette.js` and `PIECE_COLORS`.