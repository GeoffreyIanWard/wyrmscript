// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { MapSheet, ProjectData } from '../src/shared/types'
import { mapOf, storedMapId, WORLD_MAP } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm, __disposeAll } from '../src/renderer/src/store'
import { WorldMap } from '../src/renderer/src/components/WorldMap'
import { Corkboard } from '../src/renderer/src/components/Corkboard'
import { CompileDialog } from '../src/renderer/src/components/CompileDialog'
import {
  contentsOf,
  freshMapName,
  mapNameProblem,
  onMap,
  sheetOf,
  sheetsOf,
  WORLD_NAME,
  withNewSheet,
  withoutSheet,
  withSheet
} from '../src/renderer/src/lib/mapSheets'
import { boardCards, mapCards, stackLayout } from '../src/renderer/src/lib/corkboard'

/**
 * F-12: several maps — folder tabs along the top of the map view, each map
 * with its own extent, scale, shapes, marks and pins (a place can be on any
 * number of them), Clear Map and Delete Map (confirmed, and checkpointed
 * first), and maps on the corkboard as minimap cards.
 *
 * Driven against the in-memory demo project, which keeps its records between
 * tests: every test starts from a map-free World (see `reset`).
 */

const base: ProjectData = { version: 1, title: 'T', binder: [], trash: [] }
const sheet = (id: string, name: string, extra: Partial<MapSheet> = {}): MapSheet => ({
  id,
  name,
  ...extra
})
const bounds = { x: 0, y: 0, width: 1000, height: 800 }
const scale = {
  pixels: 100,
  distance: 20,
  unit: 'miles',
  perDay: { foot: 20, horse: 40, ship: 100 }
}

/* ---------- the record's map ---------- */

describe('which map a record is on', () => {
  it('is World when it names none, or names World, and never writes World', () => {
    expect(mapOf({})).toBe(WORLD_MAP)
    expect(mapOf({ map: WORLD_MAP })).toBe(WORLD_MAP)
    expect(mapOf({ map: 'abc' })).toBe('abc')
    expect(storedMapId(WORLD_MAP)).toBeUndefined()
    expect(storedMapId('')).toBeUndefined()
    expect(storedMapId(7)).toBeUndefined()
    expect(storedMapId('abc')).toBe('abc')
  })
})

/* ---------- the sheets ---------- */

describe('the maps, as sheets', () => {
  it('reads a project from before there were several maps as World alone', () => {
    const data = { ...base, mapBounds: bounds, mapScale: scale }
    expect(sheetsOf(data)).toEqual([{ id: WORLD_MAP, name: WORLD_NAME, bounds, scale }])
    // An unknown id is World: the view always has a map to show.
    expect(sheetOf(data, 'gone').id).toBe(WORLD_MAP)
  })

  it('keeps World’s extent and scale in their own fields, and only the rest in its entry', () => {
    let data = withSheet(base, WORLD_MAP, { bounds, scale })
    expect(data.mapBounds).toEqual(bounds)
    expect(data.mapScale).toEqual(scale)
    expect(data.maps).toBeUndefined()
    data = withSheet(data, WORLD_MAP, { name: 'The Known World', onBoard: true })
    expect(data.maps).toEqual([{ id: WORLD_MAP, name: 'The Known World', onBoard: true }])
    expect(sheetsOf(data)[0]).toMatchObject({ name: 'The Known World', onBoard: true, bounds })
    // Taken back to saying nothing, the entry goes.
    data = withSheet(data, WORLD_MAP, { name: WORLD_NAME, onBoard: undefined })
    expect(data.maps).toBeUndefined()
    // A cleared scale is gone, not kept as undefined.
    data = withSheet(data, WORLD_MAP, { scale: undefined })
    expect('mapScale' in data).toBe(false)
  })

  it('adds, changes and removes the other maps, in tab order, never World', () => {
    let data = withNewSheet(base, sheet('a', 'Port Cray'))
    data = withNewSheet(data, sheet('b', 'The Fens'))
    expect(sheetsOf(data).map((m) => m.name)).toEqual(['World', 'Port Cray', 'The Fens'])
    data = withSheet(data, 'a', { bounds, boardX: 3 })
    expect(sheetOf(data, 'a')).toEqual({ id: 'a', name: 'Port Cray', bounds, boardX: 3 })
    data = withSheet(data, 'a', { boardX: undefined })
    expect('boardX' in sheetOf(data, 'a')).toBe(false)
    expect(withSheet(data, 'nope', { name: 'x' })).toBe(data)
    expect(withoutSheet(data, WORLD_MAP)).toBe(data)
    data = withoutSheet(data, 'a')
    expect(sheetsOf(data).map((m) => m.id)).toEqual([WORLD_MAP, 'b'])
    expect(withoutSheet(data, 'b').maps).toBeUndefined()
  })

  it('says what is wrong with a name, and finds a fresh one', () => {
    const data = withNewSheet(base, sheet('a', 'Port Cray'))
    expect(mapNameProblem(data, '  ')).toBe('A map needs a name.')
    expect(mapNameProblem(data, 'port cray')).toBe('There is already a map called “Port Cray”.')
    expect(mapNameProblem(data, 'world')).toBe('There is already a map called “World”.')
    expect(mapNameProblem(data, 'Port Cray', 'a')).toBeNull()
    expect(mapNameProblem(data, 'x'.repeat(41))).toMatch(/40 letters/)
    expect(freshMapName(data)).toBe('Map 2')
    expect(freshMapName(withNewSheet(data, sheet('b', 'Map 2')))).toBe('Map 3')
  })

  it('says what is on a map as a writer would', () => {
    expect(contentsOf({ shapes: 0, marks: 0, places: 0 })).toBeNull()
    expect(contentsOf({ shapes: 1, marks: 0, places: 0 })).toBe('1 shape')
    expect(contentsOf({ shapes: 3, marks: 1, places: 0 })).toBe('3 shapes and 1 mark')
    expect(contentsOf({ shapes: 3, marks: 12, places: 2 })).toBe('3 shapes, 12 marks and 2 places')
    expect(onMap([{ id: 1 }, { id: 2, map: 'a' }], WORLD_MAP)).toEqual([{ id: 1 }])
  })
})

