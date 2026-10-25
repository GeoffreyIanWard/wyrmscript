export type BinderNodeType = 'folder' | 'doc'

export interface BinderNode {
  id: string
  type: BinderNodeType
  title: string
  children?: BinderNode[]
}

export type DocStatus = 'draft' | 'revised' | 'final'

/**
 * The document-scoped pin vocabulary (F-10). Pins are a closed, app-shipped
 * set — unlike tags, writers cannot invent new ones. "Scene" is deliberately
 * absent: it is a tag (`SCENE_TAG` below), not a pin, so any document can be
 * marked plottable without a document-kind change.
 */
export const DOC_PINS = [
  'Setup',
  'Rising Action',
  'Climax',
  'Falling Action',
  'Resolution'
] as const
export type DocPin = (typeof DOC_PINS)[number]

/** The character-scoped pin vocabulary (F-10). World/glossary entities have none yet. */
export const CHARACTER_PINS = ['Protagonist', 'Antagonist', 'Viewpoint Character'] as const
export type CharacterPin = (typeof CHARACTER_PINS)[number]

/**
 * The tag that makes a document orderable/plottable (F-02/F-03/F-04 filter on
 * this). Not a new BinderNodeType — any document can carry it and keep being
 * treated as an ordinary document everywhere else in the app.
 */
export const SCENE_TAG = 'scene'

export interface DocMeta {
  id: string
  title: string
  label?: string
  status?: DocStatus
  /** Free-form, writer-invented, including `SCENE_TAG`. */
  tags?: string[]
  /** From `DOC_PINS`. */
  pins?: string[]
  /**
   * Position on the F-02 timeline (scene-tagged documents only). A
   * fractional rank — reordering one card never touches any other card's
   * value. Unset until a writer first drags a card; until then the
   * timeline falls back to binder order.
   */
  timelineOrder?: number
  /**
   * Free-form in-world date label ("Year 3, the first thaw"). Not parsed or
   * validated — no calendar system is assumed — so it is shown when set but
   * never governs sort order; `timelineOrder` alone does that.
   */
  timelineDate?: string
  /**
   * F-03: dramatic tension/intensity, 0–10, scene-tagged documents only.
   * Manual — set by dragging a node on the plot graph, never derived from
   * anything. Unset until a writer first drags a scene's node.
   */
  tension?: number
  /**
   * Where this scene's card sits on the corkboard, in board pixels from its
   * top-left. Unset until a writer first moves the card, and cleared again by
   * Tidy — an unplaced card falls back to its slot in binder order, so a
   * project that has never used the board needs no migration and reads the
   * same as it always did.
   *
   * Deliberately *not* the manuscript order: `timelineOrder` already
   * established that a view's own arrangement and the binder are different
   * questions (F-02). Where a card sits is the writer's thinking; the binder
   * is still the book.
   */
  boardX?: number
  boardY?: number
  /*
   * F-42: the back of the card — a scene outlined before any prose exists.
   * Every field optional and absent until written; a cleared field is a
   * deleted key, never an empty one (`lib/cardBack.ts` is the one writer).
   */
  /** What happens, in a line or three. */
  synopsis?: string
  /** Which act the scene falls in. A free label ("II", "Act Two") — an
   *  annotation like `tension`, never a container in the binder. */
  act?: string
  /** Free text with remembered suggestions, like tags. */
  sceneType?: string
  /** A World Book entry's id: where the scene happens. */
  location?: string
  /** What is at stake between whom. */
  conflict?: string
  /** Who is in the scene — the first stored link from a scene to the
   *  story bible, which otherwise is only ever derived from the prose. */
  cast?: CastEntry[]
  created: string
  modified: string
}

/** F-42: one character in a scene, and what they bring to it. */
export interface CastEntry {
  /** A Character Book entry's id. */
  entityId: string
  motivation?: string
  goal?: string
  /** Anything scene-specific the other two do not cover. */
  note?: string
}

/**
 * F-32/F-33: how a story-bible collection (Glossary/Character Book/World
 * Book) orders its entries. `pin` only means anything for `character` — the
 * other two collections have no pin vocabulary yet, so their sort control
 * offers `alphabetical`/`tag` only. Unset means "use the collection's own
 * default" (`pin` for characters, `alphabetical` otherwise) rather than
 * eagerly writing a value, so older project files need no migration.
 */
export type EntitySortMode = 'alphabetical' | 'tag' | 'pin'

export interface ProjectData {
  version: 1
  title: string
  binder: BinderNode[]
  trash: BinderNode[]
  /** Per-collection (F-33) — Character Book, World Book and Glossary each
   *  remember their own choice independently. Per-project, not app-level:
   *  a shared project should look the same on every machine it's opened on. */
  entitySort?: Partial<Record<EntityType, EntitySortMode>>
  /**
   * The world map's extent, in map pixels. Absent on a project that has
   * never grown its map, which then has the default. An origin rather than
   * a size alone, so growing the map north or west moves the edge, not
   * every pin and shape on it: one field in project.json changes, where
   * shifting the content would rewrite a file per pin.
   */
  mapBounds?: MapBounds
  /** F-12: what a distance on the map is in the story's own units, and how
   *  far a day's travel goes. Absent until the writer sets a scale. */
  mapScale?: MapScale
  /**
   * F-12: the maps beyond the first, in tab order — a city plan, a region
   * drawn closer. The first map, World, keeps its extent and scale in
   * `mapBounds` and `mapScale` above, so a project from before there were
   * several maps reads unchanged; an entry here with World's id carries
   * only what those fields do not (a new name, its place on the board).
   * Read through `lib/mapSheets.ts`, never by hand.
   */
  maps?: MapSheet[]
}

