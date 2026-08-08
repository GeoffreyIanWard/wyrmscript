// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { HalftoneRuler } from '../src/renderer/src/components/HalftoneRuler'

/**
 * F-22: the ruler's numbers have to track the actual configured line width
 * (F-06), not just decorate near it — these assert the tick set and their
 * `ch` positions rather than pixels, since `ch` is what makes the ruler
 * align with real character columns regardless of font size.
 */

function ticks(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.halftone-ruler-tick')].map((el) => el.textContent ?? '')
}

describe('HalftoneRuler', () => {
  it('places a tick every 10 characters, starting at 0', () => {
    const { container } = render(<HalftoneRuler measure={62} />)

    expect(ticks(container)).toEqual(['0', '10', '20', '30', '40', '50', '60'])
  })

  it('stops at the last multiple of 10 within the measure, not past it', () => {
    const { container } = render(<HalftoneRuler measure={45} />)

    expect(ticks(container)).toEqual(['0', '10', '20', '30', '40'])
  })

  it('positions each tick at its own character column in ch units', () => {
    const { container } = render(<HalftoneRuler measure={62} />)
    const tick30 = [...container.querySelectorAll('.halftone-ruler-tick')].find(
      (el) => el.textContent === '30'
    ) as HTMLElement

    expect(tick30.style.left).toBe('30ch')
  })

  it('sizes the track to the full measure, matching .page itself', () => {
    const { container } = render(<HalftoneRuler measure={80} />)
    const track = container.querySelector('.halftone-ruler-track') as HTMLElement

    expect(track.style.width).toBe('80ch')
  })
})
