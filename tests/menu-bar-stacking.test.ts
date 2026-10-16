import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Regression for a real bug: clicking a menu-bar dropdown item did nothing
 * whenever a `.dialog-overlay` was also present (Welcome's included), while
 * the item's own keyboard shortcut worked fine — the classic "click is
 * silently swallowed" symptom. `.dialog-overlay` is confined to `.desktop`'s
 * box, which starts right under the 30px-tall menu bar, so the menu *titles*
 * (y<30) stayed clickable throughout — only the open dropdown's items, which
 * extend down into that box, were dead. `.menu-drop`'s own z-index (200) is
 * scoped inside `.menu-bar`'s stacking context and never faces the overlay
 * directly, so `.menu-bar` has to outrank every `.dialog-overlay` itself.
 *
 * jsdom does not lay out or hit-test real pixels, so this can't be
 * reproduced by clicking in a jsdom test — it was only caught by driving a
 * real click in the browser preview and checking `elementFromPoint`. What
 * *can* be pinned down is the invariant the fix depends on, straight from
 * the source CSS, so a future edit that lowers `.menu-bar` back down (or
 * raises some new overlay above it) fails a test instead of failing silently.
 */

const css = readFileSync(join(__dirname, '../src/renderer/src/styles/retro.css'), 'utf8')

function zIndexOf(selector: string): number {
  const block = new RegExp(`${selector.replace(/[.[\]]/g, '\\$&')}\\s*\\{[^}]*\\}`).exec(css)
  if (!block) throw new Error(`No rule found for ${selector}`)
  const z = /z-index:\s*(-?\d+)/.exec(block[0])
  if (!z) throw new Error(`${selector} has no z-index`)
  return Number(z[1])
}

describe('menu bar vs. dialog-overlay stacking', () => {
  it('.menu-bar outranks every .dialog-overlay, so an open dropdown stays clickable', () => {
    expect(zIndexOf('.menu-bar')).toBeGreaterThan(zIndexOf('.dialog-overlay'))
  })

  it('.menu-overlay (the menu’s own click-away backdrop) still stays below .menu-bar', () => {
    expect(zIndexOf('.menu-overlay')).toBeLessThan(zIndexOf('.menu-bar'))
  })
})

/**
 * Regression for the third button on Welcome (F-43's "From GitHub…"), which
 * hung off the *left* edge of its own dialog.
 *
 * `.dialog-buttons` is justified to the right, so a row of buttons wider than
 * its dialog overflows backwards, out of the left edge, rather than being
 * clipped at the right where it would be obvious. Button widths depend on the
 * palette's chrome face — sixteen of them, some much wider than the default —
 * so no fixed dialog width can be relied on to prevent it. Wrapping is what
 * makes it structurally impossible.
 *
 * jsdom has no layout engine, so this reads the rule rather than measuring
 * the result; the sixteen palettes were measured in the browser.
 */
describe('a dialog’s button row', () => {
  it('wraps rather than spilling out of the dialog', () => {
    const css = readFileSync(join('src/renderer/src/styles/retro.css'), 'utf8')
    // Anchored to the start of a line: `.dialog > .dialog-buttons` is a
    // different rule that appears first, and matching it would have passed
    // this test against the bug.
    const match = /^\.dialog-buttons \{([^}]*)\}/m.exec(css)
    expect(match, '.dialog-buttons rule not found').toBeTruthy()
    expect(match?.[1]).toContain('flex-wrap: wrap')
  })
})