/** The first map's id: every pin, shape and mark with no `map` is on it. */
export const WORLD_MAP = 'world'

/** A record's `map` as it is stored: a map other than World, or nothing —
 *  World is never written, so the records from before there were several
 *  maps and the ones made on World since read and write the same. */
export const storedMapId = (map: unknown): string | undefined =>
  typeof map === 'string' && map !== '' && map !== WORLD_MAP ? map : undefined

/** The map a record is on. */
export const mapOf = (record: { map?: string }): string => storedMapId(record.map) ?? WORLD_MAP

/**
 * F-12: one map — a tab along the top of the map view. Each has its own
 * extent and scale (and its own pins, shapes and marks, which name it by
 * `map`). It can be put on the corkboard as a minimap card, placed like any
 * card.
 */
export interface MapSheet {
  id: string
  name: string
  bounds?: MapBounds
  scale?: MapScale
  /** On the corkboard as a minimap card. */
  onBoard?: boolean
  /** Where its card was put, unset until it is moved. */
  boardX?: number
  boardY?: number
}

/**
 * F-12: the map's scale — `pixels` map pixels are `distance` of the
 * writer's own `unit` (miles, leagues, days' sail) — and a day's travel on
 * foot, on horseback and by ship, in that unit.
 */
export interface MapScale {
  pixels: number
  distance: number
  unit: string
  perDay: { foot: number; horse: number; ship: number }
}

/** F-12: the world map's extent. `x`/`y` may be negative once grown north or west. */
export interface MapBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The GitHub account this app is signed into, if any — app-level, not a
 * project's: a writer on a new computer has no project open yet, and needs to
 * sign in to bring one down.
 */
export interface GithubAccount {
  /** Whether the OAuth app's client id has been entered on this computer. */
  clientIdSet: boolean
  login: string | null
}

/** A repository on the signed-in GitHub account (F-43). */
export interface GithubRepo {
  name: string
  /** `owner/name`, which is what the writer recognises. */
  fullName: string
  cloneUrl: string
  private: boolean
  /** ISO timestamp of the last push, for ordering and for the list. */
  updatedAt: string
}

export interface ProjectInfo {
  path: string
  data: ProjectData
}

/** F-24: the home screen's recents list. Title is captured at open time
 *  rather than read live, so a closed project's entry still shows a name
 *  without reopening it just to display a row. */
export interface RecentProject {
  path: string
  title: string
  openedAt: string
}

export interface DocFile {
  meta: DocMeta
  body: string
}

/** The three story-bible flavours. One mechanic, three skins (brief §5). */
export type EntityType = 'glossary' | 'character' | 'world'

export interface Entity {
  id: string
  type: EntityType
  /** Canonical name, e.g. "Elara Voss". */
  name: string
  /** Nicknames, titles, alternate spellings — all auto-link too. */
  aliases: string[]
  /** Free-form definition / bio / description (Markdown). */
  body: string
  /**
   * Free-form, writer-invented (F-10). Factions are not a separate mechanism —
   * a faction is just a tag shared by several entities (e.g. "House Voss").
   */
  tags?: string[]
  /** From `CHARACTER_PINS`. Meaningless and left empty on `world`/`glossary` entities. */
  pins?: string[]
  /**
   * F-13: nesting for `world` entities only (a building inside a
   * neighbourhood inside a city). One field, not a separate hierarchy
   * structure — the tree is reconstructed on the fly by following parent
   * pointers, the same "no second source of truth" reasoning behind every
   * other F-nn this session (tags, pins, plotlines, relationships). Meaningless
   * on `character`/`glossary` entities.
   */
  parentId?: string
  /**
   * F-45: this entry has a card on the corkboard. Characters and locations
   * are put on the board deliberately — the World Map's "Place on Map" model,
   * not the scenes' automatic one — so a big story bible does not flood the
   * board, and a card can come off it without deleting the entry behind it.
   * Written only when true. Meaningless on `glossary` entities.
   */
  onBoard?: boolean
  /**
   * Where the card sits, in board pixels — the same fields a scene carries in
   * `DocMeta`, with the same rules: unset until the writer moves it, cleared
   * by Tidy, grid slot in the meantime.
   */
  boardX?: number
  boardY?: number
  /**
   * F-47: the entry's portrait, as a project-relative filename —
   * `characters/<id>.png`. Relative because the project moves between
   * machines (sync, backup, restore), and an absolute path would break on
   * the first one it landed on. Beside the entry rather than in an images
   * folder of its own: `listEntities` already ignores non-`.md` files in the
   * collection folders, so the image sits next to the entry it belongs to
   * and travels with it. Meaningless on `glossary` entities.
   */
  portrait?: string
  created: string
  modified: string
}

