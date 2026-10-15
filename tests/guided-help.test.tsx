// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { DEFAULT_APPEARANCE, DEFAULT_STATS } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm, __disposeAll } from '../src/renderer/src/store'
import { HELP_IDS, HELP_TOPICS, TIP_MAX_H, TIP_W, tipPosition } from '../src/renderer/src/lib/help'

/**
 * Guided help (F-44).
 *
 * The drift guard is the important one here, and it is the same shape as the
 * keyboard legend's: the copy lives in one file and the controls opt in with
 * an attribute, so the two can part company silently. A control marked with
 * no copy explains nothing when hovered; copy for a control that no longer
 * exists is writing nobody will ever read.
 */

/** Every `data-help` id actually used in the renderer source. */
function markedIds(): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        walk(path)
        continue
      }
      if (!/\.tsx?$/.test(name) || name === 'help.ts') continue
      for (const m of readFileSync(path, 'utf8').matchAll(/data-help="([a-z-]+)"/g)) {
        found.push(m[1])
      }
    }
  }
  walk('src/renderer/src')
  return found
}

async function renderApp(): Promise<void> {
  vi.spyOn(api, 'getStatsSettings').mockResolvedValue(DEFAULT_STATS)
  vi.spyOn(api, 'getAppearance').mockResolvedValue(DEFAULT_APPEARANCE)
  vi.spyOn(api, 'getDailyStats').mockResolvedValue([])
  const { default: App } = await import('../src/renderer/src/App')
  await act(async () => {
    render(<App />)
  })
}

async function openProject(): Promise<string> {
  const path = (await api.getLastProjectPath())!
  const info = (await api.openProjectPath(path))!
  useWyrm.setState({ project: info, booted: true, saveState: 'saved', renamingId: null })
  return path
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  useWyrm.setState({
    project: null,
    booted: false,
    parked: {},
    openPaths: [],
    editor: null,
    helpMode: false,
    mainView: { kind: 'doc' },
    viewHistory: []
  })
  __disposeAll()
})

describe('the copy and the controls agree', () => {
  it('explains every control that asks to be explained', () => {
    const missing = [...new Set(markedIds())].filter((id) => !HELP_TOPICS[id])
    expect(missing).toEqual([])
  })

  it('has no explanation for a control that does not exist', () => {
    const marked = new Set(markedIds())
    const orphaned = HELP_IDS.filter((id) => !marked.has(id))
    expect(orphaned).toEqual([])
  })

  it('actually says something', () => {
    // A title and a sentence, not a restatement of the label.
    for (const [id, topic] of Object.entries(HELP_TOPICS)) {
      expect(topic.title.trim().length, id).toBeGreaterThan(2)
      expect(topic.body.trim().length, id).toBeGreaterThan(40)
    }
  })
})

describe('where the explanation goes', () => {
  // Pure arithmetic, tested away from the DOM: jsdom has no layout engine, so
  // asserting this through the rendered tree would be asserting against
  // zeroes. Each rule here was a tip that could not be read.
  const view = { width: 1000, height: 700 }
  const pointer = { x: 100, y: 100 }

  it('sits under the control it explains', () => {
    const box = { left: 120, top: 80, width: 200, height: 40 }
    expect(tipPosition(box, pointer, view)).toEqual({ x: 120, y: 126 })
  })

  it('flips above rather than running off the bottom', () => {
    // The binder did exactly this: a tall control low on the screen put its
    // own explanation past the bottom edge, where it was cut in half.
    const box = { left: 10, top: 500, width: 200, height: 160 }
    const { y } = tipPosition(box, pointer, view)
    expect(y).toBeLessThan(500)
    expect(y + TIP_MAX_H).toBeLessThanOrEqual(view.height)
  })

  it('follows the pointer for a control too tall to point at', () => {
    // The binder is most of the window; its bottom edge is nowhere near
    // whatever the writer is actually hovering.
    const box = { left: 0, top: 0, width: 180, height: 600 }
    const { y } = tipPosition(box, { x: 50, y: 220 }, view)
    expect(y).toBe(238)
  })

  it('keeps a control near the right edge from pushing its tip off screen', () => {
    const box = { left: 960, top: 40, width: 30, height: 20 }
    const { x } = tipPosition(box, pointer, view)
    expect(x + TIP_W).toBeLessThanOrEqual(view.width)
  })

  it('never places the tip off the top either', () => {
    const box = { left: 10, top: 0, width: 200, height: 690 }
    const { y } = tipPosition(box, { x: 20, y: 680 }, view)
    expect(y).toBeGreaterThanOrEqual(0)
  })
})

