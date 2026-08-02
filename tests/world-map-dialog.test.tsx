// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Entity, MapPin } from '../src/shared/types'
import { useWyrm } from '../src/renderer/src/store'
import { WorldMapDialog } from '../src/renderer/src/components/WorldMapDialog'

/**
 * F-12: a location is "on the map" purely by having a MapPin — these tests
 * drive the real dialog against seeded store state, same shape as the
 * plotlines/character-graph dialog tests.
 */

function place(id: string, name: string): Entity {
  const now = new Date().toISOString()
  return { id, type: 'world', name, aliases: [], body: '', created: now, modified: now }
}

function pin(overrides: Partial<MapPin> = {}): MapPin {
  const now = new Date().toISOString()
  return {
    id: 'pin-1',
    entityId: 'a',
    x: 100,
    y: 60,
    created: now,
    modified: now,
    ...overrides
  }
}

async function renderDialog(
  entities: Entity[],
  mapPins: MapPin[],
  overrides: Partial<{
    setMapPin: ReturnType<typeof vi.fn>
    removeMapPin: ReturnType<typeof vi.fn>
    showEntity: ReturnType<typeof vi.fn>
  }> = {}
): Promise<void> {
  useWyrm.setState({
    entities,
    mapPins: [],
    loadMapPins: async () => {
      useWyrm.setState({ mapPins })
    },
    setMapPin: overrides.setMapPin ?? vi.fn(async () => {}),
    removeMapPin: overrides.removeMapPin ?? vi.fn(async () => {}),
    showEntity: overrides.showEntity ?? vi.fn()
  })
  await act(async () => {
    render(<WorldMapDialog onClose={() => {}} />)
  })
}

afterEach(() => {
  cleanup()
  useWyrm.setState({ entities: [], mapPins: [] })
})

describe('WorldMapDialog', () => {
  it('shows an empty state when there are no locations', async () => {
    await renderDialog([], [])
    expect(screen.getByText(/No locations yet/)).toBeTruthy()
  })

  it('lists an unplaced location under UNPLACED, not PLACED', async () => {
    await renderDialog([place('a', 'Harrowgate')], [])
    expect(screen.getByText('UNPLACED')).toBeTruthy()
    expect(screen.queryByText('PLACED')).toBeNull()
    expect(screen.getByText('Harrowgate')).toBeTruthy()
  })

  it('places a location on the map when clicked', async () => {
    const setMapPin = vi.fn(async () => {})
    await renderDialog([place('a', 'Harrowgate')], [], { setMapPin })
    fireEvent.click(screen.getByText('+ Place on Map'))
    expect(setMapPin).toHaveBeenCalledWith('a', expect.any(Number), expect.any(Number))
  })

  it('renders a pin for a placed location and moves it out of UNPLACED', async () => {
    await renderDialog([place('a', 'Harrowgate')], [pin({ entityId: 'a' })])
    expect(screen.queryByText('UNPLACED')).toBeNull()
    expect(screen.getByText('PLACED')).toBeTruthy()
    expect(document.querySelectorAll('.world-map-pin')).toHaveLength(1)
  })

  it('opens the location and closes the dialog on a small pointer movement (a click)', async () => {
    const showEntity = vi.fn()
    await renderDialog([place('a', 'Harrowgate')], [pin({ entityId: 'a' })], { showEntity })
    const marker = screen.getByRole('button', { name: /Harrowgate/ })
    fireEvent.pointerDown(marker, { clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(marker, { clientX: 101, clientY: 101, pointerId: 1 })
    fireEvent.pointerUp(marker, { clientX: 101, clientY: 101, pointerId: 1 })
    expect(showEntity).toHaveBeenCalledWith('a')
  })

  it('moves the pin instead of opening the location on a real drag', async () => {
    const setMapPin = vi.fn(async () => {})
    const showEntity = vi.fn()
    await renderDialog([place('a', 'Harrowgate')], [pin({ entityId: 'a', x: 100, y: 60 })], {
      setMapPin,
      showEntity
    })
    const marker = screen.getByRole('button', { name: /Harrowgate/ })
    fireEvent.pointerDown(marker, { clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(marker, { clientX: 150, clientY: 130, pointerId: 1 })
    fireEvent.pointerUp(marker, { clientX: 150, clientY: 130, pointerId: 1 })
    expect(showEntity).not.toHaveBeenCalled()
    expect(setMapPin).toHaveBeenCalledWith('a', 150, 90)
  })

  it('opens the location on Enter when the pin has keyboard focus', async () => {
    const showEntity = vi.fn()
    await renderDialog([place('a', 'Harrowgate')], [pin({ entityId: 'a' })], { showEntity })
    fireEvent.keyDown(screen.getByRole('button', { name: /Harrowgate/ }), { key: 'Enter' })
    expect(showEntity).toHaveBeenCalledWith('a')
  })

  it('removes a pin from the PLACED list', async () => {
    const removeMapPin = vi.fn(async () => {})
    await renderDialog([place('a', 'Harrowgate')], [pin({ entityId: 'a' })], { removeMapPin })
    fireEvent.click(screen.getByText('Remove'))
    expect(removeMapPin).toHaveBeenCalled()
  })
})