/**
 * F-04: a plotline is a lightweight entity in its own right (name, colour,
 * status) — not a story-bible `Entity` (it never auto-links in prose, which
 * is what `Entity` is fundamentally for) and not just a tag (a tag has
 * nowhere to hang a colour or a status). A scene belongs to a plotline by
 * carrying a `DocMeta.tags` entry equal to the plotline's `name` — the same
 * tag mechanism as everywhere else, just read by name instead of a stored
 * id, so renaming a plotline is a deliberate, visible act (re-tag the
 * scenes) rather than a silent id remap.
 */
export type PlotlineStatus = 'open' | 'resolved'

/** A small, closed set of swatches — not free-color-picker input — so two
 *  plotlines are always visually distinguishable without relying on a
 *  writer's color sense, and so the palette stays finite and printable. */
export const PLOTLINE_COLOURS = [
  '#000000',
  '#8b2e2e',
  '#2e5f8b',
  '#3f7a3f',
  '#8b6f2e',
  '#6a3f8b'
] as const
export type PlotlineColour = (typeof PLOTLINE_COLOURS)[number]

export interface Plotline {
  id: string
  name: string
  colour: string
  /** Manual — set on the plotline itself, not derived from any scene's pins. */
  status: PlotlineStatus
  created: string
  modified: string
}

/**
 * F-11: a character graph edge. Typed and directional — "sibling of" reads
 * differently forwards and backwards, and only a directional edge can
 * answer "who is estranged from whom" rather than just "these two are
 * connected somehow." A new lightweight record, the same shape of decision
 * as F-04's `Plotline`: not a field on `Entity` (which would drift out of
 * sync the moment one side of a two-way relationship is edited without the
 * other), and not a story-bible entity of its own (it never auto-links).
 */
export interface Relationship {
  id: string
  /** Character entity ids — the direction the label reads, `fromId` → `toId`. */
  fromId: string
  toId: string
  /** e.g. "sibling of", "estranged from". Free-form, writer-owned. */
  label: string
  created: string
  modified: string
}

/**
 * F-12: a World Book location's position on the map. One `MapPin` per
 * placed location, not one big map file — the roadmap's standing open
 * question ("a map is spatial data that does not diff or merge as prose
 * does") is answered by not treating it as one file at all: each pin is its
 * own record, the same shape of decision as `Plotline`/`Relationship`, so a
 * sync conflict on one pin's position is an ordinary per-file frontmatter
 * conflict the existing sync engine already resolves, not a new kind of
 * problem. A `world` entity with no `MapPin` simply isn't on the map yet.
 */
export interface MapPin {
  id: string
  entityId: string
  /** Pixel coordinates within the map canvas. */
  x: number
  y: number
  /** How the place is drawn: as this stamp (a castle for a castle) rather
   *  than a pin. Omitted for a pin. */
  stamp?: MapStampKind
  /** The stamp's size (one of `MARK_SIZES`); omitted at the usual size, and
   *  meaningless for a pin. */
  size?: number
  /** The map it is on (a `MapSheet` id); omitted on the first map, World. A
   *  place has a pin on each map it is on. */
  map?: string
  created: string
  modified: string
}

/**
 * F-12: a shape drawn on the world map — a land mass's coast, a shaded area,
 * or a border. Points in map pixels, in drawing order, rounded to whole
 * pixels. `land` and `area` are closed outlines (the last point joins the
 * first); `border`, `river`, `road` and `rail` are open lines.
 *
 * One record per shape, like `MapPin` and `BoardString`: stored as
 * `map-shapes/<id>.md` (not `map/`, which holds the pins), so two devices drawing different coasts merge cleanly, and
 * an edit to one shape is a conflict about that shape alone.
 */
export const MAP_SHAPE_KINDS = ['land', 'area', 'border', 'river', 'road', 'rail', 'wall'] as const
export type MapShapeKind = (typeof MAP_SHAPE_KINDS)[number]

/** Whether the last point joins the first: land and areas are outlines,
 *  everything else a line. */
export const isClosedShape = (kind: MapShapeKind): boolean => kind === 'land' || kind === 'area'

/** The fewest points a shape can have and still be one: an outline needs
 *  three corners, a line two ends. Stated once, for main, the store and the
 *  view, which used to say it three times. */
export const minShapePoints = (kind: MapShapeKind): number => (isClosedShape(kind) ? 3 : 2)

export interface MapShape {
  id: string
  kind: MapShapeKind
  points: { x: number; y: number }[]
  /** What the feature is called — "The Saltmarsh", "River Wend" — drawn as a
   *  label on the map. Omitted, not empty, when it has none. */
  name?: string
  /** The map it is on; omitted on World. */
  map?: string
  created: string
  modified: string
}

/**
 * F-12 part 4: the map's marks — things at one point rather than along a
 * line. A stamp is a 1-bit picture of a feature (a mountain, a forest); a
 * label is free text for a sea, a region, anything not drawn.
 */