/* ---------- the board's cards ---------- */

describe('maps as cards', () => {
  it('puts up only the maps put on the board, as map cards in their own pile', () => {
    const sheets = [
      sheet(WORLD_MAP, 'World'),
      sheet('a', 'Port Cray', { onBoard: true, boardX: 5, boardY: 6 })
    ]
    expect(mapCards(sheets)).toEqual([
      expect.objectContaining({ kind: 'map', id: 'a', title: 'Port Cray', boardX: 5, boardY: 6 })
    ])
    const cards = boardCards([], [], [], sheets)
    expect(cards.map((c) => c.kind)).toEqual(['map'])
    expect(stackLayout(cards).get('a')).toEqual({ x: 0, y: 0 })
  })
})

/* ---------- the store, against the demo project ---------- */

let demoPath = ''

async function reset(): Promise<void> {
  demoPath ||= (await api.getLastProjectPath())!
  const info = (await api.openProjectPath(demoPath))!
  delete info.data.maps
  delete info.data.mapBounds
  delete info.data.mapScale
  await api.saveProject(demoPath, info.data)
  for (const s of await api.listMapShapes(demoPath)) await api.deleteMapShape(demoPath, s.id)
  for (const m of await api.listMapMarks(demoPath)) await api.deleteMapMark(demoPath, m.id)
  for (const p of await api.listMapPins(demoPath)) if (p.map) await api.deleteMapPin(demoPath, p.id)
  for (const e of await api.listEntities(demoPath))
    if (e.onBoard) await api.writeEntity(demoPath, { ...e, onBoard: undefined })
  // The demo's one pin, on World: a test that clears World takes it.
  const harrow = (await api.listEntities(demoPath)).find((e) => e.name === 'Harrowgate')!
  if (!(await api.listMapPins(demoPath)).some((p) => p.entityId === harrow.id))
    await api.writeMapPin(demoPath, {
      id: 'demo-pin',
      entityId: harrow.id,
      x: 180,
      y: 120,
      created: '',
      modified: ''
    })
  await act(async () => {
    await useWyrm.getState().openRecentProject(demoPath)
  })
  useWyrm.setState({ activeId: null, activeDoc: null, mapId: WORLD_MAP })
  await act(async () => {
    await Promise.all([
      useWyrm.getState().loadMapPins(),
      useWyrm.getState().loadMapShapes(),
      useWyrm.getState().loadMapMarks()
    ])
  })
}

const store = (): ReturnType<typeof useWyrm.getState> => useWyrm.getState()
const tri = [
  { x: 10, y: 10 },
  { x: 90, y: 10 },
  { x: 50, y: 80 }
]

