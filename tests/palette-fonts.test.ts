import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * F-15 made Manuscript the first palette to override `--font-chrome`, which
 * exposed a latent cascade bug: `data-palette` lives on `.screen`, but the
 * chrome font was only ever declared on `body`, one level above it. A custom
 * property resolves where it is *used*, and inheritance passes the already
 * resolved value down — so `body { font-family: var(--font-chrome) }` baked in
 * the `:root` font before any palette could speak, and every chrome element
 * that merely inherited its font (the menu bar, the sidebar, the title bars)
 * silently kept Silkscreen while elements that re-declared the variable
 * themselves switched. Half the chrome in one face, half in another.
 *
 * This asserts against the stylesheet source rather than a rendered page
 * because jsdom has no cascade to speak of: it does not resolve custom
 * properties through inheritance, so a DOM test here would pass no matter
 * which element carried the declaration and would guard nothing. The real
 * behaviour was verified in a browser; this keeps the declaration from being
 * tidied away as a duplicate of the one on `body`.
 */

const css = readFileSync(join(__dirname, '../src/renderer/src/styles/retro.css'), 'utf8')

/** Comments stripped, so a `/* ... *\/` sitting above a rule is not read as
 *  part of its selector list. */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** Every top-level rule naming this selector, bodies joined. Selectors are
 *  grouped (Manuscript shares a block with the other flat palettes), so a
 *  single lookup would read the wrong rule. */
function ruleBody(selector: string): string {
  const bodies = [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(',').some((s) => s.trim() === selector))
    .map(([, , body]) => body)
  expect(bodies.length, `no rule for ${selector}`).toBeGreaterThan(0)
  return bodies.join('\n')
}

describe('palette fonts', () => {
  it('resolves the chrome font on the element that carries the palette', () => {
    // Without this, a palette that overrides --font-chrome only reaches the
    // chrome elements that happen to re-declare it.
    expect(ruleBody('.screen')).toContain('font-family: var(--font-chrome)')
  })

  it('keeps the palette attribute and the chrome font on the same element', () => {
    // If data-palette ever moves off .screen, the declaration has to move
    // with it — a palette cannot override a variable resolved above itself.
    const app = readFileSync(join(__dirname, '../src/renderer/src/App.tsx'), 'utf8')
    const screenTag = app.slice(app.indexOf('className={`screen'))

    expect(screenTag.slice(0, 400)).toContain('data-palette=')
  })

  it('gives Manuscript its own chrome and prose faces', () => {
    const manuscript = ruleBody("[data-palette='manuscript']")

    expect(manuscript).toContain('--font-chrome: ')
    expect(manuscript).toContain('UnifrakturMaguntia')
    expect(manuscript).toContain('--font-prose: ')
    expect(manuscript).toContain('Cardo')
  })

  it('leaves the default chrome font alone for every other palette', () => {
    // Only Manuscript may repaint the chrome face; a stray --font-chrome in
    // another palette block would be a silent house-rule break.
    const overrides = [...bare.matchAll(/\[data-palette='(\w+)'\][^{]*\{([^}]*)\}/g)]
      .filter(([, , body]) => body.includes('--font-chrome'))
      .map(([, name]) => name)

    expect(overrides).toEqual(['manuscript'])
  })
})
