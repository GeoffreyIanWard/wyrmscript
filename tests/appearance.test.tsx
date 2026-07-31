// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_APPEARANCE } from '../src/shared/types'
import type { AppearanceSettings } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'
import { PrefsDialog } from '../src/renderer/src/components/Dialogs'

/**
 * Appearance is app-level and must survive a restart — a writer who picks a
 * night palette should not find the white page waiting for them tomorrow.
 * These cover the store/persistence contract and the Preferences controls.
 */

function renderPrefs(appearance: AppearanceSettings = DEFAULT_APPEARANCE): {
  onChange: ReturnType<typeof vi.fn>
} {
  const onChange = vi.fn()
  render(<PrefsDialog appearance={appearance} onChange={onChange} onClose={() => {}} />)
  return { onChange }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  useWyrm.setState({ appearance: null })
})

describe('appearance persistence', () => {
  it('loads on boot, before any project is opened', async () => {
    const getAppearance = vi.spyOn(api, 'getAppearance')
    vi.spyOn(api, 'getLastProjectPath').mockResolvedValue(null)

    await useWyrm.getState().boot()

    expect(getAppearance).toHaveBeenCalled()
    expect(useWyrm.getState().appearance).toEqual(DEFAULT_APPEARANCE)
  })

  it('a change is written through, not just held in memory', async () => {
    const setAppearance = vi.spyOn(api, 'setAppearance')
    await useWyrm.getState().loadAppearance()

    await useWyrm.getState().setAppearance({ palette: 'night' })

    expect(setAppearance).toHaveBeenCalledWith({ palette: 'night' })
    expect(useWyrm.getState().appearance?.palette).toBe('night')
  })

  it('survives a reload — a fresh load returns what was set', async () => {
    await useWyrm.getState().loadAppearance()
    await useWyrm.getState().setAppearance({ palette: 'dark', fontSize: 21 })

    useWyrm.setState({ appearance: null })
    await useWyrm.getState().loadAppearance()

    expect(useWyrm.getState().appearance).toMatchObject({ palette: 'dark', fontSize: 21 })
  })

  it('keeps defaults for fields an older settings file never wrote', async () => {
    vi.spyOn(api, 'getAppearance').mockResolvedValue({
      ...DEFAULT_APPEARANCE,
      palette: 'ereader'
    })

    await useWyrm.getState().loadAppearance()

    expect(useWyrm.getState().appearance?.measure).toBe(DEFAULT_APPEARANCE.measure)
    expect(useWyrm.getState().appearance?.palette).toBe('ereader')
  })
})

describe('the Preferences controls', () => {
  it('offers all six palettes, comfort variants included', () => {
    renderPrefs()
    for (const label of [
      /^Paper —/,
      /^E-reader —/,
      /^Night —/,
      /^Dark —/,
      /^Green phosphor/,
      /^Amber phosphor/
    ]) {
      expect(screen.getByText(label)).toBeTruthy()
    }
  })

  it('reports only the field that changed', () => {
    const { onChange } = renderPrefs()

    fireEvent.click(screen.getByText(/Night/))

    expect(onChange).toHaveBeenCalledWith({ palette: 'night' })
  })

  it('steps the measure without touching the other geometry', () => {
    const { onChange } = renderPrefs()

    fireEvent.click(screen.getByLabelText(/Increase line width/i))

    expect(onChange).toHaveBeenCalledWith({ measure: DEFAULT_APPEARANCE.measure + 4 })
  })

  it('keeps line spacing to one decimal so 0.1 steps never drift', () => {
    const { onChange } = renderPrefs({ ...DEFAULT_APPEARANCE, lineHeight: 1.7 })

    fireEvent.click(screen.getByLabelText(/Increase line spacing/i))

    const [[patch]] = onChange.mock.calls
    expect(patch.lineHeight).toBe(1.8)
  })

  it('stops at the limits rather than running off the end', () => {
    renderPrefs({ ...DEFAULT_APPEARANCE, measure: 40, fontSize: 28 })

    expect(screen.getByLabelText(/Decrease line width/i).hasAttribute('disabled')).toBe(true)
    expect(screen.getByLabelText(/Increase text size/i).hasAttribute('disabled')).toBe(true)
  })

  it('resets the page geometry in one move, leaving the palette alone', () => {
    const { onChange } = renderPrefs({
      ...DEFAULT_APPEARANCE,
      palette: 'dark',
      measure: 90,
      fontSize: 24,
      lineHeight: 2.2
    })

    fireEvent.click(screen.getByText(/Reset to defaults/i))

    expect(onChange).toHaveBeenCalledWith({
      measure: DEFAULT_APPEARANCE.measure,
      fontSize: DEFAULT_APPEARANCE.fontSize,
      lineHeight: DEFAULT_APPEARANCE.lineHeight
    })
  })
})

describe('appearance reaches the page', () => {
  it('rides on the root element as data attributes and custom properties', async () => {
    vi.spyOn(api, 'getAppearance').mockResolvedValue({
      accents: '4bit',
      palette: 'night',
      firstLineIndent: true,
      measure: 74,
      fontSize: 20,
      lineHeight: 1.9
    })
    const { default: App } = await import('../src/renderer/src/App')
    await act(async () => {
      render(<App />)
    })

    await waitFor(() => {
      const root = document.querySelector('.screen') as HTMLElement
      expect(root.dataset.palette).toBe('night')
      expect(root.dataset.accents).toBe('4bit')
      expect(root.dataset.indent).toBe('on')
      // `ch` units, so the column stays the same character width at any size.
      expect(root.style.getPropertyValue('--measure')).toBe('74ch')
      expect(root.style.getPropertyValue('--prose-size')).toBe('20px')
      expect(root.style.getPropertyValue('--prose-leading')).toBe('1.9')
    })
  })
})