beforeEach(async () => {
  vi.restoreAllMocks()
  await reset()
})

afterEach(async () => {
  cleanup()
  await act(async () => {
    __disposeAll?.()
  })
})

describe('drawing on a map', () => {
  it('puts what is drawn, stamped and placed on the map in view, and its extent and scale', async () => {
    const id = (await store().addMap('Port Cray'))!
    expect(store().mapId).toBe(id)
    const shape = await store().createMapShape('land', tri)
    const mark = await store().createMapMark('castle', 5, 5)
    const harrow = store().mapPins[0].entityId
    await store().setMapPin(harrow, 40, 40)
    await store().setMapBounds(bounds)
    await store().setMapScale(scale)
    expect(shape?.map).toBe(id)
    expect(mark?.map).toBe(id)
    // As read back from "disk".
    expect((await api.listMapShapes(demoPath)).find((s) => s.id === shape!.id)?.map).toBe(id)
    // A place on two maps has two pins; World's did not move.
    const pins = (await api.listMapPins(demoPath)).filter((p) => p.entityId === harrow)
    expect(pins.map((p) => [mapOf(p), p.x])).toEqual(
      expect.arrayContaining([
        [WORLD_MAP, 180],
        [id, 40]
      ])
    )
    expect(sheetOf(store().project!.data, id)).toMatchObject({ bounds, scale })
    expect(store().project!.data.mapBounds).toBeUndefined()
    // Back on World, the same calls are World's, and write no map.
    store().chooseMap(WORLD_MAP)
    const worldShape = await store().createMapShape('land', tri)
    expect(worldShape && 'map' in worldShape).toBe(false)
  })

  it('chooses World for a map that is not there', async () => {
    store().chooseMap('gone')
    expect(store().mapId).toBe(WORLD_MAP)
  })
})

describe('clearing and deleting a map', () => {
  it('clears only that map, after a checkpoint, keeping its size and scale', async () => {
    const id = (await store().addMap('Port Cray'))!
    await store().createMapShape('land', tri)
    await store().createMapMark('castle', 5, 5)
    await store().setMapBounds(bounds)
    store().chooseMap(WORLD_MAP)
    const worldShape = (await store().createMapShape('land', tri))!
    const commit = vi.spyOn(api, 'commit')
    const del = vi.spyOn(api, 'deleteMapShape')
    await act(async () => {
      await store().clearMap(demoPath, id)
    })
    expect(commit).toHaveBeenCalledWith(demoPath, 'Auto: before clearing a map')
    expect(commit.mock.invocationCallOrder[0]).toBeLessThan(del.mock.invocationCallOrder[0])
    expect(onMap(await api.listMapShapes(demoPath), id)).toEqual([])
    expect(onMap(await api.listMapMarks(demoPath), id)).toEqual([])
    expect(store().mapShapes.map((s) => s.id)).toEqual([worldShape.id])
    expect(sheetOf(store().project!.data, id).bounds).toEqual(bounds)
    // The places themselves are untouched.
    expect((await api.listEntities(demoPath)).length).toBe(store().entities.length)
  })

  it('deletes a map and everything on it, and goes back to World', async () => {
    const id = (await store().addMap('Port Cray'))!
    await store().createMapShape('land', tri)
    await store().setMapPin(store().mapPins[0].entityId, 1, 1)
    const commit = vi.spyOn(api, 'commit')
    await act(async () => {
      await store().deleteMap(demoPath, id)
    })
    expect(commit).toHaveBeenCalledWith(demoPath, 'Auto: before deleting a map')
    expect(sheetsOf(store().project!.data).map((m) => m.id)).toEqual([WORLD_MAP])
    expect(store().mapId).toBe(WORLD_MAP)
    expect(onMap(await api.listMapPins(demoPath), id)).toEqual([])
    expect(onMap(await api.listMapPins(demoPath), WORLD_MAP)).toHaveLength(1)
    // World is cleared, never deleted.
    await store().deleteMap(demoPath, WORLD_MAP)
    expect(sheetsOf(store().project!.data)).toHaveLength(1)
  })

  it('lands its removals in the project it was asked of, whichever is in front after', async () => {
    const id = (await store().addMap('Port Cray'))!
    await store().createMapShape('land', tri)
    // Another project comes to the front while the clear is under way.
    const parkedSelf = { ...store() }
    const clear = store().clearMap(demoPath, id)
    useWyrm.setState({
      project: { path: '/elsewhere', data: base },
      parked: { [demoPath]: parkedSelf as never }
    })
    await act(async () => {
      await clear
    })
    expect(store().parked[demoPath].mapShapes.filter((s) => mapOf(s) === id)).toEqual([])
  })

  it('resets a deleted map in a project swapped out mid-delete', async () => {
    const id = (await store().addMap('Port Cray'))!
    const parkedSelf = { ...store() }
    const del = store().deleteMap(demoPath, id)
    useWyrm.setState({
      project: { path: '/elsewhere', data: base },
      mapId: WORLD_MAP,
      parked: { [demoPath]: parkedSelf as never }
    })
    await act(async () => {
      await del
    })
    expect(store().parked[demoPath].mapId).toBe(WORLD_MAP)
    expect(sheetsOf(store().parked[demoPath].project!.data).map((m) => m.id)).toEqual([WORLD_MAP])
  })

  it('waits for a write already queued for a record before deleting it, so none comes back', async () => {
    const id = (await store().addMap('Port Cray'))!
    const shape = (await store().createMapShape('land', tri))!
    // The move is still being written when the clear comes.
    const write = api.writeMapShape.bind(api)
    vi.spyOn(api, 'writeMapShape').mockImplementation(async (path, sh) => {
      await new Promise((r) => setTimeout(r, 30))
      await write(path, sh)
    })
    const moved = store().updateMapShapeAt(demoPath, shape.id, [...tri, { x: 5, y: 5 }])
    const clear = store().clearMap(demoPath, id)
    await act(async () => {
      await Promise.all([moved, clear])
    })
    expect(await api.listMapShapes(demoPath)).toEqual([])
  })
})

