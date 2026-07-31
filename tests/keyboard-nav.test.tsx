// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { JSX } from 'react'
import { useState } from 'react'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'
import { MenuBar } from '../src/renderer/src/components/MenuBar'
import { Binder } from '../src/renderer/src/components/Binder'
import { useFocusTrap } from '../src/renderer/src/lib/useFocusTrap'

/**
 * F-07: the app has to be operable without a mouse. These drive real key
 * events at real components — a keyboard path that only works in theory is
 * the failure mode this whole feature exists to prevent.
 */

const noop = (): void => {}

function renderMenuBar(overrides: Partial<Parameters<typeof MenuBar>[0]> = {}): void {
  render(
    <MenuBar
      onAbout={noop}
      onPreferences={noop}
      onVersionDialog={noop}
      onCompile={noop}
      onBackup={noop}
      onSyncSettings={noop}
      onSearch={noop}
      onPalette={noop}
      focusMode={false}
      onFocusMode={noop}
      {...overrides}
    />
  )
}

async function openProject(): Promise<void> {
  const path = (await api.getLastProjectPath())!
  const info = (await api.openProjectPath(path))!
  useWyrm.setState({ project: info, booted: true, saveState: 'saved', renamingId: null })
}

const menuBar = (): HTMLElement => screen.getByRole('menubar')

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  useWyrm.setState({ project: null, booted: false, activeId: null, activeDoc: null })
})

describe('menu bar', () => {
  it('is one tab stop, not one per menu', async () => {
    await openProject()
    renderMenuBar()
    const titles = screen
      .getAllByRole('menuitem')
      .filter((el) => el.className.includes('menu-title'))
    const reachable = titles.filter((el) => el.getAttribute('tabindex') === '0')
    expect(titles.length).toBeGreaterThan(1)
    expect(reachable).toHaveLength(1)
  })

  it('opens a menu with ArrowDown and lands on the first enabled item', async () => {
    await openProject()
    renderMenuBar()
    const file = screen.getByText('File')
    act(() => file.focus())

    fireEvent.keyDown(file, { key: 'ArrowDown' })

    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy())
    expect(document.querySelector('.menu-item.active')?.textContent).toContain('New Document')
  })

  it('walks items with the arrows, skipping what cannot be chosen', async () => {
    await openProject()
    // No open document, so History and Variants are disabled and must be skipped.
    useWyrm.setState({ activeDoc: null })
    renderMenuBar()
    const file = screen.getByText('File')
    act(() => file.focus())
    fireEvent.keyDown(file, { key: 'ArrowDown' })

    // Four steps down the File menu. If disabled items were walked, this
    // lands on History or Variants — both greyed out with no document open.
    for (let i = 0; i < 4; i++) fireEvent.keyDown(menuBar(), { key: 'ArrowDown' })

    const active = document.querySelector('.menu-item.active')
    expect(active?.className).not.toContain('disabled')
    expect(active?.textContent).not.toContain('History')
    expect(active?.textContent).not.toContain('Variants')
  })

  it('moves between menus with ArrowLeft and ArrowRight', async () => {
    await openProject()
    renderMenuBar()
    const file = screen.getByText('File')
    act(() => file.focus())
    fireEvent.keyDown(file, { key: 'ArrowDown' })

    fireEvent.keyDown(menuBar(), { key: 'ArrowRight' })

    await waitFor(() => expect(screen.getByText('Edit').getAttribute('aria-expanded')).toBe('true'))
  })

  it('jumps by first letter (type-ahead)', async () => {
    await openProject()
    renderMenuBar()
    const file = screen.getByText('File')
    act(() => file.focus())
    fireEvent.keyDown(file, { key: 'ArrowDown' })

    fireEvent.keyDown(menuBar(), { key: 'o' })

    expect(document.querySelector('.menu-item.active')?.textContent).toContain('Open Project…')
  })

  it('runs the highlighted item on Enter', async () => {
    await openProject()
    const onCompile = vi.fn()
    renderMenuBar({ onCompile })
    const file = screen.getByText('File')
    act(() => file.focus())
    fireEvent.keyDown(file, { key: 'ArrowDown' })
    fireEvent.keyDown(menuBar(), { key: 'c' }) // Commit Checkpoint…
    fireEvent.keyDown(menuBar(), { key: 'c' }) // Compile Manuscript…

    fireEvent.keyDown(menuBar(), { key: 'Enter' })

    expect(onCompile).toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on Escape without running anything', async () => {
    await openProject()
    const onCompile = vi.fn()
    renderMenuBar({ onCompile })
    const file = screen.getByText('File')
    act(() => file.focus())
    fireEvent.keyDown(file, { key: 'ArrowDown' })

    fireEvent.keyDown(menuBar(), { key: 'Escape' })

    expect(screen.queryByRole('menu')).toBeNull()
    expect(onCompile).not.toHaveBeenCalled()
  })

  it('walks the bar with the arrows before any menu is open', async () => {
    await openProject()
    renderMenuBar()
    const wyrm = screen.getByLabelText('WyrmStar menu')
    act(() => wyrm.focus())

    fireEvent.keyDown(wyrm, { key: 'ArrowRight' })

    // Nothing opened, but focus moved along the bar — F10 then → must work.
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement?.textContent).toBe('File')
  })

  it('hands App a way to move focus into the bar', async () => {
    await openProject()
    let focusMenus: (() => void) | null = null
    renderMenuBar({
      registerFocusMenus: (f) => {
        focusMenus = f
      }
    })

    expect(focusMenus).toBeTypeOf('function')
    act(() => focusMenus!())
    expect(document.activeElement?.className).toContain('menu-title')
  })
})