// Order is storage-irrelevant (a stamp is stored by its kind's name); the
// palette groups them itself. 'forest' is the broadleaf wood, kept under its
// first name so maps drawn before pines existed still read.
export const MAP_STAMP_KINDS = [
  'mountain',
  'hills',
  'mesa',
  'cliffs',
  'volcano',
  'dunes',
  'cave',
  'forest',
  'pine',
  'marsh',
  'waterfall',
  'rocks',
  'ship',
  'lighthouse',
  'town',
  'city',
  'castle',
  'tower',
  'ruins',
  'gate',
  'oak',
  'deadtree',
  'rainforest',
  'highgrass',
  'cactus',
  'seastacks',
  'boilingsea',
  'oasis',
  'wreck',
  'encampment',
  'cabin',
  'westerntown',
  'metropolis',
  'cathedral',
  'ziggurat',
  'cyberspire',
  'hangingcitadel',
  'ruinedarch',
  'ruinedtower',
  'ruinedcity',
  'buriedstatue',
  'effigy',
  'battlefield',
  'cemetery',
  'graveyard'
] as const
export type MapStampKind = (typeof MAP_STAMP_KINDS)[number]
export type MapMarkKind = MapStampKind | 'label'
export const MAP_MARK_KINDS: readonly MapMarkKind[] = [...MAP_STAMP_KINDS, 'label']

/** The sizes a mark can be drawn at, small to extra large. 1 is the usual
 *  size, and is never stored. */
export const MARK_SIZES = [0.6, 1, 1.5, 2.2] as const

/** A stored size, or 1 for one that is missing or not one of `MARK_SIZES`. */
export const markSizeOf = (size: unknown): number =>
  (MARK_SIZES as readonly unknown[]).includes(size) ? (size as number) : 1

/**
 * One mark on the map, in map pixels. Stored one per file as
 * `map-marks/<id>.md` (not `map/`, the pins', nor `map-shapes/`), so two
 * devices stamping different forests merge cleanly.
 *
 * A stamp's `name` is optional and drawn beneath it; a label's `name` is the
 * label, and a label without one is not kept.
 */
export interface MapMark {
  id: string
  kind: MapMarkKind
  x: number
  y: number
  /** How large it is drawn, as a multiple of its usual size (one of
   *  `MARK_SIZES`). Omitted at the usual size. */
  size?: number
  name?: string
  /** The map it is on; omitted on World. */
  map?: string
  created: string
  modified: string
}

/**
 * F-46: one end of a red string, anchored to a corkboard card.
 *
 * The anchor is a card plus an offset from the card's top-left in board
 * pixels, never a board coordinate: a string between two cards has to
 * survive either card being dragged, and a string stored by position would
 * stay nailed to the cork while the card it was pinned to walked away. The
 * card id is a scene's `DocMeta.id` or a bible entry's `Entity.id`; the view
 * never needs the collection to resolve it, so the end does not record one.
 */
export interface StringEnd {
  cardId: string
  dx: number
  dy: number
}

/**
 * F-46: a red string joining two corkboard cards, pin to pin.
 *
 * Stored exactly as `MapPin` is — one gray-matter file per string, empty
 * body — and for the same reason: two devices each adding or moving a
 * different string merge silently as two unrelated files, where a single
 * strings file would be a prose-style conflict on every such edit.
 */
export interface BoardString {
  id: string
  from: StringEnd
  to: StringEnd
  /** What the string means ("owes", "same night"). Optional; absent, not
   *  empty, when there is none. A string between two *characters* is not a
   *  board string at all but a `Relationship`, whose label is required. */
  label?: string
  created: string
  modified: string
}

export interface CommitInfo {
  oid: string
  message: string
  /** ms since epoch */
  timestamp: number
}

export interface VariantInfo {
  branch: string
  name: string
  /** ms since epoch */
  createdAt: number
  oid: string
}

/* ---------- Compile / export (brief §8) ---------- */

export type CompileFormat = 'txt' | 'md' | 'docx' | 'pdf'

/**
 * A formatted span of manuscript text. Only the three supported marks exist —
 * story-bible auto-links are ProseMirror decorations, never marks, so they
 * cannot reach this model at all (see the house rules).
 */
export interface CompileRun {
  text: string
  bold?: boolean
  italic?: boolean
  highlight?: boolean
}

/** A hard break inside a paragraph (TipTap `hardBreak`). */
export interface CompileBreak {
  break: true
}

export type CompileInline = CompileRun | CompileBreak

/**
 * The compiled manuscript as a flat block list, format-independent. Every
 * output format is a pure function of this — so selection, ordering, and
 * separator logic is written and tested exactly once.
 */
export type CompileBlock =
  | { kind: 'titlePage'; title: string; lines: string[] }
  | { kind: 'heading'; level: 1 | 2; text: string }
  | { kind: 'separator'; text: string }
  | { kind: 'pageBreak' }
  | { kind: 'paragraph'; runs: CompileInline[] }
  /** The world map, on a page of its own at the front (a frontispiece).
   *  Drawn by the paged formats from the picture handed to them; skipped,
   *  never failed, by a renderer that has none. */
  | { kind: 'map'; alt: string }

