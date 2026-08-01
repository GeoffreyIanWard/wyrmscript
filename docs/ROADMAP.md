# WyrmStar Roadmap

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
| 6   | Suggested extras           | 🔨     | Compile/export (PR #8), full-project search + command palette (PR #13) and writing stats (PR #22) shipped; corkboard still to come                                 |

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

- **The working tree is the single source of truth for every sync commit.** isomorphic-git's `merge` never touches the working directory (verified by experiment) — trusting its ref move would let the next autosave commit the stale tree back over the merge, silently undoing the other device's work. So `merge` is only ever a conflict _detector_ and a content _oracle_ (`noUpdateBranch` both times); the final state is always materialized to disk first and committed from there with explicit parents.
- **Prose never auto-merges.** diff3 would happily interleave paragraphs of fiction edited on two devices; in a prose tool that is not a feature. Frontmatter merges structurally (newer `modified` wins, per-field three-way — so timestamp noise never nags), but two devices editing the same document's _text_ always goes to the writer: keep mine / take theirs / keep both, with "both" shelving the other device's version as a variant pointing at the remote commit itself.
- **A binder conflict cannot orphan a document.** After every merge, any `documents/*.md` not reachable from binder or trash is re-attached to the binder root as "(recovered)" — resolving project.json either way is safe.
- **The sacred page holds for sync.** A background sync that finds conflicts raises a quiet status-bar flag; only a sync the writer asked for may open the resolution screen.
- Auth: device flow (no client secret; the one-time OAuth app client id is entered in Sync Settings), token encrypted via the OS keychain (`safeStorage`) at rest, remote URL in `.git/config` — none of it ever inside the synced content.

Deferred from this pass: syncing to a remote whose default branch isn't `main`; structural (rather than mine/theirs) binder merge; multi-account.

### 4. Quality-of-life batch — 🔨 in progress

Split in two, because "appearance you can live in" and "navigation you can drive" are unrelated changes that would otherwise land as one unreviewable diff.

**4a. Reading comfort ✅** — F-05's comfort variants and F-06, shipped in PR #12. Appearance is now persisted app-level (`settings.json`), so a chosen palette survives a restart — previously it was React state and reset on every launch, which made the phosphor themes decorative rather than usable.

- The theme axis was `data-terminal`, which only ever _looked_ writing-pane-scoped — it has always remapped the root `--ink`/`--paper` pair for the whole app. Renamed to **`data-palette`** to stop the name lying, and split "palette" from "CRT effects": glow and scanlines now belong only to `green`/`amber`, so a comfort variant can be two-colour without pretending to be a monitor.
- New palettes: `ereader` (warm grey / deep blue), `night` (tan / brown), `dark` (inverse — deliberately `#e6e6e6` on `#0d0d0d`, since full-contrast white on black blooms over a long session).
- **Every palette must restate all five SVG data-URIs** (3 dithers, 2 scrollbar arrows) — the ink colour is baked into each one, so a palette that forgets them keeps the previous theme's patterns and looks subtly broken. This is the single easiest way to add a broken theme.
- F-06 geometry (`--measure` in `ch`, `--prose-size`, `--prose-leading`) rides as inline custom properties on the root, so the page reflows live. The measure is in `ch` on purpose: the column stays the same number of characters wide at any text size, which is what actually governs readability.
- Dialogs became a flex column with a scrolling body and a `92vh` cap — the enlarged Preferences pushed its own title bar and Close button off-screen, and losing the way out of a dialog is worse than a scrollbar.

**4b. Navigation ✅** — F-07, full-project search and the ⌘K palette, shipped in PR #13. **⌘K** jumps to any document, story-bible entry or command; **⇧⌘F** searches inside the prose; **F10** or **⌥F** enters the menu bar.

- F-07 follows the WAI-ARIA menubar pattern rather than an invented one (roving tabindex, ←/→ between menus with or without one open, ↑/↓ within, Home/End, type-ahead, Esc), which also makes the bar screen-reader navigable. Dialogs get a real focus trap — without one, Tab walks out of a modal into the manuscript behind it, so a keyboard-only writer can type into a document they cannot see. The binder gets ↑/↓/←/→, Enter, F2, ⌫, with the **keyboard cursor kept distinct from the open document**: arrowing browses, Enter opens. Showing them identically would claim a document had been opened when it had not.
- `lib/search.ts` backs both surfaces so "what is findable" is decided once. Search is plain case-insensitive substring (fuzzy matching inside 100,000 words returns noise); the palette is fuzzy subsequence with a bias toward word starts. Trash is excluded from both, as in compile.
- **Search runs against the plain-text projection, not the stored Markdown.** Bodies carry `**` and `==` mid-sentence, so searching the raw text silently fails for any phrase spanning a bold word — "Not louder. Exactly" never matches `Not louder. **Exactly**` — and snippets show storage syntax instead of prose. Parsed results are cached by body string, since bodies do not change while a query is being typed.

**4c. Writing stats ✅** — daily count, goal and streak, shipped in PR #22. **Project → Writing Stats…**, plus a today-vs-goal indicator in the status bar.

It needed a data model, as predicted — but not a new one. **The stats are derived from git history rather than recorded anywhere.** Every checkpoint is already a timestamped snapshot of the whole manuscript, so "how many words existed on Tuesday" is a question the repository can already answer. That choice fell out of Geoffrey's decision that stats should follow the project across devices, and it beat a tracked `stats.json` on every axis that mattered:

- **No commit churn.** A tracked stats file would dirty the working tree every time the counter moved, turning a quiet session into a stream of commits about nothing.
- **No merge conflicts.** Two machines writing on the same day would both edit that day's row; instead they contribute commits, and merging commits is what git is for.
- **It syncs for free**, because history syncs — which is what was actually asked for.
- **It works retroactively.** Geoffrey's real project reported its whole back-history the first time the feature ran, rather than starting from zero on ship day.

Cost is a walk over history, kept cheap in `main/wyrm/stats.ts` by memoising word counts against blob oids: an oid is a content hash, so an unchanged document is counted once no matter how many commits span it, and the work scales with distinct document versions rather than commits × documents.

Decisions worth keeping straight:

- **Three counting modes, the writer's choice** (Preferences → WRITING STATS). Net, added-only, and net-floored-at-zero disagree most on exactly the day that matters — one spent cutting — so Geoffrey asked for the choice rather than a house opinion. `net` is the default and shows a cutting day as the loss it was.
- **The streak counts showing up, not hitting the goal.** A day spent cutting three thousand words of flab keeps it. A streak that punished revision would quietly discourage revising, which is the opposite of what a drafting tool should do. An unfinished day is also not a broken streak — nothing written yet today still reads from yesterday.
- **Reading the stats checkpoints first**, the same way compile does. History is the only source of these numbers, so uncommitted work would otherwise be invisible and a writer who just wrote 300 words would be told they wrote none.
- `countWords` moved to `src/shared/words.ts`. The status bar counts in the renderer and the engine counts in main, main never imports from renderer, and two copies would drift into quoting different numbers for the same text.
- **The ambient counters can be switched off entirely** (Preferences → WRITING STATS → "Show word counts while writing"), requested immediately after the first pass. One switch takes the editor header count, the status-bar count and the today indicator together — leaving any one behind would defeat the point. Writing Stats still reports everything on demand: choosing not to be watched while drafting is a different thing from not wanting to know.

**Found while building:** git commit timestamps are whole **seconds**, so checkpoints made in the same second compare equal, and a stable sort left them in `git.log`'s newest-first order — the day's *oldest* commit then defined where the day ended, reporting a full day of writing as a total of zero while `net`/`added` stayed correct, which is what disguised it as a plumbing failure. Ties now break on reversed log order. Not a test artifact: an autosave landing in the same second as a manual checkpoint hits it, as does project creation followed by a first save.

Deferred: a live in-session counter (the status bar's per-document count already covers "am I writing"), and best-day/total-words-this-month style figures.

### 5. Story-structure cluster (F-10 first, then F-02, F-03, F-04, F-11, F-12, F-13) 🔨

Timeline, plot graph, plotline tracking — now joined by graph views, the world map and nested locations. **F-10 (pins & tags) gated everything else in this cluster and is now built** — F-02/F-03/F-04/F-11 can proceed as views over its data rather than three incompatible metadata schemes. F-02 is the first of those views, also now built; F-29 gave it a second, richer rendering the same day; F-03 is the second view over the same coordinate, plotting tension instead of chronology; F-04 adds a fourth thing scenes can carry (a plotline membership, by tag) alongside tags/pins/timeline position/tension, and unblocks F-03's deferred multi-curve overlay whenever that's picked up.

**5a. Pins, tags & factions (F-10) ✅** — shipped. `DocMeta` and `Entity` both gain `tags?: string[]`; `DocMeta` gains `pins?: string[]` from `DOC_PINS`, `Entity` gains `pins?: string[]` from `CHARACTER_PINS` (`src/shared/types.ts`). Both are plain frontmatter, matching how the story bible already stores everything — no `project.json` index, so the model versions and diffs with the file it describes.

- **Tags** are free-form, added by typing into the "+ tag" field and pressing Enter; a faction ("House Voss") is nothing but a tag several entities share, and `scene` (`SCENE_TAG`) is nothing but a tag on a document — no new `BinderNodeType`, so F-02/F-03/F-04 can filter on it later without any document-kind change. **The Scene tag gets its own checkbox in the doc header, not a typed tag** — found unintuitive in testing ("is this a scene?" is a yes/no question, not a word to remember and spell correctly). The data model is unchanged: the checkbox reads and writes `SCENE_TAG` in the same `tags` array, it's just hidden from the ordinary tag-chip list so it isn't shown twice. Every other tag, including factions, stays free-typed.
- **Pins** are a closed, app-shipped vocabulary and cannot be invented by the writer — a dropdown toggles membership. Documents get `DOC_PINS` (Setup, Rising Action, Climax, Falling Action, Resolution); characters get `CHARACTER_PINS` (Protagonist, Antagonist, Viewpoint Character). World/glossary entities have no pin vocabulary yet, per the original design — none invented speculatively.
- **UI split by component's own convention rather than one shared widget**: the writing terminal's tags/pins bar (`Editor.tsx`'s `DocMetaBar`) writes immediately, the same "no debounce for metadata" reasoning as 4c's stats; the story-bible entry editor (`EntityEditor.tsx`) queues tags/pins in local state like every other field there, applied on the existing explicit **Save Entry**. Both bars live in chrome, not on the page itself — the doc header row is a second flex row inside `.terminal-chrome`, which only appears on hover alongside the title/word-count row already there (the page-is-sacred house rule extends to metadata, not just notifications).
- `entities.ts`'s `writeEntity` omits `tags`/`pins` from frontmatter entirely when empty, so entities untouched by F-10 keep the frontmatter they always had rather than gaining `tags: []` on every save; `gray-matter`'s YAML dumper throws on an explicit `undefined` value, which is why the store's `updateDocMeta` deletes the key rather than setting it to `undefined` when a writer removes the last tag.

Deferred, as scoped at design time: the skeuomorphic treatment (pin heads, luggage-tag-shaped tags, still 1-bit) — the current chips/toggles are functional but plain, matching the rest of the chrome rather than the request's original visual ambition. Revisit alongside F-20/F-21/F-22's other editor-pane visual work rather than blocking F-02/F-03/F-04 on it.

**5b. Timeline (F-02) ✅** — shipped. **Project → Timeline…** (also in the ⌘K palette) lists every `scene`-tagged document as a card, ordered by the new `DocMeta.timelineOrder` with binder order as the fallback for a scene that has never been dragged; an optional `DocMeta.timelineDate` free-text label rides alongside but never affects sort order (`shared/types.ts`).

- **No standalone card entity and no `project.json` index** — a card is nothing but a scene-tagged document, matching F-10's storage philosophy exactly. `lib/timeline.ts`'s `timelineCards` is a pure read-through: filter by `SCENE_TAG`, sort by `timelineOrder ?? <binder position>`.
- **Reordering never rewrites the rest of the list.** `orderBetween` assigns the dropped card a fractional rank — the midpoint of its new neighbours' `timelineOrder` values (or ±1 past an end) — so moving one card is one `writeDoc` call, not a renumbering pass across every scene.
- **The store acts on an arbitrary doc id, not just the active document.** `setTimelineOrder`/`setTimelineDate` read whichever document is targeted (falling back to `api.readDoc` when it isn't the one open in the editor), since the card a writer drags on the timeline is rarely the document currently open for writing — unlike F-10's `updateDocMeta`, which only ever touches the active doc.
- The dialog fetches its own doc list via `api.readAllDocs` on open (same pattern as the entity editor's backlinks) rather than keeping a live store slice — the timeline is opened rarely enough that a fresh read on open is simpler than keeping another piece of global state in sync.

Deferred, as scoped at design time: a real calendar/duration system (explicitly the heavier of the two dated-events options, not chosen); per-thread or per-POV timelines (one timeline per project was chosen). The plain-row visual was superseded almost immediately — see 5c.

**5c. Timeline: line-graphic view (F-29) ✅** — shipped the same day it was requested. **Project → Timeline… → Line** (a tab next to **List**, which stays — see below) redraws the same cards as markers on a literal line rather than rows. Design settled 2026-08-01 with Geoffrey:

- **Position is a literal coordinate, reusing `timelineOrder` as-is** — no new field. The list view already treated it as a sortable rank; the line view is the same number read as an x-position, so nothing added to `DocMeta`.
- **An in-world date still never affects placement** — consistent with 5b's original decision, not reopened.
- **A stack is a visual coincidence, not stored data** — two cards land on a stack by sharing a grid position; nothing records "these happen at once" beyond that. `lib/timeline.ts`'s `stackByPosition` groups cards for rendering only.
- **Dragging snaps to a grid (`TIMELINE_GRID`) instead of pixel-precise placement.** The grid size is exactly 1 — larger than it first sounds, and load-bearing: `TimelineLineView`'s `PX_PER_UNIT` (140) is sized so one grid step never renders narrower than a card (108px). A finer grid was tried first and found broken in the browser preview, not just in theory — a drop landing close to but not exactly on another card rendered as an unreadable partial overlap, neither a clean gap nor a clean stack. The invariant (`PX_PER_UNIT * TIMELINE_GRID >= card width`) is written down at both ends (`lib/timeline.ts` and `TimelineLineView.tsx`) and has a regression test (`timeline-line-view.test.tsx`) asserting no two different grid positions ever render closer than a card width apart.
- **List and Line are both kept, as a tab toggle**, rather than Line replacing List outright — the request said "I should be able to view the timeline as" a line, which reads as adding a view rather than retiring the one already shipped and tested.
- **Click vs. drag is decided entirely from the pointer-event sequence** (movement past a small pixel threshold means drag, not click) since there's no separate drag handle — resolved via a ref read synchronously in `onPointerUp` rather than a subsequent `onClick`, because by the time a browser's own `click` event fires, the drag state has already been cleared and reading it there would silently misfire on every click that followed a drag.

Deferred, as scoped at design time: a real calendar/duration system, per-thread timelines (both same as 5b, unchanged); keyboard-driven reordering (Enter still opens a card via keyboard; only mouse can reposition one, matching the list view's own drag having no keyboard equivalent either).

**5d. Plot graph (F-03) ✅** — shipped. **Project → Plot Graph…** plots the same scene-tagged, timeline-ordered cards as 5b/5c, with tension on the y-axis instead of chronology — a curve reading the dramatic shape of the manuscript at a glance. Design settled 2026-08-01:

- **Tension is manual only, set by dragging a node vertically** — 0–10, no scoring model, nothing derived. `DocMeta.tension` is a new optional field; unset scenes render at the midpoint (5) so they show up on the curve without implying "no tension yet" at either extreme, but nothing is written to disk until a writer actually drags a node.
- **The x-axis reuses `timelineOrder` as-is**, the same coordinate F-02/F-29 already read — the plot graph is a third view over the same one axis rather than a second "narrative order" concept. `lib/timeline.ts`'s `timelineCards` (already shared by both timeline views) is reused unchanged; `TimelineCard` just grew an optional `tension` field to carry it through.
- **One curve, not one per plotline** — the original sketch asked about overlaying curves per plotline, but that needs F-04's plotline model to exist first, and it doesn't yet. Building for multiple curves now would mean designing two undesigned features at once; single-curve ships today and multi-curve is a natural extension once F-04 gives it something real to key off.
- **Drag mechanics mirror F-29's line view deliberately**: click vs. drag decided from the pointer-event sequence (a movement threshold, not a separate handle), resolved via a ref read in `onPointerUp` for the same race-avoidance reason documented in 5c. The one difference is the value dragged live-previews unclamped and unrounded (so the curve moves smoothly under the pointer) and only gets `clampTension`'s round-to-whole-number-in-range treatment on release — there's no grid-overlap hazard here since nodes don't collide horizontally the way timeline cards can.

Deferred, as scoped at design time: keyboard-driven tension adjustment (Enter opens a card same as the other two views; only mouse sets tension); a real "what does tension mean" rubric — it's explicitly whatever the writer says it is.

**5e. Plotline tracking (F-04) ✅** — shipped. **Project → Plotlines…** tracks main plot, B-plots, romance arcs, and any other thread the writer names, answering "which threads are still open?" and "which scenes advance this arc?" Design settled 2026-08-01:

- **A plotline is its own lightweight record** (`Plotline`: name, colour, status) — deliberately neither a story-bible `Entity` (a plotline never auto-links in prose, which is what `Entity` exists for) nor just a tag (a tag has nowhere to hang a colour or a status). Stored the same way as entities — one frontmatter-only file per plotline, in a new `plotlines/` directory (`main/wyrm/plotlines.ts`, mirroring `entities.ts`'s shape exactly) — so it versions and diffs with the project the same way everything else does.
- **A scene joins a plotline by tag, matching its name** — not a stored id. Typing a plotline's name into a scene's existing "+ tag" field (F-10) is the entire linking mechanism; no new UI on the document side at all. Renaming a plotline is consequently a visible, deliberate act (re-tag the scenes that should follow), never a silent id remap.
- **Status is a manual toggle on the plotline itself** (open/resolved) — not derived from any scene's pins. Consistent with `DocStatus` (draft/revised/final) already being a plain manual field rather than inferred from anything.
- **Setup/payoff beats reuse F-10's existing `DOC_PINS`** (`Setup` / `Resolution`) rather than a plotline-specific vocabulary — a scene tagged with a plotline's name *and* pinned `Setup` (or `Resolution`) is read as that plotline's setup (or payoff) beat. One shared vocabulary, no new pin concept to design or maintain.
- **Colour is a closed set of six swatches** (`PLOTLINE_COLOURS`), not a free color picker — same reasoning as `DOC_PINS`/`CHARACTER_PINS` being closed vocabularies: two plotlines are always visually distinguishable without depending on a writer's color sense, and the swatch list stays finite. Colour is scoped to the Plotlines dialog only, per the design decision — it does not propagate to the binder, timeline, or plot graph (a larger, cross-cutting change explicitly deferred).
- **One curve on the plot graph remains unchanged for now** — F-04 existing is what F-03 was waiting on to make multi-curve overlays possible, but the plot graph itself wasn't touched in this pass; that's a follow-up, not part of what shipped here.

Deferred, as scoped at design time: colour propagating beyond the Plotlines dialog; multi-curve overlays on the F-03 plot graph (now unblocked, not yet built); any automatic "is this plotline actually resolved" inference.

---

## Backlog

Requested features, not yet scheduled. Stable IDs so they can be referenced in commits and PRs.

### F-01 · Local-only version control (no GitHub required) 📋

Users who want everything on their own machine must get full version-control parity — history, diff, restore, variants, branches — with no account and no network. WyrmStar already uses **isomorphic-git** (open-source, MIT), so the entire engine is local; GitHub is only a _remote_. Work needed:

- ✅ "No remote" is an explicit, first-class choice — the sync setup screen's first question, with local-only phrased as a peer of GitHub, not a fallback (PR #11).
- ✅ **Optional local backup target** — shipped in PR #10 (see Execution order §2). Note for whoever does the rest: isomorphic-git has **no local transport**, so this was built from git plumbing rather than `push`; GitHub sync gets a real HTTP transport and cannot reuse that code path.
- ✅ Sync surfaces degrade silently with no remote: Sync Now is disabled, the status bar shows plain `◆ LOCAL`, nothing nags (PR #11).
- Confirm every Phase 5 sync surface degrades cleanly and silently when no remote exists (no nagging, no dead buttons).
- Document the trade-off honestly: local-only means a disk failure is unrecoverable; recommend at least one off-machine copy.

**Note:** this reorders Phase 5 slightly — local-first is the default path, GitHub sync becomes opt-in. Cheap to do now, expensive to retrofit.

### F-02 · Timeline ✅ shipped — see Execution order §5b

Arrange scenes on a chronological timeline of story events — distinct from binder order, because narrative order ≠ chronology (flashbacks, parallel threads). Design settled 2026-08-01, built the same day:

- **Both relative order and an optional in-world date.** Relative order (`timelineOrder`) is what sorts the timeline; a free-text date label (`timelineDate`) can be attached on top but is never parsed and never governs sort order — no calendar system is assumed. See Execution order §5b.
- **Cards are the same objects as binder scenes** — any document tagged `scene` (F-10) is a card. No standalone event-card entity; backstory that will never be a scene still needs a document, even a bare one.
- **One timeline per project.**

### F-03 · Plot graph ✅ shipped — see Execution order §5d

Scenes plotted on a graph board to visualize dramatic shape — rising action, climaxes, falling action, resolution. Design settled and built 2026-08-01: x-axis is the F-02/F-29 timeline order (not a separate narrative-order field), y-axis is a manual 0–10 tension value set by dragging a node, one curve only for now (multiple curves per plotline needs F-04's model to exist first). See §5d for what shipped.

### F-04 · Plotline tracking ✅ shipped — see Execution order §5e

Track main plot, B-plots, romance/love-interest arcs, character arcs — and surface unresolved threads. Design settled and built 2026-08-01: a lightweight **plotline** record (name, colour, status) that scenes join by tag, with setup/payoff beats read from F-10's existing document pins rather than a new vocabulary. See §5e for what shipped and what's deferred (colour propagating beyond the Plotlines dialog, multi-curve plot-graph overlays).

### F-05 · More retro visual variants 🔨

More themes, more intensely period. Remaining candidates: Apple II / Commodore 64 / ZX Spectrum palettes, IBM CGA (cyan-magenta), Macintosh Plus warm grey-green, DOS EGA 16-colour, a paper-white "LaserWriter proof" mode. Also: optional CRT curvature/bloom/flicker, and the classic Mac UI click/chime sound set from design-brief.md §2 (off by default). The theming layer already remaps ink/paper/dither/accents from one place, so new variants are mostly a palette block each.

**Comfort variants** (requested 2026-07-30) — ✅ shipped in PR #12 (see Execution order 4a). E-reader, Night, Dark — ergonomic rather than period-authentic, same strict two colours as the default.

**Six more** (requested 2026-07-31) — ✅ shipped in PR #15: Vaporwave (CRT, magenta glow), Halftone (newsprint dot screen — genuine circular halftone dithers in place of the checkerboard, not just a recolour), Ledger (cream stock, rust "correction ink" highlight), Arcade (black ground, hot orange/pink diagonal marquee stripes baked directly into the dither SVGs), Blueprint (drafting navy, grid-ruled dithers), BIOS (classic setup-screen blue, cyan selected-row bar). Ledger and Arcade are the two that deliberately keep a second highlight colour rather than flattening to monochrome — everything else stays strict two-colour, matching the discipline of the first three comfort variants.

**Found and fixed while extending the mechanism:** highlighted text (`==like this==`) was **fully invisible** under 4-bit accents combined with any comfort palette (ereader/night/dark). The palette blocks set `--highlight-bg: transparent` to suppress the 4-bit colour wash, and the box-outline fallback that saves the highlight under 1-bit accents was scoped to `[data-accents='1bit']` only — so 4-bit accents got neither the colour nor the outline. Green/amber dodged this with their own inverse-video override; the three comfort palettes didn't. Fixed by folding the box outline into the unconditional base `.page mark` rule, so a highlight can never disappear regardless of accent/palette combination — verified live by inspecting computed style (`box-shadow` present despite `background: transparent`) rather than trusting the CSS by inspection alone.

The theme axis is `data-palette` (renamed from `data-terminal` in PR #12 — it always recoloured the whole app, not just the writing pane). Dithers are inline SVG data-URIs carrying a hardcoded fill per palette; **a palette that forgets to restate all five (three dithers, two scrollbar arrows) keeps the previous theme's patterns and looks subtly broken** — this is the single easiest way to introduce a broken palette, called out in both `CLAUDE.md` and the CSS itself.

**Two more, palette-tier** (requested 2026-07-31) — ✅ shipped in PR #16: **Collegiate** (dark hunter-green ground, varsity gold ink — retro football-program energy) and, briefly, "NES" (near-black ground, Nintendo red ink, joined the CRT family for scanlines and glow) — see I-09: that palette was actually the Virtual Boy's colour scheme and was renamed **Virtual Wyrm**. A genuine NES palette shipped afterward as **Famicom**, full-colour rather than two-tone (see I-09).

**Four more, requested at Manuscript-tier** — real mechanics and content changes, not palette blocks. See F-15 through F-18 below.

### F-06 · Editor margins & measure control ✅

Shipped in PR #12 (Execution order 4a): line measure, text size and line spacing are steppers in Preferences → THE PAGE, applied live as root custom properties and persisted app-level. First-line indent shipped earlier with the I-03 drift fix.

### F-07 · Full keyboard navigation ✅

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

### F-09 · Focus mode 📋

An icon on an open document expands the editor pane to the whole screen; the same icon returns to the standard view. Requested 2026-07-30. Small and self-contained — binder, side panel, and status bar hide, the page keeps its measure and centres. Wants a period-correct glyph rather than a modern expand arrow: the System-era idiom is a **zoom box** (the little nested-squares control already drawn in the main window's title bar), so reuse that vocabulary. Note there is already a disabled `Composition Mode` (⌥⌘F) item in the View menu — this is that item, and it should adopt the shortcut rather than inventing a second one.

### F-10 · Pins, tags & factions ✅ shipped — see Execution order §5a

Requested 2026-07-30, design settled 2026-08-01, built 2026-08-01. **This is the scene-level metadata model the roadmap was deferring.** F-02 (timeline), F-03 (plot graph) and F-04 (plotline tracking) all need exactly this and were explicitly held back so it would be designed once — see Execution order §5a for what shipped and what's still deferred (the skeuomorphic UI treatment). The design record below is kept as-is for context; F-02/F-03/F-04 can now proceed as views over this data.

**Pins and tags are two different mechanisms, not two names for one idea** — the original framing (both illustrated by the same four examples) blurred that, and it matters for the data model:

- **Pins are a closed, curated vocabulary the app ships**, scoped by what they're pinned to rather than one universal list — a pin only appears as an option where it means something. Documents get a scene-structural set (Rising Action, Climax, Setup, and similar — exact wording is a UI-copy pass, not a design blocker); characters get a narrative-role set (Protagonist, Antagonist, Viewpoint Character). World and glossary entities have no pin vocabulary of their own yet — nothing requested one, so none is invented; add one later if a real need shows up rather than filling the gap speculatively now.
- **Tags are a free vocabulary the writer invents**, no starter set, no fixed list — writer-owned the way the story bible already is.
- **Factions are not a third mechanism.** A faction is a tag, applied to `Entity` instead of `DocMeta`, following the exact same free-form rule — grouping characters, locations and glossary items into a named faction ("House Voss") is just several entities carrying the same tag value. This reuses the tag field rather than adding a parallel grouping concept, so `Entity` needs a `tags` field for the first time (it does not have one today) precisely so factions can exist. Note this only partly matches `design-brief.md`'s §5 aside that World entries might carry an internal `type` of "faction" — that was one entity being *labelled* a faction; tags let *any* entity, including characters, *belong* to one. The tag reading is more general and is the one to build.
- **"Scene" is a tag, not a first-class document kind.** A document becomes orderable/plottable by carrying the tag `scene` — no new `BinderNodeType`, fully reversible, and every other part of the app (compile, search, the binder) keeps treating it as an ordinary document. F-02/F-03/F-04 filter on this tag to decide what counts as a plottable unit.

**Storage: document frontmatter, matching `DocMeta`/`Entity`'s existing shape** — versioned with the file, diffs cleanly, no second source of truth, and it is what the story bible already proves works. Losing the queryable-without-reading-every-file property that a `project.json` index would have given is an accepted, deliberate cost — matches "everything is plain text on purpose."

Concretely, once built:

- `DocMeta` gains `tags?: string[]` (free-form, including `scene`) and `pins?: string[]` (from the document-scoped fixed set).
- `Entity` gains `tags?: string[]` (free-form — factions live here by convention, no dedicated field) and `pins?: string[]` (from the character-scoped fixed set; meaningless and left empty on `world`/`glossary` entities for now).

Still open, deliberately left for the implementation pass rather than blocking design sign-off: the exact wording of each fixed pin list; the skeuomorphic UI (pins with actual pin heads, tags shaped like little luggage tags, still 1-bit) that the original request asked for; and how the binder/entity editor surfaces "add a tag" versus "add a pin" as two visually distinct actions given they are two different mechanisms now.

### F-11 · Graph views 💭

Maps rather than lists: a **character graph** where characters can be grouped and joined by relationship edges, alongside the plot graph of F-03. Requested 2026-07-30. Depends on F-10 for what the nodes are and what edges mean — F-10's factions (§ above) already give one axis of grouping for free once they exist, entities sharing a faction tag. Open: are relationships their own entity (typed, directional, with a label like "brother of"), or free edges? Directional typed edges are more work but are the only version that can answer "who is estranged from whom".

### F-12 · World map 💭

Lay out World Book locations on a gridded map, with chunky old-school map tools: legends, borders, landmarks, topography. Requested 2026-07-30. Fantasy-cartography feel in 1-bit — hatching and dither patterns instead of colour fills, which the dither variables already provide. Depends on F-10 (locations need to be placeable things) and on F-13 for the hierarchy. Biggest open question is storage: a map is spatial data that does not diff or merge as prose does, so it needs its own file per map and a deliberate answer for what a sync conflict on one means.

### F-13 · Nested locations 💭

Locations nest: a building inside a neighbourhood inside a city inside a country. Requested 2026-07-30. The story bible is currently flat (`glossary/`, `characters/`, `world/`, one file each), so this is the first hierarchy inside it — the binder's tree shape is the obvious precedent. Feeds F-12 directly (zooming a map is walking that tree) and affects auto-linking: mentioning a building might reasonably surface its city in the side panel.

### F-14 · Escape as "back" 💭

Esc should pop the writer to whatever they were looking at before, not just close the topmost dialog — opening a glossary entry from a document and hitting Esc should return to that document, not to the Welcome screen or nowhere. Requested 2026-07-30.

- Needs a real navigation stack, not a single "previous view" pointer — a chain (doc → entity → a different entity opened from a backlink → …) has to unwind one step at a time, the way a browser's back button does, not jump straight to the start.
- Where does the stack live? `mainView` (`{kind:'doc'} | {kind:'entity', id}`) is the obvious base, but it's `App`/store state today with no history. A `MainView[]` in the store, pushed on every `showEntity`/`showDoc` and popped on Esc, is probably the shape — needs to be capped (unbounded growth from restless clicking) and pruned when an entity is deleted out from under a stack entry.
- Interacts with F-09: what does Esc do while both a dialog is open _and_ focus mode is active? Dialogs already close on Esc (`useFocusTrap`) — that has to keep winning; the view-history pop is next in line only once nothing is open on top.
- Scope question worth settling before building: does the stack also cover binder navigation (doc → doc → doc), or only the doc↔entity hop the request describes? The narrower scope is a lot less state to get right.

### F-15 · Manuscript mode 💭

A fully medieval palette, a period display face for chrome (still legible), and — the real feature, not a palette trick — the first letter of each paragraph rendered as a giant illuminated capital. Requested 2026-07-30, explicitly asked to be "on par with" the visual weight of a full theme rather than a `[data-palette]` recolour.

- The drop cap is cheap in principle — CSS `::first-letter` on `.page p` naturally targets the first letter of a block, no editor changes needed — but it wants a genuine calligraphic/blackletter face for just that one glyph, which the app doesn't have today. `@fontsource` likely has a workable option (something in the Fraktur/uncial family) for the capital, kept separate from a _legible_ period-flavoured serif for the body text — the request is explicit that body prose must "still be readable," so the two faces can't be the same one.
- New font dependency, so it's worth its own PR rather than folding into a batch of palette blocks — this is the one item in this group with a real, if small, supply-chain footprint (a license to check, a file to vendor).
- Ties into the paid-variant idea below more than any other item here, since it's the most visually complete of the four.

### F-16 · Wargames mode 💭

"Vectorized retro tech" — reads as wanting real vector-line rendering (the `WarGames`/`Aliens`-terminal glowing-outline look) rather than a flat two-colour swap; a plain green-on-black palette would just be a dimmer copy of the existing phosphor themes (green/amber/vaporwave) and miss what makes the reference recognisable. Requested 2026-07-31, explicitly "on par with" Manuscript's visual refactor.

- Needs a design pass on what "vectorized" means concretely for a text app that is fundamentally rendering glyphs, not line art — outlined/stroke-only text rendering? A scanning CRT vector-monitor persistence trail on the caret? Worth prototyping the caret/cursor effect in isolation before committing to an approach, since that's likely the highest-risk, highest-payoff piece.

### F-17 · Hacker mode 💭

"Retro film hacker aesthetic" — the Hollywood-invented, green-cascade, oversized-chunky-terminal look (`Hackers`, `The Matrix`-adjacent), not anything a real 1990s terminal looked like. Requested 2026-07-31, "on par with" Manuscript.

- Likely wants motion (something scrolling or cascading) as part of its identity — every palette shipped so far is deliberately static. Worth deciding explicitly whether animation is in scope for a "palette" at all before building, since "the page is sacred — no notifications, nothing moves in the writing terminal" has been a house rule since Phase 1. If motion is allowed here, it should be scoped tightly (chrome only, never the prose itself) and easy to disable.

### F-18 · Gothic mode 💭

"A gothic literary overhaul." Requested 2026-07-31, "on par with" Manuscript. Overlaps with F-15 (illuminated capitals, a period display face, a dark ornamented palette) but reads as a distinct identity — cathedral/blackletter rather than illuminated-scriptorium. Worth designing F-15 first and then deciding whether Gothic is a sibling built on the same drop-cap/period-font mechanism or wants its own.

### F-19 · Paid supporter tier for premium variants 💭 — product decision, not a design one

Geoffrey raised charging a few dollars for supporters to unlock the Manuscript-tier variants (F-15 through F-18) as a way to fund development. Worth taking seriously, but it's a different kind of work than anything shipped so far, and deserves its own conversation before any code: the app is local-first, offline-capable and account-less by design (F-01, brief §7's local-only requirement) — a purchase/unlock flow needs an answer for what "unlocked" even means with no account and no server. Candidate mechanisms, none evaluated yet: a one-time license file dropped into the settings directory; a separate paid build with the extra palettes compiled in versus a free build without them; something else entirely. Not started.

### F-20 · Collegiate: college-ruled editor pane 📋

Requested 2026-07-31. The palette itself (PR #16) is done; this is an editor-pane treatment on top of it — thin, lightly-visible yellow ruling on `.page` itself, dashed or dotted preferred over a solid line, referencing both a football field's yard lines and a school notebook's ruling at once. Not achievable with the existing chrome-dither mechanism (those tile at a few pixels, sized for backgrounds and disabled-text clipping, not for line-spaced page ruling) — wants its own `[data-palette='collegiate'] .page` background, most likely a small tileable SVG background-image (the same technique as the dithers) sized and spaced to land near the prose line height rather than reusing `--dither-*`.

### F-21 · Blueprint: grid on the editor pane 📋

Requested 2026-07-31. A lightly-visible grey grid on `.page`, sparse — explicitly _not_ the tight chrome crosshatch already used for the desktop/scrollbar dither, which would be distracting at page scale. Wants its own wider-spaced background treatment on the writing surface, same technique family as F-20, tuned not to compete with the prose.

### F-22 · Halftone: margins, ruler and newspaper-editing marks 📋

Requested 2026-07-31, alongside F-20/F-21 but noticeably bigger — the most substantial of this batch. Four asks bundled together:

- **Black margin bars** flanking `.page`, signalling the print margin visually. Plausibly pure CSS (pseudo-elements either side of the page column).
- **Visible margin measurements and ruler accents**, in both the page and the surrounding chrome. Rendering real numbers against the actual configured measure (F-06) is more than a background image — likely wants a small dedicated component (a ruler bar), not a CSS-only treatment.
- **Paragraph marks** (¶) shown where appropriate. The cheap part of this request — `[data-palette='halftone'] .page p::after { content: ' ¶'; }` gets most of the way there with no editor changes.
- **"Old-school newspaper-editing vibe wherever possible"** — evocative but unscoped as written. Needs a concrete shortlist (proofreader's marks? column-inch annotations? a specific reference image) before it's buildable rather than open-ended.

Worth splitting into a cheap pass (margin bars + paragraph marks, CSS-only) and a real pass (the ruler component) rather than one PR, given the gap in effort between the two halves.

### F-23 · BIOS: block cursor in the editor pane 📋

Requested 2026-07-31. Sounds like a CSS tweak and isn't one: browsers don't reliably support a block-shaped text caret through standard CSS (the experimental `caret-shape` property has no meaningful stable support), so an authentic block cursor needs `caret-color: transparent` plus a positioned decoration element tracking the real cursor — a small TipTap/ProseMirror plugin, not a palette-block change. Comparable in kind to the Manuscript-tier work above even though the ask reads small.

### F-24 · Close project + a real home screen with recents 📋

Requested 2026-07-31. Two things bundled together:

- **Close the open project.** The main window's title-bar close-box (`App.tsx`, the `<span className="close-box" />` next to the project title) is currently decorative — no `onClick`, not even a `<button>`. It should close the project (return to the state below) the way every other System-era close-box closes its window.
- **A real home screen.** `Welcome.tsx` already exists and covers new/open/restore, but today it's only reachable by accident: `boot()` in `store.ts` silently reopens `getLastProjectPath()` on every launch, so a returning writer never sees it. Once the close-box works, closing a project should land here — and it should also gain a **recent projects list** to pick from, not just Create/Open/Restore buttons.

Open questions worth settling before building:

- **Does auto-reopen-on-boot go away?** If Welcome is meant to double as a "recents" home screen, silently skipping past it on every launch defeats the point — but some writers may want straight back into their manuscript with zero clicks. Candidate: keep auto-reopen, but make the close-box's destination this same home screen (so it's still one click away), rather than removing auto-reopen outright.
- **Where does "recent projects" live?** Nothing today tracks project history beyond the single `lastProjectPath` in `main/wyrm/settings.ts`. Needs a small ordered list (path + title + last-opened time) instead, capped and pruned when a path no longer opens (moved/deleted project folder).
- **Does closing autosave first?** Every other operation that could lose work checkpoints first (house rule: nothing is ever lost) — closing a project should be no exception.

### F-25 · Story-bible section headers need visual hierarchy 📋

Requested 2026-07-31. In the binder's Glossary/Character Book/World Book sections, the header row (`BibleSection` in `Binder.tsx`) and its entries render through the exact same `.binder-row` class as everything else — same font size, same weight, same padding. Nothing distinguishes "this is a section" from "this is an entry"; a header currently reads as just another row that happens to be first. Two directions worth weighing, not chosen yet:

- **Make the headers visually distinct** — bolder/larger chrome type, a different background wash, or a rule under them — cheap, CSS-only, matches how `.fieldset legend` already gets its own treatment elsewhere in the chrome.
- **Nest entries under headers** — indent them further than the current single `paddingLeft: 8 + 16` step (`Binder.tsx`'s entity row), so the tree structure itself carries the hierarchy the way folders already do for the manuscript binder above it.

These aren't mutually exclusive — the manuscript binder's folder rows already indent children by depth, so doing the same for story-bible entries plus a distinct header treatment would bring the two trees into visual agreement rather than leaving story-bible sections as the one flat exception.

### F-26 · Stats page: hotkey, per-day figures, calendar heatmap 📋

Requested 2026-07-31, straight after 4c shipped. The current Writing Stats dialog is the small version of this: today, streak, manuscript total, and a fortnight of bars. The ask is a fuller **page** reachable by hotkey, with:

- **More figures** — words per day, words in this manuscript, presumably also per-document and per-period totals (this month, this draft).
- **A GitHub-contributions-style calendar.** Every day with a checkpoint is marked; days that beat the goal are marked complete, or better, shaded on a gradient by volume.

Most of the data already exists. `main/wyrm/stats.ts` returns `DayStat[]` for the whole history — `date`, `total`, `net`, `added`, `commits` per day — so a heatmap is a rendering job, not a data job. Things to settle before building:

- **A page, not a dialog?** Everything else in the app that fills the main pane is a `MainView` case (`doc` | `entity`); a stats *page* would be a third. That is the honest way to do it and interacts with F-14's Esc-as-back stack. A hotkey that opens the existing dialog is much cheaper and might be enough — worth deciding rather than drifting.
- **Gradient buckets.** GitHub uses four shades against a rolling maximum. In a strictly two-colour palette that has to be dither density rather than colour (the `--dither-25/50/75` set is exactly three steps plus solid — a natural fit, and it would look properly period).
- **Which day counts as "complete"?** Beating the goal is the obvious rule, but 4c deliberately made the *streak* about showing up rather than hitting the target. Two different rules on one screen needs the visual to distinguish "wrote" from "hit goal" rather than conflating them.
- **`dailyStats` currently walks the whole history on each call** (memoised per blob, so repeat calls are cheap). A year-long heatmap is the first thing that would make a slow first walk noticeable on a large project — worth measuring on real data before optimising.

### F-27 · Line numbers and page view 📋

Requested 2026-07-31. Two related editor-gutter treatments, **both off by default** — the page is sacred, and neither belongs in a writer's default view:

- **Line numbers**, the way a code editor shows them.
- **Page view**: a dotted rule across the page every N lines, standing in for a page break.

Neither is a CSS-only job, and the reason is the same for both: the editor is a ProseMirror document of paragraphs, and a *visual line* is a wrapped-text artefact that only the layout engine knows about. A paragraph can be one line or forty depending on the measure (F-06), the text size, and the window width — all of which change live. So this needs either a ProseMirror decoration plugin measuring rendered line boxes, or a gutter that re-measures on resize. Same family of work as F-23's block cursor.

Open questions:

- **What is a "page"?** Real pagination depends on a paper size and font metrics; "every N lines" is a decent approximation but will not match what the compiled `.docx` actually paginates to. Worth being honest in the UI about which one it is rather than implying a print preview.
- **Do line numbers count visual lines or paragraphs?** Visual is what a code editor does and what the request implies; paragraph numbering is far cheaper and arguably more useful for prose (it survives a resize). Ask before assuming.
- Interacts with F-22's halftone ruler and margin marks — both want gutter furniture, and two independent gutter mechanisms would be a mistake.

### F-28 · Windows 95 palette 📋

Requested 2026-07-31. Teal desktop, other Windows-esque chrome homages.

This is the same "break the two-colour discipline on purpose" family as Ledger, Arcade and Famicom, not a new mechanism — but it pulls on a different piece of the existing system than any of those three:

- **The desktop background is currently themed, not just the window.** `.desktop` already reads `--paper`/`--dither-50` (`retro.css`), so a teal desktop is in scope for the palette variables already — no new hook needed, unlike the nuclear-tiger website work where the "Windows 95 teal desktop" idea first appeared as a page-specific skin outside this app entirely. Here it's native.
- **"Other Windows-esque homages"** is the open half of the request. Candidates worth naming rather than leaving implicit: a beveled (rather than flat 2px) border on `.mac-window` and buttons — real Win95 chrome is a raised 3D bevel, which is a genuine departure from every palette so far, all of which keep the flat 1-bit border language; a taskbar-style affordance somewhere in the chrome; the teal-and-grey combination itself (`#008080` desktop, `#c0c0c0` window chrome) rather than teal alone.
- **Bevels are the one piece that isn't "just new CSS variables."** Every palette to date reskins colour and dither fill within the existing flat-chrome shape; a genuine 3D bevel changes the shape (multiple border colours simulating light/shadow, not achievable with a single `--ink` border). Worth deciding whether this palette gets that treatment or stays flat-chrome-with-Win95-colours — the former is a much bigger, more novel piece of work than any palette shipped so far.

### F-29 · Timeline: line-graphic view ✅ shipped — see Execution order §5c

Requested 2026-08-01, the same day F-02 shipped as a plain list; design settled and built the same day. Wants the timeline redrawn as a genuine visual chart — a literal line (the old-history-book convention) with scene markers laid along it like birds on a wire, rather than a stacked list of rows. Key asks:

- Uneven spacing is the point, not a bug — scenes that are narratively close together sit shoulder to shoulder, a long gap in the story shows as visible empty space on the line, and both are placed by dragging rather than computed automatically.
- Simultaneous events can stack — more than one card at the same point on the line, for scenes happening at once (parallel POV threads, a flashback interleaved with a present-day scene).

Design questions to settle before building, in the same settle-first spirit as F-02's own design pass:

- **What does horizontal position mean?** F-02's `timelineOrder` is a strict total order (a bare rank) — ranks 1 and 2 look identical to ranks 1 and 100, so it has no notion of "distance." This request wants position on the line to also encode gap/proximity, which likely means either `timelineOrder` becomes a literal coordinate rather than a rank, or a second field is added purely for visual spacing, independent of sort order.
- **Does the in-world date (`timelineDate`) drive spacing, or is spacing a purely hand-placed visual choice?** F-02 deliberately made `timelineDate` a label that never governs layout — this request leans the opposite way (position implies meaning), so decide explicitly whether that's an opt-in mode layered on top rather than a reversal of the original decision.
- **What does a stack mean structurally?** A shared x-position with several cards is easy to draw; whether that's just a visual coincidence (no stored relationship) or an actual "these happen simultaneously" fact worth remembering — and potentially feeding a future plotline view (F-04) — is a modelling decision, not only a rendering one.
- **Continuous drag or snap-to-gap-size?** Pixel-precise placement is the most literal "birds on a wire" feel but is harder to keep stable across window widths and screen sizes than a small number of discrete gap sizes. Worth prototyping both before committing.

Likely relates to F-03 (plot graph) visually — both want a spatial board rather than a list — but the axes mean different things (F-03's y-axis is tension; this is purely chronological placement), so treat them as separate views rather than merging early.

### CRT family: found in review 📋 — glow ✅ fixed, see I-09 for the rename

Two notes from reviewing PR #16, both affecting the whole CRT palette group (`green`/`amber`/`vaporwave`/`virtualwyrm`, formerly named `nes` — see I-09):

- **Glow is too strong on small text.** ✅ fixed: `text-shadow: 0 0 3px currentColor` pulled back to `0 0 2px` on the shared CRT-family rule. Verified live in the browser preview — small UI text stays legible at the new radius across all four CRT palettes; no palette needed its own value beyond the shared one.
- See I-09 for the NES/Virtual Boy mislabelling, now fixed.

---

## Known issues

| ID   | Issue                                                                                                                                                                                                                                                                                                                      | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-01 | History dialog white-screened the whole app with no way out — an uncaught error in a React effect (failing IPC call after a stale dev hot-reload) unmounted the entire tree                                                                                                                                                | ✅ fixed: ErrorBoundary + recovery panel                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| I-02 | History list rendered blank with no explanation — a rejected `api.log` promise left state `null`, which rendered neither rows nor the empty-state message                                                                                                                                                                  | ✅ fixed: explicit loading/empty/error states                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| I-03 | First-line indent drifted right and stayed shifted — `text-indent: 2ch` on every paragraph (measured 44.4px vs 24px) is jarring while typing and inconsistent with hard-break lines                                                                                                                                        | ✅ fixed: off by default, Preferences toggle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| I-04 | Highlight mark shifted text ~2px horizontally because its box used padding                                                                                                                                                                                                                                                 | ✅ fixed: negative-margin compensation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| I-05 | Clicking a document in the binder while a story-bible entry was open selected the row but left the entry in the main pane. Two stacked causes: `selectDoc` never reset `mainView`, and it returned early when the clicked document was already active — exactly the case a writer hits returning to the document they left | ✅ fixed: `selectDoc` restores the manuscript view _before_ the same-document guard                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| I-06 | The GitHub sign-in code could not be selected or copied — `retro.css` sets `user-select: none` across all chrome, and the one string a writer must reproduce by hand never opted back in                                                                                                                                   | ✅ fixed: `.device-code` opts into `user-select: text`, plus a Copy Code button                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| I-07 | A successful sign-in was never acknowledged: the panel swapped silently to the connect form, nothing in the app ever said an account was reached, and the first poll waited 5s behind a static "Waiting for approval…" — so a working sign-in read exactly like a hang                                                     | ✅ fixed: explicit signed-in panel, standing account line, immediate first poll with a visible check count                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| I-08 | `sync:clientId` computed its reply with `syncStatusOf('')`, returning status for an empty project path (masked by the store reloading afterwards)                                                                                                                                                                          | ✅ fixed: the handler takes the project path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| I-09 | The palette shipped in PR #16 as "NES" is red-on-near-black — that's the Virtual Boy's colour scheme, not the NES's. Content-correctness bug, not a preference: the label and the design both describe the wrong console                                                                                                   | ✅ fixed: the type value (not just the display label) is renamed `virtualwyrm` everywhere — `types.ts`, all four `[data-palette='nes']` selector groups in `retro.css`, the Preferences radio, and `appearance.test.tsx`. `readAppearance` remaps any settings file that persisted the old `'nes'` value, covered by a mutation-tested unit test (`tests/settings.test.ts`). A genuine NES palette shipped alongside it as **Famicom** (`famicom` — deliberately not `nes`, so it can never collide with the retired value): rather than the two-tone ink/paper discipline every other palette keeps, Geoffrey asked for a full-colour palette instead — white ink on black paper plus four 4-bit accent slots and the highlight wash all drawn from real NES/Famicom NTSC 2C02 colours (sky blue, grass green, cartridge red, coin gold, magenta), so the reference is unmistakable rather than a single representative hue. |

---

## How we track work

- **This file is the plan.** Update it in the same PR as the work it describes — status changes, new backlog items, new known issues.
- **Backlog IDs are permanent** (`F-01`, `I-02`). Reference them in commit messages and PR titles so history stays greppable.
- **Bugs get logged here with their root cause**, not just a symptom, and are only marked fixed when there's a test or a verified reproduction behind the fix.
- **Feature requests land in the backlog immediately**, even half-formed — 💭 means "needs design before it can be scheduled," which is a real status, not a parking lot.
- **Execution order beats phase numbering.** The phase table describes scope; the Execution order section says what to build next and why. Re-sequence it deliberately, with the reason written down, rather than letting the brief's numbering decide by default.
- **Verify a merge actually landed** on `develop` before starting the next item (`git merge-base --is-ancestor <commit> origin/develop`). Two batches of work have silently missed the mainline — see the workflow rules in `CLAUDE.md`.
- **Start a fresh session per work item.** Long sessions re-send their whole history every turn; this file plus `CLAUDE.md` exist so a new agent can pick up full context in two reads instead.