describe('a map id that names no map', () => {
  it('is World again when another project is opened', async () => {
    useWyrm.setState({ mapId: 'from-another-novel' })
    await act(async () => {
      await store().openRecentProject(demoPath)
    })
    expect(store().mapId).toBe(WORLD_MAP)
  })

  it('is World again when a sync takes the map away', async () => {
    const id = (await store().addMap('Port Cray'))!
    // The other device deleted it; the merge brings that here.
    const info = (await api.openProjectPath(demoPath))!
    delete info.data.maps
    await api.saveProject(demoPath, info.data)
    vi.spyOn(api, 'resolveSyncConflicts').mockResolvedValue({ status: 'merged' } as never)
    await act(async () => {
      await store().resolveConflicts([])
    })
    expect(store().mapId).toBe(WORLD_MAP)
    expect(id).not.toBe(WORLD_MAP)
  })

  it('puts whatever is made on World, never on a map that is not there', async () => {
    useWyrm.setState({ mapId: 'gone' })
    const shape = (await store().createMapShape('land', tri))!
    const mark = (await store().createMapMark('town', 1, 1))!
    await store().setMapPin(store().entities.find((e) => e.type === 'world')!.id, 2, 2)
    expect('map' in shape).toBe(false)
    expect('map' in mark).toBe(false)
    for (const p of await api.listMapPins(demoPath)) expect('map' in p).toBe(false)
    // And World's extent and scale take what is set.
    await store().setMapBounds(bounds)
    expect(store().project!.data.mapBounds).toEqual(bounds)
  })
})

describe('records whose map is gone', () => {
  it('are shown, counted and cleared on World, never on no tab at all', async () => {
    await api.writeMapShape(demoPath, {
      id: 'lost1',
      kind: 'land',
      points: tri,
      map: 'lost',
      created: '',
      modified: ''
    })
    await act(async () => {
      await store().loadMapShapes()
    })
    await renderMap()
    expect(document.querySelector('[data-shape="lost1"]')).not.toBeNull()
    await click(screen.getByRole('button', { name: 'Clear Map…' }))
    expect(screen.getByRole('alertdialog').textContent).toMatch(/1 shape/)
    await click(screen.getByRole('button', { name: 'Clear Map' }))
    await waitFor(() => expect(document.querySelector('[data-shape="lost1"]')).toBeNull())
    expect(await api.listMapShapes(demoPath)).toEqual([])
  })
})

describe('a place deleted', () => {
  it('takes its pin off every map it was on', async () => {
    const harrow = store().mapPins[0].entityId
    await store().addMap('Port Cray')
    await store().setMapPin(harrow, 9, 9)
    const entity = store().entities.find((e) => e.id === harrow)!
    // The map layers in the store are stale: only disk knows both pins.
    useWyrm.setState({ mapPins: [] })
    await act(async () => {
      await store().deleteEntity(entity)
    })
    expect((await api.listMapPins(demoPath)).filter((p) => p.entityId === harrow)).toEqual([])
    await api.writeEntity(demoPath, entity)
  })
})