describe('guided help', () => {
  it('is off until asked for, and the mode says so while it is on', async () => {
    await openProject()
    await renderApp()
    expect(document.querySelector('.help-banner')).toBeNull()

    const toggle = document.querySelector('.help-toggle') as HTMLElement
    await act(async () => {
      fireEvent.click(toggle)
    })

    expect(document.querySelector('.help-banner')).toBeTruthy()
    expect(useWyrm.getState().helpMode).toBe(true)
  })

  it('explains the control under the pointer', async () => {
    await openProject()
    await renderApp()
    act(() => useWyrm.getState().setHelpMode(true))

    const binder = document.querySelector('[data-help="binder"]') as HTMLElement
    await act(async () => {
      fireEvent.mouseMove(binder)
    })

    await waitFor(() => expect(document.querySelector('.help-tip')).toBeTruthy())
    expect(document.querySelector('.help-tip-title')?.textContent).toBe(HELP_TOPICS.binder.title)
    expect(document.querySelector('.help-tip-body')?.textContent).toBe(HELP_TOPICS.binder.body)
  })

  it('explains the nearest marked thing, not only an exact hit', async () => {
    // A writer hovers a row or an icon, not the container that carries the
    // attribute, so the lookup walks up from whatever is under the pointer.
    await openProject()
    await renderApp()
    act(() => useWyrm.getState().setHelpMode(true))

    const inside = document.querySelector('[data-help="binder"] .row-title') as HTMLElement
    await act(async () => {
      fireEvent.mouseMove(inside)
    })

    await waitFor(() =>
      expect(document.querySelector('.help-tip-title')?.textContent).toBe(HELP_TOPICS.binder.title)
    )
  })

  it('says nothing about a control with nothing to say', async () => {
    await openProject()
    await renderApp()
    act(() => useWyrm.getState().setHelpMode(true))
    const binder = document.querySelector('[data-help="binder"]') as HTMLElement
    await act(async () => {
      fireEvent.mouseMove(binder)
    })
    await waitFor(() => expect(document.querySelector('.help-tip')).toBeTruthy())

    await act(async () => {
      fireEvent.mouseMove(document.body)
    })

    expect(document.querySelector('.help-tip')).toBeNull()
  })

  it('does not do the thing it is explaining', async () => {
    // The point of swallowing the click: some of the marked controls delete,
    // compile or minimise, and asking what a control does is not asking for
    // it to happen. Asserted against the scene toggle, whose effect is
    // visible in the document — the first version of this test clicked the
    // trash row, which only expands an empty list, so it passed just as
    // happily with the guard removed.
    const path = await openProject()
    const docs = await api.readAllDocs(path)
    await renderApp()
    await act(async () => {
      await useWyrm.getState().selectDoc(docs[0].meta.id)
    })
    await waitFor(() => expect(document.querySelector('[data-help="scene-tag"]')).toBeTruthy())

    act(() => useWyrm.getState().setHelpMode(true))
    const toggle = (): HTMLElement =>
      document.querySelector('[data-help="scene-tag"]') as HTMLElement
    const tagged = (): boolean => (useWyrm.getState().activeDoc?.meta.tags ?? []).includes('scene')
    expect(tagged()).toBe(false)

    await act(async () => {
      fireEvent.click(toggle())
    })
    expect(tagged()).toBe(false)
    expect(useWyrm.getState().helpMode).toBe(true)

    // And the same click does work once the mode is off, so the assertion
    // above is about the guard rather than about the control being inert.
    act(() => useWyrm.getState().setHelpMode(false))
    await act(async () => {
      fireEvent.click(toggle())
    })
    await waitFor(() => expect(tagged()).toBe(true))
  })

  it('leaves on Esc, without also walking back a view', async () => {
    // Esc is already "back" and "close the dialog". Leaving help must not do
    // both at once, or stopping reading also moves you somewhere.
    await openProject()
    await renderApp()
    // A story-bible detour, which is a view Esc *would* walk back from —
    // the corkboard clears the history, so Esc there does nothing anyway and
    // the assertion would hold with or without the guard.
    await act(async () => {
      useWyrm.getState().showEntity('a')
    })
    expect(useWyrm.getState().viewHistory.length).toBeGreaterThan(0)
    act(() => useWyrm.getState().setHelpMode(true))

    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'Escape' })
    })

    expect(useWyrm.getState().helpMode).toBe(false)
    expect(useWyrm.getState().mainView.kind).toBe('entity')
  })

  it('stops explaining once the mode is off', async () => {
    await openProject()
    await renderApp()
    act(() => useWyrm.getState().setHelpMode(true))
    const binder = document.querySelector('[data-help="binder"]') as HTMLElement
    await act(async () => {
      fireEvent.mouseMove(binder)
    })
    await waitFor(() => expect(document.querySelector('.help-tip')).toBeTruthy())

    act(() => useWyrm.getState().setHelpMode(false))
    await act(async () => {
      fireEvent.mouseMove(binder)
    })

    expect(document.querySelector('.help-tip')).toBeNull()
    expect(document.querySelector('.help-banner')).toBeNull()
  })

  it('is in the menu too, and names the way out', async () => {
    await openProject()
    await renderApp()
    act(() => useWyrm.getState().setHelpMode(true))

    const wyrmMenu = document.querySelector('.menu-title') as HTMLElement
    await act(async () => {
      fireEvent.mouseDown(wyrmMenu)
    })

    const items = [...document.querySelectorAll('.menu-drop .menu-item')].map(
      (i) => i.textContent ?? ''
    )
    expect(items.join('\n')).toContain('Stop Guided Help')
  })
})
