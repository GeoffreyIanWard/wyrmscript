# WyrmStar

A bespoke desktop word processor for long-form fiction. WordStar's focus, Scrivener's structure, System 6's face — and git underneath, so nothing is ever truly lost.

Full product/architecture spec: [docs/design-brief.md](docs/design-brief.md).

## Development

```
npm install
npm run dev        # launches Electron with hot reload
npm run test       # vitest suite
npm run typecheck  # tsc, node + web configs
npm run lint       # eslint
npm run build      # production build (out/)
```

Opening the renderer URL (printed by `npm run dev`) in a plain browser runs the UI against an in-memory mock project — handy for UI work; real filesystem/git behavior only exists in the Electron window.

## Project format

A project is a folder, `MyNovel.wyrm/`, which is also a local git repository:

- `project.json` — binder tree (folders/documents), trash, project settings
- `documents/<id>.md` — one Markdown file per document, YAML frontmatter for metadata; prose formatting is `**bold**`, `*italic*`, `==highlight==`
- `.git/` — managed by isomorphic-git; every checkpoint of your manuscript is a commit

Everything outside `.git/` is plain, diffable text on purpose.