describe('the map layers read', () => {
  it('land in the project they were read for, whichever is in front after', async () => {
    const own = { ...store() }
    const load = store().loadMapPins()
    useWyrm.setState({
      project: { path: '/elsewhere', data: base },
      mapPins: [],
      parked: { [demoPath]: own as never }
    })
    await act(async () => {
      await load
    })
    expect(store().mapPins).toEqual([])
    expect(store().parked[demoPath].mapPins.length).toBeGreaterThan(0)
  })

  it('keep the map in view with each project (it is part of the project’s slice)', async () => {
    const { SLICE_KEYS } = await import('../src/renderer/src/store')
    expect(SLICE_KEYS).toContain('mapId')
  })

  it('are made on the map in view in the project written to, not the one in front', async () => {
    const id = (await store().addMap('Port Cray'))!
    const own = { ...store() }
    useWyrm.setState({
      project: { path: '/elsewhere', data: base },
      mapId: WORLD_MAP,
      parked: { [demoPath]: own as never }
    })
    const mark = await store().createMapMarkAt(demoPath, 'town', 3, 3)
    expect(mark?.map).toBe(id)
    expect((await api.listMapMarks(demoPath)).find((m) => m.id === mark!.id)?.map).toBe(id)
  })

  it('draw the chosen map, and only it, into a picture', async () => {
    const id = (await store().addMap('Port Cray'))!
    await store().createMapShape('land', [
      { x: 900, y: 900 },
      { x: 990, y: 900 },
      { x: 950, y: 990 }
    ])
    store().chooseMap(WORLD_MAP)
    await store().createMapShape('land', tri)
    const { DEFAULT_PICTURE_OPTIONS } = await import('../src/renderer/src/lib/mapPicture')
    const cray = (await store().mapPicture(DEFAULT_PICTURE_OPTIONS, id))!
    const world = (await store().mapPicture(DEFAULT_PICTURE_OPTIONS, WORLD_MAP))!
    expect(cray.svg).not.toBe(world.svg)
    // Trimmed to what is drawn: Port Cray's island alone, not World's too.
    expect(cray.width).toBeLessThan(300)
    // Printed at the front, the map chosen is the one drawn.
    const printHtml = vi.spyOn(api, 'printHtml').mockResolvedValue(true)
    vi.spyOn(api, 'commit').mockResolvedValue(null as never)
    await store().printManuscript({
      ...(await import('../src/renderer/src/lib/compile')).DEFAULT_COMPILE_OPTIONS,
      format: 'pdf',
      frontispiece: true,
      frontispieceMap: id
    })
    const b64 = /base64,([^"]+)"/.exec(printHtml.mock.calls[0][0] as string)![1]
    expect(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))).toBe(
      cray.svg
    )
  })
})

/* ---------- the tabs ---------- */

async function renderMap(): Promise<void> {
  useWyrm.setState({ mainView: { kind: 'map' } })
  await act(async () => {
    render(<WorldMap />)
  })
}
const tabs = (): string[] =>
  screen
    .getAllByRole('tab')
    .map((t) => t.textContent + (t.getAttribute('aria-selected') === 'true' ? '*' : ''))
const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5))
  })
}
const click = async (el: Element): Promise<void> => {
  await act(async () => {
    fireEvent.click(el)
  })
}

