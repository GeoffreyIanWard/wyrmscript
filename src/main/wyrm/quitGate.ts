/**
 * Quitting goes through the window, so that the page is saved and every
 * open project checkpointed before the app goes. Every way to quit — File →
 * Quit, ⌘Q, the WyrmStar menu, the Dock — arrives in main as `before-quit`;
 * this holds it, asks the window to put its work away, and lets the quit
 * through when the window says it is done.
 *
 * Before this, a quit relied on `beforeunload`, which starts the save and
 * the checkpoint and does not wait for either.
 *
 * Two ways it must never trap the writer in an app that will not quit:
 * - A window that does not answer at all (hung, or with no one listening)
 *   is given `QUIT_GRACE_MS`, then the quit goes through. A window that has
 *   answered may take as long as it needs — it may be asking the writer
 *   whether to quit after a failed save — and may decline.
 * - With no window open, there is nothing to put away and nothing to ask.
 *
 * Pure, with Electron passed in, so the rules are tested without it.
 */

/** How long a window that has not answered gets before the quit goes on. */
export const QUIT_GRACE_MS = 5000

export interface QuitGateDeps {
  /** Ask the window to put its work away; false when there is no window. */
  ask(): boolean
  /** Quit for real. Re-enters `beforeQuit`, which now lets it through. */
  quit(): void
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(timer: unknown): void
}

export interface QuitGate {
  /** From `before-quit`. Calls `prevent` when the quit has to wait. */
  beforeQuit(prevent: () => void): void
  /** The window heard the request and is dealing with it. */
  acknowledged(): void
  /** The window has put everything away. */
  quitNow(): void
}

export function createQuitGate(deps: QuitGateDeps): QuitGate {
  let allowed = false
  let timer: unknown = null

  const stopTimer = (): void => {
    if (timer != null) deps.clearTimer(timer)
    timer = null
  }

  const go = (): void => {
    stopTimer()
    allowed = true
    deps.quit()
  }

  return {
    beforeQuit(prevent) {
      if (allowed) return
      if (!deps.ask()) return
      prevent()
      stopTimer()
      timer = deps.setTimer(go, QUIT_GRACE_MS)
    },
    acknowledged() {
      stopTimer()
    },
    quitNow() {
      go()
    }
  }
}
