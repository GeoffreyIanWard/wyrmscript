# Wyrmscript — working notes for Claude

Retro desktop word processor for long-form fiction. WordStar focus, Scrivener structure, early-Mac face, git underneath.

## Read these first

- [docs/ROADMAP.md](docs/ROADMAP.md) — **the plan.** Phase status, feature backlog (stable `F-nn` ids), known issues (`I-nn`). Update it in the same PR as the work it describes.
- [docs/design-brief.md](docs/design-brief.md) — the product/architecture spec. Sections marked `[LOCKED]` are firm.

## Workflow

- Work on feature branches; open a PR against `develop` for review. Never push directly to `develop` or `main`.
- Run git commands against this repo explicitly (`git -C /path/to/wyrmscript`) — the shell's working directory occasionally resets to the parent folder.
- Before pushing: `npm run test && npm run typecheck && npm run lint`.

## Architecture

- `src/main/wyrm/` — project format, isomorphic-git operations, IPC handlers, settings. Pure Node; keep it Electron-free where practical so it stays unit-testable (`project.ts` and `git.ts` are imported directly by tests).
- `src/preload/index.ts` — the only bridge; mirrors the `WyrmApi` interface in `src/shared/types.ts`.
- `src/renderer/src/` — React UI. `lib/api.ts` falls back to a full in-memory mock when `window.wyrm` is absent, so the browser preview exercises the whole UI without touching disk.
- A project is a folder (`Name.wyrm/`) that is also a git repo: `project.json` (binder tree + trash), `documents/<id>.md` (YAML frontmatter + Markdown body), `.git/`.

## House rules

- **The page is sacred**: no spellcheck, no autocomplete, no AI suggestions, no notifications in the writing terminal. Formatting is bold / italic / highlight only.
- **Nothing is ever lost**: any operation that replaces text (restore, adopt variant, bulk change) must safety-commit first. Never rewrite history — corrections are new commits.
- **The UI never says "git"**: it says checkpoint, version, variant, restore.
- Chrome uses the bitmap font; manuscript prose never does. Themes remap `--ink`/`--paper` and the dither/accent variables from one place in `styles/retro.css` — add new themes there rather than hardcoding colours.
- A failure in one panel must never take down the app. Dialogs own their loading/empty/error states.
- **Never return a fresh object from a zustand selector** (`s.entities.filter(...)`, `.map(...)`): the snapshot differs on every read and the component re-renders until React throws "Maximum update depth exceeded". Select the stable slice and derive during render.
- Auto-linking is _derived_ data: story-bible links are ProseMirror decorations, never marks, so they never get written into the manuscript file.

## Verifying UI work

`npm run dev` runs Electron; the same dev server URL opens in a plain browser against the mock. Drive real clicks when verifying interaction — synthetic events dispatched straight at elements bypass hit-testing and have hidden real bugs here before. Native dialogs (New/Open Project) exist only in Electron.