describe('the tabs', () => {
  it('shows World alone until there are other maps', async () => {
    await renderMap()
    expect(tabs()).toEqual(['World*'])
    expect(screen.queryByRole('button', { name: /Delete Map/ })).toBeNull()
  })

  it('makes a new map, offers it a name at once, and keeps a better one', async () => {
    await renderMap()
    await click(screen.getByRole('button', { name: 'New map' }))
    await settle()
    expect(tabs()).toEqual(['World', 'Map 2*'])
    const field = screen.getByRole('textbox', { name: 'Name of the map' })
    expect(document.activeElement).toBe(field)
    // A name that will not do is said, not refused silently.
    fireEvent.change(field, { target: { value: 'world' } })
    await click(screen.getByRole('button', { name: 'Rename' }))
    expect(screen.getByRole('alert').textContent).toBe('There is already a map called “World”.')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(field, { target: { value: 'Port Cray' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
      fireEvent.keyUp(document.body, { key: 'Enter' })
    })
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Port Cray' }))
    )
    expect(tabs()).toEqual(['World', 'Port Cray*'])
  })

  it('keeps Esc to the name field, and keeps the old name', async () => {
    await store().addMap('Port Cray')
    await renderMap()
    const back = vi.fn()
    window.addEventListener('keydown', back)
    await click(screen.getByRole('button', { name: 'Rename…' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Elsewhere' } })
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
      fireEvent.keyUp(document.body, { key: 'Escape' })
    })
    window.removeEventListener('keydown', back)
    expect(back).not.toHaveBeenCalled()
    expect(tabs()).toEqual(['World', 'Port Cray*'])
  })

  it('moves along the tabs with the arrows, choosing as it goes, focus staying on the row', async () => {
    await store().addMap('Port Cray')
    await store().addMap('The Fens')
    store().chooseMap(WORLD_MAP)
    await renderMap()
    const world = screen.getByRole('tab', { name: 'World' })
    world.focus()
    await act(async () => {
      fireEvent.keyDown(world, { key: 'ArrowRight' })
      fireEvent.keyUp(document.body, { key: 'ArrowRight' })
    })
    await settle()
    expect(tabs()).toEqual(['World', 'Port Cray*', 'The Fens'])
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Port Cray' }))
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: 'End' })
      fireEvent.keyUp(document.body, { key: 'End' })
    })
    await settle()
    expect(tabs()).toEqual(['World', 'Port Cray', 'The Fens*'])
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
      fireEvent.keyUp(document.body, { key: 'ArrowRight' })
    })
    expect(tabs()).toEqual(['World*', 'Port Cray', 'The Fens'])
    // Roving: only the chosen tab is in the Tab order.
    expect(screen.getAllByRole('tab').map((t) => t.tabIndex)).toEqual([0, -1, -1])
  })

  it('draws only the map in view, and starts each map afresh', async () => {
    const id = (await store().addMap('Port Cray'))!
    await store().createMapShape('land', tri)
    store().chooseMap(WORLD_MAP)
    await renderMap()
    expect(document.querySelectorAll('[data-shape]')).toHaveLength(0)
    // A route half-measured on World is not carried to Port Cray.
    await click(screen.getByRole('button', { name: 'Measure' }))
    await click(screen.getByRole('tab', { name: 'Port Cray' }))
    expect(store().mapId).toBe(id)
    expect(document.querySelectorAll('[data-shape]')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Hand' }).getAttribute('aria-pressed')).toBe('true')
    // Its places are its own: Harrowgate is on World, not here.
    expect(screen.getByText('NOT ON THE MAP').parentElement?.textContent).toMatch(/Harrowgate/)
  })

  it('keeps where each map was being looked at when the tabs are flipped', async () => {
    await store().addMap('Port Cray')
    store().chooseMap(WORLD_MAP)
    await renderMap()
    await click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(document.querySelector('.map-zoom')?.textContent).toBe('200%')
    await click(screen.getByRole('tab', { name: 'Port Cray' }))
    expect(document.querySelector('.map-zoom')?.textContent).toBe('100%')
    await click(screen.getByRole('tab', { name: 'World' }))
    expect(document.querySelector('.map-zoom')?.textContent).toBe('200%')
  })

  it('comes back from a place to the map it was opened on', async () => {
    const id = (await store().addMap('Port Cray'))!
    store().chooseMap(WORLD_MAP)
    useWyrm.setState({ mainView: { kind: 'map', mapId: id, scrollLeft: 0, scrollTop: 0 } })
    await act(async () => {
      render(<WorldMap />)
    })
    expect(tabs()).toEqual(['World', 'Port Cray*'])
    expect(store().mapId).toBe(id)
  })

  it('gives focus back to Rename… when that is what opened the name', async () => {
    await store().addMap('Port Cray')
    await renderMap()
    await click(screen.getByRole('button', { name: 'Rename…' }))
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
      fireEvent.keyUp(document.body, { key: 'Escape' })
    })
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Rename…' }))
    )
  })

  it('is a tablist of tabs alone, labelling the map below, each with its whole name', async () => {
    await store().addMap('The Northern Reaches of Asterholm, east')
    await renderMap()
    const list = screen.getByRole('tablist', { name: 'Maps' })
    expect([...list.children].every((c) => c.getAttribute('role') === 'tab')).toBe(true)
    const tab = screen.getByRole('tab', { name: 'The Northern Reaches of Asterholm, east' })
    expect(tab.getAttribute('title')).toBe('The Northern Reaches of Asterholm, east')
    const panel = screen.getByRole('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBe(tab.id)
    expect(tab.getAttribute('aria-controls')).toBe(panel.id)
  })

  it('confirms a clear, says what goes, and leaves Cancel the safe default', async () => {
    await store().addMap('Port Cray')
    await store().createMapShape('land', tri)
    await store().createMapMark('castle', 1, 1)
    await renderMap()
    const clear = vi.spyOn(store(), 'clearMap')
    await click(screen.getByRole('button', { name: 'Clear Map…' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Clear Port Cray' })
    expect(dialog.textContent).toMatch(/its 1 shape and 1 mark\?/)
    expect(dialog.textContent).toMatch(/checkpoint is made first/)
    expect(document.activeElement?.textContent).toBe('Cancel')
    // Drawn as the default, too: the ring says what Return does.
    expect(document.activeElement?.classList.contains('default')).toBe(true)
    expect(screen.getByRole('button', { name: 'Clear Map' }).classList.contains('default')).toBe(
      false
    )
    await click(screen.getByRole('button', { name: 'Cancel' }))
    expect(clear).not.toHaveBeenCalled()
    expect(document.querySelectorAll('[data-shape]')).toHaveLength(1)
    await click(screen.getByRole('button', { name: 'Clear Map…' }))
    await click(screen.getByRole('button', { name: 'Clear Map' }))
    await waitFor(() => expect(document.querySelectorAll('[data-shape]')).toHaveLength(0))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await settle()
    expect(document.activeElement?.textContent).toMatch(/Clear Map…/)
  })

  it('says so, rather than offering to clear, when nothing is drawn', async () => {
    await renderMap()
    // World has its one pin in the demo; clear it first.
    await act(async () => {
      await store().clearMap(demoPath, WORLD_MAP)
    })
    await click(screen.getByRole('button', { name: 'Clear Map…' }))
    expect(screen.getByRole('alertdialog').textContent).toMatch(/Nothing is drawn on World yet/)
    expect(screen.queryByRole('button', { name: 'Clear Map' })).toBeNull()
  })

  it('deletes a map after asking, and comes back to World', async () => {
    await store().addMap('Port Cray')
    await store().createMapShape('land', tri)
    await renderMap()
    await click(screen.getByRole('button', { name: 'Delete Map…' }))
    expect(screen.getByRole('alertdialog').textContent).toMatch(
      /Delete Port Cray and everything on it — its 1 shape\?/
    )
    await click(screen.getByRole('button', { name: 'Delete Map' }))
    await waitFor(() => expect(tabs()).toEqual(['World*']))
    await settle()
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'World' }))
  })
})

