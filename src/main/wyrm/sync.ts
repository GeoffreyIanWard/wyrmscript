import fs from 'node:fs'
import { promises as fsp } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import git from 'isomorphic-git'
import diff3Merge from 'diff3'
import matter from 'gray-matter'
import type {
  ConflictAnswer,
  ConflictChoice,
  MapSheet,
  ProjectData,
  SyncConflict,
  SyncHeads,
  SyncOutcome
} from '../../shared/types'
import { author, commitAll, commitMerge } from './git'
import { mergedMapsOf, withMaps, withMergedMaps } from './mergeMaps'
import { isPlainId } from './plainId'
import { scrapFileText, scrapRepoPath } from './scratch'

/**
 * GitHub sync engine (Phase 5, brief §7). Sync is git's own push/pull over
 * HTTPS — never a filesystem-sync tool touching `.git/`, which is the
 * corruption path the brief explicitly rules out.
 *
 * **The working tree is the single source of truth for every sync commit.**
 * isomorphic-git's `merge` never touches the working directory (verified by
 * experiment: it writes the merge commit and can move the ref, but files on
 * disk keep their pre-merge content). Trusting its ref move would therefore
 * plant a time bomb: the next autosave would commit the stale working tree
 * right back over the merge, silently undoing the other device's work — the
 * same class of bug as racy-git in `commitAll`, and just as unacceptable here.
 * So `merge` is only ever used two ways, with `noUpdateBranch: true` both
 * times:
 *
 *  - as a **detector**: a plain attempt whose MergeConflictError lists the
 *    genuinely conflicting paths (its diff3 auto-merges non-overlapping edits
 *    to the same file, so a listed path is a real overlap);
 *  - as an **oracle**: a re-run with an always-clean driver, producing a
 *    dangling commit whose tree holds the correct auto-merged content for
 *    every path the user was not asked about.
 *
 * The final state is always materialized into the working directory first and
 * committed from there with explicit parents (`commitMerge`), so what the
 * writer sees on screen and what history records are the same bytes by
 * construction.
 *
 * Nothing is destroyed on any path: the safety commit runs before anything
 * else, a merge keeps both parents (so either side is restorable), "keep
 * both" shelves the other device's version as a variant, and a conflicted
 * sync changes nothing at all until the writer chooses.
 *
 * **Content the engine did not compose travels as bytes.** Every other
 * route a file takes (push, pull, backup, clone) moves blobs by oid; a
 * divergent merge is the one place the engine assembles files itself, and
 * it used to assemble every one as a string. A blob is only intact after a
 * round trip through a string if it was valid UTF-8 — a PNG decodes with
 * every bad byte replaced by U+FFFD and is re-encoded that way, so the first
 * merge after a portrait was added committed a corrupted copy of a file
 * neither device had touched. The only strings in a merge target are the
 * frontmatter merges the engine wrote itself; everything else is read with
 * `blobAt` and written back as the same bytes.
 */

const SYNC_BRANCH = 'main'
const REMOTE = 'origin'
const REMOTE_REF = `refs/remotes/${REMOTE}/${SYNC_BRANCH}`

/**
 * Network operations, injected. Tests drive the whole engine against a second
 * repository on disk; production binds isomorphic-git's HTTP client and the
 * OAuth token. Everything above this seam is exercised for real either way.
 */
export interface SyncTransport {
  /**
   * Fetch the remote sync branch, leaving its head in refs/remotes/origin/main.
   * Resolves null when the remote exists but is empty. Throws on network/auth
   * failure.
   */
  fetchMainHead(dir: string): Promise<string | null>
  /** Push the given fully-qualified refs. Throws PushRejectedError on non-fast-forward. */
  push(dir: string, refs: string[]): Promise<void>
}

export class PushRejectedError extends Error {}

/* ---------- remote configuration (stored in .git/config, never synced) ---------- */

export async function getRemoteUrl(dir: string): Promise<string | null> {
  const remotes = await git.listRemotes({ fs, dir }).catch(() => [])
  return remotes.find((r) => r.remote === REMOTE)?.url ?? null
}

export async function setRemoteUrl(dir: string, url: string): Promise<void> {
  await git.deleteRemote({ fs, dir, remote: REMOTE }).catch(() => undefined)
  await git.addRemote({ fs, dir, remote: REMOTE, url })
}

export async function clearRemote(dir: string): Promise<void> {
  await git.deleteRemote({ fs, dir, remote: REMOTE }).catch(() => undefined)
}

/* ---------- helpers ---------- */

async function resolveOrNull(dir: string, ref: string): Promise<string | null> {
  return git.resolveRef({ fs, dir, ref }).catch(() => null)
}

/** File bytes at a commit, or null when the file does not exist there. */
async function blobAt(dir: string, oid: string, filepath: string): Promise<Uint8Array | null> {
  try {
    const { blob } = await git.readBlob({ fs, dir, oid, filepath })
    return blob
  } catch {
    return null
  }
}

/**
 * File text at a commit, or null when the file does not exist there. For
 * files the engine parses (frontmatter, conflict display) only — anything
 * heading back to disk goes through `blobAt`, since this decode is lossy for
 * everything that is not UTF-8.
 */
async function textAt(dir: string, oid: string, filepath: string): Promise<string | null> {
  const blob = await blobAt(dir, oid, filepath)
  return blob == null ? null : new TextDecoder().decode(blob)
}

