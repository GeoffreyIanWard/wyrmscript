// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DocFile, Entity, MapPin, ProjectInfo } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'
import { WorldMap } from '../src/renderer/src/components/WorldMap'
import { PlotGraphDialog } from '../src/renderer/src/components/PlotGraphDialog'
import { sceneCount, scenesByPin, scenesOf } from '../src/renderer/src/lib/mapScenes'
import { actBands, actCounts, actHeading } from '../src/renderer/src/lib/plotGraph'

/**
 * F-42's last two pieces: scenes on the map, at the place each happens (one
 * marker with a count per place), and the plot graph grouped by act.
 */

// The store's own, before any test stands a mock in for them.
const REAL = (({ selectDoc, loadAllDocs, showDoc, setTension }) => ({
  selectDoc,
  loadAllDocs,
  showDoc,
  setTension
}))(useWyrm.getState())

const at = '2026-01-01T00:00:00.000Z'
const doc = (id: string, title: string, meta: Partial<DocFile['meta']> = {}): DocFile => ({
  meta: { id, title, created: at, modified: at, tags: ['scene'], ...meta },
  body: ''
})
const place = (id: string, name: string, parentId?: string): Entity =>
  ({
    id,
    type: 'world',
    name,
    aliases: [],
    created: at,
    modified: at,
    body: '',
    ...(parentId ? { parentId } : {})
  }) as unknown as Entity
const pin = (
  id: string,
  entityId: string,
  x = 300,
  y = 300,
  extra: Partial<MapPin> = {}
): MapPin => ({
  id,
  entityId,
  x,
  y,
  created: at,
  modified: at,
  ...extra
})

const binder: ProjectInfo['data']['binder'] = [
  {
    id: 'm',
    type: 'folder',
    title: 'Manuscript',
    children: [
      { id: 's1', type: 'doc', title: 'The Knock' },
      { id: 's2', type: 'doc', title: 'The Ledger' },
      { id: 'n1', type: 'doc', title: 'Notes' },
      { id: 's3', type: 'doc', title: 'Low Tide' }
    ]
  }
]

/* ---------- where scenes happen ---------- */