/* ---------- the board ---------- */

async function renderBoard(): Promise<void> {
  useWyrm.setState({ mainView: { kind: 'corkboard' } })
  await act(async () => {
    render(
      <Corkboard
        onTimeline={() => {}}
        onPlotGraph={() => {}}
        onPlotlines={() => {}}
        onCharacterGraph={() => {}}
        onWorldMap={() => {}}
      />
    )
  })
  await settle()
}

describe('minimap cards', () => {
  it('draws a map put on the board as the map, shrunk, and opens its tab', async () => {
    const id = (await store().addMap('Port Cray'))!
    await store().createMapShape('land', tri)
    await store().setMapOnBoard(id, true)
    store().chooseMap(WORLD_MAP)
    await renderBoard()
    const face = screen.getByRole('button', { name: 'Open the map Port Cray' })
    const mini = face.querySelector('.map-card-mini svg')!
    expect(mini).not.toBeNull()
    // Its patterns are its own, so two minimaps never share one.
    expect(mini.querySelector(`pattern#minimap-${id}-sea`)).not.toBeNull()
    await click(face)
    expect(store().mainView).toEqual({ kind: 'map' })
    expect(store().mapId).toBe(id)
    // A detour: back is the board, at this card.
    expect(store().viewHistory.at(-1)).toMatchObject({ kind: 'corkboard', cardId: id })
  })

  it('says so on a map with nothing drawn', async () => {
    const id = (await store().addMap('Port Cray'))!
    await store().setMapOnBoard(id, true)
    await renderBoard()
    expect(screen.getByRole('button', { name: 'Open the map Port Cray' }).textContent).toMatch(
      /Nothing drawn yet/
    )
  })

  it('places, tidies and takes a map card off, the map itself staying', async () => {
    const id = (await store().addMap('Port Cray'))!
    await store().setMapOnBoard(id, true)
    await store().placeMapCard(id, { x: 300.4, y: 120 })
    expect(sheetOf(store().project!.data, id)).toMatchObject({ boardX: 300, boardY: 120 })
    await act(async () => {
      await store().tidyBoard()
    })
    expect(sheetOf(store().project!.data, id)).not.toHaveProperty('boardX')
    expect(sheetOf(store().project!.data, id).onBoard).toBe(true)
    await renderBoard()
    await click(screen.getByRole('button', { name: 'Take Port Cray off the board' }))
    await settle()
    expect(screen.queryByRole('button', { name: 'Open the map Port Cray' })).toBeNull()
    expect(sheetsOf(store().project!.data).map((m) => m.name)).toEqual(['World', 'Port Cray'])
    // Off the board, its place goes too: put back, it is dealt afresh.
    await store().placeMapCard(id, { x: 300, y: 120 })
    await store().setMapOnBoard(id, false)
    const entry = store().project!.data.maps!.find((m) => m.id === id)!
    expect(Object.keys(entry).sort()).toEqual(['id', 'name'])
  })

  it('is moved by the keyboard, and the place is written to the map', async () => {
    const id = (await store().addMap('Port Cray'))!
    await store().setMapOnBoard(id, true)
    await renderBoard()
    const card = screen
      .getByRole('button', { name: 'Open the map Port Cray' })
      .closest('.scene-card')!
    await act(async () => {
      fireEvent.keyDown(card, { key: 'ArrowRight', altKey: true })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400))
    })
    expect(sheetOf(store().project!.data, id).boardX).toBeGreaterThan(0)
  })

  it('is added from Add Card, new or already drawn, and a second of a name is said', async () => {
    await store().addMap('Port Cray')
    await renderBoard()
    await act(async () => store().openAddCard())
    await click(screen.getByRole('radio', { name: 'Map' }))
    const field = screen.getByPlaceholderText('Name of the map')
    fireEvent.change(field, { target: { value: 'port cray' } })
    await click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByRole('alert').textContent).toBe('There is already a map called “Port Cray”.')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(field.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id)
    // One already drawn.
    await click(screen.getByRole('button', { name: 'Port Cray' }))
    await settle()
    expect(screen.getByRole('button', { name: 'Open the map Port Cray' })).toBeTruthy()
    // And a new one, made and put up at once.
    await act(async () => store().openAddCard())
    await click(screen.getByRole('radio', { name: 'Map' }))
    fireEvent.change(screen.getByPlaceholderText('Name of the map'), {
      target: { value: 'The Fens' }
    })
    await click(screen.getByRole('button', { name: 'Add' }))
    await settle()
    expect(screen.getByRole('button', { name: 'Open the map The Fens' })).toBeTruthy()
  })
})

