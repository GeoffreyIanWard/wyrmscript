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
| 5   | GitHub sync                | 📋     | OAuth device flow, push/pull, offline queue, merge-conflict resolution UI. See F-01 — local-only must stay first-class                                             |
| 6   | Suggested extras           | 📋     | Compile/export, corkboard, full-project search, writing stats, command palette                                                                                     |

**Locked v1 decisions** (confirmed 2026-07-29): 1-bit default palette with entity links distinguished per type; entity click opens a side panel; character/world entries free-form; compile/export, backlinks, auto-commit safety net, and command palette all in v1; variants are frozen snapshots (not editable branches).

---

## Backlog

Requested features, not yet scheduled. Stable IDs so they can be referenced in commits and PRs.

### F-01 · Local-only version control (no GitHub required) 📋

Users who want everything on their own machine must get full version-control parity — history, diff, restore, variants, branches — with no account and no network. Wyrmscript already uses **isomorphic-git** (open-source, MIT), so the entire engine is local; GitHub is only a _remote_. Work needed:

- Make "no remote" an explicit, first-class choice in onboarding rather than an implicit state, so it never feels like a degraded mode.
- Optional local backup target: push/pull to a second repo on disk or an external drive (a git remote can be a filesystem path — real redundancy, no cloud).
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

### F-06 · Editor margins & measure control 📋

Let the writer control page geometry in the writing terminal: margin width / line measure (currently a fixed 62ch), font size, line height, and first-line indent (the indent toggle shipped early as part of the drift fix — see I-03). Belongs in Preferences beside the existing typography settings.

### F-07 · Full keyboard navigation 📋

Every menu and panel reachable and operable without the mouse — the WordStar half of the app's lineage (design-brief.md §1, pillar 3) currently only holds inside the editor. What exists today: global shortcuts (⌘S, ⌘Y, ⌘N, ⇧⌘N, ⌘,), and menu items are already real `<button>`s with `role="menuitem"`, so the semantics are in place. What's missing:

- **Menu bar**: a key to enter the menu bar, then ←/→ between menus, ↑/↓ between items, Home/End, Enter to activate, Esc to close, and type-ahead to jump to an item by first letter. This is the WAI-ARIA menubar pattern (roving `tabindex`) — worth following it rather than inventing, since it also makes the app screen-reader navigable.
- **Dialogs**: focus trap while open, Tab/⇧Tab cycling, Esc to cancel everywhere (only the commit field handles it today), Enter for the default button.
- **Binder**: ↑/↓ through rows, ←/→ to collapse/expand folders, Enter to open or rename, ⌫ to trash — plus a shortcut to move focus between binder, editor, and side panel.
- **Discoverability**: show the shortcut in the menu item that triggers each action (already partly done), and consider a keyboard-shortcut reference sheet.

Related: the ⌘K command palette (Phase 6) covers fast _navigation_ but is not a substitute for operating the existing menus; the optional WordStar Ctrl-key diamond (design-brief.md §3) is a separate opt-in keymap that should be designed alongside this so the two don't fight over bindings.

---

## Known issues

| ID   | Issue                                                                                                                                                                               | Status                                        |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| I-01 | History dialog white-screened the whole app with no way out — an uncaught error in a React effect (failing IPC call after a stale dev hot-reload) unmounted the entire tree         | ✅ fixed: ErrorBoundary + recovery panel      |
| I-02 | History list rendered blank with no explanation — a rejected `api.log` promise left state `null`, which rendered neither rows nor the empty-state message                           | ✅ fixed: explicit loading/empty/error states |
| I-03 | First-line indent drifted right and stayed shifted — `text-indent: 2ch` on every paragraph (measured 44.4px vs 24px) is jarring while typing and inconsistent with hard-break lines | ✅ fixed: off by default, Preferences toggle  |
| I-04 | Highlight mark shifted text ~2px horizontally because its box used padding                                                                                                          | ✅ fixed: negative-margin compensation        |

---

## How we track work

- **This file is the plan.** Update it in the same PR as the work it describes — status changes, new backlog items, new known issues.
- **Backlog IDs are permanent** (`F-01`, `I-02`). Reference them in commit messages and PR titles so history stays greppable.
- **Bugs get logged here with their root cause**, not just a symptom, and are only marked fixed when there's a test or a verified reproduction behind the fix.
- **Feature requests land in the backlog immediately**, even half-formed — 💭 means "needs design before it can be scheduled," which is a real status, not a parking lot.
- Phases stay in the order above unless explicitly re-sequenced; if a backlog item changes a phase's shape (F-01 does), note it on the item.