export interface CompileOptions {
  format: CompileFormat
  /** Binder document ids to include. Null means every document in the binder. */
  includeIds: string[] | null
  /** Text placed between documents; empty means a blank line only. */
  separator: string
  titlePage: boolean
  docTitles: boolean
  folderTitles: boolean
  /** Only honoured by formats with pages (`docx`). */
  pageBreakBetweenFolders: boolean
  /** The world map on a page of its own before everything else. Only
   *  honoured by formats with pages (`docx`, `pdf`). */
  frontispiece?: boolean
  /** Which map goes at the front (a `MapSheet` id); World when unset. */
  frontispieceMap?: string
}

/**
 * The map as the paged formats draw it at the front: the picture as SVG
 * (for PDF) and as PNG (for .docx, which Word draws reliably), with the PNG's
 * size in pixels. Made by the renderer, which alone can draw a PNG.
 */
export interface CompileMap {
  svg: string
  png?: Uint8Array
  /** The PNG's size in pixels. */
  width: number
  height: number
}

export interface CompileResult {
  blocks: CompileBlock[]
  /** Prose words only — headings, separators and the title page are excluded,
   *  so this is comparable with the status bar's count. */
  wordCount: number
  /** Number of documents that contributed prose. */
  docCount: number
  /** Text formats only; `docx` output is bytes. */
  text: string
  bytes?: Uint8Array
  extension: string
}

/* ---------- Appearance & page geometry (F-05, F-06) ---------- */

export type AccentTheme = '1bit' | '4bit'

/**
 * Whole-app palette. `paper` is the 1-bit default; `green`/`amber`/`vaporwave`/
 * `virtualwyrm` add CRT glow and scanlines; `ereader`/`night`/`dark`/`halftone`/
 * `blueprint`/`bios`/`collegiate` keep the same strict two-colour discipline
 * as the default, chosen for comfort or period flavour rather than novelty;
 * `ledger`/`arcade` deliberately keep a second highlight colour rather than
 * flattening to monochrome; `famicom` goes further still, breaking the
 * two-colour discipline entirely to run a full roster of real NES-palette
 * colours across ink/paper/accents/highlight (named `famicom` rather than
 * `nes` so it can't collide with the retired I-09 value in old settings
 * files — see the migration note in `main/wyrm/settings.ts`); `win95` keeps
 * a second colour too (teal desktop, silver window chrome, white page) but
 * stays flat-chrome like every palette above — no 3D bevels (F-28).
 */
export type PaletteTheme =
  | 'paper'
  | 'ereader'
  | 'night'
  | 'dark'
  | 'green'
  | 'amber'
  | 'vaporwave'
  | 'halftone'
  | 'ledger'
  | 'arcade'
  | 'blueprint'
  | 'bios'
  | 'collegiate'
  | 'virtualwyrm'
  | 'famicom'
  | 'win95'
  | 'manuscript'

export interface AppearanceSettings {
  accents: AccentTheme
  palette: PaletteTheme
  firstLineIndent: boolean
  /** Line measure in characters — the width of the text column. */
  measure: number
  /** Prose size in px. */
  fontSize: number
  /** Prose line height, unitless. */
  lineHeight: number
  /** F-27: paragraph numbers in a gutter beside the page. Off by default —
   *  the page is sacred, and gutter furniture is not a writer's default view. */
  lineNumbers: boolean
  /** F-27: a dotted rule every `pageViewLines` visual lines, standing in for
   *  an approximate page break. Off by default. */
  pageView: boolean
  /** F-27: how many visual lines between page-view rules. An approximation,
   *  not real pagination — see `lib/pageView.ts`. */
  pageViewLines: number
}

/**
 * F-39, Windows: height of the native window-control overlay, in px.
 *
 * **Must stay equal to `.menu-bar`'s height in `retro.css`** — the overlay
 * sits on top of that bar, and any mismatch shows as caption buttons that
 * float above or hang below the retro chrome. Duplicated here only because
 * the main process cannot read the stylesheet; `retro.css` remains the
 * source of truth for the bar itself.
 */
export const TITLE_BAR_OVERLAY_HEIGHT = 30

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  accents: '1bit',
  palette: 'paper',
  firstLineIndent: false,
  measure: 62,
  fontSize: 17,
  lineHeight: 1.7,
  lineNumbers: false,
  pageView: false,
  pageViewLines: 25
}

/* ---------- Writing stats (4c, brief §8) ---------- */

/**
 * How "words written today" is measured. The brief warns against making this
 * obnoxiously gamified, and the three modes disagree most on exactly the day
 * that matters: one spent cutting.
 */
export type WordCountMode =
  /** End-of-day total minus yesterday's. A day spent cutting reads negative,
   *  and the app says so rather than flattering the writer. */
  | 'net'
  /** Only additions counted, deletions ignored. Kinder to revision days, but
   *  retyping the same sentence counts every time. */
  | 'added'
  /** Net, floored at zero — a cutting day reads 0 instead of negative. */
  | 'net-positive'