describe('binder', () => {
  const tree = (): HTMLElement => screen.getByRole('tree')

  it('moves a cursor with the arrows without opening documents', async () => {
    await openProject()
    render(<Binder />)
    expect(useWyrm.getState().activeDoc).toBeNull()

    // Far enough to pass over real documents, not just the two folders above
    // them — otherwise an implementation that opens on arrow never gets the
    // chance to prove it does.
    for (let i = 0; i < 4; i++) fireEvent.keyDown(tree(), { key: 'ArrowDown' })

    // Browsing is not opening. Asserted on store state rather than a spy:
    // Binder captures selectDoc at render, so a spy installed afterwards
    // would never see the call and the test would pass vacuously.
    await waitFor(() => expect(document.querySelector('.binder-row.cursor')).toBeTruthy())
    expect(useWyrm.getState().activeDoc).toBeNull()
  })

  it('opens the document under the cursor on Enter', async () => {
    await openProject()
    render(<Binder />)

    // Manuscript → Part One → first scene.
    fireEvent.keyDown(tree(), { key: 'ArrowDown' })
    fireEvent.keyDown(tree(), { key: 'ArrowDown' })
    fireEvent.keyDown(tree(), { key: 'ArrowDown' })
    fireEvent.keyDown(tree(), { key: 'Enter' })

    await waitFor(() =>
      expect(useWyrm.getState().activeDoc?.meta.title).toBe('The Wyrmlight Fades')
    )
  })

  it('collapses and expands folders with the left and right arrows', async () => {
    await openProject()
    render(<Binder />)
    fireEvent.keyDown(tree(), { key: 'ArrowDown' }) // Manuscript
    const before = document.querySelectorAll('.binder-row').length

    fireEvent.keyDown(tree(), { key: 'ArrowLeft' })

    await waitFor(() =>
      expect(document.querySelectorAll('.binder-row').length).toBeLessThan(before)
    )
    fireEvent.keyDown(tree(), { key: 'ArrowRight' })
    await waitFor(() => expect(document.querySelectorAll('.binder-row').length).toBe(before))
  })

  it('leaves every key alone while a row is being renamed', async () => {
    await openProject()
    const moveToTrash = vi.spyOn(useWyrm.getState(), 'moveToTrash')
    render(<Binder />)
    fireEvent.keyDown(tree(), { key: 'ArrowDown' })
    act(() => useWyrm.setState({ renamingId: 'anything' }))

    fireEvent.keyDown(tree(), { key: 'Backspace' })

    expect(moveToTrash).not.toHaveBeenCalled()
  })
})

describe('dialog focus trap', () => {
  function Trapped({ onClose }: { onClose: () => void }): JSX.Element {
    const ref = useFocusTrap<HTMLDivElement>(onClose)
    return (
      <div ref={ref}>
        <input aria-label="first" />
        <button type="button">middle</button>
        <button type="button">last</button>
      </div>
    )
  }

  it('puts the caret in the first text field on open', () => {
    render(<Trapped onClose={noop} />)
    expect(document.activeElement).toBe(screen.getByLabelText('first'))
  })

  it('wraps Tab at the end and ⇧Tab at the start', () => {
    render(<Trapped onClose={noop} />)
    const first = screen.getByLabelText('first')
    const last = screen.getByText('last')

    act(() => last.focus())
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<Trapped onClose={onClose} />)

    fireEvent.keyDown(screen.getByLabelText('first'), { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })

  it('returns focus to whatever opened it', async () => {
    function Host(): JSX.Element {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            opener
          </button>
          {open && <Trapped onClose={() => setOpen(false)} />}
        </>
      )
    }
    render(<Host />)
    const opener = screen.getByText('opener')
    act(() => opener.focus())
    fireEvent.click(opener)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('first')))

    fireEvent.keyDown(screen.getByLabelText('first'), { key: 'Escape' })

    await waitFor(() => expect(document.activeElement).toBe(opener))
  })
})
