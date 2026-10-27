import { describe, expect, it, vi } from 'vitest'
import { createQuitGate, QUIT_GRACE_MS } from '../src/main/wyrm/quitGate'

/**
 * Quitting waits for the window to put its work away, and never traps the
 * writer: no window means no wait, and a window that never answers gets
 * a grace period, not forever.
 */

type Timer = { fn: () => void; ms: number; cleared: boolean }

function gate(windowOpen = true): {
  g: ReturnType<typeof createQuitGate>
  deps: { ask: ReturnType<typeof vi.fn>; quit: ReturnType<typeof vi.fn> }
  live: () => Timer[]
} {
  const timers: Timer[] = []
  const deps = {
    ask: vi.fn(() => windowOpen),
    quit: vi.fn(),
    setTimer: vi.fn((fn: () => void, ms: number) => {
      const t = { fn, ms, cleared: false }
      timers.push(t)
      return t
    }),
    clearTimer: vi.fn((t: unknown) => {
      ;(t as { cleared: boolean }).cleared = true
    })
  }
  const live = (): typeof timers => timers.filter((t) => !t.cleared)
  return { g: createQuitGate(deps), deps, live }
}

describe('the quit gate', () => {
  it('holds a quit and asks the window to put its work away', () => {
    const { g, deps, live } = gate()
    const prevent = vi.fn()
    g.beforeQuit(prevent)
    expect(prevent).toHaveBeenCalled()
    expect(deps.ask).toHaveBeenCalled()
    expect(deps.quit).not.toHaveBeenCalled()
    expect(live().map((t) => t.ms)).toEqual([QUIT_GRACE_MS])
  })

  it('lets the quit through once the window is done, and never holds it again', () => {
    const { g, deps, live } = gate()
    g.beforeQuit(() => {})
    g.acknowledged()
    g.quitNow()
    expect(deps.quit).toHaveBeenCalledTimes(1)
    expect(live()).toEqual([])
    // The quit it starts comes back through before-quit, and goes.
    const prevent = vi.fn()
    g.beforeQuit(prevent)
    expect(prevent).not.toHaveBeenCalled()
    expect(deps.ask).toHaveBeenCalledTimes(1)
  })

  it('waits as long as an answering window needs, and lets it decide to stay', () => {
    const { g, deps, live } = gate()
    g.beforeQuit(() => {})
    g.acknowledged()
    // No timer left to quit behind the writer's back while they are asked.
    expect(live()).toEqual([])
    expect(deps.quit).not.toHaveBeenCalled()
    // Stayed: the next quit is asked about again.
    const prevent = vi.fn()
    g.beforeQuit(prevent)
    expect(prevent).toHaveBeenCalled()
    expect(deps.ask).toHaveBeenCalledTimes(2)
  })

  it('quits anyway when the window never answers', () => {
    const { g, deps, live } = gate()
    g.beforeQuit(() => {})
    live()[0].fn()
    expect(deps.quit).toHaveBeenCalledTimes(1)
    const prevent = vi.fn()
    g.beforeQuit(prevent)
    expect(prevent).not.toHaveBeenCalled()
  })

  it('keeps one grace period, however many times quit is pressed', () => {
    const { g, live } = gate()
    g.beforeQuit(() => {})
    g.beforeQuit(() => {})
    expect(live()).toHaveLength(1)
  })

  it('quits at once with no window to ask', () => {
    const { g, deps, live } = gate(false)
    const prevent = vi.fn()
    g.beforeQuit(prevent)
    expect(prevent).not.toHaveBeenCalled()
    expect(live()).toEqual([])
    expect(deps.quit).not.toHaveBeenCalled()
  })
})
