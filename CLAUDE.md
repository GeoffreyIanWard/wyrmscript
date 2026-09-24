# WyrmStar — working notes for Claude

Retro desktop word processor for long-form fiction. WordStar focus, Scrivener structure, early-Mac face, git underneath.

## Read these first

- [docs/ROADMAP.md](docs/ROADMAP.md) — **the plan.** Phase status, the **Execution order** section (what to build next, and why it differs from the brief's numbering), feature backlog (`F-nn`), known issues (`I-nn`). Update it in the same PR as the work it describes.
- [docs/design-brief.md](docs/design-brief.md) — the product/architecture spec. Sections marked `[LOCKED]` are firm.

## Where things stand

**Almost everything in the Execution order section is shipped** as of v0.3.0 — the exception is the **corkboard** (Phase 6), which was never built and is still a `disabled: true` item in the View menu. This line previously claimed everything was done, which quietly hid the last outstanding feature. — all six phases, compile/export, local backup, GitHub sync, the full quality-of-life batch (comfort, navigation, writing stats), the whole story-structure cluster (pins/tags, timeline, plot graph, plotlines, character graph, nested locations, world map), folder view, Esc-as-back, and the home screen. v0.3.0 added real fullscreen (F-39), browse-by-tag (F-34), pagination with PDF/print and auto-print (F-38), and Manuscript mode (F-15). **Geoffrey writes in this app for real** — his project lives at `~/Documents/testoria.wyrm`, which is useful for reproducing bugs against real data, and it means regressions cost him actual work.

What's left: the **corkboard** (the last Execution-order item), and the backlog. F-34 (browse by tag), F-38 (pagination + auto-print), F-15 (Manuscript mode) and F-01 (local-only parity) have since shipped; the remaining items are 💭 (need design before they can be scheduled): F-16 (Wargames), F-17 (Hacker), F-18 (Gothic), plus the F-19 paid-tier product question. Two decisions are already settled for those: **motion is allowed in chrome only, never the page** (for F-17), and there is **no paid tier for now** (F-19 deferred). There is no longer a "next up" the roadmap decides on its own — pick one with Geoffrey and settle its open questions first.

## Workflow

- Work on feature branches; open a PR against `develop` for review. Never push directly to `develop` or `main`.
- **Always target `develop`; never stack a PR on another feature branch.** A stacked PR merges into its parent branch, so if the parent merges first the work silently lands off the mainline and GitHub still reports "merged" (this happened to Phase 4). If work depends on an unmerged branch, branch from it but still open the PR against `develop`, and after any merge verify with `git merge-base --is-ancestor <commit> origin/develop`.
- After a PR is merged, confirm the code actually reached `develop` before starting the next phase — commits pushed to a branch _after_ its PR merged are orphaned and need a fresh PR.
- Run git commands against this repo explicitly (`git -C /path/to/wyrmscript`) — the shell's working directory occasionally resets to the parent folder.
- Before pushing: `npm run test && npm run typecheck && npm run lint`.

### Cutting a release

1. Bump `package.json` on a `release/vX.Y.Z` branch and open a PR against `develop` (precedent: #54, #61). The About box reads the version from `package.json` at build time, so there is nothing else to update.
2. After it merges, tag `develop` with an **annotated** tag — `git tag -a vX.Y.Z -m "..."`.
3. `git push origin vX.Y.Z`. The tag push is what triggers the build.

**The tag annotation is the release text**: its first line becomes the release title, the rest becomes the notes. Write it the way it should read on the releases page — the house style is `vX.Y.Z — Headline feature`, matching v0.2.0 and v0.3.0. A lightweight tag has no message and falls back to GitHub's generated commit list, which is not what anyone wants to read.

`create_release` makes the release once before the three builders start, and is idempotent — it will not clobber notes edited by hand afterwards. Do not collapse it back into the build matrix: three parallel builders each creating the release is a race that kills two of them on `422 already_exists`, and on v0.3.0 that shipped a release with no `latest-mac.yml`, silently breaking macOS auto-update while every installer looked fine.

**Do not gate a release on `gh run watch --exit-status`** — it exited 0 on the v0.3.0 run even though the macOS job had failed. Check `gh run view <id>` and confirm the asset list matches the previous release's, name for name.

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
- `lib/compile.ts` — compile/export. Binder + documents are flattened into a format-independent block list (`CompileBlock` in `shared/types.ts`) first, and every output format is a pure function of that list, so selection/order/separator rules exist once. Markdown output goes back through `docToMarkdown`, which is what makes compiled Markdown byte-identical to the stored files. `lib/docx.ts` is a dependency-free OOXML + ZIP writer; keep it that way.
- `main/wyrm/sync.ts` — the GitHub sync engine. **The working tree is the single source of truth for every sync commit**: isomorphic-git's `merge` never touches the working directory, so it is only ever used as a conflict detector and a content oracle (`noUpdateBranch` both times), and the merged state is materialized to disk before being committed with explicit parents. Prose never auto-merges — frontmatter merges structurally, but both-device edits to a document's text always go to the writer. The header comment explains which silent-data-loss bug each rule prevents; do not "simplify" any of them away. Transport is injected (`SyncTransport`), which is how the whole engine is tested against real repos with no network.
- `main/wyrm/backup.ts` — mirrors a project into a second repo on disk. **isomorphic-git has no local transport** (`push` demands an HTTP client; `file://` and bare paths both fail), so this copies objects then moves refs, the way git's dumb protocol does. Three invariants hold it together and none are optional: objects land before refs move, every object is staged and renamed into place, and updates are fast-forward only with nothing ever deleted. The comment block at the top explains why each one prevents a specific, silent corruption.
- `lib/syncState.ts` — the single answer to "is this project actually connected" and "does a second copy exist anywhere". It exists because the surfaces disagreed: `mode` is stored intent, `remoteUrl` is read live from `.git/config`, and a remote removed outside the app leaves them contradicting each other. Gating on `mode` alone left Sync Now live with nowhere to push and made the status bar report `◆ SYNCED` for a project that was not synced. Anything answering "can we sync / is the work off this machine" uses these predicates rather than testing `mode` by hand.
- `lib/search.ts` — one index behind both ⌘K and ⇧⌘F, so "what is findable" is decided once. **Searches the plain-text projection, never the stored Markdown**: bodies carry `**`/`==` mid-sentence, so raw search silently misses any phrase spanning a mark and shows storage syntax in snippets. Parsed bodies are cached by string.
- `lib/useFocusTrap.ts` — dialog keyboard containment. Without it Tab walks out of a modal into the manuscript behind it, letting a keyboard-only writer type into a document they cannot see. Filters focusables by attribute, not layout, so it does not depend on a real layout engine.
- `components/MenuBar.tsx` — the WAI-ARIA menubar pattern (roving tabindex, ←/→ with or without a menu open, type-ahead, Esc). Follow the pattern rather than extending ad hoc; it is also what makes the bar screen-reader navigable.
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
- Chrome uses the bitmap font and manuscript prose a serif — **except where a palette says otherwise.** Manuscript (F-15) is the first palette to repaint both faces via `--font-chrome`/`--font-prose`; a palette that does this must keep the prose face a *reading* face, with atmosphere confined to the chrome. Because `data-palette` lives on `.screen`, any font/colour a palette overrides has to be **re-declared on `.screen`** — `body` sits above the attribute, and inheritance passes the already-resolved value down, so a variable resolved on `body` silently ignores every palette. Themes remap `--ink`/`--paper` and the dither/accent variables from one place in `styles/retro.css` — add new themes there rather than hardcoding colours. A palette is `[data-palette='name']` on the root and **must restate all five SVG data-URIs** (three dithers, two scrollbar arrows) with its own ink baked in; forgetting them leaves the previous theme's patterns behind. Glow and scanlines belong to the CRT palettes only. Most palettes flatten to strict two colours (`--highlight-bg: transparent`, accent-\* vars collapsed to `--ink`); a couple (Ledger, Arcade) deliberately don't. **`.page mark`'s box outline is unconditional, not scoped to any accent/palette combination** — it used to be `[data-accents='1bit']`-only, which left a highlight fully invisible under 4-bit accents plus any palette that suppresses the colour wash. Don't re-scope it; that reintroduces the bug. Page geometry (`--measure` in `ch`, `--prose-size`, `--prose-leading`) is set inline on the root from persisted appearance settings.
- A failure in one panel must never take down the app. Dialogs own their loading/empty/error states.
- **Never return a fresh object from a zustand selector** (`s.entities.filter(...)`, `.map(...)`): the snapshot differs on every read and the component re-renders until React throws "Maximum update depth exceeded". Select the stable slice and derive during render.
- Auto-linking is _derived_ data: story-bible links are ProseMirror decorations, never marks, so they never get written into the manuscript file.

## Verifying UI work

`npm run dev` runs Electron; the same dev server URL opens in a plain browser against the mock. Native dialogs (New/Open Project) and real filesystem/git behaviour exist **only** in Electron — the browser preview is mock-backed and never writes to disk.

- **Drive real clicks.** Synthetic events dispatched straight at elements bypass hit-testing and have hidden real bugs here: a click-away overlay stacked above a menu made every menu item dead, and the original verification missed it entirely because it fired events directly on the elements.
- Editing a file that the running app has hot-reloaded can reset store state mid-test; reload before drawing conclusions from a half-finished interaction.
- After changing main-process or preload code, **restart Electron** — a stale bridge against a fresh renderer produces failures that look like application bugs (this caused the white-screen report).