/** One calendar day of writing, derived from git history (main/wyrm/stats.ts). */
export interface DayStat {
  /** Local calendar date, YYYY-MM-DD. */
  date: string
  /** Total manuscript words at this day's last checkpoint. */
  total: number
  /** This day's end-of-day total minus the previous active day's. May be negative. */
  net: number
  /** Sum of the positive per-checkpoint changes within the day. Never negative. */
  added: number
  /** Checkpoints recorded on this day. */
  commits: number
}

export interface StatsSettings {
  /** Words per day the writer is aiming for. */
  dailyGoal: number
  mode: WordCountMode
  /**
   * Whether word counts appear while writing — the editor's header count, the
   * status bar's count, and the today-vs-goal indicator, all together.
   *
   * Off is a real writing preference, not a niche one: a number that ticks up
   * beside the cursor invites watching it instead of the sentence. Turning it
   * off hides the ambient counters only; Writing Stats still reports
   * everything on demand, because choosing not to be watched while drafting
   * is different from not wanting to know.
   */
  showCounter: boolean
}

export const DEFAULT_STATS: StatsSettings = {
  dailyGoal: 500,
  mode: 'net',
  showCounter: true
}

/* ---------- printing (F-38) ---------- */

export interface PrintSettings {
  /**
   * Print each page as it fills, the way a sheet comes off a typewriter
   * platen. **Off by default and deliberately so** — the writing terminal
   * carries no interruptions unless asked (house rule), and a printer is a
   * loud, physical, paper-consuming interruption.
   */
  autoPrint: boolean
  /**
   * Device name from `listPrinters()`. Auto-printing needs one chosen in
   * advance: it prints silently, and "silently" with no printer selected
   * would mean either a dialog mid-sentence or paper appearing from whatever
   * the OS happened to consider default.
   */
  printerName: string
}

export const DEFAULT_PRINT: PrintSettings = {
  autoPrint: false,
  printerName: ''
}

/** One installed printer, as offered in Preferences. */
export interface PrinterInfo {
  name: string
  displayName: string
  isDefault: boolean
}

/* ---------- Project windows (F-41) ---------- */

/**
 * Where a project's window sits on the desktop, in pixels relative to it.
 * Persisted per project path, so reopening a novel puts its window back where
 * the writer left it.
 */
export interface WindowGeometry {
  x: number
  y: number
  width: number
  height: number
}

/* ---------- Local backup (F-01) ---------- */

/**
 * One place a project is mirrored to. A writer can have several — an external
 * drive, a storage card, a folder that some other tool syncs offsite — and
 * every checkpoint writes to all of them (F-40).
 */
export interface BackupTarget {
  /** Stable across renames and reordering, so settings key off this, not path. */
  id: string
  /** Absolute path of the backup repository. */
  path: string
  /**
   * When this particular target last received a successful mirror. Per-target
   * on purpose: the whole point of several targets is that they fall out of
   * date independently — a card that is only occasionally plugged in is the
   * normal case, not a fault.
   */
  lastBackupAt: number | null
}

export interface BackupSettings {
  targets: BackupTarget[]
  /** Mirror to every reachable target automatically after each checkpoint. */
  auto: boolean
}

/** What happened at one target during a backup run. */
export type TargetResult =
  | { targetId: string; status: 'ok'; outcome: BackupOutcome }
  /**
   * The target's volume is not mounted — an unplugged card, a drive that is
   * not connected. Emphatically not a failure: it is the expected state of
   * removable media, and is never surfaced as an error (F-40).
   */
  | { targetId: string; status: 'unreachable' }
  | { targetId: string; status: 'failed'; message: string }

/** One backup run across every configured target. */
export interface BackupRun {
  at: number
  results: TargetResult[]
}

export type BackupOutcome =
  | {
      status: 'backed-up'
      objectsCopied: number
      branches: number
      /** Files read back out of the backup to prove the manuscript is recoverable. */
      filesVerified: number
      at: number
    }
  | { status: 'up-to-date'; at: number }
  /** The backup holds work this project does not. Nothing was written. */
  | { status: 'diverged'; branch: string; detail: string }

/* ---------- GitHub sync (Phase 5, brief §7) ---------- */

/** Per-project sync state. `local-only` is an explicit, first-class choice (F-01). */
export interface SyncStatus {
  mode: 'unset' | 'local-only' | 'github'
  remoteUrl: string | null
  /** Signed-in GitHub account (app-level, shared across projects). */
  login: string | null
  /** Whether the OAuth client id has been configured (one-time app setup). */
  clientIdSet: boolean
  lastSyncAt: number | null
  /** Work committed locally that has not reached GitHub yet. */
  pendingSync: boolean
}

/** Device-flow prompt: show the code, send the writer to the URL. */
export interface DeviceCodeInfo {
  userCode: string
  verificationUri: string
  /** Seconds until the code expires. */
  expiresIn: number
}

export type SignInPoll =
  { state: 'pending' } | { state: 'ok'; login: string } | { state: 'error'; detail: string }