describe('scenes at places', () => {
  const entities = [
    place('city', 'Harrowgate'),
    place('quarter', 'The Drowned Quarter', 'city'),
    place('fens', 'The Fens')
  ]

  it('lists the scenes, in binder order, with where each happens', () => {
    const docs = [
      doc('s3', 'Low Tide', { location: 'fens' }),
      doc('s1', 'The Knock', { location: 'city' }),
      doc('n1', 'Notes', { tags: [] }),
      doc('s2', 'The Ledger')
    ]
    expect(scenesOf(docs, binder)).toEqual([
      { id: 's1', title: 'The Knock', location: 'city' },
      { id: 's2', title: 'The Ledger', location: undefined },
      { id: 's3', title: 'Low Tide', location: 'fens' }
    ])
  })

  it('counts a scene at its place, or at the nearest place it is inside with a pin', () => {
    const scenes = [
      { id: 's1', title: 'The Knock', location: 'city' },
      { id: 's2', title: 'The Ledger', location: 'quarter' },
      { id: 's3', title: 'Low Tide', location: 'fens' },
      { id: 's4', title: 'Nowhere' }
    ]
    // The world map pins the city alone: the quarter's scene counts there.
    const world = scenesByPin([pin('p-city', 'city')], scenes, entities)
    expect(world.get('p-city')?.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(world.size).toBe(1)
    // A city plan pins the quarter itself: its scene counts at the quarter.
    const plan = scenesByPin([pin('p-city', 'city'), pin('p-q', 'quarter')], scenes, entities)
    expect(plan.get('p-q')?.map((s) => s.id)).toEqual(['s2'])
    expect(plan.get('p-city')?.map((s) => s.id)).toEqual(['s1'])
    // A place gone from the World Book still counts at its own pin.
    expect(
      scenesByPin([pin('p-x', 'gone')], [{ id: 'g', title: 'G', location: 'gone' }], []).get('p-x')
    ).toHaveLength(1)
    expect(sceneCount(1)).toBe('1 scene')
    expect(sceneCount(4)).toBe('4 scenes')
  })
})

/* ---------- acts ---------- */

describe('acts', () => {
  it('bands each run of neighbouring scenes in one act', () => {
    const scenes = [{ act: 'I' }, { act: ' I ' }, {}, { act: 'II' }, { act: 'II' }, { act: 'I' }]
    expect(actBands(scenes)).toEqual([
      { act: 'I', from: 0, to: 1 },
      { act: 'II', from: 3, to: 4 },
      { act: 'I', from: 5, to: 5 }
    ])
  })

  it('counts each act’s scenes, in the order the acts first come, and those with none', () => {
    expect(actCounts([{ act: 'II' }, { act: 'I' }, { act: 'II' }, {}, { act: '' }])).toEqual({
      acts: [
        { act: 'II', count: 2 },
        { act: 'I', count: 1 }
      ],
      none: 2
    })
  })

  it('heads a bare numeral as an act, and the writer’s own words as they are', () => {
    expect(actHeading('II')).toBe('Act II')
    expect(actHeading('3')).toBe('Act 3')
    expect(actHeading('Prologue')).toBe('Prologue')
  })
})

const project = (): ProjectInfo => ({
  path: '/demo',
  data: { version: 1, title: 'T', binder, trash: [] }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useWyrm.setState({ ...REAL, project: null, mainView: { kind: 'doc' } })
})

describe('the plot graph, grouped by act', () => {
  async function renderGraph(docs: DocFile[]): Promise<void> {
    vi.spyOn(api, 'readAllDocs').mockResolvedValue(docs)
    useWyrm.setState({ project: project(), setTension: vi.fn(), showDoc: vi.fn() })
    await act(async () => {
      render(<PlotGraphDialog onClose={() => {}} />)
    })
  }

  it('rules off each act and names it, and says how many scenes each has', async () => {
    await renderGraph([
      doc('s1', 'The Knock', { act: 'I' }),
      doc('s2', 'The Ledger', { act: 'I' }),
      doc('s3', 'Low Tide', { act: 'II' })
    ])
    const bands = [...document.querySelectorAll('.plot-graph-act')]
    expect(bands.map((b) => b.textContent)).toEqual(['Act I · 2', 'Act II · 1'])
    // Side by side, in the scenes' order along the graph.
    const left = (el: Element): number => parseFloat((el as HTMLElement).style.left)
    expect(left(bands[0])).toBeLessThan(left(bands[1]))
    expect(document.querySelector('.plot-graph-acts')?.textContent).toBe(
      'Act I: 2 scenes · Act II: 1 scene'
    )
  })

  it('leaves out a scene in the trash, whose file is still there', async () => {
    // s9 is no longer in the binder: it was trashed.
    await renderGraph([
      doc('s1', 'The Knock', { act: 'I' }),
      doc('s9', 'Cut Scene', { act: 'I', timelineOrder: 1 })
    ])
    expect(document.querySelector('.plot-graph-acts')?.textContent).toBe('Act I: 1 scene')
    expect(screen.queryByText('Cut Scene')).toBeNull()
  })

  it('rules each band once, rules one after a gap, and keeps names apart', async () => {
    await renderGraph([
      doc('s1', 'The Knock', { act: 'I', timelineOrder: 1 }),
      doc('s2', 'The Ledger', { timelineOrder: 2 }),
      doc('s3', 'Low Tide', { act: 'II', timelineOrder: 3 }),
      // Stacked on Low Tide's place on the timeline, in another act.
      doc('n1', 'Notes', { act: 'The Long Night Before the Siege', timelineOrder: 3 })
    ])
    const bands = [...document.querySelectorAll<HTMLElement>('.plot-graph-act')]
    expect(bands.map((b) => b.classList.contains('starts'))).toEqual([true, true, false])
    const names = bands.map((b) => b.querySelector('.plot-graph-act-name') as HTMLElement)
    // Overlapping its neighbour: a line lower, cut to its band, whole in its tip.
    expect(names[2].classList.contains('lower')).toBe(true)
    expect(names[2].getAttribute('title')).toBe('The Long Night Before the Siege · 1')
    expect(parseFloat(names[2].style.maxWidth)).toBeLessThan(parseFloat(bands[2].style.width))
  })

  it('counts the scenes with no act, and shows no acts at all until one has one', async () => {
    await renderGraph([doc('s1', 'The Knock', { act: 'I' }), doc('s2', 'The Ledger')])
    expect(document.querySelector('.plot-graph-acts')?.textContent).toBe(
      'Act I: 1 scene · No act: 1'
    )
    cleanup()
    await renderGraph([doc('s1', 'The Knock'), doc('s2', 'The Ledger')])
    expect(document.querySelector('.plot-graph-act')).toBeNull()
    expect(document.querySelector('.plot-graph-acts')).toBeNull()
  })
})

/* ---------- the map ---------- */

describe('scenes on the map', () => {
  const docs = [
    doc('s1', 'The Knock', { location: 'city' }),
    doc('s2', 'The Ledger', { location: 'quarter' }),
    doc('s3', 'Low Tide', { location: 'fens' })
  ]
  const entities = [
    place('city', 'Harrowgate'),
    place('quarter', 'The Drowned Quarter', 'city'),
    place('fens', 'The Fens')
  ]

  async function renderMap(selectDoc = vi.fn(async () => {})): Promise<typeof selectDoc> {
    return renderMapWith(
      [pin('p-city', 'city', 300, 300), pin('p-fens', 'fens', 600, 300, { stamp: 'marsh' })],
      selectDoc
    )
  }

  async function renderMapWith(
    pins: MapPin[],
    selectDoc = vi.fn(async () => {})
  ): Promise<typeof selectDoc> {
    useWyrm.setState({
      project: project(),
      entities,
      mapPins: pins,
      mapShapes: [],
      mapMarks: [],
      mapId: 'world',
      mainView: { kind: 'map' },
      loadMapPins: vi.fn(async () => {}),
      loadMapShapes: vi.fn(async () => {}),
      loadMapMarks: vi.fn(async () => {}),
      loadAllDocs: vi.fn(async () => new Map(docs.map((d) => [d.meta.id, d]))),
      selectDoc
    })
    await act(async () => {
      render(<WorldMap />)
    })
    await waitFor(() => expect(document.querySelector('.map-scene-count')).not.toBeNull())
    return selectDoc
  }

  it('shows one marker per place, with its count, the inner place’s scene counted at the city', async () => {
    await renderMap()
    const markers = [...document.querySelectorAll('.map-scene-count')]
    expect(markers.map((m) => [m.getAttribute('aria-label'), m.textContent])).toEqual([
      ['2 scenes at Harrowgate', '2'],
      ['1 scene at The Fens', '1']
    ])
  })

  it('lists a place’s scenes, and opens one as a detour back to that place on the map', async () => {
    const selectDoc = await renderMap()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '2 scenes at Harrowgate' }))
    })
    const list = screen.getByRole('dialog', { name: 'Scenes at Harrowgate' })
    const rows = [...list.querySelectorAll('button')].map((b) => b.textContent)
    expect(rows).toEqual(['The Knock', 'The Ledger'])
    expect(document.activeElement?.textContent).toBe('The Knock')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'The Ledger' }))
    })
    expect(selectDoc).toHaveBeenCalledWith(
      's2',
      expect.objectContaining({ kind: 'map', mapId: 'world', focusPin: 'p-city' })
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes its list on Esc without leaving the map, focus back on the marker', async () => {
    await renderMap()
    const marker = screen.getByRole('button', { name: '1 scene at The Fens' })
    await act(async () => {
      fireEvent.click(marker)
    })
    const back = vi.fn()
    window.addEventListener('keydown', back)
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
      fireEvent.keyUp(document.body, { key: 'Escape' })
    })
    window.removeEventListener('keydown', back)
    expect(back).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(marker))
  })

  it('closes its list on a press elsewhere on the map', async () => {
    await renderMap()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '1 scene at The Fens' }))
    })
    await act(async () => {
      fireEvent.pointerDown(document.querySelector('.map-sizer')!)
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('sits beside a stamp, above a pin, and never above the map’s top edge', async () => {
    await renderMap()
    const spans = [...document.querySelectorAll<HTMLElement>('.map-scenes')]
    const pos = (el: HTMLElement): number[] => [parseFloat(el.style.left), parseFloat(el.style.top)]
    // The map starts at 0 here; a plain pin's marker is 34px above its point.
    expect(pos(spans[0])).toEqual([300, 300 - 34])
    // A marsh stamp at the usual size: half its 36×30 box right and up.
    expect(pos(spans[1])).toEqual([600 + 18, 300 - 15])
    cleanup()
    await renderMapWith([pin('p-city', 'city', 40, 0)])
    const top = document.querySelector<HTMLElement>('.map-scenes')!
    expect(parseFloat(top.style.top)).toBeGreaterThanOrEqual(-6)
    // At the west edge its list lines up with it rather than hanging off,
    // and near the top it opens below.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /at Harrowgate/ }))
    })
    const list = document.querySelector('.map-scene-list')!
    expect(list.classList.contains('start')).toBe(true)
    expect(list.classList.contains('below')).toBe(true)
  })

  it('opens and closes from its marker, one list at a time, over the other markers', async () => {
    await renderMap()
    const fens = screen.getByRole('button', { name: '1 scene at The Fens' })
    await act(async () => {
      fireEvent.click(fens)
    })
    expect(fens.getAttribute('aria-expanded')).toBe('true')
    expect(fens.closest('.map-scenes')!.classList.contains('open')).toBe(true)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '2 scenes at Harrowgate' }))
    })
    expect(screen.getAllByRole('dialog').map((d) => d.getAttribute('aria-label'))).toEqual([
      'Scenes at Harrowgate'
    ])
    expect(fens.getAttribute('aria-expanded')).toBe('false')
    const city = screen.getByRole('button', { name: '2 scenes at Harrowgate' })
    await act(async () => {
      fireEvent.pointerDown(city)
      fireEvent.click(city)
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes when focus leaves it, on Esc at its marker (staying on the map), and on a press on a pin', async () => {
    await renderMap()
    const fens = screen.getByRole('button', { name: '1 scene at The Fens' })
    await act(async () => {
      fireEvent.click(fens)
    })
    const zoom = screen.getByRole('button', { name: 'Zoom in' })
    await act(async () => {
      fireEvent.blur(document.activeElement!, { relatedTarget: zoom })
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(async () => {
      fireEvent.click(fens)
    })
    const back = vi.fn()
    window.addEventListener('keydown', back)
    await act(async () => {
      fireEvent.keyDown(fens, { key: 'Escape' })
      fireEvent.keyUp(document.body, { key: 'Escape' })
    })
    window.removeEventListener('keydown', back)
    expect(back).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(async () => {
      fireEvent.click(fens)
    })
    // A real primary press, which the pin keeps to itself (stopped): the list
    // closes for it all the same.
    await act(async () => {
      const press = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
      Object.defineProperty(press, 'pointerId', { value: 1 })
      document.querySelector('[data-pin="p-city"]')!.dispatchEvent(press)
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not come back with the hand after a drawing tool was taken up', async () => {
    await renderMap()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '1 scene at The Fens' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Land' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Hand' }))
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reads the documents once, whichever map is shown, and shows the map without them', async () => {
    await renderMap()
    const load = useWyrm.getState().loadAllDocs as unknown as ReturnType<typeof vi.fn>
    await act(async () => {
      useWyrm.setState({
        project: {
          ...project(),
          data: { ...project().data, maps: [{ id: 'cray', name: 'Port Cray' }] }
        }
      })
    })
    await act(async () => useWyrm.getState().chooseMap('cray'))
    await act(async () => useWyrm.getState().chooseMap('world'))
    expect(load).toHaveBeenCalledTimes(1)
    cleanup()
    useWyrm.setState({ loadAllDocs: vi.fn(async () => Promise.reject(new Error('unreadable'))) })
    await act(async () => {
      render(<WorldMap />)
    })
    expect(document.querySelector('.world-map')).not.toBeNull()
    expect(document.querySelector('.map-scene-count')).toBeNull()
  })

  it('stands aside while drawing, as the pins do', async () => {
    await renderMap()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Land' }))
    })
    expect(document.querySelector('.map-scene-count')).toBeNull()
  })

  it('counts only the scenes at places pinned on the map in view', async () => {
    await renderMap()
    // The Fens' pin is on World alone; another map has none of these places.
    await act(async () => {
      useWyrm.setState({
        project: {
          ...project(),
          data: { ...project().data, maps: [{ id: 'cray', name: 'Port Cray' }] }
        },
        mapId: 'cray'
      })
    })
    expect(document.querySelector('.map-scene-count')).toBeNull()
  })
})

describe('a scene opened from the map', () => {
  it('adds the map to the way back, so Esc walks back to the map and then the board', async () => {
    vi.spyOn(api, 'readDoc').mockResolvedValue(doc('s1', 'The Knock'))
    useWyrm.setState({
      project: project(),
      activeId: null,
      mainView: { kind: 'corkboard' },
      viewHistory: []
    })
    useWyrm.getState().showMap()
    await act(async () => {
      await useWyrm.getState().selectDoc('s1', { kind: 'map', mapId: 'world', focusPin: 'p' })
    })
    expect(useWyrm.getState().viewHistory.map((v) => v.kind)).toEqual(['corkboard', 'map'])
    // From the binder, still an arrival: the trail is cleared.
    await act(async () => {
      await useWyrm.getState().selectDoc('s1')
    })
    expect(useWyrm.getState().viewHistory).toEqual([])
  })
})
