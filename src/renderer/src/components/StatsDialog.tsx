import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useWyrm } from '../store'
import { useFocusTrap } from '../lib/useFocusTrap'
import { localDate, summarize, wordsFor } from '../lib/stats'
import type { DayStat, WordCountMode } from '../../../shared/types'

/**
 * The "high score screen" the brief asks for, kept on the right side of
 * gamified: it reports what happened and never nags. A day spent cutting is
 * shown as the loss it was rather than hidden, and the streak counts showing
 * up rather than hitting a target, so revision days do not read as failure.
 */

function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today'
  const [y, m, d] = date.split('-').map(Number)
  const at = new Date(y, m - 1, d)
  return at.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function signed(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toLocaleString()}`
}

/** A day's bar, scaled against the busiest day on screen so the shape of a
 *  fortnight is readable without axes. */
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

export function StatsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const trapRef = useFocusTrap<HTMLDivElement>(onClose)
  const dailyStats = useWyrm((s) => s.dailyStats)
  const statsSettings = useWyrm((s) => s.statsSettings)
  const refreshStats = useWyrm((s) => s.refreshStats)
  const project = useWyrm((s) => s.project)
  const [loading, setLoading] = useState(true)

  // Opening the screen checkpoints first (see the IPC handler), so what's on
  // screen includes the words written in the last few minutes rather than
  // telling a writer who just wrote 300 words that they wrote none.
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
  // The real calendar day, not the newest day with activity — those differ
  // whenever nothing has been written yet today, and mislabelling yesterday
  // as "Today" would be worse than showing the date.
  const today = localDate()
  const summary = statsSettings ? summarize(dailyStats, statsSettings) : null
  const recent = summary ? summary.recent.slice(0, 14) : []
  const peak = Math.max(1, ...recent.map((d) => Math.abs(wordsFor(d, mode))))

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="dialog" ref={trapRef} onMouseDown={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
          <span className="title">Writing Stats</span>
        </div>
        <div className="dialog-body">
          {loading && dailyStats.length === 0 ? (
            <div className="dialog-hint">Reading your history…</div>
          ) : !summary || dailyStats.length === 0 ? (
            <div className="dialog-hint">
              No checkpoints yet — write something and your history starts here.
            </div>
          ) : (
            <>
              <div className="stat-tiles">
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
                  <div className="stat-tile-value">{summary.total.toLocaleString()}</div>
                  <div className="stat-tile-label">MANUSCRIPT</div>
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
                <legend>THE LAST FORTNIGHT</legend>
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
        <div className="dialog-buttons">
          <button type="button" className="btn default" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
