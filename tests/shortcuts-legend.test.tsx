// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { DEFAULT_APPEARANCE, DEFAULT_STATS } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm, __disposeAll } from '../src/renderer/src/store'
import { ALL_SHORTCUTS, SHORTCUT_GROUPS } from '../src/renderer/src/lib/shortcuts'

/**
 * The legend, and the one thing that makes it worth having: that it agrees
 * with the app.
 *
 * A shortcut is stated by the menu item advertising it and by the handler
 * implementing it; the legend is a third statement. A legend that drifts is
 * worse than none — it teaches a key that does nothing, and the writer blames
 * their keyboard. So the coverage test below reads the **menu bar's own
 * source** rather than a copy of it.
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

describe('the legend agrees with the app', () => {
  it('lists every shortcut the menus advertise', () => {
    // Read from source: a second hand-written list of menu shortcuts here
    // would be the very drift this is meant to catch.
    const source = readFileSync('src/renderer/src/components/MenuBar.tsx', 'utf8')
    const advertised = [...source.matchAll(/shortcut: '([^']+)'/g)].map((m) => m[1])
    expect(advertised.length).toBeGreaterThan(5)

    const listed = new Set(ALL_SHORTCUTS.map((s) => s.keys))
    const missing = advertised.filter((keys) => !listed.has(keys))
    expect(missing).toEqual([])
  })

  it('says what each key does, not just what it is', () => {
    for (const item of ALL_SHORTCUTS) {
      expect(item.keys.trim()).not.toBe('')
      expect(item.what.trim().length).toBeGreaterThan(2)
    }
  })

  it('does not list the same key twice', () => {
    // Two rows for one key means one of them is wrong.
    const keys = ALL_SHORTCUTS.map((s) => s.keys)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('covers the keys that no menu mentions', () => {
    // The other half of the legend's point: these work and nothing in the app
    // ever said so.
    const listed = new Set(ALL_SHORTCUTS.map((s) => s.keys))
    for (const keys of ['⌘Y', '⌘P', 'Esc', '⌥F', '⇧⌘O']) {
      expect(listed.has(keys)).toBe(true)
    }
  })
})

describe('opening the legend', () => {
  it('opens on ⌘/', async () => {
    await renderApp()
    await act(async () => {
      fireEvent.keyDown(document.body, { key: '/', metaKey: true })
    })

    await waitFor(() => expect(document.querySelector('.shortcut-groups')).toBeTruthy())
    const rows = document.querySelectorAll('.shortcut-row')
    expect(rows.length).toBe(ALL_SHORTCUTS.length)
  })

  it('opens with no project, since that is where the question gets asked', async () => {
    await renderApp()
    act(() => useWyrm.setState({ project: null }))

    await act(async () => {
      fireEvent.keyDown(document.body, { key: '/', metaKey: true })
    })

    await waitFor(() => expect(document.querySelector('.shortcut-groups')).toBeTruthy())
  })

  it('shows the groups a writer would look under', async () => {
    await renderApp()
    await act(async () => {
      fireEvent.keyDown(document.body, { key: '/', metaKey: true })
    })
    await waitFor(() => expect(document.querySelector('.shortcut-groups')).toBeTruthy())

    const titles = [...document.querySelectorAll('.shortcut-group-title')].map((t) => t.textContent)
    expect(titles).toEqual(SHORTCUT_GROUPS.map((g) => g.title))
  })

  it('closes on Esc like every other dialog', async () => {
    await renderApp()
    await act(async () => {
      fireEvent.keyDown(document.body, { key: '/', metaKey: true })
    })
    await waitFor(() => expect(document.querySelector('.shortcut-groups')).toBeTruthy())

    await act(async () => {
      fireEvent.keyDown(document.querySelector('.dialog') as HTMLElement, { key: 'Escape' })
    })

    await waitFor(() => expect(document.querySelector('.shortcut-groups')).toBeNull())
  })

  it('is in the menu as well, for anyone who does not know the key yet', async () => {
    await renderApp()
    const wyrmMenu = document.querySelector('.menu-title') as HTMLElement
    await act(async () => {
      fireEvent.mouseDown(wyrmMenu)
    })

    const items = [...document.querySelectorAll('.menu-drop .menu-item')].map(
      (i) => i.textContent ?? ''
    )
    expect(items.join('\n')).toContain('Keyboard Shortcuts')
  })
})
