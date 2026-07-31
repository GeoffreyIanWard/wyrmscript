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

**4c. Writing stats 📋 — next up.** Session word count, daily goal, streak. Held back from 4b deliberately: "words written today" is a net-change measurement over time, not a snapshot, and it needs its own data model rather than being wedged into a navigation change.

### 5. Story-structure cluster (F-10 first, then F-02, F-03, F-04, F-11, F-12, F-13) 💭

Timeline, plot graph, plotline tracking — now joined by graph views, the world map and nested locations. **Design F-10 (pins & tags) first and build nothing else until it settles.** Every item here hangs off scene-level metadata, which is precisely what F-10 defines; the roadmap has deferred that model twice already, and the 2026-07-30 requests made it the gating item rather than one feature among several. Once pins and tags exist, the timeline, the plot graph and the character graph are all _views over the same data_ rather than three incompatible metadata schemes. High-value thinking, low-volume output.

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

### F-10 · Pins & tags 💭 — **design this before F-02/F-03/F-04**

Pin and tag characters, events, scenes and locations: "Protagonist", "Viewpoint character", "Antagonist", "Rising Action". Pinning a document as a **scene** is what lets it be ordered and plotted. Requested 2026-07-30. Slightly skeuomorphic UI — pins with actual pin heads, tags shaped like little luggage tags; old-school cool, still 1-bit.

**This is the scene-level metadata model the roadmap has been deferring.** F-02 (timeline), F-03 (plot graph) and F-04 (plotline tracking) all need exactly this and were explicitly held back so it would be designed once. It is now the gating item for that whole cluster — design it first, and the other three become views over it. Design questions:

- Are tags a free vocabulary the writer invents, a fixed set the app ships, or both (ship a starter set, let it grow)?
- Do pins live on `DocMeta`/`Entity` (simple, versioned with the file, diffs cleanly) or in a separate index in `project.json` (queryable without reading every document, but a second source of truth)? The first fits "everything is plain text on purpose"; the second is faster for graph views. Frontmatter probably wins — the story bible already proves that shape works.
- Does "scene" become a first-class document kind, or a tag that some documents happen to carry? A tag is less disruptive to the binder and reversible.

### F-11 · Graph views 💭

Maps rather than lists: a **character graph** where characters can be grouped and joined by relationship edges, alongside the plot graph of F-03. Requested 2026-07-30. Depends on F-10 for what the nodes are and what edges mean. Open: are relationships their own entity (typed, directional, with a label like "brother of"), or free edges? Directional typed edges are more work but are the only version that can answer "who is estranged from whom".

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
