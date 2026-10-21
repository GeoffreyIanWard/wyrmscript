// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { DEFAULT_APPEARANCE, DEFAULT_STATS } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm, __disposeAll } from '../src/renderer/src/store'

/**
 * The Corkboard menu: the outlining toolset in one place.
 *
 * The board and its five views were split across View and Project, where the
 * five sat beside Backup and Sync Settings as though they were housekeeping.
 * These cover the grouping itself, the ⌥⌘B toggle, and the two places that
 * have to agree with the menu — the command palette's subtitles and the
 * board's own pinned strip. Those are exactly what drifts when a menu moves
 * and nothing holds the three together.
 */

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

const menuTitle = (name: string): HTMLElement =>
  [...document.querySelectorAll('.menu-title')].find((t) => t.textContent === name) as HTMLElement

/** The labels of whichever menu is open. */
const openItems = (): string[] =>
  [...document.querySelectorAll('.menu-drop .menu-item')].map((i) => i.textContent ?? '')

async function openMenu(name: string): Promise<void> {
  // The bar opens on mousedown, not click — a click never gets that far —
  // and mousedown on an open menu *closes* it, so anything already open has
  // to be dismissed first or the second call just toggles it shut.
  const overlay = document.querySelector('.menu-overlay')
  if (overlay) {
    await act(async () => {
      fireEvent.mouseDown(overlay)
    })
  }
  await act(async () => {
    fireEvent.mouseDown(menuTitle(name))
  })
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
    mainView: { kind: 'doc' },
    viewHistory: []
  })
  __disposeAll()
})

describe('the Corkboard menu', () => {
  it('gathers the whole outlining toolset', async () => {
    await openProject()
    await renderApp()
    await openMenu('Corkboard')

    const items = openItems().join('\n')
    for (const view of ['Timeline', 'Plot Graph', 'Plotlines', 'Character Graph', 'World Map']) {
      expect(items).toContain(view)
    }
  })

  it('leaves none of them behind in Project', async () => {
    // The failure this guards is a half-done move: an item in both menus, or
    // one that never left. Project keeps its own housekeeping either way.
    await openProject()
    await renderApp()
    await openMenu('Project')

    const items = openItems().join('\n')
    for (const view of ['Timeline', 'Plot Graph', 'Plotlines', 'Character Graph', 'World Map']) {
      expect(items).not.toContain(view)
    }
    expect(items).toContain('Backup')
  })

  it('names the place it would take you, not the place you are', async () => {
    await openProject()
    await renderApp()
    await openMenu('Corkboard')
    expect(openItems()[0]).toContain('Corkboard')

    act(() => useWyrm.getState().showCorkboard())
    await openMenu('Corkboard')
    expect(openItems()[0]).toContain('Manuscript')
  })
})

describe('⌥⌘B', () => {
  it('goes to the board and back again', async () => {
    await openProject()
    await renderApp()
    expect(useWyrm.getState().mainView.kind).toBe('doc')

    // `code`, not `key`: Option remaps the character on macOS (⌥B is "∫"),
    // so a handler that checked 'b' would do nothing on the platform this
    // was designed for — the same trap ⌥⌘F and ⌥⌘T already document.
    await act(async () => {
      fireEvent.keyDown(document.body, { code: 'KeyB', altKey: true, metaKey: true })
    })
    expect(useWyrm.getState().mainView.kind).toBe('corkboard')

    await act(async () => {
      fireEvent.keyDown(document.body, { code: 'KeyB', altKey: true, metaKey: true })
    })
    expect(useWyrm.getState().mainView.kind).toBe('doc')
  })

  it('comes to the board from anywhere else, not just the manuscript', async () => {
    await openProject()
    await renderApp()
    act(() => useWyrm.getState().showStats())

    await act(async () => {
      fireEvent.keyDown(document.body, { code: 'KeyB', altKey: true, metaKey: true })
    })

    expect(useWyrm.getState().mainView.kind).toBe('corkboard')
  })

  it('does nothing with no project open', async () => {
    // App boots the last project on mount, so the no-project state has to be
    // set after rendering — otherwise this passes against a project that is
    // very much open.
    await renderApp()
    act(() => useWyrm.setState({ project: null, mainView: { kind: 'doc' } }))

    await act(async () => {
      fireEvent.keyDown(document.body, { code: 'KeyB', altKey: true, metaKey: true })
    })

    expect(useWyrm.getState().mainView.kind).not.toBe('corkboard')
  })
})

