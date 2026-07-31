# WyrmStar — Design & Build Brief

You are building a desktop word processor for long-form fiction writing. Two lodestars: **WordStar** (distraction-free, keyboard-driven, terminal-era prose composition) and **Scrivener** (hierarchical project organization, corkboard/outline thinking, compile-to-manuscript). The visual language is **early Mac OS (Lisa / System 1–6)**: chunky, bold, 1-to-4-bit, unapologetically retro.

This document is both a product spec and an architecture brief. Sections marked **[LOCKED]** are firm requirements from the project owner (Geoffrey). Sections marked **[SUGGESTED]** are additions proposed to round out the app — treat these as recommendations to confirm with Geoffrey, not mandates. Everything else is implementation guidance you should follow unless you find a concrete reason not to.

---

## 1. Design Pillars

1. **Retro chrome, modern reliability.** The interface looks like 1984. The engineering underneath does not — no floppy disks, no data loss.
2. **The page is sacred.** The writing terminal is the one place in the app that stays quiet: no red squiggles, no autocomplete popups, no AI suggestions, no notifications.
3. **Structure like Scrivener, prose like WordStar.** Organize a novel the way Scrivener does (binder, hierarchy, metadata). Write a scene the way WordStar does (fast, plain, keyboard-first).
4. **Nothing is ever truly lost.** Every meaningful edit is recoverable. This is the feature Geoffrey has never found elsewhere — treat it as the app's signature strength, not an afterthought.

---

## 2. Visual Design System **[LOCKED direction, implementation detail below]**

- **Palette:** default theme is **1-bit black-and-white** with Susan Kare–style dithered gray fills (classic Mac pattern textures) for shading, disabled states, and panel backgrounds — no gradients, no drop shadows, no rounded corners beyond the era-accurate slight corner clip on windows. A **4-bit (16-color, Mac II/EGA-adjacent)** palette is available as an alternate theme for accents (folder colors, label colors, highlight colors) — keep it restrained, not a rainbow.
- **Window chrome:** double pinstripe title bars, thick black 1px-multiplied borders, chunky square scrollbars with visible arrow buttons, boxy checkboxes/radio buttons, no anti-aliasing on UI chrome elements (crisp pixel edges).
- **UI typeface (chrome only — menus, binder, dialogs, title bars):** a faithful bitmap/pixel font in the spirit of Chicago or Geneva (e.g. an open license Chicago-style webfont, or "Silkscreen" as a fallback). This font is for labels and navigation, not prose.
- **Writing typeface (terminal only):** a **separate, highly legible monospace**, distinct from the chrome font — chunky bitmap fonts are fatigue-inducing over 2,000+ words. Default to something like **Courier Prime** (typewriter homage, very on-brand for WordStar) or **IBM Plex Mono** / **JetBrains Mono**. Make this user-configurable; don't force pixel fonts onto actual manuscript text.
- **Icons:** simple 1-bit glyphs for documents, folders, characters, locations, glossary entries — Finder-icon-era simplicity, not skeuomorphic detail.
- **Optional secondary "terminal" theme** for the writing view specifically: monochrome green- or amber-on-black phosphor look, subtle scanline texture, as a WordStar/DOS nod. Toggle, not default.
- **Sound (low priority, easter-egg tier):** optional classic Mac UI clicks/chimes on actions like commit or save. Off by default.

---

## 3. Writing Terminal **[LOCKED]**

- Single-document focused editor. Minimal chrome — ideally an auto-hiding top bar showing just document title and live word count.
- **No spellcheck, no grammar check, no AI autocomplete, no autosuggest.** Disable the OS/browser spellcheck attribute explicitly. This is a hard requirement, not a toggle to reconsider later.
- Formatting support limited to: **bold, italic, highlight**. Resist scope creep into a full rich-text toolbar (no font-size pickers, no text color, no tables) — this is prose, not desktop publishing.
- **[SUGGESTED]** Typewriter scrolling (active line stays vertically centered) as a toggle.
- **[SUGGESTED]** A distraction-free/composition full-screen mode that dims all but the current paragraph, echoing Scrivener's Composition Mode.
- **[SUGGESTED]** Optional "WordStar mode" keybinding set (the classic Ctrl-S/D/E/X diamond for cursor movement, Ctrl-K commands) for anyone who has that muscle memory. Opt-in, not default — most users won't want it.

