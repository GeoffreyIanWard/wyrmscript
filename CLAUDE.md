# Wyrmscript — working notes for Claude

Retro desktop word processor for long-form fiction. WordStar focus, Scrivener structure, early-Mac face, git underneath.

## Read these first

- [docs/ROADMAP.md](docs/ROADMAP.md) — **the plan.** Phase status, the **Execution order** section (what to build next, and why it differs from the brief's numbering), feature backlog (`F-nn`), known issues (`I-nn`). Update it in the same PR as the work it describes.
- [docs/design-brief.md](docs/design-brief.md) — the product/architecture spec. Sections marked `[LOCKED]` are firm.

## Where things stand

Phases 1–4 are shipped: the retro shell and design system, the `.wyrm` project format with a binder and a TipTap writing terminal, the version-control UI (checkpoints, per-document history, prose word-diff, restore, snapshot variants), and the story bible (entity index, auto-linking, side panel, backlinks). **Geoffrey writes in this app for real** — his project lives at `~/Documents/testoria.wyrm`, which is useful for reproducing bugs against real data, and it means regressions cost him actual work.

Next up is Compile/Export — see the Execution order section of the roadmap for the reasoning and the agreed sequence after it.

## Workflow

- Work on feature branches; open a PR against `develop` for review. Never push directly to `develop` or `main`.
- **Always target `develop`; never stack a PR on another feature branch.** A stacked PR merges into its parent branch, so if the parent merges first the work silently lands off the mainline and GitHub still reports "merged" (this happened to Phase 4). If work depends on an unmerged branch, branch from it but still open the PR against `develop`, and after any merge verify with `git merge-base --is-ancestor <commit> origin/develop`.
- After a PR is merged, confirm the code actually reached `develop` before starting the next phase — commits pushed to a branch _after_ its PR merged are orphaned and need a fresh PR.
- Run git commands against this repo explicitly (`git -C /path/to/wyrmscript`) — the shell's working directory occasionally resets to the parent folder.
- Before pushing: `npm run test && npm run typecheck && npm run lint`.

## Architecture

- `src/main/wyrm/` — project format, isomorphic-git operations, IPC handlers, settings. Pure Node; keep it Electron-free where practical so it stays unit-testable (`project.ts` and `git.ts` are imported directly by tests).
- `src/preload/index.ts` — the only bridge; mirrors the `WyrmApi` interface in `src/shared/types.ts`.
- `src/renderer/src/` — React UI. `lib/api.ts` falls back to a full in-memory mock when `window.wyrm` is absent, so the browser preview exercises the whole UI without touching disk.
- A project is a folder (`Name.wyrm/`) that is also a git repo: `project.json` (binder tree + trash), `documents/<id>.md` (YAML frontmatter + Markdown body), `glossary/` + `characters/` + `world/` (one frontmattered file per story-bible entry), `.git/`.

### Implementation landmarks

Worth reading before touching the neighbouring code:

- `lib/markdown.ts` — the only bridge between stored Markdown and TipTap JSON. Supports paragraphs plus `**bold**`, `*italic*`, `==highlight==`, hard breaks. Serialization groups maximal runs per mark so round-trips are a fixed point; there are tests asserting that, including a fixture copied verbatim from a real project file.
- `main/wyrm/git.ts` — `commitAll` compares **blob hashes against HEAD** rather than trusting `statusMatrix`'s stat-based dirt check. Do not "simplify" that back: same-length edits landing inside one mtime second are invisible to stat comparison (racy git), which for this app means a silently lost draft.
- `lib/entities.ts` — the auto-link matcher: longest-match-wins alternation, Unicode lookaround word boundaries (accents work, possessives link), regex-escaped terms, collisions recorded rather than shadowed.
- `lib/entityLinks.ts` — the ProseMirror plugin that draws links as decorations. Scans per text block (so names split across marks are still found) and is debounced; `refreshEntityLinks(editor)` forces a re-scan after the index changes.
- `components/ErrorBoundary.tsx` — wraps the root and each dialog. An error thrown from a React effect otherwise unmounts the whole tree, which once left the app a dead white window with no way back to the manuscript.

## Testing

`npm run test` (vitest). Conventions:

- Pure logic and the main-process modules get plain node tests; `main/wyrm/project.ts`, `git.ts`, and `entities.ts` are Electron-free precisely so they can be imported directly and exercised against real temp dirs (`fs.mkdtemp`), including real git repos.
- UI failure modes and the editor get jsdom tests (`*.test.tsx`, `// @vitest-environment jsdom`), driving a real TipTap editor or React Testing Library rather than asserting on mocks.
- Don't commit tests that depend on a specific machine's files.
- When a bug is found, the fix lands with a test that reproduces it — every `I-nn` in the roadmap has one.

## Delegating work

Splitting a phase across agents works when the contract is written down first: define the types in `src/shared/types.ts`, then hand a subagent an **exclusive file list** (and an explicit do-not-touch list) so two writers never share a file. That is how the story bible's storage/IPC layer was built in parallel with its matching engine. Mechanical, well-specified layers (storage, IPC wiring, mock implementations, CSS themes, export templates) delegate well; subjective design and tightly coupled architecture do not.

## House rules

- **The page is sacred**: no spellcheck, no autocomplete, no AI suggestions, no notifications in the writing terminal. Formatting is bold / italic / highlight only.
- **Nothing is ever lost**: any operation that replaces text (restore, adopt variant, bulk change) must safety-commit first. Never rewrite history — corrections are new commits.
- **The UI never says "git"**: it says checkpoint, version, variant, restore.
- Chrome uses the bitmap font; manuscript prose never does. Themes remap `--ink`/`--paper` and the dither/accent variables from one place in `styles/retro.css` — add new themes there rather than hardcoding colours.
- A failure in one panel must never take down the app. Dialogs own their loading/empty/error states.
- **Never return a fresh object from a zustand selector** (`s.entities.filter(...)`, `.map(...)`): the snapshot differs on every read and the component re-renders until React throws "Maximum update depth exceeded". Select the stable slice and derive during render.
- Auto-linking is _derived_ data: story-bible links are ProseMirror decorations, never marks, so they never get written into the manuscript file.

## Verifying UI work

`npm run dev` runs Electron; the same dev server URL opens in a plain browser against the mock. Native dialogs (New/Open Project) and real filesystem/git behaviour exist **only** in Electron — the browser preview is mock-backed and never writes to disk.

- **Drive real clicks.** Synthetic events dispatched straight at elements bypass hit-testing and have hidden real bugs here: a click-away overlay stacked above a menu made every menu item dead, and the original verification missed it entirely because it fired events directly on the elements.
- Editing a file that the running app has hot-reloaded can reset store state mid-test; reload before drawing conclusions from a half-finished interaction.
- After changing main-process or preload code, **restart Electron** — a stale bridge against a fresh renderer produces failures that look like application bugs (this caused the white-screen report).