describe('the places that have to agree with the menu', () => {
  it('finds the outlining views by the menu they live under', async () => {
    // A palette subtitle is searched, not shown, so the menu's name is what
    // makes "corkboard" turn up the five views. Left as "Project" they were
    // findable only by their own names, which is no help to a writer who has
    // learnt where they live.
    await openProject()
    await renderApp()
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'k', metaKey: true })
    })
    await waitFor(() => expect(document.querySelector('.text-field')).toBeTruthy())

    await act(async () => {
      fireEvent.change(document.querySelector('.text-field') as HTMLInputElement, {
        target: { value: 'corkboard' }
      })
    })

    await waitFor(() => expect(document.querySelectorAll('.version-row').length).toBeGreaterThan(0))
    const rows = [...document.querySelectorAll('.version-row')].map((r) => r.textContent ?? '')
    for (const view of ['Timeline', 'Plot Graph', 'Plotlines', 'Character Graph', 'World Map']) {
      expect(rows.some((r) => r.includes(view))).toBe(true)
    }
  })

  it('pins all five to the board itself', async () => {
    // The board's strip and the menu are two statements of the same set; if
    // they disagree, neither tells a writer what the outlining tools are.
    const path = await openProject()
    for (const d of (await api.readAllDocs(path)).slice(0, 1)) {
      await api.writeDoc(path, { ...d, meta: { ...d.meta, tags: ['scene'] } })
    }
    await renderApp()
    act(() => useWyrm.getState().showCorkboard())

    await waitFor(() => expect(document.querySelector('.corkboard-tools')).toBeTruthy())
    const pinned = [...document.querySelectorAll('.board-tool')].map((b) => b.textContent ?? '')
    for (const view of ['Timeline', 'Plot Graph', 'Plotlines', 'Characters', 'World Map']) {
      expect(pinned.join('\n')).toContain(view)
    }
  })

  it('opens a dialog from the board rather than only naming it', async () => {
    const path = await openProject()
    for (const d of (await api.readAllDocs(path)).slice(0, 1)) {
      await api.writeDoc(path, { ...d, meta: { ...d.meta, tags: ['scene'] } })
    }
    await renderApp()
    act(() => useWyrm.getState().showCorkboard())
    await waitFor(() => expect(document.querySelector('.corkboard-tools')).toBeTruthy())

    const plotlines = [...document.querySelectorAll('.board-tool')].find((b) =>
      b.textContent?.includes('Plotlines')
    ) as HTMLElement
    await act(async () => {
      fireEvent.click(plotlines)
    })

    await waitFor(() => expect(document.querySelector('.dialog-overlay')).toBeTruthy())
  })

  it('opens the world map as a place from the menu, the board and the palette, binder hidden', async () => {
    const path = await openProject()
    for (const d of (await api.readAllDocs(path)).slice(0, 1)) {
      await api.writeDoc(path, { ...d, meta: { ...d.meta, tags: ['scene'] } })
    }
    await renderApp()
    const atMap = async (): Promise<void> => {
      await waitFor(() => expect(useWyrm.getState().mainView.kind).toBe('map'))
      await waitFor(() => expect(document.querySelector('.world-map')).toBeTruthy())
      // The map takes the window, as the board does: no binder squeezing it.
      expect(document.querySelector('.binder')).toBeNull()
      expect(document.querySelector('.dialog-overlay')).toBeNull()
    }

    // The menu.
    await openMenu('Corkboard')
    const item = [...document.querySelectorAll('.menu-drop .menu-item')].find((i) =>
      i.textContent?.includes('World Map')
    ) as HTMLElement
    // Menu items act on mousedown, as the bar does.
    await act(async () => {
      fireEvent.mouseDown(item)
    })
    await atMap()
    act(() => {
      useWyrm.getState().goBack()
    })
    expect(useWyrm.getState().mainView.kind).toBe('doc')

    // The board's own strip.
    act(() => useWyrm.getState().showCorkboard())
    await waitFor(() => expect(document.querySelector('.corkboard-tools')).toBeTruthy())
    const tool = [...document.querySelectorAll('.board-tool')].find((b) =>
      b.textContent?.includes('World Map')
    ) as HTMLElement
    await act(async () => {
      fireEvent.click(tool)
    })
    await atMap()
    // A detour from the board: Esc goes back there.
    act(() => {
      useWyrm.getState().goBack()
    })
    expect(useWyrm.getState().mainView.kind).toBe('corkboard')

    // The palette.
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'k', metaKey: true })
    })
    await waitFor(() => expect(document.querySelector('.text-field')).toBeTruthy())
    await act(async () => {
      fireEvent.change(document.querySelector('.text-field') as HTMLInputElement, {
        target: { value: 'world map' }
      })
    })
    const row = await waitFor(() => {
      const r = [...document.querySelectorAll('.version-row')].find((x) =>
        x.textContent?.includes('World Map')
      )
      expect(r).toBeTruthy()
      return r as HTMLElement
    })
    await act(async () => {
      fireEvent.click(row)
    })
    await atMap()
  })
})