---

## 4. Hierarchical Organization (the Binder) **[LOCKED]**

Modeled directly on Scrivener's binder: a visible tree of folders and documents (chapters, scenes, notes) that can be nested arbitrarily deep, drag-reordered, and renamed inline. Every project has one binder as its spine.

**[SUGGESTED]** additions in the same spirit:

- **Label & status metadata** per document (e.g. label = POV character or plot thread, color-coded dot in the tree; status = Draft/Revised/Final), shown as small chrome in the binder row — pure Scrivener homage.
- **Corkboard/outline view**: index-card view of a folder's children (title + synopsis), drag to reorder, doubles as a scene-planning tool.
- **Trash with recovery window**: deleting a whole document is a different action from editing text inside one — keep a short-lived trash separate from the version control system described below.

---

## 5. Story Bible: Glossary, Character Book, World Book **[LOCKED]**

These three are functionally the same mechanic with three skins, so build one underlying system:

**Entity index.** A single lookup table merging all glossary terms, characters, and world/location entries, each with: id, type (glossary/character/world), canonical name, and a list of aliases (nicknames, titles, alternate spellings — e.g. character "Elara Voss" might have aliases `["Elara", "Captain Voss", "the Captain"]`).

**Auto-linking in the terminal.** As the user types (debounced, ~300–500ms), scan the active document's text for exact, whole-word, case-insensitive matches against the entity index, preferring the longest match when names overlap (e.g. "Captain Elara Voss" over "Elara" alone). Matched spans get a subtle underline, styled distinctly per entity type (e.g. dotted for glossary, one color for characters, another for world/locations — respecting the 1–4-bit palette). Clicking a matched span opens that entry (side panel or navigation, your call on interaction pattern — just don't require a modifier key that conflicts with text selection).

**Add-from-terminal.** Right-click a selected word or phrase in the writing terminal to get a context menu: "Add to Glossary…", "Add to Character Book…", "Add to World Book…". Opens a quick-create form pre-filled with the selection as the name; user adds a definition/bio/description and saves. Newly added entries should retroactively highlight existing occurrences in the current document without requiring a reload.

**Entry editors.** Each entry type gets its own structured view:

- Glossary: term, definition, optional notes.
- Character: name, aliases, a free-form bio/notes area, optionally structured fields (role, appearance, relationships) — keep this lightweight and non-prescriptive rather than a rigid character-sheet template.
- World: name, aliases, description, optionally a type (location/faction/item/etc.).

**[SUGGESTED]** Backlinks panel on every entry: "mentioned in — Chapter 3, Chapter 7, Scene 12…", generated from the same index, letting the user jump straight to every scene a character or place appears in. This is high-value and cheap to build once the index exists — recommend including it in v1 rather than deferring.

---

## 6. Version Control **[LOCKED — the standout feature]**

This is the feature Geoffrey specifically called out as missing everywhere else. It's implemented on **real git**, not a bespoke snapshot system — see §7 for why that's now the right call.

