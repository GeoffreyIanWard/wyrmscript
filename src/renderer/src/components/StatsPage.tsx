import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { useWyrm } from '../store'
import { didWork, localDate, previousDate, summarize, wordsFor } from '../lib/stats'
import type { DayStat, WordCountMode } from '../../../shared/types'

/**
 * F-26: the fuller version of the Writing Stats dialog (4c) — a real page in
 * the main pane rather than a dialog, so a year of history and a calendar
 * heatmap have room to breathe. Opened via ⇧⌘S or Project → Writing Stats…;
 * treated as a detour like a story-bible entry (F-14), not an arrival like
 * the folder view, so Esc returns to exactly what was on screen.
 */

const HEATMAP_WEEKS = 53

function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today'
  const [y, m, d] = date.split('-').map(Number)
  const at = new Date(y, m - 1, d)
  return at.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function signed(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toLocaleString()}`
}

function monthLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short' })
}

/** A day's bar, scaled against the busiest day on screen. */
function DayRow({
  day,
  mode,
  peak,
  today
}: {
  day: DayStat
  mode: WordCountMode
  peak: number
  today: string
}): JSX.Element {
  const words = wordsFor(day, mode)
  const width = peak > 0 ? Math.round((Math.abs(words) / peak) * 100) : 0
  return (
    <div className="stat-row">
      <span className="stat-day">{dayLabel(day.date, today)}</span>
      <span className="stat-bar-track">
        <span
          className={words < 0 ? 'stat-bar negative' : 'stat-bar'}
          style={{ width: `${width}%` }}
        />
      </span>
      <span className="stat-words">{signed(words)}</span>
    </div>
  )
}

/** One calendar cell's dither bucket: 0 (nothing) through 4 (busiest quarter),
 *  the "three dither steps plus solid" the roadmap called for. `null` marks a
 *  day the heatmap has no data for at all — before the project existed, or
 *  still in the future — kept visually distinct from "wrote nothing". */
function bucketLevel(magnitude: number, peak: number): 0 | 1 | 2 | 3 | 4 {
  if (peak <= 0 || magnitude <= 0) return 0
  const ratio = magnitude / peak
  if (ratio > 0.75) return 4
  if (ratio > 0.5) return 3
  if (ratio > 0.25) return 2
  return 1
}

interface HeatmapCell {
  date: string
  inRange: boolean
  level: 0 | 1 | 2 | 3 | 4 | null
  goalMet: boolean
  words: number
}

function buildHeatmap(
  byDate: Map<string, DayStat>,
  mode: WordCountMode,
  goal: number,
  today: string,
  earliest: string | null
): { columns: HeatmapCell[][]; monthMarks: Map<number, string> } {
  const [ty, tm, td] = today.split('-').map(Number)
  const todayAt = new Date(ty, tm - 1, td)
  const endDow = todayAt.getDay() // 0=Sun..6=Sat
  // The grid's last column is the week containing today, so the trailing
  // cells after today (later in that week) render as out-of-range rather
  // than pretending the future already happened.
  const gridEnd = new Date(todayAt)
  gridEnd.setDate(gridEnd.getDate() + (6 - endDow))
  const totalDays = HEATMAP_WEEKS * 7
  const gridStart = new Date(gridEnd)
  gridStart.setDate(gridStart.getDate() - (totalDays - 1))

  const peak = Math.max(1, ...[...byDate.values()].map((d) => Math.abs(wordsFor(d, mode))))

  const columns: HeatmapCell[][] = []
  const monthMarks = new Map<number, string>()
  let lastMonth = -1
  const cursor = new Date(gridStart)
  for (let week = 0; week < HEATMAP_WEEKS; week++) {
    const column: HeatmapCell[] = []
    for (let dow = 0; dow < 7; dow++) {
      const date = localDate(cursor)
      const afterToday = date > today
      const beforeEarliest = earliest !== null && date < earliest
      const inRange = !afterToday && !beforeEarliest
      const stat = byDate.get(date)
      const words = stat ? wordsFor(stat, mode) : 0
      const worked = stat !== undefined && didWork(stat)
      column.push({
        date,
        inRange,
        level: !inRange ? null : worked ? bucketLevel(Math.abs(words), peak) : 0,
        goalMet: inRange && goal > 0 && worked && words >= goal,
        words
      })
      if (dow === 0) {
        const m = cursor.getMonth()
        if (m !== lastMonth) {
          monthMarks.set(week, monthLabel(date))
          lastMonth = m
        }
      }
      cursor.setDate(cursor.getDate() + 1)
    }
    columns[week] = column
  }
  return { columns, monthMarks }
}

const DOW_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', '']

export function StatsPage(): JSX.Element {
  const dailyStats = useWyrm((s) => s.dailyStats)
  const statsSettings = useWyrm((s) => s.statsSettings)
  const refreshStats = useWyrm((s) => s.refreshStats)
  const project = useWyrm((s) => s.project)
  const showDoc = useWyrm((s) => s.showDoc)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    void refreshStats().finally(() => {
      if (live) setLoading(false)
    })
    return () => {
      live = false
    }
  }, [refreshStats])

  const mode = statsSettings?.mode ?? 'net'
  const today = localDate()
  const summary = statsSettings ? summarize(dailyStats, statsSettings) : null

  const byDate = useMemo(() => {
    const map = new Map<string, DayStat>()
    for (const day of dailyStats) map.set(day.date, day)
    return map
  }, [dailyStats])

  const thisWeekTotal = useMemo(() => {
    let cursor = today
    let sum = 0
    for (let i = 0; i < 7; i++) {
      const day = byDate.get(cursor)
      if (day) sum += wordsFor(day, mode)
      cursor = previousDate(cursor)
    }
    return sum
  }, [byDate, mode, today])

  const thisMonthTotal = useMemo(() => {
    const monthPrefix = today.slice(0, 7)
    let sum = 0
    for (const day of dailyStats) {
      if (day.date.slice(0, 7) === monthPrefix) sum += wordsFor(day, mode)
    }
    return sum
  }, [dailyStats, mode, today])

  const bestDay = useMemo(() => {
    let best: DayStat | null = null
    for (const day of dailyStats) {
      if (!best || Math.abs(wordsFor(day, mode)) > Math.abs(wordsFor(best, mode))) best = day
    }
    return best
  }, [dailyStats, mode])

  const heatmap = useMemo(
    () =>
      buildHeatmap(byDate, mode, statsSettings?.dailyGoal ?? 0, today, dailyStats[0]?.date ?? null),
    [byDate, mode, statsSettings, today, dailyStats]
  )

  const recent = summary ? summary.recent.slice(0, 30) : []
  const peak = Math.max(1, ...recent.map((d) => Math.abs(wordsFor(d, mode))))

  return (
    <div className="terminal stats-page">
      <div className="entity-main-bar">
        <button type="button" className="btn small" onClick={showDoc}>
          ‹ Back to Manuscript
        </button>
        <span className="entity-kind">STATS</span>
        <span className="row-title">Writing Stats</span>
        <span className="spacer" />
      </div>
      <div className="entity-main-body stats-page-body">
        {loading && dailyStats.length === 0 ? (
          <div className="dialog-hint">Reading your history…</div>
        ) : !summary || dailyStats.length === 0 ? (
          <div className="dialog-hint">
            No checkpoints yet — write something and your history starts here.
          </div>
        ) : (
          <>
            <div className="stat-tiles stat-tiles-wide">
              <div className="stat-tile">
                <div className="stat-tile-value">{signed(summary.today)}</div>
                <div className="stat-tile-label">TODAY</div>
              </div>
              <div className="stat-tile">
                <div className="stat-tile-value">
                  {summary.streak}
                  {summary.streak === 1 ? ' DAY' : ' DAYS'}
                </div>
                <div className="stat-tile-label">STREAK</div>
              </div>
              <div className="stat-tile">
                <div className="stat-tile-value">{signed(thisWeekTotal)}</div>
                <div className="stat-tile-label">THIS WEEK</div>
              </div>
              <div className="stat-tile">
                <div className="stat-tile-value">{signed(thisMonthTotal)}</div>
                <div className="stat-tile-label">THIS MONTH</div>
              </div>
              <div className="stat-tile">
                <div className="stat-tile-value">{summary.total.toLocaleString()}</div>
                <div className="stat-tile-label">MANUSCRIPT</div>
              </div>
              <div className="stat-tile">
                <div className="stat-tile-value">
                  {bestDay ? signed(wordsFor(bestDay, mode)) : '—'}
                </div>
                <div className="stat-tile-label">
                  {bestDay ? `BEST · ${dayLabel(bestDay.date, today)}` : 'BEST DAY'}
                </div>
              </div>
            </div>

            {statsSettings && statsSettings.dailyGoal > 0 && (
              <fieldset className="fieldset">
                <legend>TODAY&rsquo;S GOAL</legend>
                <div className="stat-goal-track">
                  <div
                    className="stat-goal-fill"
                    style={{ width: `${Math.round(summary.goalProgress * 100)}%` }}
                  />
                </div>
                <div className="dialog-hint" style={{ marginTop: 6 }}>
                  {summary.goalMet
                    ? `Goal met — ${signed(summary.today)} against ${statsSettings.dailyGoal.toLocaleString()}.`
                    : `${signed(summary.today)} of ${statsSettings.dailyGoal.toLocaleString()} words.`}
                </div>
              </fieldset>
            )}

            <fieldset className="fieldset">
              <legend>THE LAST YEAR</legend>
              <div className="heatmap-scroll">
                <div className="heatmap">
                  <div className="heatmap-dow-labels">
                    {DOW_LABELS.map((label, i) => (
                      <span key={i}>{label}</span>
                    ))}
                  </div>
                  <div className="heatmap-grid">
                    {heatmap.columns.map((column, week) => (
                      <div className="heatmap-column" key={week}>
                        <div className="heatmap-month-mark">
                          {heatmap.monthMarks.get(week) ?? ''}
                        </div>
                        {column.map((cell) => (
                          <div
                            key={cell.date}
                            className={
                              cell.level === null
                                ? 'heatmap-cell out-of-range'
                                : `heatmap-cell level-${cell.level}${cell.goalMet ? ' goal-met' : ''}`
                            }
                            title={
                              cell.level === null
                                ? undefined
                                : `${cell.date}: ${cell.level === 0 ? 'no words' : signed(cell.words)}${cell.goalMet ? ' — goal met' : ''}`
                            }
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="dialog-hint" style={{ marginTop: 8 }}>
                Shading is relative volume for {mode === 'added' ? 'words added' : 'net change'};
                the small mark is a day that met the goal.
              </div>
            </fieldset>

            <fieldset className="fieldset">
              <legend>THE LAST MONTH</legend>
              <div className="stat-list">
                {recent.map((day) => (
                  <DayRow key={day.date} day={day} mode={mode} peak={peak} today={today} />
                ))}
              </div>
              <div className="dialog-hint">
                Days away from the desk are not listed. Counted{' '}
                {mode === 'added'
                  ? 'as words added, ignoring cuts'
                  : mode === 'net-positive'
                    ? 'as net change, never below zero'
                    : 'as net change'}
                {' — change this in Preferences.'}
              </div>
            </fieldset>
          </>
        )}
        {project == null && <div className="dialog-hint">Open a project to see its history.</div>}
      </div>
    </div>
  )
}
