import { describe, expect, it } from 'vitest'
import { maximiseAsFullScreen, type MaximisableWindow } from '../src/main/wyrm/maximise'

/** A window that records what was done to it and can be maximised by hand. */
function fakeWindow(): MaximisableWindow & { maximise: () => void; calls: string[] } {
  let listener: (() => void) | null = null
  let full = false
  const calls: string[] = []
  return {
    calls,
    on: (_event, fn) => {
      listener = fn
    },
    isFullScreen: () => full,
    unmaximize: () => calls.push('unmaximize'),
    setFullScreen: (flag) => {
      full = flag
      calls.push(`fullscreen:${flag}`)
    },
    maximise: () => listener?.()
  }
}

describe('the maximise button', () => {
  it('goes full screen on Windows, from the ordinary window', () => {
    const win = fakeWindow()
    maximiseAsFullScreen(win, 'win32')
    win.maximise()
    expect(win.calls).toEqual(['unmaximize', 'fullscreen:true'])
  })

  it('is left alone already full screen', () => {
    const win = fakeWindow()
    maximiseAsFullScreen(win, 'win32')
    win.setFullScreen(true)
    win.calls.length = 0
    win.maximise()
    expect(win.calls).toEqual([])
  })

  it('still maximises on macOS and Linux', () => {
    for (const platform of ['darwin', 'linux']) {
      const win = fakeWindow()
      maximiseAsFullScreen(win, platform)
      win.maximise()
      expect(win.calls).toEqual([])
    }
  })
})
