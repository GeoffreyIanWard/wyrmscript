# Wyrmscript Roadmap

Single source of truth for what's built, what's next, and what's known broken.
Product spec lives in [design-brief.md](design-brief.md); this file tracks execution against it.

**Status:** ✅ shipped · 🔨 in progress · 📋 planned · 💭 needs design · ❄️ deferred

---

## Phases

The phased build order from design-brief.md §11. One PR (or small series) per phase.

| #   | Phase                      | Status | Notes                                                                                                                                                              |
| --- | -------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Scaffold & aesthetic proof | ✅     | Electron+React+TS+Vite, 1-bit design system, both typefaces, phosphor themes. PR #1                                                                                |
| 2   | Core loop                  | ✅     | `.wyrm` format, binder, TipTap terminal, autosave, local git from day one. PR #2                                                                                   |
| 3   | Version control UI         | ✅     | Commit dialog, per-doc history, prose word-diff, restore, snapshot variants. PR #3, with the bug fixes and this roadmap following in PR #4                         |
| 4   | Story bible                | ✅     | Entity index over glossary/characters/world, debounced auto-linking in the terminal, click-to-side-panel, add-from-selection, entry editors, backlinks. PRs #5, #6 |
| 5   | GitHub sync                | ✅     | OAuth device flow, sync engine, offline queue, conflict resolution UI, local-only first-class. PR #11                                                              |
| 6   | Suggested extras           | 🔨     | Compile/export shipped (PR #8); corkboard, full-project search, writing stats, command palette still to come                                                       |

**Locked v1 decisions** (confirmed 2026-07-29): 1-bit default palette with entity links distinguished per type; entity click opens a side panel; character/world entries free-form; compile/export, backlinks, auto-commit safety net, and command palette all in v1; variants are frozen snapshots (not editable branches).

---

## Execution order

**Phases 1–4 are shipped and the app is in real daily use, which changes what matters next.** The brief's numbering above still describes the _scope_ of each phase, but the running order below supersedes it. Reprioritized 2026-07-30, agreed with Geoffrey.

### 1. Compile / Export ✅

Assemble binder items into a finished manuscript — the app can now get prose back out. **File → Compile Manuscript… (⇧⌘E).** Shipped in PR #8.

- **Selection**: a checkbox tree over the binder; ticking a folder takes everything beneath it, and folders show a partial state. Binder order is the output order. Trash is excluded _by construction_ — `trash` is a separate tree that the compiler never walks, and a test passes a trashed id in explicitly to prove it cannot leak.
- **Formats**: plain text, Markdown, and `.docx`. The `.docx` writer is dependency-free (`lib/docx.ts` builds the OOXML and its own stored-entry ZIP), so no new packages entered the tree.
- **Scene separators**: `#`, `* * *`, blank line, or a custom string; a page break replaces the separator at folder boundaries in `.docx`.
- **Front matter**: optional title page with the project title and the compiled word count.
- **Formatting**: bold/italic/highlight map to each format — Markdown re-uses the editor's own serializer, so compiled Markdown is byte-identical to the stored files (tested against real fixtures). Plain text keeps the words and drops the markup, since inventing asterisks would just be Markdown again.
- **Safety**: a checkpoint is committed before compiling, and the documents are re-read afterwards, so the exported manuscript is always a state that can be returned to.
- The dialog shows a live preview plus word and document counts, comparable with the status bar.

Deferred: EPUB and PDF (the hard formats — the block model in `shared/types.ts` is format-independent, so each is a new serializer rather than new plumbing).

### 2. Local backup remote (cheap half of F-01) ✅

Off-machine redundancy with no account, no OAuth and no network. **Project → Backup…** mirrors a project into a second repository on disk (external drive, synced folder, network share) and restores from one. Shipped in PR #10.

**The premise in the original plan was wrong, and it matters for Phase 5.** "A git remote can be a filesystem path" is true of real git but **not of isomorphic-git**, which has no local transport at all — `push` requires an HTTP client, and both `file:///path` and a bare path fail with `MissingParameterError`. Shelling out to system git would break the brief's §10 decision to require no git install. So the mirror is done the way git's own "dumb" transport does it: copy objects, then move refs. See `main/wyrm/backup.ts`, which documents the three invariants that make that safe:

1. **Objects are copied before refs move.** Interrupted halfway, the backup holds unreferenced objects (harmless garbage) and its refs still describe a complete, older history. The reverse order leaves a ref pointing at a missing object — a corrupt repository.
2. **Every object is staged and renamed into place.** A torn write sitting at its final name would be treated as "already present" by every later backup, making the corruption permanent and silent.
3. **Fast-forward only, and nothing is ever deleted.** If the backup holds commits this project does not, the backup is left untouched and the writer is told. There is deliberately no force option.

Also shipped: the backup carries variant branches, not just the main line; restore always creates a **new** project folder so it cannot overwrite an open one; auto-backup after each checkpoint is opt-in and can never block or fail a commit; and a successful backup is verified by reading every file of the manuscript back **out** of the backup, so "backed up" means "provably recoverable" rather than "the copy returned no error".

### 3. Phase 5 — GitHub sync (+ the rest of F-01) ✅

Shipped in PR #11: OAuth device flow, auto-sync after each checkpoint, offline queueing, the merge-conflict resolution screen on the existing diff viewer, and local-only as an explicit first-class choice. **Project → Sync Settings… / Sync Now.**

Design decisions that will matter later, recorded in `main/wyrm/sync.ts`'s header:

- **The working tree is the single source of truth for every sync commit.** isomorphic-git's `merge` never touches the working directory (verified by experiment) — trusting its ref move would let the next autosave commit the stale tree back over the merge, silently undoing the other device's work. So `merge` is only ever a conflict *detector* and a content *oracle* (`noUpdateBranch` both times); the final state is always materialized to disk first and committed from there with explicit parents.
- **Prose never auto-merges.** diff3 would happily interleave paragraphs of fiction edited on two devices; in a prose tool that is not a feature. Frontmatter merges structurally (newer `modified` wins, per-field three-way — so timestamp noise never nags), but two devices editing the same document's *text* always goes to the writer: keep mine / take theirs / keep both, with "both" shelving the other device's version as a variant pointing at the remote commit itself.
- **A binder conflict cannot orphan a document.** After every merge, any `documents/*.md` not reachable from binder or trash is re-attached to the binder root as "(recovered)" — resolving project.json either way is safe.
- **The sacred page holds for sync.** A background sync that finds conflicts raises a quiet status-bar flag; only a sync the writer asked for may open the resolution screen.
- Auth: device flow (no client secret; the one-time OAuth app client id is entered in Sync Settings), token encrypted via the OS keychain (`safeStorage`) at rest, remote URL in `.git/config` — none of it ever inside the synced content.

Deferred from this pass: syncing to a remote whose default branch isn't `main`; structural (rather than mine/theirs) binder merge; multi-account.

### 4. Quality-of-life batch — **next up** 📋

F-06 (margins/measure), F-05 (more retro themes), F-07 (full keyboard navigation), plus full-project search, the ⌘K command palette, and writing stats. All well-specified and largely independent — the best delegation candidates in the whole plan, and several are close to pure CSS.

### 5. Story-structure trio (F-02, F-03, F-04) 💭

Timeline, plot graph, and plotline tracking. **Design these together before building any of them**: all three hang off scene-level metadata (chronology, tension, plotline tags), so the metadata model should be designed once rather than three incompatible times. High-value thinking, low-volume output.

---

## Backlog

Requested features, not yet scheduled. Stable IDs so they can be referenced in commits and PRs.

### F-01 · Local-only version control (no GitHub required) 📋

Users who want everything on their own machine must get full version-control parity — history, diff, restore, variants, branches — with no account and no network. Wyrmscript already uses **isomorphic-git** (open-source, MIT), so the entire engine is local; GitHub is only a _remote_. Work needed:

- ✅ "No remote" is an explicit, first-class choice — the sync setup screen's first question, with local-only phrased as a peer of GitHub, not a fallback (PR #11).
- ✅ **Optional local backup target** — shipped in PR #10 (see Execution order §2). Note for whoever does the rest: isomorphic-git has **no local transport**, so this was built from git plumbing rather than `push`; GitHub sync gets a real HTTP transport and cannot reuse that code path.
- ✅ Sync surfaces degrade silently with no remote: Sync Now is disabled, the status bar shows plain `◆ LOCAL`, nothing nags (PR #11).
- Confirm every Phase 5 sync surface degrades cleanly and silently when no remote exists (no nagging, no dead buttons).
- Document the trade-off honestly: local-only means a disk failure is unrecoverable; recommend at least one off-machine copy.

**Note:** this reorders Phase 5 slightly — local-first is the default path, GitHub sync becomes opt-in. Cheap to do now, expensive to retrofit.

### F-02 · Timeline 💭

Arrange scenes and standalone event cards on a chronological timeline of story events — distinct from binder order, because narrative order ≠ chronology (flashbacks, parallel threads). Design questions to settle:

- Do events carry in-world dates (a custom calendar?), relative ordering only, or both?
- Are timeline cards the same objects as binder scenes, or can they exist independently (backstory that's never a scene)?
- One timeline per project, or several (per POV, per thread)?

### F-03 · Plot graph 💭

Scenes plotted on a graph board to visualize dramatic shape — rising action, climaxes, falling action, resolution. Sketch: x-axis = narrative order (or timeline), y-axis = tension/intensity set per scene (drag a node to set it), producing a curve the writer can read at a glance. Open questions: is tension a manual 0–10 value per scene, or derived from something? Multiple curves overlaid per plotline (ties into F-04)?

### F-04 · Plotline tracking 💭

Track main plot, B-plots, romance/love-interest arcs, character arcs — and surface unresolved threads. Needs design, but the shape is likely: a **plotline** entity (name, type, colour, status) that scenes get tagged with, plus per-plotline setup/payoff beats so the app can answer "which threads are still open?" and "which scenes advance this arc?" Reuses the Phase 4 entity index and can share the label/colour chrome already in the binder. Natural companion to F-02 and F-03 — all three want scene-level metadata, so design the metadata model once for all of them.

### F-05 · More retro visual variants 📋

More themes, more intensely period. Candidates: Apple II / Commodore 64 / ZX Spectrum palettes, IBM CGA (cyan-magenta), plasma orange, Macintosh Plus warm grey-green, DOS EGA 16-colour, a paper-white "LaserWriter proof" mode. Also: optional CRT curvature/bloom/flicker, and the classic Mac UI click/chime sound set from design-brief.md §2 (off by default). The theming layer already remaps ink/paper/dither/accents from one place, so new variants are mostly a palette block each.

**Comfort variants** (requested 2026-07-30) — same mechanism, different intent: ergonomic rather than period-authentic, still strictly two-colour so the 1-bit look holds.

- **E-reader**: light warm grey paper, dark blue ink — subtle, easy on the eyes, mimics an e-ink screen.
- **Night mode**: warm tan paper, brown ink — for writing after dark without the searing white page.
- **Dark mode**: straight inverse of the default — black paper, white ink.

Design note before building: today there are two theme axes — `data-accents` (1bit/4bit) and `data-terminal` (paper/green/amber), and the terminal axis only recolours the writing pane. These three variants want to recolour the **whole app**, chrome included, which is what the phosphor themes already do via the root CSS variables — so they likely extend the terminal axis (or promote it to an app-wide "palette" axis) rather than adding a third. Decide that once, then each variant is a palette block. Dithers are inline SVG data-URIs carrying a hardcoded fill per theme — new palettes must remember to restate them (the phosphor themes show the pattern).

### F-06 · Editor margins & measure control 📋

Let the writer control page geometry in the writing terminal: margin width / line measure (currently a fixed 62ch), font size, line height, and first-line indent (the indent toggle shipped early as part of the drift fix — see I-03). Belongs in Preferences beside the existing typography settings.

### F-07 · Full keyboard navigation 📋

Every menu and panel reachable and operable without the mouse — the WordStar half of the app's lineage (design-brief.md §1, pillar 3) currently only holds inside the editor. What exists today: global shortcuts (⌘S, ⌘Y, ⌘N, ⇧⌘N, ⌘,), and menu items are already real `<button>`s with `role="menuitem"`, so the semantics are in place. What's missing:

- **Menu bar**: a key to enter the menu bar, then ←/→ between menus, ↑/↓ between items, Home/End, Enter to activate, Esc to close, and type-ahead to jump to an item by first letter. This is the WAI-ARIA menubar pattern (roving `tabindex`) — worth following it rather than inventing, since it also makes the app screen-reader navigable.
- **Dialogs**: focus trap while open, Tab/⇧Tab cycling, Esc to cancel everywhere (only the commit field handles it today), Enter for the default button.
- **Binder**: ↑/↓ through rows, ←/→ to collapse/expand folders, Enter to open or rename, ⌫ to trash — plus a shortcut to move focus between binder, editor, and side panel.
- **Discoverability**: show the shortcut in the menu item that triggers each action (already partly done), and consider a keyboard-shortcut reference sheet.

Related: the ⌘K command palette (Phase 6) covers fast _navigation_ but is not a substitute for operating the existing menus; the optional WordStar Ctrl-key diamond (design-brief.md §3) is a separate opt-in keymap that should be designed alongside this so the two don't fight over bindings.

### F-08 · Folder view (document browser) 📋

Clicking a folder in the binder currently only expands or collapses it. It should also open a **file-explorer view of that folder's documents** in the main pane — one row per document with word count, created and last-modified timestamps, and status/label (both already exist in `DocMeta`). Requested 2026-07-30.

- **Keep it plain.** A sortable list of rows, chrome font, 1-bit — not a table with borders everywhere, and not the corkboard (that is a separate Phase 6 item with index cards). The point is to see a folder's shape at a glance, so the columns should earn their place: title, words, modified. Created and status are useful but secondary.
- Clicking a row opens that document; the folder view is a _destination_, so `MainView` gains a `{ kind: 'folder'; id }` case alongside `doc` and `entity` (see I-05 — that union is what decides the main pane).
- Word counts for non-open documents need every body read, which `readAllDocs` already does; the compile dialog does the same thing and could share the loader.
- Open question: does clicking a folder replace expand/collapse, or does the twist stay the expander and the row body become the navigation target? The second is less surprising and matches the Finder lineage.

---

## Known issues

| ID   | Issue                                                                                                                                                                                                                                                                                                                      | Status                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| I-01 | History dialog white-screened the whole app with no way out — an uncaught error in a React effect (failing IPC call after a stale dev hot-reload) unmounted the entire tree                                                                                                                                                | ✅ fixed: ErrorBoundary + recovery panel                                            |
| I-02 | History list rendered blank with no explanation — a rejected `api.log` promise left state `null`, which rendered neither rows nor the empty-state message                                                                                                                                                                  | ✅ fixed: explicit loading/empty/error states                                       |
| I-03 | First-line indent drifted right and stayed shifted — `text-indent: 2ch` on every paragraph (measured 44.4px vs 24px) is jarring while typing and inconsistent with hard-break lines                                                                                                                                        | ✅ fixed: off by default, Preferences toggle                                        |
| I-04 | Highlight mark shifted text ~2px horizontally because its box used padding                                                                                                                                                                                                                                                 | ✅ fixed: negative-margin compensation                                              |
| I-05 | Clicking a document in the binder while a story-bible entry was open selected the row but left the entry in the main pane. Two stacked causes: `selectDoc` never reset `mainView`, and it returned early when the clicked document was already active — exactly the case a writer hits returning to the document they left | ✅ fixed: `selectDoc` restores the manuscript view _before_ the same-document guard |

---

## How we track work

- **This file is the plan.** Update it in the same PR as the work it describes — status changes, new backlog items, new known issues.
- **Backlog IDs are permanent** (`F-01`, `I-02`). Reference them in commit messages and PR titles so history stays greppable.
- **Bugs get logged here with their root cause**, not just a symptom, and are only marked fixed when there's a test or a verified reproduction behind the fix.
- **Feature requests land in the backlog immediately**, even half-formed — 💭 means "needs design before it can be scheduled," which is a real status, not a parking lot.
- **Execution order beats phase numbering.** The phase table describes scope; the Execution order section says what to build next and why. Re-sequence it deliberately, with the reason written down, rather than letting the brief's numbering decide by default.
- **Verify a merge actually landed** on `develop` before starting the next item (`git merge-base --is-ancestor <commit> origin/develop`). Two batches of work have silently missed the mainline — see the workflow rules in `CLAUDE.md`.
- **Start a fresh session per work item.** Long sessions re-send their whole history every turn; this file plus `CLAUDE.md` exist so a new agent can pick up full context in two reads instead.
