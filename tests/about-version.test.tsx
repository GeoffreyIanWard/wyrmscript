// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AboutDialog } from '../src/renderer/src/components/Dialogs'

/**
 * The About box used to carry the version as a hardcoded string, and it
 * drifted: it still read 0.1.0 through the whole of v0.2.0, because bumping
 * `package.json` to cut a release gives nobody a reason to open Dialogs.tsx.
 * The number is now injected at build time from `package.json`, and this is
 * what keeps the two honest — a release that forgets the About box is no
 * longer possible, and a well-meaning "let's just inline it" gets caught.
 */

const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8')) as {
  version: string
}

describe('about box', () => {
  it('shows the version from package.json', () => {
    render(<AboutDialog onClose={() => {}} />)

    expect(screen.getByText(`WYRMSTAR ${pkg.version}`)).toBeTruthy()
  })

  it('does not hardcode a version number in the component source', () => {
    // The injected constant is the only acceptable source; a literal here is
    // the exact bug this guards.
    const source = readFileSync(
      join(__dirname, '../src/renderer/src/components/Dialogs.tsx'),
      'utf8'
    )
    const aboutBody = source.slice(source.indexOf('export function AboutDialog'))

    expect(aboutBody).toContain('__APP_VERSION__')
    expect(aboutBody).not.toMatch(/WYRMSTAR \d/)
  })
})
