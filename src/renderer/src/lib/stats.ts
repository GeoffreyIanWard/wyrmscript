import type { DayStat, StatsSettings, WordCountMode } from '../../../shared/types'

/**
 * Turning the raw per-day history from `main/wyrm/stats.ts` into the few
 * numbers the writer actually sees. Pure functions over a day list, so the
 * rules that decide "did I write today" and "is my streak alive" are testable
 * without a git repository behind them.
 */

/** Local calendar date (YYYY-MM-DD) — must match the engine's day boundary. */
export function localDate(at: Date = new Date()): string {
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return `${at.getFullYear()}-${month}-${day}`
}

/** The day before a YYYY-MM-DD date, via local-time arithmetic so month ends
 *  and daylight-saving shifts land on the right calendar day. */
export function previousDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const at = new Date(y, m - 1, d)
  at.setDate(at.getDate() - 1)
  return localDate(at)
}

/** A day's headline number under the writer's chosen counting mode. */
export function wordsFor(day: DayStat, mode: WordCountMode): number {
  if (mode === 'added') return day.added
  if (mode === 'net-positive') return Math.max(0, day.net)
  return day.net
}

/**
 * Whether a day counts as work for the streak. Geoffrey's rule: showing up is
 * what counts, not hitting a target — so a day spent cutting three thousand
 * words of flab keeps the streak, because that is real work and a streak that
 * punishes revision would quietly discourage it.
 */
export function didWork(day: DayStat): boolean {
  return day.added > 0 || day.net !== 0
}

/**
 * Consecutive days of work ending today, or ending yesterday when nothing has
 * been written yet today — an unfinished day is not a broken streak, and
 * telling a writer their streak is gone at 9am would be both wrong and mean.
 */
export function streak(days: DayStat[], today: string = localDate()): number {
  const active = new Set(days.filter(didWork).map((d) => d.date))
  let cursor = active.has(today) ? today : previousDate(today)
  let run = 0
  while (active.has(cursor)) {
    run += 1
    cursor = previousDate(cursor)
  }
  return run
}

export interface StatsSummary {
  /** Words today under the chosen mode. Negative is possible in `net` mode. */
  today: number
  /** Consecutive days of work — see `streak`. */
  streak: number
  /** Total manuscript words at the most recent checkpoint. */
  total: number
  /** 0–1, clamped; 0 when the goal is unset. Negative days read as 0. */
  goalProgress: number
  goalMet: boolean
  /** Most recent days first — for the history list. */
  recent: DayStat[]
}

export function summarize(
  days: DayStat[],
  settings: StatsSettings,
  today: string = localDate()
): StatsSummary {
  const todayStat = days.find((d) => d.date === today)
  const todayWords = todayStat ? wordsFor(todayStat, settings.mode) : 0
  const total = days.length > 0 ? days[days.length - 1].total : 0
  const goal = settings.dailyGoal
  return {
    today: todayWords,
    streak: streak(days, today),
    total,
    goalProgress: goal > 0 ? Math.min(1, Math.max(0, todayWords / goal)) : 0,
    goalMet: goal > 0 && todayWords >= goal,
    recent: [...days].reverse()
  }
}