/* ---------- Compile ---------- */

describe('Compile: which map at the front', () => {
  it('offers each map when there is more than one, and passes the one chosen', async () => {
    const id = (await store().addMap('Port Cray'))!
    await store().createMapShape('land', tri)
    store().chooseMap(WORLD_MAP)
    const compile = vi.spyOn(store(), 'compileManuscript').mockResolvedValue({
      result: {} as never,
      path: '/out'
    })
    useWyrm.setState({ compileManuscript: compile })
    render(<CompileDialog onClose={() => {}} />)
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Notes' })).toBeTruthy())
    fireEvent.click(screen.getByRole('radio', { name: 'PDF (.pdf)' }))
    const group = screen.getByRole('radiogroup', { name: 'Map at the front' })
    expect([...group.querySelectorAll('[role=radio]')].map((r) => r.textContent)).toEqual([
      'World',
      'Port Cray'
    ])
    fireEvent.click(screen.getByRole('radio', { name: 'Port Cray' }))
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /^Map at the front/ })).toHaveProperty(
        'disabled',
        false
      )
    )
    fireEvent.click(screen.getByRole('checkbox', { name: /^Map at the front/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Compile' }))
    await waitFor(() => expect(compile).toHaveBeenCalled())
    expect(compile.mock.calls[0][0]).toMatchObject({ frontispiece: true, frontispieceMap: id })
  })
})
