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

describe('palette assets', () => {
  /**
   * The house rule: a palette must restate every SVG data-URI with its own ink
   * baked in, because a background-image cannot inherit a colour. The
   * corkboard added a sixth one (`--cork`) and it was initially declared only
   * at `:root` — so every theme drew black cork grain regardless of its ink,
   * which is exactly the drift this rule exists to prevent. A new palette is
   * the easiest place in the codebase to forget one of these.
   */
  it('gives every palette its own cork, in its own ink', () => {
    const palettes = [...bare.matchAll(/\[data-palette='(\w+)'\][^{]*\{([^}]*)\}/g)]
      // Only the blocks that define a palette, not the ones that tweak one.
      .filter(([, , body]) => body.includes('--dither-25:'))

    expect(palettes.length).toBeGreaterThan(10)
    for (const [, name, body] of palettes) {
      expect(body, `${name} has no --cork`).toContain('--cork:')
      const ink = /--ink:\s*(#[0-9a-fA-F]{3,6})/.exec(body)?.[1]
      expect(ink, `${name} has no --ink`).toBeTruthy()
      // The ink is URL-encoded into the data-URI as %23rrggbb.
      const encoded = `%23${ink!.slice(1)}`
      const cork = /--cork:[^;]*/.exec(body)?.[0] ?? ''
      expect(cork.toLowerCase(), `${name}'s cork is not drawn in its own ink`).toContain(
        encoded.toLowerCase()
      )
    }
  })
})

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

/**
 * The board's string and portraits, per palette. Both are judged against the
 * palette's own colours, so the test resolves them the way the cascade does:
 * every top-level rule naming the palette exactly (grouped or not), last
 * declaration wins, `var(--ink)`/`var(--paper)` followed one step, `:root`
 * where the palette says nothing.
 */
describe('the board, per palette', () => {
  const palettes = [...bare.matchAll(/\[data-palette='(\w+)'\][^{]*\{([^}]*)\}/g)]
    .filter(([, , body]) => body.includes('--dither-25:'))
    .map(([, name]) => name)

  const declared = (selector: string, prop: string): string | undefined => {
    let value: string | undefined
    for (const [, selectors, body] of bare.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (!selectors.split(',').some((s) => s.trim() === selector)) continue
      const hit = [...body.matchAll(new RegExp(`${prop}:\\s*([^;]+);`, 'g'))].pop()
      if (hit) value = hit[1].trim()
    }
    return value
  }

  const resolve = (palette: string, prop: string): string => {
    const raw = declared(`[data-palette='${palette}']`, prop) ?? declared(':root', prop)
    expect(raw, `${palette} has no ${prop}`).toBeTruthy()
    const ref = /^var\((--[\w-]+)\)$/.exec(raw!)
    return ref ? resolve(palette, ref[1]) : raw!
  }

  const luminance = (hex: string): number => {
    const h = hex.replace('#', '')
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  }
  const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }

  it('finds every palette', () => {
    expect(palettes.length).toBe(16)
  })

  it("draws every palette's string at 3:1 or better against its paper", () => {
    // WCAG's floor for graphics. The root red is 6.5:1 on white and under
    // 2:1 on Blueprint's blue, where it all but vanished into the cork.
    for (const name of palettes) {
      const string = resolve(name, '--string')
      expect(string, `${name}'s string is not a colour`).toMatch(/^#[0-9a-f]{6}$/i)
      expect(
        contrast(string, resolve(name, '--paper')),
        `${name}'s string (${string}) against its paper`
      ).toBeGreaterThanOrEqual(3)
    }
  })

  it('prints portraits with the darker ink in the shadows, never as a negative', () => {
    for (const name of palettes) {
      const lo = resolve(name, '--duo-lo')
      const hi = resolve(name, '--duo-hi')
      expect(luminance(lo), `${name}'s portrait would print as a negative`).toBeLessThan(
        luminance(hi)
      )
      // And in the palette's own two inks, nothing else.
      expect([lo, hi].sort()).toEqual([resolve(name, '--ink'), resolve(name, '--paper')].sort())
    }
  })

  it('gives the one-colour screens no red, and makes their string glow', () => {
    for (const name of ['green', 'amber', 'vaporwave', 'virtualwyrm']) {
      expect(resolve(name, '--string')).toBe(resolve(name, '--ink'))
      expect(resolve(name, '--string-glow')).toContain('drop-shadow')
    }
  })

  it('draws the string, dash and glow from the variables, so a palette can restate them', () => {
    const path = ruleBody('.board-string path')
    expect(path).toContain('stroke: var(--this-string, var(--string))')
    expect(path).toContain('stroke-dasharray: var(--this-dash, var(--string-dash))')
    expect(path).toContain('filter: var(--string-glow)')
  })

  /** The other four colours (red is `--string`), and each colour's dash:
   *  its own where the palette gives one, else the palette's string dash. */
  const OTHERS = ['blue', 'orange', 'yellow', 'green']
  const dashOf = (palette: string, colour: string): string => {
    const own =
      declared(`[data-palette='${palette}']`, `--string-dash-${colour}`) ??
      declared(':root', `--string-dash-${colour}`)
    return own ?? resolve(palette, '--string-dash')
  }

  it('draws all five colours at 3:1 or better against every paper', () => {
    for (const name of palettes) {
      const paper = resolve(name, '--paper')
      for (const colour of OTHERS) {
        const hex = resolve(name, `--string-${colour}`)
        expect(hex, `${name}'s ${colour} is not a colour`).toMatch(/^#[0-9a-f]{6}$/i)
        expect(
          contrast(hex, paper),
          `${name}'s ${colour} string (${hex}) against its paper`
        ).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('tells the five apart on every palette: by colour, or where they are one ink, by dash', () => {
    for (const name of palettes) {
      const looks = [
        `${resolve(name, '--string')} ${resolve(name, '--string-dash')}`,
        ...OTHERS.map((c) => `${resolve(name, `--string-${c}`)} ${dashOf(name, c)}`)
      ]
      expect(new Set(looks).size, `${name}: ${looks.join(' | ')}`).toBe(5)
    }
  })

  it('gives the one-colour screens one ink for all five, so they differ only by dash', () => {
    for (const name of ['green', 'amber', 'vaporwave', 'virtualwyrm', 'blueprint']) {
      for (const c of OTHERS) expect(resolve(name, `--string-${c}`)).toBe(resolve(name, '--ink'))
    }
  })

  it('colours each string, its pins, its tag, the swatches and the stickers from the one class', () => {
    for (const c of ['red', ...OTHERS]) {
      const body = ruleBody(`.colour-${c}`)
      expect(body).toContain('--this-string:')
      expect(body).toContain('--this-dash:')
    }
    expect(ruleBody('.board-pin')).toContain('fill: var(--this-string, var(--string))')
    expect(ruleBody('.string-label')).toContain('var(--this-string, var(--string))')
    expect(ruleBody('.sticker-body')).toContain('fill: var(--this-string, var(--string))')
    expect(ruleBody('.swatch-string')).toContain('stroke-dasharray: var(--this-dash')
  })
})
