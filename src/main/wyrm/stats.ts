import fs from 'node:fs'
import git from 'isomorphic-git'
import matter from 'gray-matter'

import { countWords } from '../../shared/words'
import type { DayStat } from '../../shared/types'

const DOCS_DIR = 'documents'

/**
 * Writing statistics, derived from git history rather than tracked in a file.
 *
 * Every checkpoint is already a timestamped snapshot of the whole manuscript,
 * so "how many words existed on Tuesday" is a question the repository can
 * already answer. Deriving the numbers instead of recording them buys four
 * things that a stats file would not:
 *
 * 1. **No commit churn.** A tracked `stats.json` would dirty the working tree
 *    on every keystroke-driven update, turning a quiet writing session into a
 *    stream of commits about nothing but the counter.
 * 2. **No merge conflicts.** Two machines writing on the same day would each
 *    edit the same day's row; here they simply contribute commits, and git
 *    merges commits for a living.
 * 3. **It syncs for free**, because history syncs.
 * 4. **It works retroactively** — a project that has been written in for
 *    months reports its whole history the first time this feature runs,
 *    rather than starting from zero on the day the feature shipped.
 *
 * Cost is a walk over history, kept cheap by `wordsByBlob`: blob oids are
 * content hashes, so a document that did not change between two commits is
 * counted once and reused. A typical commit touches one or two files, so the
 * work is proportional to the number of distinct document versions, not to
 * commits × documents. The cache is module-level and never invalidated, which
 * is safe precisely because an oid's content can never change.
 *
 * **Known imprecision, deliberately accepted:** across a merge the linearized
 * commit order can dip and recover, which inflates `added` (the gross figure)
 * on days that contain a merge. `net` is computed from end-of-day totals and
 * is unaffected. Fixing this properly means walking the commit graph rather
 * than a sorted list; not worth it before anyone has felt the problem.
 */

/** Word count per blob oid. Content-addressed, so entries are valid forever. */
const wordsByBlob = new Map<string, number>()

/** Local calendar date (YYYY-MM-DD) — a session past midnight belongs to the
 *  day the writer thinks they wrote it, so this is deliberately not UTC. */
function localDate(ms: number): string {
  const d = new Date(ms)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

async function blobWords(dir: string, oid: string): Promise<number> {
  const cached = wordsByBlob.get(oid)
  if (cached !== undefined) return cached
  let words = 0
  try {
    const { blob } = await git.readBlob({ fs, dir, oid })
    // Frontmatter is metadata, not manuscript — count only the body.
    words = countWords(matter(new TextDecoder().decode(blob)).content)
  } catch {
    words = 0
  }
  wordsByBlob.set(oid, words)
  return words
}

/** Total manuscript words across every document at one commit. */
async function totalWordsAtCommit(dir: string, oid: string): Promise<number> {
  let entries: { path: string; oid: string; type: string }[]
  try {
    const { tree } = await git.readTree({ fs, dir, oid, filepath: DOCS_DIR })
    entries = tree
  } catch {
    return 0 // no documents/ at this commit (e.g. the very first one)
  }
  let total = 0
  for (const entry of entries) {
    if (entry.type !== 'blob' || !entry.path.endsWith('.md')) continue
    total += await blobWords(dir, entry.oid)
  }
  return total
}

/**
 * Per-day writing history, oldest first. Days with no commits are absent
 * rather than zero-filled — the caller decides whether a gap means "wrote
 * nothing" or "was not at the desk", and the streak rule needs that
 * distinction.
 */
export async function dailyStats(dir: string, depth = 2000): Promise<DayStat[]> {
  const log = await git.log({ fs, dir, depth }).catch(() => [])
  if (log.length === 0) return []

  // Chronological by commit time rather than log order: with merges present
  // the graph walk is not guaranteed to be time-ordered, and "when did I
  // write this" is a question about the clock.
  //
  // Ties matter more than they look. Git timestamps are whole seconds, so a
  // manual checkpoint landing in the same second as an autosave — or the
  // project-creation commit and the first save — compare equal, and a stable
  // sort would then leave them in git.log's newest-first order. Processing a
  // day's commits backwards makes the *oldest* commit define where the day
  // ended, reporting a day of writing as a total of zero. So ties fall back
  // to log order reversed: git.log walks parents, so a later index is an
  // older commit.
  const order = new Map<string, number>(log.map((entry, i) => [entry.oid, i] as [string, number]))
  const commits = [...log].sort(
    (a, b) =>
      a.commit.committer.timestamp - b.commit.committer.timestamp ||
      order.get(b.oid)! - order.get(a.oid)!
  )

  const byDate = new Map<string, { total: number; added: number; commits: number }>()
  let prevTotal: number | null = null

  for (const entry of commits) {
    const total = await totalWordsAtCommit(dir, entry.oid)
    const date = localDate(entry.commit.committer.timestamp * 1000)
    // The first commit in history is all gain: there was nothing before it.
    const delta = prevTotal === null ? total : total - prevTotal
    const day = byDate.get(date) ?? { total, added: 0, commits: 0 }
    day.total = total // the last commit of a day defines where that day ended
    day.added += Math.max(0, delta)
    day.commits += 1
    byDate.set(date, day)
    prevTotal = total
  }

  const days: DayStat[] = []
  let prevDayTotal = 0
  for (const date of [...byDate.keys()].sort()) {
    const day = byDate.get(date)!
    days.push({
      date,
      total: day.total,
      net: day.total - prevDayTotal,
      added: day.added,
      commits: day.commits
    })
    prevDayTotal = day.total
  }
  return days
}

/** Test seam: the blob cache is process-global, which unit tests must not share. */
export function clearStatsCache(): void {
  wordsByBlob.clear()
}
