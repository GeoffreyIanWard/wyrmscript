import { describe, expect, it } from 'vitest'
import type { DayStat, StatsSettings } from '../src/shared/types'
import { didWork, previousDate, streak, summarize, wordsFor } from '../src/renderer/src/lib/stats'

const day = (date: string, patch: Partial<DayStat> = {}): DayStat => ({
  date,
  total: 0,
  net: 0,
  added: 0,
  commits: 1,
  ...patch
})

const settings = (patch: Partial<StatsSettings> = {}): StatsSettings => ({
  dailyGoal: 500,
  mode: 'net',
  ...patch
})

describe('counting modes', () => {
  // The day the three modes exist for: 1,000 words written, 1,400 cut.
  const cuttingDay = day('2026-07-31', { net: -400, added: 1000 })

  it('reports the honest loss in net mode', () => {
    expect(wordsFor(cuttingDay, 'net')).toBe(-400)
  })

  it('reports only what was added in added mode', () => {
    expect(wordsFor(cuttingDay, 'added')).toBe(1000)
  })

  it('floors a cutting day at zero in net-positive mode', () => {
    expect(wordsFor(cuttingDay, 'net-positive')).toBe(0)
  })
})

describe('previousDate', () => {
  it('steps back across a month boundary', () => {
    expect(previousDate('2026-08-01')).toBe('2026-07-31')
  })

  it('steps back across a year boundary', () => {
    expect(previousDate('2026-01-01')).toBe('2025-12-31')
  })

  it('handles a leap day', () => {
    expect(previousDate('2024-03-01')).toBe('2024-02-29')
  })
})

describe('didWork', () => {
  it('counts a day spent only cutting', () => {
    expect(didWork(day('2026-07-31', { net: -900 }))).toBe(true)
  })

  it('does not count a checkpoint that moved no words', () => {
    // e.g. renaming a document — a commit, but not writing.
    expect(didWork(day('2026-07-31', { net: 0, added: 0 }))).toBe(false)
  })
})

describe('streak', () => {
  it('counts consecutive days of work ending today', () => {
    const days = [
      day('2026-07-29', { net: 100 }),
      day('2026-07-30', { net: 100 }),
      day('2026-07-31', { net: 100 })
    ]
    expect(streak(days, '2026-07-31')).toBe(3)
  })

  it('survives a day that has not been written in yet', () => {
    // Nothing today, but yesterday counts — the day is not over, so telling
    // the writer their streak is gone would be both wrong and discouraging.
    const days = [day('2026-07-30', { net: 100 }), day('2026-07-31', { net: 100 })]
    expect(streak(days, '2026-08-01')).toBe(2)
  })

  it('breaks after a full day with nothing written', () => {
    const days = [day('2026-07-30', { net: 100 }), day('2026-07-31', { net: 100 })]
    expect(streak(days, '2026-08-02')).toBe(0)
  })

  it('keeps a streak alive through a day spent entirely cutting', () => {
    const days = [
      day('2026-07-30', { net: 800 }),
      day('2026-07-31', { net: -3000, added: 0 }),
      day('2026-08-01', { net: 400 })
    ]
    expect(streak(days, '2026-08-01')).toBe(3)
  })

  it('ignores a gap further back in history', () => {
    const days = [
      day('2026-07-01', { net: 100 }),
      day('2026-07-31', { net: 100 }),
      day('2026-08-01', { net: 100 })
    ]
    expect(streak(days, '2026-08-01')).toBe(2)
  })

  it('is zero with no history at all', () => {
    expect(streak([], '2026-08-01')).toBe(0)
  })
})

describe('summarize', () => {
  const days = [
    day('2026-07-30', { net: 200, added: 200, total: 200 }),
    day('2026-07-31', { net: 300, added: 450, total: 500 })
  ]

  it('reports today under the chosen mode and tracks goal progress', () => {
    const s = summarize(days, settings({ dailyGoal: 600 }), '2026-07-31')
    expect(s.today).toBe(300)
    expect(s.goalMet).toBe(false)
    expect(s.goalProgress).toBeCloseTo(0.5)
    expect(s.total).toBe(500)
  })

  it('marks the goal met once reached', () => {
    const s = summarize(days, settings({ dailyGoal: 300 }), '2026-07-31')
    expect(s.goalMet).toBe(true)
    expect(s.goalProgress).toBe(1)
  })

  it('clamps progress rather than reporting a negative bar on a cutting day', () => {
    const cutting = [day('2026-07-31', { net: -800, added: 0, total: 100 })]
    const s = summarize(cutting, settings({ dailyGoal: 500 }), '2026-07-31')
    expect(s.today).toBe(-800) // the number stays honest
    expect(s.goalProgress).toBe(0) // the bar does not run backwards
  })

  it('reports zero for a day with no writing yet, without inventing a day', () => {
    const s = summarize(days, settings(), '2026-08-05')
    expect(s.today).toBe(0)
    expect(s.recent).toHaveLength(2)
  })

  it('lists history newest first', () => {
    const s = summarize(days, settings(), '2026-07-31')
    expect(s.recent.map((d) => d.date)).toEqual(['2026-07-31', '2026-07-30'])
  })
})