/** One file that changed on both devices in ways that cannot both be kept. */
export interface SyncConflict {
  /** Repo-relative path — the id the resolution answers by. */
  path: string
  kind: 'doc' | 'entity' | 'project' | 'file'
  /** Human name: document title, entity name, or a file label. */
  title: string
  /** Body text on this device; null means it was deleted here. */
  localBody: string | null
  /** Body text on the other device; null means it was deleted there. */
  remoteBody: string | null
}

/** `both` keeps this device's text and shelves the other's as a variant (docs only). */
export type ConflictResolution = 'mine' | 'theirs' | 'both'

export type SyncOutcome =
  | { status: 'up-to-date'; at: number }
  | { status: 'pushed'; at: number }
  | { status: 'pulled'; at: number; pushed: boolean }
  | { status: 'merged'; at: number; pushed: boolean }
  | { status: 'conflicts'; conflicts: SyncConflict[] }
  | { status: 'offline'; detail: string }
  | { status: 'error'; detail: string }

/** API exposed to the renderer over the context bridge. */
export interface WyrmApi {
  /** Show a save dialog and create a fresh .wyrm project. Null if cancelled. */
  createProject(title: string): Promise<ProjectInfo | null>
  /** Show an open dialog and open an existing .wyrm project. Null if cancelled. */
  openProject(): Promise<ProjectInfo | null>
  /** Open a project by path (e.g. the last-used project). Null if missing/invalid. */
  openProjectPath(path: string): Promise<ProjectInfo | null>
  saveProject(path: string, data: ProjectData): Promise<void>
  readDoc(path: string, id: string): Promise<DocFile>
  writeDoc(path: string, doc: DocFile): Promise<void>
  /** Stage everything and commit if anything changed. Returns true if a commit was made. */
  commit(path: string, message: string): Promise<boolean>
  getLastProjectPath(): Promise<string | null>
  /** F-24: most-recent first, for the home screen's recents list. */
  getRecentProjects(): Promise<RecentProject[]>
  /** F-24: clears the auto-reopen pointer. The project stays in recentProjects. */
  closeProject(): Promise<void>

  /** Commit history, newest first; docId scopes it to one document's file. */
  log(path: string, docId?: string): Promise<CommitInfo[]>
  /** A document as it existed at a commit oid or branch ref. Null if absent. */
  readDocAtRef(path: string, id: string, ref: string): Promise<DocFile | null>
  /** Restore a doc to its state at a ref, as a new commit (safety commit first). */
  restoreDocToRef(path: string, id: string, ref: string, label: string): Promise<DocFile>
  createVariant(path: string, docId: string, name: string): Promise<VariantInfo>
  listVariants(path: string, docId: string): Promise<VariantInfo[]>
  deleteVariant(path: string, branch: string): Promise<void>

  /** Every story-bible entry across all three types. */
  listEntities(path: string): Promise<Entity[]>
  writeEntity(path: string, entity: Entity): Promise<void>
  deleteEntity(path: string, type: EntityType, id: string): Promise<void>
  /** All documents with metadata — used to compute backlinks. */
  readAllDocs(path: string): Promise<DocFile[]>

  /**
   * F-47: pick an image with the native picker and copy it into the project
   * as the entry's portrait. Resolves to the project-relative filename to
   * store on the entry, or null when the writer cancels. The renderer names
   * the entry by id only — main looks its collection up and derives every
   * path itself, so nothing sent over the bridge is ever used as one.
   */
  importPortrait(path: string, entityId: string): Promise<string | null>
  /**
   * F-47: the portrait as a `data:` URL, or null when the entry has none. A
   * `data:` URL rather than `file://`: the shipped CSP already allows
   * `img-src data:`, and Chromium blocks `file://` from the dev server.
   */
  readPortrait(path: string, entityId: string): Promise<string | null>
  /** F-47: delete the portrait image. A no-op when there is none. */
  removePortrait(path: string, entityId: string): Promise<void>

  /** F-04: plotlines. Scenes belong to one by tag (see `Plotline`'s doc comment). */
  listPlotlines(path: string): Promise<Plotline[]>
  writePlotline(path: string, plotline: Plotline): Promise<void>
  deletePlotline(path: string, id: string): Promise<void>

  /** F-11: character graph edges. */
  listRelationships(path: string): Promise<Relationship[]>
  writeRelationship(path: string, relationship: Relationship): Promise<void>
  deleteRelationship(path: string, id: string): Promise<void>

  /** F-12: world map pin placements. */
  listMapPins(path: string): Promise<MapPin[]>
  writeMapPin(path: string, pin: MapPin): Promise<void>
  deleteMapPin(path: string, id: string): Promise<void>
  /** F-12: shapes drawn on the map, one `map/<id>.md` each. */
  listMapShapes(path: string): Promise<MapShape[]>
  writeMapShape(path: string, shape: MapShape): Promise<void>
  deleteMapShape(path: string, id: string): Promise<void>
  listMapMarks(path: string): Promise<MapMark[]>
  writeMapMark(path: string, mark: MapMark): Promise<void>
  deleteMapMark(path: string, id: string): Promise<void>

