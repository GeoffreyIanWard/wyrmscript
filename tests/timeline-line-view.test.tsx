// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CARD_WIDTH_PX, TimelineLineView } from '../src/renderer/src/components/TimelineLineView'
import type { TimelineCard } from '../src/renderer/src/lib/timeline'

afterEach(cleanup)

/**
 * F-29: position on the line is a real coordinate, and dragging has to tell
 * a click (open the document) apart from a drag (reorder) using only the
 * pointer-event sequence — there is no separate "drag handle" element. These
 * tests drive that sequence directly rather than asserting on internal state.
 */

function card(id: string, title: string, order: number, date?: string): TimelineCard {
  return { id, title, order, date }
}

describe('TimelineLineView', () => {
  it('treats a small pointer movement as a click, opening the card', () => {
    const onOpen = vi.fn()
    const onReorder = vi.fn()
    render(
      <TimelineLineView
        cards={[card('a', 'Scene A', 0)]}
        onReorder={onReorder}
        onOpen={onOpen}
        onDateChange={vi.fn()}
      />
    )
    const marker = screen.getByRole('button', { name: 'Scene A' })
    fireEvent.pointerDown(marker, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(marker, { clientX: 102, pointerId: 1 })
    fireEvent.pointerUp(marker, { clientX: 102, pointerId: 1 })

    expect(onOpen).toHaveBeenCalledWith('a')
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('treats a movement past the click threshold as a drag, reordering instead', () => {
    const onOpen = vi.fn()
    const onReorder = vi.fn()
    render(
      <TimelineLineView
        cards={[card('a', 'Scene A', 0)]}
        onReorder={onReorder}
        onOpen={onOpen}
        onDateChange={vi.fn()}
      />
    )
    const marker = screen.getByRole('button', { name: 'Scene A' })
    fireEvent.pointerDown(marker, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(marker, { clientX: 240, pointerId: 1 }) // +140px = +1 unit at PX_PER_UNIT
    fireEvent.pointerUp(marker, { clientX: 240, pointerId: 1 })

    expect(onOpen).not.toHaveBeenCalled()
    expect(onReorder).toHaveBeenCalledWith('a', 1)
  })

  it('snaps the dropped position to the grid rather than the raw pixel delta', () => {
    const onReorder = vi.fn()
    render(
      <TimelineLineView
        cards={[card('a', 'Scene A', 0)]}
        onReorder={onReorder}
        onOpen={vi.fn()}
        onDateChange={vi.fn()}
      />
    )
    const marker = screen.getByRole('button', { name: 'Scene A' })
    fireEvent.pointerDown(marker, { clientX: 0, pointerId: 1 })
    // 170px at 140px/unit is 1.214 units — should snap to the nearest whole
    // grid line (1), not land at the raw fractional position.
    fireEvent.pointerMove(marker, { clientX: 170, pointerId: 1 })
    fireEvent.pointerUp(marker, { clientX: 170, pointerId: 1 })

    expect(onReorder).toHaveBeenCalledWith('a', 1)
  })

  it('opens the card on Enter when it has keyboard focus', () => {
    const onOpen = vi.fn()
    render(
      <TimelineLineView
        cards={[card('a', 'Scene A', 0)]}
        onReorder={vi.fn()}
        onOpen={onOpen}
        onDateChange={vi.fn()}
      />
    )
    fireEvent.keyDown(screen.getByRole('button', { name: 'Scene A' }), { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith('a')
  })

  it('does not open the card when Space is pressed while typing in its date field', () => {
    const onOpen = vi.fn()
    render(
      <TimelineLineView
        cards={[card('a', 'Scene A', 0)]}
        onReorder={vi.fn()}
        onOpen={onOpen}
        onDateChange={vi.fn()}
      />
    )
    fireEvent.keyDown(screen.getByPlaceholderText('+ date'), { key: ' ' })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('saves a typed date on blur, only when it changed', () => {
    const onDateChange = vi.fn()
    render(
      <TimelineLineView
        cards={[card('a', 'Scene A', 0, 'Spring')]}
        onReorder={vi.fn()}
        onOpen={vi.fn()}
        onDateChange={onDateChange}
      />
    )
    const input = screen.getByPlaceholderText('+ date')
    fireEvent.blur(input)
    expect(onDateChange).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'Autumn' } })
    fireEvent.blur(input)
    expect(onDateChange).toHaveBeenCalledWith('a', 'Autumn')
  })

  it('renders cards at the same grid position as one stack', () => {
    render(
      <TimelineLineView
        cards={[card('a', 'Scene A', 1), card('b', 'Scene B', 1), card('c', 'Scene C', 5)]}
        onReorder={vi.fn()}
        onOpen={vi.fn()}
        onDateChange={vi.fn()}
      />
    )
    expect(document.querySelectorAll('.timeline-line-cluster')).toHaveLength(2)
    expect(document.querySelectorAll('.timeline-line-card')).toHaveLength(3)
  })

  // Regression: with a finer grid than the card is wide, a drop landing one
  // grid step away from another card (close, but not the same position)
  // rendered as a partial overlap — unreadable as either a gap or a stack.
  it('never renders two different grid positions closer than a card width apart', () => {
    render(
      <TimelineLineView
        cards={[card('a', 'Scene A', 0), card('b', 'Scene B', 1)]}
        onReorder={vi.fn()}
        onOpen={vi.fn()}
        onDateChange={vi.fn()}
      />
    )
    const [left, right] = [...document.querySelectorAll('.timeline-line-cluster')].map((el) =>
      parseFloat((el as HTMLElement).style.left)
    )
    expect(right - left).toBeGreaterThanOrEqual(CARD_WIDTH_PX)
  })
})
