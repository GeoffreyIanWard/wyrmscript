# Contributing to WyrmStar

Thanks for looking. A few things are worth knowing before you spend time on a
change.

## The licence, and what contributing means

WyrmStar is GPL-3.0. Contributions are accepted under the same licence.

**The maintainer may also distribute WyrmStar commercially, including under
other terms.** To keep that possible, contributors are asked to confirm in
their pull request that they are the author of the change and that they grant
the maintainer permission to relicense it. Without that, a contribution can
only ever be GPL, which would make a paid build impossible to ship.

If that is not something you want to agree to, please open an issue describing
the change instead of a pull request — a described bug is genuinely useful and
carries no licensing question at all.

## Before you build something

Open an issue first for anything beyond a bug fix. This is an opinionated
application with a written design brief, and several plausible-sounding
features have been deliberately rejected. [`docs/ROADMAP.md`](docs/ROADMAP.md)
records what is planned and why; [`docs/design-brief.md`](docs/design-brief.md)
has sections marked `[LOCKED]` that are firm.

The house rules in [`CLAUDE.md`](CLAUDE.md) apply to every change. The ones
that most often surprise people:

- **The page is sacred.** No spellcheck, no autocomplete, no AI suggestions, no
  notifications in the writing terminal. Formatting is bold / italic /
  highlight only.
- **Nothing is ever lost.** Anything that replaces text must safety-commit
  first. History is never rewritten — corrections are new commits.
- **The UI never says "git".** It says checkpoint, version, variant, restore.
- A failure in one panel must never take down the app.

## Working on it

```bash
npm install
npm run dev      # Electron
npm run test     # vitest
npm run typecheck
npm run lint
```

The same dev server URL opens in a plain browser against an in-memory mock, so
most UI work can be done without Electron. Native dialogs and real
filesystem/git behaviour exist **only** in Electron.

Run `npm run test && npm run typecheck && npm run lint` before pushing. CI runs
all three on every pull request.

## Pull requests

- Branch from `develop` and target `develop`. Never `main`.
- **A bug fix lands with a test that reproduces the bug.** Every known issue in
  the roadmap has one.
- Match the surrounding code's comment density. Comments here explain *why* a
  thing is the way it is — particularly where the obvious implementation is
  wrong. Several files carry header comments describing the specific silent
  data-loss bug their design prevents; please read those before simplifying
  anything nearby.
- Update `docs/ROADMAP.md` in the same PR as the work it describes.

## Reporting bugs

Include the version from **About WyrmStar**, your operating system, and what
you expected to happen. If it involves a manuscript, please do not attach one —
describe the shape of the document instead. Your novel is yours.

Security problems go through [`SECURITY.md`](SECURITY.md), not the issue
tracker.