  /** F-46: red strings between corkboard cards. */
  listBoardStrings(path: string): Promise<BoardString[]>
  writeBoardString(path: string, s: BoardString): Promise<void>
  deleteBoardString(path: string, id: string): Promise<void>

  /** Show a save dialog and write compiled output. Returns the path, or null if cancelled.
   *  `dialog` names the save dialog for what is being written (Compile by default). */
  exportFile(
    defaultName: string,
    data: string | Uint8Array,
    dialog?: { title: string; buttonLabel: string }
  ): Promise<string | null>
  /**
   * F-38: render print-ready HTML to PDF bytes using Electron's own print
   * engine, so pagination is the real thing rather than a second guess.
   * Returns null where there is no print engine (the browser preview).
   */
  renderPdf(html: string): Promise<Uint8Array | null>
  /**
   * F-38: send print-ready HTML to the OS print dialog. Resolves false when
   * the writer cancels — a choice, not a failure. Rejects where there is no
   * print engine at all (the browser preview), which is a different thing
   * and must not masquerade as a cancellation.
   */
  printHtml(html: string, options?: { silent?: boolean; deviceName?: string }): Promise<boolean>
  /** F-38: installed printers, for the Preferences picker. Empty off the desktop. */
  listPrinters(): Promise<PrinterInfo[]>

  getPrintSettings(): Promise<PrintSettings>
  setPrintSettings(patch: Partial<PrintSettings>): Promise<PrintSettings>

  /** Appearance is app-level, not per-project — it follows the writer. */
  getAppearance(): Promise<AppearanceSettings>
  setAppearance(patch: Partial<AppearanceSettings>): Promise<AppearanceSettings>

  /** Daily goal and counting mode — app-level, like appearance. */
  getStatsSettings(): Promise<StatsSettings>
  setStatsSettings(patch: Partial<StatsSettings>): Promise<StatsSettings>
  /** Per-day writing history for a project, oldest first, derived from its
   *  git history. Checkpoints first so uncommitted work is included. */
  getDailyStats(path: string): Promise<DayStat[]>

  /** F-41: remembered window position, or null if this project has none yet. */
  getWindowGeometry(path: string): Promise<WindowGeometry | null>
  setWindowGeometry(path: string, geometry: WindowGeometry): Promise<void>
  /** Forget a remembered position, so the window is laid out fresh next time. */
  clearWindowGeometry(path: string): Promise<void>

  getBackupSettings(path: string): Promise<BackupSettings>
  /** Pick an additional backup location for this project. Null if cancelled. */
  chooseBackupLocation(path: string): Promise<BackupSettings | null>
  setBackupAuto(path: string, auto: boolean): Promise<BackupSettings>
  removeBackupTarget(path: string, targetId: string): Promise<BackupSettings>
  /** Checkpoint, then mirror this project into every reachable target (F-40). */
  backupNow(path: string): Promise<BackupRun>
  /** Pick a backup and a destination, then open the restored project. Null if cancelled. */
  restoreFromBackup(): Promise<ProjectInfo | null>
  /** F-43: the signed-in account's repositories, newest first. */
  listGithubRepos(): Promise<GithubRepo[]>
  getGithubAccount(): Promise<GithubAccount>
  setGithubClientId(clientId: string): Promise<GithubAccount>
  /**
   * F-43: make a local project from one that already exists on GitHub.
   * Resolves null when the writer cancels the folder picker.
   */
  cloneProject(url: string): Promise<ProjectInfo | null>

  getSyncStatus(path: string): Promise<SyncStatus>
  /** One-time app setup: the GitHub OAuth app's client id (public, not a secret). */
  setSyncClientId(path: string, clientId: string): Promise<SyncStatus>
  /** Begin the GitHub device flow. */
  signInStart(): Promise<DeviceCodeInfo>
  /** Poll for the device-flow result; call every few seconds until not pending. */
  signInPoll(): Promise<SignInPoll>
  signOut(path: string): Promise<SyncStatus>
  /** Connect this project: create a private repository, or use a pasted URL. */
  connectSync(
    path: string,
    options: { create: boolean; name?: string; url?: string }
  ): Promise<SyncStatus>
  disconnectSync(path: string): Promise<SyncStatus>
  /** Record "keep everything local" as a deliberate choice (F-01). */
  setLocalOnly(path: string): Promise<SyncStatus>
  syncNow(path: string): Promise<SyncOutcome>
  resolveSyncConflicts(
    path: string,
    choices: { path: string; resolution: ConflictResolution }[]
  ): Promise<SyncOutcome>

  /**
   * F-39: real OS fullscreen — the thing that actually covers the Windows
   * taskbar. Distinct from maximize (which never does) and from Focus Mode
   * (renderer-only). Returns the resulting state so the caller never has to
   * track it independently of the window.
   */
  toggleFullScreen(): Promise<boolean>
  /**
   * F-39, Windows only: recolour the native window-control overlay to match
   * the active palette. Colours are passed in rather than derived in main,
   * because the palettes live in `retro.css` and duplicating their hex values
   * into TypeScript would be a second source of truth. No-op off Windows.
   */
  setTitleBarOverlay(color: string, symbolColor: string): Promise<void>
}