/**
 * Whether bytes are not text: not valid UTF-8, or holding a NUL. Judged on
 * the bytes, never on a decoded string — a U+FFFD the writer typed is text,
 * and a lossy decode cannot tell the two apart.
 */
function isBinary(bytes: Uint8Array | null): boolean {
  if (!bytes) return false
  if (bytes.includes(0)) return true
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return false
  } catch {
    return true
  }
}

/** Byte-exact equality, with absence equal only to absence. */
function sameBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a == null || b == null) return a === b
  return Buffer.compare(a, b) === 0
}

async function localBranches(dir: string): Promise<string[]> {
  const branches = await git.listBranches({ fs, dir })
  return branches.map((b) => `refs/heads/${b}`)
}

function isNetworkError(e: unknown): boolean {
  if (e instanceof PushRejectedError) return false
  const message = e instanceof Error ? `${e.name} ${e.message}` : String(e)
  return /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network|socket/i.test(
    message
  )
}

function detail(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * When a side last changed a file: the newest commit on that side touching
 * it (its committer time). A save point the app made on its own — before a
 * sync, say — counts: it is when the words were last saved there. Null when
 * the history cannot say.
 */
async function lastChangedAt(dir: string, ref: string, filepath: string): Promise<number | null> {
  try {
    const [entry] = await git.log({ fs, dir, ref, filepath, depth: 1, force: true })
    return entry ? entry.commit.committer.timestamp * 1000 : null
  } catch {
    return null
  }
}

/** Human-facing description of a conflicted path, for the resolution screen. */
async function describeConflict(
  dir: string,
  filepath: string,
  localHead: string,
  remoteHead: string,
  base: string | null
): Promise<SyncConflict> {
  const localBlob = await blobAt(dir, localHead, filepath)
  const remoteBlob = await blobAt(dir, remoteHead, filepath)
  const baseBlob = base ? await blobAt(dir, base, filepath) : null
  const localRaw = localBlob == null ? null : new TextDecoder().decode(localBlob)
  const remoteRaw = remoteBlob == null ? null : new TextDecoder().decode(remoteBlob)
  const baseRaw = baseBlob == null ? null : new TextDecoder().decode(baseBlob)

  const kind: SyncConflict['kind'] = filepath.startsWith('documents/')
    ? 'doc'
    : // Entries only: a portrait sits in the same folder and is not one.
      /^(glossary|characters|world)\/[^/]+\.md$/.test(filepath)
      ? 'entity'
      : SCRAP.test(filepath)
        ? 'scrap'
        : filepath === 'project.json'
          ? 'project'
          : 'file'

  let title = filepath
  let localBody = localRaw
  let remoteBody = remoteRaw
  let baseBody = baseRaw
  if (kind === 'doc' || kind === 'entity' || kind === 'scrap') {
    const parsed = [localRaw, remoteRaw].map((raw) => (raw == null ? null : matter(raw)))
    const meta = (parsed[0] ?? parsed[1])?.data as
      { title?: string; name?: string; fromTitle?: string } | undefined
    title =
      kind === 'scrap'
        ? meta?.fromTitle
          ? `Scratch pad: from “${meta.fromTitle}”`
          : 'Scratch pad note'
        : (meta?.title ?? meta?.name ?? filepath)
    // The writer compares prose, not frontmatter — timestamps differing is
    // noise, the body differing is the decision.
    localBody = parsed[0] == null ? null : parsed[0].content.replace(/^\n/, '')
    remoteBody = parsed[1] == null ? null : parsed[1].content.replace(/^\n/, '')
    baseBody = baseRaw == null ? null : matter(baseRaw).content.replace(/^\n/, '')
  } else if (kind === 'project') {
    title = 'Binder & project settings'
  } else {
    // A portrait or another file that is not text: its bytes mean nothing on
    // the resolution screen, and decoded they are a screenful of garbage.
    const NOT_TEXT = '(not text — an image or other file)'
    localBody = isBinary(localBlob) ? NOT_TEXT : localRaw
    remoteBody = isBinary(remoteBlob) ? NOT_TEXT : remoteRaw
    baseBody = isBinary(baseBlob) ? NOT_TEXT : baseRaw
  }

  return {
    path: filepath,
    kind,
    title,
    localBody,
    remoteBody,
    baseBody,
    localAt: await lastChangedAt(dir, localHead, filepath),
    remoteAt: await lastChangedAt(dir, remoteHead, filepath)
  }
}

/* ---------- the merge machinery ---------- */

/**
 * The corkboard's and the map's records — strings, relationships,
 * plotlines, pins, shapes, marks. Written like documents (frontmatter over
 * an often empty body), but the writer's own words and the geometry live in
 * the frontmatter: a relationship's label, a mark's name, a shape's points.
 * So they merge field by field only where the two devices changed different
 * fields; the same field changed both ways is the writer's to decide, never
 * "this device wins" (`mergeFrontmattered`'s `strict`).
 */
const RECORDS = /^(strings|stickers|relationships|plotlines|map|map-shapes|map-marks)\/[^/]+\.md$/

export function isRecord(filepath: string): boolean {
  return RECORDS.test(filepath)
}

/**
 * F-51: a scrap on the scratch pad. Prose, like a document: its text is
 * protected the same way (two devices editing one scrap's words is the
 * writer's to decide), and two devices each adding a scrap are two files,
 * which merge without asking — the reason the pad is not one file.
 */
const SCRAP = /^scratch\/[^/]+\.md$/

/**
 * Every one-file-per-record collection: documents and story-bible entries,
 * and the records above. One device moving a stamp while the other renames
 * it is two changes to two fields, not a conflict; the records used to be
 * left out, so it reached the writer as a "file" conflict of raw YAML.
 */
export function isFrontmattered(filepath: string): boolean {
  return (
    /^(documents|glossary|characters|world)\/[^/]+\.md$/.test(filepath) ||
    SCRAP.test(filepath) ||
    isRecord(filepath)
  )
}

/** Fields that are one value in two keys: a position. Merged as a pair, so
 *  two moves never combine into a point neither device chose. */
const PAIRS: [string, string][] = [
  ['x', 'y'],
  ['boardX', 'boardY']
]

/** isomorphic-git's line splitter, for merging exactly as it does. */
const LINEBREAKS = /^.*(\r?\n|$)/gm

/**
 * A three-way merge of one file's text, as isomorphic-git's default driver
 * does it (its `mergeFile`, which it does not export, over the same `diff3`,
 * pinned to the version it pins) — so a file merged cleanly here is merged
 * byte for byte as the detector merged it. Two differences, both refusals:
 * a file that is not text is never merged at all (two portraits interleaved
 * by lines "merge cleanly" into a corrupt image — I-17; the caller judges
 * that from the bytes, `isBinary`), and a conflicting
 * merge carries no markers, since nothing here ever writes one to disk.
 */
function mergeText(contents: string[], binary = false): { clean: boolean; text: string } {
  const [base, ours, theirs] = contents
  if (binary) return { clean: false, text: ours }
  const result = diff3Merge(
    ours.match(LINEBREAKS) ?? [],
    base.match(LINEBREAKS) ?? [],
    theirs.match(LINEBREAKS) ?? []
  )
  let text = ''
  for (const item of result) {
    if (item.conflict) return { clean: false, text: ours }
    if (item.ok) text += item.ok.join('')
  }
  return { clean: true, text }
}

/**
 * Three-way merge of a frontmattered file at the granularity the product
 * actually thinks in. Frontmatter merges structurally — `modified` takes the
 * newer stamp, `created` the older, a position moves as one x/y pair, and
 * any other field changed differently on both devices keeps this device's
 * value, or, for a `strict` record, makes the whole file the writer's call. Bodies merge only when at most one
 * device changed the prose; two devices editing the same document's text is
 * always the writer's decision, never diff3's — a merge tool interleaving
 * paragraphs of fiction because they were far enough apart is not a feature.
 * Returns the merged file, or null when the bodies genuinely both changed
 * (or, when strict, any field did).
 */
function mergeFrontmattered(
  baseRaw: string | null,
  oursRaw: string | null,
  theirsRaw: string | null,
  strict = false
): string | null {
  if (baseRaw == null || oursRaw == null || theirsRaw == null) return null
  const base = matter(baseRaw)
  const ours = matter(oursRaw)
  const theirs = matter(theirsRaw)

  const body =
    ours.content === theirs.content
      ? ours.content
      : theirs.content === base.content
        ? ours.content
        : ours.content === base.content
          ? theirs.content
          : null
  if (body == null) return null
  const data = mergeFields(base.data, ours.data, theirs.data, strict)
  if (data == null) return null

  const cleanBody = body.replace(/^\n/, '')
  return matter.stringify(cleanBody.endsWith('\n') ? cleanBody : cleanBody + '\n', data)
}

/**
 * Frontmatter merged field by field: `modified` takes the newer stamp,
 * `created` the older, a position moves as one pair, and any other field
 * changed differently on both devices keeps this device's value — or, when
 * `strict`, makes the file the writer's call (null).
 */
function mergeFields(
  bd: Record<string, unknown>,
  od: Record<string, unknown>,
  td: Record<string, unknown>,
  strict: boolean
): Record<string, unknown> | null {
  const keys = new Set([...Object.keys(od), ...Object.keys(td)])
  const data: Record<string, unknown> = {}
  const asJson = (v: unknown): string => JSON.stringify(v ?? null)
  /** Which side's value to keep, or null when both changed it differently
   *  and that is the writer's to decide. */
  const pick = (b: string, o: string, t: string): 'ours' | 'theirs' | null => {
    if (o !== b && t !== b && o !== t && strict) return null
    return o !== b ? 'ours' : t !== b ? 'theirs' : 'ours'
  }
  for (const pair of PAIRS) {
    if (!pair.some((k) => keys.has(k))) continue
    const side = pick(
      asJson(pair.map((k) => bd[k])),
      asJson(pair.map((k) => od[k])),
      asJson(pair.map((k) => td[k]))
    )
    if (side == null) return null
    for (const k of pair) {
      data[k] = (side === 'ours' ? od : td)[k]
      keys.delete(k)
    }
  }
  for (const key of keys) {
    const b = bd[key]
    const o = od[key]
    const t = td[key]
    if (key === 'modified' || key === 'created') {
      const stamps = [o, t]
        .filter((v) => v != null)
        .map((v) => ({ v, ms: new Date(String(v)).getTime() }))
        .filter((s) => Number.isFinite(s.ms))
      if (stamps.length === 0) {
        data[key] = o ?? t
      } else {
        stamps.sort((a, z) => (key === 'modified' ? z.ms - a.ms : a.ms - z.ms))
        data[key] = stamps[0].v
      }
      continue
    }
    // Per-field three-way. When both devices changed a field differently, a
    // document or entry keeps this device's (its prose, the part that
    // matters, is protected above); a record goes to the writer.
    const side = pick(asJson(b), asJson(o), asJson(t))
    if (side == null) return null
    data[key] = side === 'ours' ? o : t
  }
  // A cleared optional field (tags, pins, a Tidied board position) is an
  // absent key — writeEntity/writeDoc omit unset fields rather than write an
  // empty one — so when the clearing side wins, the rule above yields
  // `undefined`, which js-yaml refuses to dump. That turned a clean merge into
  // a failed sync for every both-modified file, and every save restamps
  // `modified`, so merely re-saving on the other device was enough to hit it.
  // Swept here, after every rule has run, rather than guarded per assignment:
  // one place holds the invariant for any rule that writes `data`, and
  // deleting (not writing null) keeps "cleared" meaning "absent" — the only
  // form the writers ever put on disk — so the cleared field stays cleared.
  for (const key of Object.keys(data)) if (data[key] === undefined) delete data[key]
  return data
}

/**
 * F-51: a conflicted prose file as the writer arranged it on the merge
 * screen — their body, with the details (title, tags, synopsis, positions)
 * merged field by field exactly as a clean sync merges them. Only the prose
 * was disputed, so only the prose is the writer's to arrange.
 */
function arrangedFile(
  baseRaw: string | null,
  oursRaw: string,
  theirsRaw: string,
  body: string
): string {
  const base = baseRaw == null ? {} : (matter(baseRaw).data as Record<string, unknown>)
  const data =
    mergeFields(
      base,
      matter(oursRaw).data as Record<string, unknown>,
      matter(theirsRaw).data as Record<string, unknown>,
      false
    ) ?? {}
  const clean = body.replace(/^\n/, '')
  return matter.stringify(clean.endsWith('\n') ? clean : clean + '\n', data)
}

interface MergeAnalysis {
  conflicts: string[]
  /** Timestamp-noise class: both devices touched the file but at most one
   *  changed the prose — merged here without bothering the writer. */
  autoResolved: Map<string, string>
  /** Dangling commit whose tree is the correct auto-merge for every path not
   *  otherwise decided. Null when delete-conflicts made the oracle impossible
   *  — the per-file fallback in completeMerge covers that case. */
  oracle: string | null
  /** project.json's maps list merged by map, when project.json is still a
   *  conflict: put back into whichever side the writer keeps for it. */
  projectMaps?: MapSheet[]
}

async function analyseMerge(
  dir: string,
  localHead: string,
  remoteHead: string
): Promise<MergeAnalysis> {
  const conflicts = new Set<string>()
  const autoResolved = new Map<string, string>()
  const bases = await git.findMergeBase({ fs, dir, oids: [localHead, remoteHead] })
  const base = (bases[0] as string | undefined) ?? null

  /** Whether any side of a path is not text, judged on its bytes. */
  const binaryAt = async (filepath: string): Promise<boolean> =>
    isBinary(base ? await blobAt(dir, base, filepath) : null) ||
    isBinary(await blobAt(dir, localHead, filepath)) ||
    isBinary(await blobAt(dir, remoteHead, filepath))

  // isomorphic-git hands its merge driver only a file's name, not its folder,
  // and the text already decoded — too late to judge the bytes. So every file
  // both sides changed that is not text is found first, and the driver knows
  // one by its name and the exact text of both sides.
  const toText = (b: Uint8Array): string => Buffer.from(b).toString('utf8')
  const binaryKey = (name: string, ours: string, theirs: string): string =>
    `${name}\u0000${ours}\u0000${theirs}`
  const binaryMerges = new Set<string>()
  const paths = new Set([
    ...(await git.listFiles({ fs, dir, ref: localHead })),
    ...(await git.listFiles({ fs, dir, ref: remoteHead }))
  ])
  for (const filepath of paths) {
    const local = await blobAt(dir, localHead, filepath)
    const remote = await blobAt(dir, remoteHead, filepath)
    if (local == null || remote == null || sameBytes(local, remote)) continue
    if (await binaryAt(filepath))
      binaryMerges.add(binaryKey(basename(filepath), toText(local), toText(remote)))
  }
  const isBinaryMerge = (name: string, contents: string[]): boolean =>
    binaryMerges.has(binaryKey(name, contents[1], contents[2]))

  try {
    // Plain attempt: succeeds only when nothing overlaps at all.
    const clean = await git.merge({
      fs,
      dir,
      ours: SYNC_BRANCH,
      theirs: REMOTE_REF,
      author,
      noUpdateBranch: true,
      // The default, except that a file which is not text is a conflict.
      mergeDriver: ({ contents, path }) => {
        const merged = mergeText(contents, isBinaryMerge(path, contents))
        return { cleanMerge: merged.clean, mergedText: merged.text }
      }
    })
    return { conflicts: [], autoResolved, oracle: clean.oid ?? null }
  } catch (e) {
    const data = (
      e as { data?: { bothModified?: string[]; deleteByUs?: string[]; deleteByTheirs?: string[] } }
    ).data
    if (!data) throw e
    for (const p of data.bothModified ?? []) conflicts.add(p)
    for (const p of data.deleteByUs ?? []) conflicts.add(p)
    for (const p of data.deleteByTheirs ?? []) conflicts.add(p)
    if (conflicts.size === 0) throw e
    let projectMaps: MapSheet[] | undefined

    for (const filepath of data.bothModified ?? []) {
      // project.json: its maps list merged by map first (`mergeMaps.ts`),
      // then the rest as text. Two devices each adding a map was a conflict
      // over the whole file; now only a real one in the rest of it is.
      if (filepath === 'project.json') {
        const sides = [
          base ? await textAt(dir, base, filepath) : null,
          await textAt(dir, localHead, filepath),
          await textAt(dir, remoteHead, filepath)
        ] as const
        const three = withMergedMaps(...sides)
        const merged = three ? mergeText(three) : null
        if (merged?.clean) {
          autoResolved.set(filepath, merged.text)
          conflicts.delete(filepath)
        } else {
          // A real conflict elsewhere in the file: the writer decides that,
          // but whichever side they keep gets both devices' maps.
          projectMaps = mergedMapsOf(...sides) ?? undefined
        }
        continue
      }
      // A record that is not text cannot be parsed and written back as text
      // without corrupting it: the writer chooses, and the choice is bytes.
      if (!isFrontmattered(filepath) || (await binaryAt(filepath))) continue
      const merged = mergeFrontmattered(
        base ? await textAt(dir, base, filepath) : null,
        await textAt(dir, localHead, filepath),
        await textAt(dir, remoteHead, filepath),
        isRecord(filepath)
      )
      if (merged != null) {
        autoResolved.set(filepath, merged)
        conflicts.delete(filepath)
      }
    }

    const hasDeleteConflicts =
      (data.deleteByUs?.length ?? 0) > 0 || (data.deleteByTheirs?.length ?? 0) > 0
    if (hasDeleteConflicts) {
      // The always-clean driver silences content conflicts but not
      // delete-vs-edit ones, so no oracle exists here. Rare (only entity
      // deletion can produce it) and the fallback is honest: a few extra
      // files may be presented as conflicts instead of auto-merged.
      return { conflicts: [...conflicts], autoResolved, oracle: null, projectMaps }
    }

    const oracle = await git.merge({
      fs,
      dir,
      ours: SYNC_BRANCH,
      theirs: REMOTE_REF,
      author,
      noUpdateBranch: true,
      // Every both-changed file that diff3 merges cleanly keeps that merge.
      // Only the paths this run silences — the conflicts, which the writer's
      // choices or autoResolved entries overwrite — take "ours" as a
      // well-formed placeholder. It used to give "ours" to every
      // both-changed file, so one real conflict anywhere quietly threw away
      // the other device's half of every clean merge alongside it (I-13).
      mergeDriver: ({ contents, path }) => ({
        cleanMerge: true,
        mergedText: mergeText(contents, isBinaryMerge(path, contents)).text
      })
    })
    return { conflicts: [...conflicts], autoResolved, oracle: oracle.oid ?? null, projectMaps }
  }
}

/**
 * Write the target state of every file into the working directory, then
 * remove tracked files that should no longer exist. `target` maps repo paths
 * to file content — text the engine composed, or the exact bytes of one
 * side's blob; absence means deletion.
 */
async function materialize(
  dir: string,
  localHead: string,
  target: Map<string, string | Uint8Array>
): Promise<void> {
  for (const [filepath, content] of target) {
    const absolute = join(dir, filepath)
    await fsp.mkdir(dirname(absolute), { recursive: true })
    // Bytes land as they are; a string is encoded once, as UTF-8. Nothing
    // on this path is ever decoded.
    await fsp.writeFile(absolute, content)
  }
  for (const filepath of await git.listFiles({ fs, dir, ref: localHead })) {
    if (!target.has(filepath)) await fsp.rm(join(dir, filepath), { force: true })
  }
}

/**
 * A document file that survived the merge but fell out of the binder (a
 * binder conflict resolved against the side that added it) would be invisible
 * forever — the one way this app could genuinely lose prose while keeping the
 * bytes. Re-attach any such document to the binder root.
 */
async function reconcileBinder(dir: string): Promise<void> {
  const projectFile = join(dir, 'project.json')
  const raw = await fsp.readFile(projectFile, 'utf8').catch(() => null)
  if (raw == null) return
  const data = JSON.parse(raw) as ProjectData

  const known = new Set<string>()
  const walk = (nodes: { id: string; children?: { id: string }[] }[]): void => {
    for (const node of nodes) {
      known.add(node.id)
      if ('children' in node && node.children) walk(node.children as never)
    }
  }
  walk(data.binder)
  walk(data.trash)

  let changed = false
  const docFiles = await fsp.readdir(join(dir, 'documents')).catch(() => [] as string[])
  for (const file of docFiles) {
    if (!file.endsWith('.md')) continue
    const id = file.slice(0, -3)
    if (known.has(id)) continue
    const doc = matter(await fsp.readFile(join(dir, 'documents', file), 'utf8'))
    const title = (doc.data as { title?: string }).title ?? 'Recovered document'
    data.binder.push({ id, type: 'doc', title: `${title} (recovered)` })
    changed = true
  }
  if (changed) await fsp.writeFile(projectFile, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

interface CompletedMerge {
  oid: string
  pushed: boolean
}

/**
 * Build the merged state (oracle + choices), materialize it, commit it with
 * both parents, then push. Used by both the clean auto-merge and the
 * resolution path — one code path, so it is tested once and lied about never.
 */
async function completeMerge(
  dir: string,
  transport: SyncTransport,
  localHead: string,
  remoteHead: string,
  analysis: MergeAnalysis,
  choices: Map<string, ConflictChoice>,
  /** New files to write with the merge (scraps kept from the merge screen). */
  added: Map<string, string> = new Map()
): Promise<CompletedMerge> {
  const mergeBases = await git.findMergeBase({ fs, dir, oids: [localHead, remoteHead] })
  const base = (mergeBases[0] as string | undefined) ?? null

  const paths = new Set<string>([
    ...(await git.listFiles({ fs, dir, ref: localHead })),
    ...(await git.listFiles({ fs, dir, ref: remoteHead }))
  ])

  const target = new Map<string, string | Uint8Array>()
  const variantsAt: string[] = []

  for (const filepath of paths) {
    const choice = choices.get(filepath)
    if (choice) {
      const local = await blobAt(dir, localHead, filepath)
      const remote = await blobAt(dir, remoteHead, filepath)
      if (choice.resolution === 'arranged') {
        // Checked by the caller: prose, text, on both sides.
        target.set(
          filepath,
          arrangedFile(
            base ? await textAt(dir, base, filepath) : null,
            Buffer.from(local!).toString('utf8'),
            Buffer.from(remote!).toString('utf8'),
            choice.body
          )
        )
      } else if (choice.resolution === 'mine') {
        if (local != null) target.set(filepath, local)
      } else if (choice.resolution === 'theirs') {
        if (remote != null) target.set(filepath, remote)
      } else {
        // Keep both: this device's text stays current; the other device's
        // version is shelved as a variant. The remote commit already contains
        // exactly that version, so the variant branch points straight at it —
        // no synthetic commit needed.
        if (local != null) target.set(filepath, local)
        if (remote != null && filepath.startsWith('documents/')) variantsAt.push(filepath)
      }
      continue
    }

    const auto = analysis.autoResolved.get(filepath)
    if (auto != null) {
      target.set(filepath, auto)
      continue
    }

    if (analysis.oracle) {
      const merged = await blobAt(dir, analysis.oracle, filepath)
      if (merged != null) target.set(filepath, merged)
      continue
    }

    // No oracle (delete-conflict case): per-file three-way. A file both
    // devices changed was not listed as a conflict, so diff3 merges it
    // cleanly; it used to be reduced to this device's copy (I-13 again).
    const local = await blobAt(dir, localHead, filepath)
    const remote = await blobAt(dir, remoteHead, filepath)
    const baseBlob = base ? await blobAt(dir, base, filepath) : null
    if (sameBytes(local, remote) || sameBytes(remote, baseBlob)) {
      if (local != null) target.set(filepath, local)
    } else if (sameBytes(local, baseBlob)) {
      if (remote != null) target.set(filepath, remote)
    } else if (local != null && remote != null) {
      // Decoded as isomorphic-git decodes (a TextDecoder drops a leading
      // BOM), so this is the merge the detector judged clean.
      const decode = (b: Uint8Array | null): string => (b ? Buffer.from(b).toString('utf8') : '')
      const merged = mergeText(
        [decode(baseBlob), decode(local), decode(remote)],
        isBinary(baseBlob) || isBinary(local) || isBinary(remote)
      )
      // The detector merged this cleanly, or it would be a conflict. If it
      // does not merge cleanly now, stop before anything is written rather
      // than quietly keep one side.
      if (!merged.clean)
        throw new Error(`Could not combine ${filepath} safely; nothing was changed.`)
      target.set(filepath, merged.text)
    }
  }

  // project.json kept from one side in a conflict: with both devices' maps.
  const kept = target.get('project.json')
  if (analysis.projectMaps && choices.has('project.json') && kept != null) {
    const text = typeof kept === 'string' ? kept : Buffer.from(kept).toString('utf8')
    try {
      target.set('project.json', withMaps(text, analysis.projectMaps))
    } catch {
      // Not JSON: left exactly as chosen.
    }
  }
  for (const [filepath, text] of added) target.set(filepath, text)
  await materialize(dir, localHead, target)
  await reconcileBinder(dir)
  const oid = await commitMerge(dir, 'Sync: combined work from two devices', [
    localHead,
    remoteHead
  ])

  for (const filepath of variantsAt) {
    const docId = filepath.slice('documents/'.length, -'.md'.length)
    const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')
    await git.writeRef({
      fs,
      dir,
      ref: `refs/heads/variant/${docId}/from-sync-${stamp}`,
      value: remoteHead,
      force: true
    })
  }

  let pushed = true
  try {
    await transport.push(dir, await localBranches(dir))
  } catch {
    // The merge itself is safe and local; the send retries on the next sync.
    pushed = false
  }
  return { oid, pushed }
}

/* ---------- entry points ---------- */

export async function syncProject(dir: string, transport: SyncTransport): Promise<SyncOutcome> {
  // Nothing is ever lost: whatever is on screen is committed before any
  // network or merge activity can happen.
  await commitAll(dir, 'Auto: before sync')

  let remoteHead: string | null
  try {
    remoteHead = await transport.fetchMainHead(dir)
  } catch (e) {
    return isNetworkError(e)
      ? { status: 'offline', detail: detail(e) }
      : { status: 'error', detail: detail(e) }
  }

  const localHead = await resolveOrNull(dir, 'HEAD')
  if (!localHead) return { status: 'error', detail: 'This project has no history yet.' }

  const finishPush = async (): Promise<SyncOutcome> => {
    try {
      await transport.push(dir, await localBranches(dir))
      return { status: 'pushed', at: Date.now() }
    } catch (e) {
      if (e instanceof PushRejectedError) {
        // The remote moved between our fetch and our push — someone else's
        // send won. Re-running from the top sees the new head and merges.
        return syncProject(dir, transport)
      }
      return isNetworkError(e)
        ? { status: 'offline', detail: detail(e) }
        : { status: 'error', detail: detail(e) }
    }
  }

  if (remoteHead == null) return finishPush()
  if (remoteHead === localHead) {
    // Main is level; still offer variants (best effort, retried next sync).
    try {
      await transport.push(dir, await localBranches(dir))
    } catch {
      /* quiet */
    }
    return { status: 'up-to-date', at: Date.now() }
  }

  const bases = await git.findMergeBase({ fs, dir, oids: [localHead, remoteHead] })
  const base = (bases[0] as string | undefined) ?? null
  if (base == null) {
    return {
      status: 'error',
      detail:
        'That GitHub copy holds a different history than this project. Connect this project to an empty space, or restore from the copy instead.'
    }
  }

  if (base === remoteHead) return finishPush()

  if (base === localHead) {
    // Remote is strictly ahead: bring it in. Ref first, then materialize —
    // interrupted in between, the next autosave commits the old tree as a NEW
    // commit on top (history keeps both, nothing lost), never as an overwrite.
    await git.writeRef({
      fs,
      dir,
      ref: `refs/heads/${SYNC_BRANCH}`,
      value: remoteHead,
      force: true
    })
    await git.checkout({ fs, dir, ref: SYNC_BRANCH, force: true })
    let pushed = true
    try {
      await transport.push(dir, await localBranches(dir))
    } catch {
      pushed = false
    }
    return { status: 'pulled', at: Date.now(), pushed }
  }

  // Truly diverged.
  const analysis = await analyseMerge(dir, localHead, remoteHead)
  if (analysis.conflicts.length === 0 && analysis.oracle) {
    const { pushed } = await completeMerge(
      dir,
      transport,
      localHead,
      remoteHead,
      analysis,
      new Map()
    )
    return { status: 'merged', at: Date.now(), pushed }
  }

  // Nothing has moved: refs are untouched, the working tree is untouched.
  return {
    status: 'conflicts',
    conflicts: await describeAll(dir, analysis.conflicts, localHead, remoteHead),
    heads: { local: localHead, remote: remoteHead }
  }
}

async function describeAll(
  dir: string,
  paths: string[],
  localHead: string,
  remoteHead: string
): Promise<SyncConflict[]> {
  const bases = await git.findMergeBase({ fs, dir, oids: [localHead, remoteHead] })
  const base = (bases[0] as string | undefined) ?? null
  const conflicts: SyncConflict[] = []
  for (const filepath of paths) {
    conflicts.push(await describeConflict(dir, filepath, localHead, remoteHead, base))
  }
  return conflicts
}

const RESOLUTIONS = new Set(['mine', 'theirs', 'both', 'arranged'])
const isText = (v: unknown): v is string => typeof v === 'string'

/**
 * An answer as it arrives over IPC, checked field by field: anything that is
 * not a well-formed answer is refused before it can reach the merge.
 */
export function readAnswer(raw: unknown): ConflictAnswer {
  const a = raw as Partial<ConflictAnswer> | null
  const bad = (): never => {
    throw new Error('Not an answer to these conflicts.')
  }
  if (!a || !Array.isArray(a.choices) || !a.pinned) bad()
  if (!isText(a!.pinned!.local) || !isText(a!.pinned!.remote)) bad()
  const choices = a!.choices!.map((c): ConflictChoice => {
    if (!c || !isText(c.path) || !RESOLUTIONS.has(c.resolution)) bad()
    if (c.resolution === 'arranged') {
      if (!isText((c as { body?: unknown }).body)) bad()
      return { path: c.path, resolution: 'arranged', body: (c as { body: string }).body }
    }
    return { path: c.path, resolution: c.resolution }
  })
  if (a!.scraps != null && !Array.isArray(a!.scraps)) bad()
  return {
    choices,
    pinned: { local: a!.pinned!.local, remote: a!.pinned!.remote },
    ...(a!.scraps ? { scraps: a!.scraps } : {})
  }
}

/** Whether the conflict a choice answers is still the one the writer saw:
 *  the other side unmoved, and this side's copy of every chosen file as it
 *  was. Work saved meanwhile in other files does not matter. */
async function stillPinned(
  dir: string,
  pinned: SyncHeads,
  localHead: string,
  remoteHead: string,
  paths: string[]
): Promise<boolean> {
  if (remoteHead !== pinned.remote) return false
  if (localHead === pinned.local) return true
  for (const filepath of paths) {
    const now = await blobAt(dir, localHead, filepath)
    const then = await blobAt(dir, pinned.local, filepath)
    if (!sameBytes(now, then)) return false
  }
  return true
}

/**
 * Apply the writer's answer. It is only ever applied against the versions
 * it was made from (`pinned`): if the other side has moved, or this side's
 * copy of a file the writer chose for has changed since (typing after
 * leaving the screen with Later), the arrangement no longer matches the
 * text, and the answer is refused with a fresh list (`moved`) rather than
 * applied. So is an answer that leaves a conflict unchosen.
 */
export async function resolveSyncConflicts(
  dir: string,
  answer: ConflictAnswer,
  transport: SyncTransport
): Promise<SyncOutcome> {
  await commitAll(dir, 'Auto: before sync')
  const localHead = await resolveOrNull(dir, 'HEAD')
  const remoteHead = await resolveOrNull(dir, REMOTE_REF)
  if (!localHead || !remoteHead) {
    return { status: 'error', detail: 'There is no sync in progress to resolve.' }
  }

  const chosen = new Map(answer.choices.map((c) => [c.path, c]))
  const analysis = await analyseMerge(dir, localHead, remoteHead)
  const pinned = await stillPinned(dir, answer.pinned, localHead, remoteHead, [...chosen.keys()])
  if (!pinned || analysis.conflicts.some((p) => !chosen.has(p))) {
    if (analysis.conflicts.length === 0) {
      return {
        status: 'error',
        detail:
          'Both versions changed while you were combining them, and nothing is waiting any more. Sync again to bring the work together.'
      }
    }
    return {
      status: 'conflicts',
      conflicts: await describeAll(dir, analysis.conflicts, localHead, remoteHead),
      heads: { local: localHead, remote: remoteHead },
      moved: true
    }
  }

  // An arrangement is prose: a document, entry or scrap that both sides
  // still have, as text. Anything else is a keep-this-or-that choice.
  for (const choice of chosen.values()) {
    if (choice.resolution !== 'arranged') continue
    const local = await blobAt(dir, localHead, choice.path)
    const remote = await blobAt(dir, remoteHead, choice.path)
    if (
      typeof choice.body !== 'string' ||
      !isFrontmattered(choice.path) ||
      isRecord(choice.path) ||
      local == null ||
      remote == null ||
      isBinary(local) ||
      isBinary(remote)
    ) {
      return { status: 'error', detail: `“${choice.path}” cannot be put together by hand.` }
    }
  }

  // Scraps kept from the merge screen are new files, written with it. One
  // that would land on a file either side already has is refused: the pad
  // never writes over anything.
  const added = new Map<string, string>()
  for (const scrap of answer.scraps ?? []) {
    if (!isPlainId(scrap?.id)) return { status: 'error', detail: 'Not a scrap.' }
    const filepath = scrapRepoPath(scrap.id)
    if (
      added.has(filepath) ||
      (await blobAt(dir, localHead, filepath)) != null ||
      (await blobAt(dir, remoteHead, filepath)) != null
    ) {
      return { status: 'error', detail: 'A scrap with that name is already on the pad.' }
    }
    try {
      added.set(filepath, scrapFileText(scrap))
    } catch {
      return { status: 'error', detail: 'Not a scrap.' }
    }
  }

  const { pushed } = await completeMerge(
    dir,
    transport,
    localHead,
    remoteHead,
    analysis,
    chosen,
    added
  )
  return { status: 'merged', at: Date.now(), pushed }
}

/* ---------- production transport ---------- */

type HttpClient = Parameters<typeof git.fetch>[0]['http']

/** Bind isomorphic-git's HTTP client and the signed-in token. */
export function realTransport(
  http: HttpClient,
  getToken: () => Promise<string | null>
): SyncTransport {
  const onAuth = async (): Promise<{ username: string; password: string } | { cancel: true }> => {
    const token = await getToken()
    if (!token) return { cancel: true }
    return { username: 'x-access-token', password: token }
  }

  return {
    async fetchMainHead(dir: string): Promise<string | null> {
      const url = await getRemoteUrl(dir)
      if (!url) throw new Error('This project is not connected to GitHub.')
      const info = await git.getRemoteInfo({ http, onAuth, url })
      if (!info.refs || Object.keys(info.refs.heads ?? {}).length === 0) return null
      if (!(info.refs.heads ?? {})[SYNC_BRANCH]) {
        throw new Error(
          `That GitHub copy has no “${SYNC_BRANCH}” line to sync with — it may belong to a different tool.`
        )
      }
      await git.fetch({
        fs,
        http,
        onAuth,
        dir,
        remote: REMOTE,
        ref: SYNC_BRANCH,
        singleBranch: true,
        tags: false
      })
      return resolveOrNull(dir, REMOTE_REF)
    },

    async push(dir: string, refs: string[]): Promise<void> {
      for (const ref of refs) {
        try {
          await git.push({ fs, http, onAuth, dir, remote: REMOTE, ref, remoteRef: ref })
        } catch (e) {
          if (e instanceof git.Errors.PushRejectedError) throw new PushRejectedError(detail(e))
          throw e
        }
      }
    }
  }
}