- Each project (`MyNovel.wyrm/`) is its own git repository. Every document, story-bible entry, and project file (§10) is plain text, so git's native diffing works out of the box with no extra tooling.
- Use **isomorphic-git** (pure JS/TS, runs inside Electron's Node process) rather than shelling out to a system git binary — no dependency on the user having git installed, no PATH issues on Windows vs. Mac.
- **User-facing operations map directly onto git, but the UI never exposes git terminology or raw commands:**
  - _Commit_: save the current state with a message ("finished second draft of the confrontation scene"). Under the hood: `git add` the changed files + `git commit`.
  - _Diff_: view any two commits (or a commit vs. working state) side-by-side or inline, word/sentence-level — render git's diff output through a prose-friendly word-diff view rather than raw unified-diff text.
  - _Rollback_: revert a document to a prior commit, implemented as a new commit (`git revert`-style, non-destructive) so rollback itself is never a data-loss event.
  - _Branch/variant_: duplicate a document or scene as an alternate version to explore without losing the original — a real git branch under the hood, surfaced to the user as "Save As Variant," not as branch/merge jargon.
- **[SUGGESTED]** Auto-commit safety net: silently commit before risky bulk operations (compile/export, rollback, bulk delete) in addition to the user's manual commits.

---

## 7. Sync via GitHub **[LOCKED — revised from an earlier Dropbox-folder draft]**

**Use GitHub as the sync backbone, via git's own push/pull protocol — not by pointing a `.git` folder at a filesystem-sync tool like Dropbox.** That distinction matters: syncing git's internal object store with a tool that isn't git-aware (Dropbox, iCloud Drive, etc.) is a well-documented corruption risk, because those tools sync file-by-file and can catch git mid-write. Syncing via git's own push/pull has none of that risk — it's what git was built for, and it turns §6's version control and cross-device sync into the same mechanism instead of two.

- Each project's repo has a **private GitHub remote** (private by default — this is unpublished creative work). One repo per novel project, matching the `.wyrm` package boundary.
- **Auth:** GitHub OAuth device flow at first launch/project creation — one-time "sign in with GitHub," no manual token management for the user.
- **Sync behavior:** auto-push after each commit when online; queue commits locally and push automatically once connectivity returns when offline (this preserves the offline-first requirement — commits themselves are always local-first and instant, only the push needs network). A manual "Sync Now" control covers pull-on-demand.
- **Conflict handling:** if the same document is edited on two devices without syncing in between, a normal push will be rejected and a pull will surface a git merge conflict. Do not expose raw `<<<<<<<` conflict markers — build a resolution screen that reuses the diff viewer from §6 to show both versions side by side and let the user pick one, merge by hand, or keep both (the second becoming a new commit/variant). This is a friendlier, better-tooled version of the "conflicted copy" problem Dropbox would have handed the user as stray files.
- Cross-platform (Windows/Mac) "pick up where you left off" falls out of this for free once push/pull is wired up correctly — no custom backend, no server Geoffrey has to run or pay for beyond GitHub's free tier.
- **Trade-off to flag:** this requires a GitHub account and a one-time OAuth step, which is a heavier ask than "point the app at a folder." Worth it for getting real diff/branch/merge tooling and free private hosting/backup in return, but call it out explicitly during onboarding rather than burying it.

---

## 8. Suggested Feature Additions **[SUGGESTED — confirm priority with Geoffrey]**

Beyond what's above, these fit the WordStar/Scrivener lineage well:

- **Compile/Export**: assemble selected binder items into a single output (plain text, .docx, .epub, PDF) with configurable scene separators and formatting overrides. Without this, the app can't produce a finished manuscript — treat as a v1 requirement even though it wasn't explicitly named.
- **Full-project search**: search across all documents and all story bible entries at once, with results linking back to source.
- **Writing stats**: session word count, daily goal with a progress indicator, streak tracking — fits the "high score" retro feel without being gamified in an obnoxious way.
- **Command palette** (Cmd/Ctrl-K): fast fuzzy navigation between documents and story bible entries — keyboard-first, on-brand for the WordStar heritage.

---

## 9. Explicit Non-Goals (v1)

- Spellcheck / grammar-check (deliberately excluded — breaks immersion, per requirement).
- Real-time multi-user collaboration (git-per-project sync is single-writer-at-a-time in spirit; concurrent-edit handling in §7 is a safety net, not a collaboration feature).
- A custom cloud backend or account system (GitHub is the entire sync/hosting layer — no server for Geoffrey to run).
- Native mobile app (out of scope for v1; the repo is technically reachable from anywhere with git, but no mobile client is being built now).

---

## 10. Architecture Recommendation

- **Shell:** Electron + React + TypeScript + Vite. Electron over Tauri here specifically because the agent building this will move faster with Electron's much larger ecosystem of examples, filesystem-access patterns, and rich-text-editor integrations — bundle size is not a real constraint for a single-user writing tool.
- **Editor:** TipTap (built on ProseMirror) for the writing terminal — supports the custom "entity mark" decorations needed for §5's auto-linking, plus clean bold/italic/highlight without dragging in a bloated toolbar.
- **Storage format:** a project is a folder (`MyNovel.wyrm/`) that is also a git repository (see §6/§7) — this is what makes version control, GitHub sync, and future portability all work cleanly:
  - `project.json` — binder tree structure, project-level settings.
  - `documents/<id>.md` — one Markdown file per document, with YAML frontmatter for id/title/label/status/timestamps.
  - `glossary/`, `characters/`, `world/` — one file (or one JSON collection) per entry type.
  - `.git/` — managed entirely by isomorphic-git; this _is_ the version history, no separate history format needed.
  - Everything outside `.git/` is plain text on purpose: diffable, human-inspectable, and future-proof if the app ever needs to be rebuilt or exported from.
- **Git library:** isomorphic-git for all commit/diff/branch/push/pull operations (see §6/§7) — avoids bundling or requiring a system git install.
- **State management:** keep it simple — React context or Zustand, no need for anything heavier for a single-window desktop app.

---

## 11. Development Process (for the app's own codebase — separate from §6/§7 above)

This is about building WyrmStar itself, not the in-app manuscript version control feature — note that **GitHub is now used in two unrelated capacities**: once as where WyrmStar's own source code lives (this section), and once as the sync/version-control backbone for each user's _novel_ repos (§6/§7). Don't let the two get conflated in implementation — they're different repos, different accounts even (Geoffrey's dev GitHub vs. whatever GitHub account each user signs the app into).

- Standard git repo (GitHub) for WyrmStar's own source, with the agent working in feature branches and opening PRs for review rather than pushing directly to main. Geoffrey reviews and approves; rollback = revert the PR/commit. This gives him the "approve or roll back agent changes" control he asked for as engineering-manager-in-the-loop.
- **Recommended phased build order**, each phase its own PR (or small PR series):
  1. **Scaffold & aesthetic proof**: Electron+React+TS+Vite shell with the Lisa-style window chrome and both typefaces in place, no real functionality yet. Cheap to course-correct on the most subjective part (the look) before investing in features.
  2. **Core loop**: binder tree + writing terminal + local file save/load against the `.wyrm` folder format, with the folder initialized as a local git repo from day one (even before push/pull exists, local commits give you the safety net immediately).
  3. **Version control UI**: commit/diff/rollback/variant, built on isomorphic-git against the Phase 2 repo.
  4. **Story bible**: glossary, character book, world book, plus the shared entity-linking mechanic and right-click add-from-terminal flow.
  5. **GitHub sync**: OAuth device flow, push/pull, offline queueing, merge-conflict resolution UI.
  6. **Suggested extras**: compile/export, corkboard, full-project search, stats, command palette — sequence these by Geoffrey's priority after the core app is in hand.

---

## 12. Open Questions to Resolve Before/During Build

- Interaction pattern for clicking an entity link in the terminal: open a side panel in place, or navigate away from the writing view entirely? (Recommend a side panel to avoid breaking flow.)
- Default palette: pure 1-bit black-and-white, or 4-bit as the default with 1-bit as the "purist" alternate theme?
- Whether character/world entries get structured fields (role, appearance, etc.) or stay fully free-form — affects entry editor complexity.
