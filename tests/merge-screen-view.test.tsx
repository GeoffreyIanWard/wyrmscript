// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SyncConflict, SyncHeads } from '../src/shared/types'
import { DEFAULT_APPEARANCE, DEFAULT_STATS } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { bodyOf } from '../src/renderer/src/lib/mergePages'
import { forget, recall } from '../src/renderer/src/lib/mergeScreen'
import { useWyrm, __disposeAll } from '../src/renderer/src/store'
import { MergeScreen } from '../src/renderer/src/components/MergeScreen'

/**
 * F-51 step 4: the merge screen as the writer meets it. Stacks either side
 * of a page with a gap where the disputed passage was; cards dragged onto the
 * page land where the cursor shows, or into the bin or onto the pad; the clip
 * moves a whole stack; ⌘Z undoes; Later (or Esc) keeps the arrangement for
 * next time; Finish sends each chapter as arranged, with every card kept or
 * left over on the scratch pad.
 *
 * jsdom has no layout, so the boxes the drag measures are set by hand, and
 * the pointer events are dispatched as the corkboard's tests dispatch them.
 */

const body = (...ps: string[]): string => bodyOf(ps)
const HEADS: SyncHeads = { local: 'l0cal', remote: 'rem0te' }

const FERRY: SyncConflict = {
  path: 'documents/ferry.md',
  kind: 'doc',
  title: 'The Ferry',
  baseBody: body('One.', 'Two was here.', 'Three.', 'Four was here.', 'Five.'),
  localBody: body(
    'One.',
    'Two, as I had it.',
    'Somewhere below, an engine.',
    'Three.',
    'Four was here.',
    'Five.'
  ),
  remoteBody: body('One.', 'Two, as they had it.', 'Three.', 'Four, as they had it.', 'Five.'),
  localAt: Date.now() - 60_000,
  remoteAt: Date.now() - 3_600_000
}

const BINDER: SyncConflict = {
  path: 'project.json',
  kind: 'project',
  title: 'Binder & project settings',
  baseBody: '{}',
  localBody: '{ "a": 1 }',
  remoteBody: '{ "a": 2 }',
  localAt: null,
  remoteAt: null
}

let demoPath: string | null = null

async function show(conflicts: SyncConflict[], heads: SyncHeads = HEADS): Promise<string> {
  demoPath ??= (await api.getLastProjectPath())!
  await act(async () => {
    await useWyrm.getState().openRecentProject(demoPath!)
  })
  useWyrm.setState({ syncConflicts: conflicts, conflictHeads: heads })
  render(<MergeScreen />)
  return demoPath
}

const state = (): ReturnType<typeof useWyrm.getState> => useWyrm.getState()

function pointer(target: EventTarget, type: string, x: number, y: number): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  // jsdom has no PointerEvent; React reads `pointerId` off the event object.
  Object.defineProperty(e, 'pointerId', { value: 1 })
  target.dispatchEvent(e)
}

/** Give an element a box, since jsdom lays nothing out. */
function box(el: Element, left: number, top: number, width: number, height: number): void {
  el.getBoundingClientRect = () =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({})
    }) as DOMRect
}

async function drag(from: Element, x: number, y: number): Promise<void> {
  await act(async () => pointer(from, 'pointerdown', 5, 5))
  await act(async () => pointer(document, 'pointermove', x, y))
  await act(async () => pointer(document, 'pointerup', x, y))
}

const pageKinds = (): string[] =>
  [...document.querySelectorAll('.merge-page [data-item]')].map((el) => {
    const card = (el as HTMLElement).dataset.card
    return card ? `card:${card}` : el.className
  })
const stackCards = (side: 'local' | 'incoming'): string[] =>
  [...document.querySelectorAll(`.merge-stack[data-side=${side}] .merge-card`)].map(
    (el) => (el as HTMLElement).dataset.card!
  )
const finishButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: /^Finish|^Combining/ }) as HTMLButtonElement

beforeEach(() => {
  vi.restoreAllMocks()
  if (demoPath) forget(demoPath)
})

afterEach(() => {
  cleanup()
  useWyrm.setState({
    project: null,
    booted: false,
    parked: {},
    openPaths: [],
    syncConflicts: null,
    conflictHeads: null,
    waitingConflicts: null,
    syncNeedsAttention: false
  })
  __disposeAll()
})

describe('what the screen shows', () => {
  it('puts the page between the two stacks, each saying whose and when', async () => {
    await show([FERRY])
    const local = document.querySelector('.merge-stack[data-side=local]')!
    const incoming = document.querySelector('.merge-stack[data-side=incoming]')!
    expect(local.textContent).toMatch(/^LOCALThis computer · today/)
    expect(incoming.textContent).toMatch(/INCOMINGOther computer/)
    expect(stackCards('local')).toEqual(['d0.l0', 'd0.l1'])
    expect(stackCards('incoming')).toEqual(['d0.i0'])
    expect(pageKinds()).toEqual(['merge-text', 'merge-gap', 'merge-text', 'card:c0', 'merge-text'])
    expect(document.querySelector('.merge-gap')!.textContent).toMatch(
      /^Before · both changed thisTwo was here\.$/
    )
  })

  it('tags a new paragraph New, underlines changed words, and marks a change only one side made', async () => {
    await show([FERRY])
    const [edited, added] = [
      ...document.querySelectorAll('.merge-stack[data-side=local] .merge-card')
    ]
    expect(added.querySelector('.merge-tag')?.textContent).toBe('New')
    expect(added.querySelector('u')).toBeNull()
    expect([...edited.querySelectorAll('u')].map((u) => u.textContent)).toContain('I had it')
    const only = document.querySelector('[data-card="c0"]')!
    expect(only.querySelector('.merge-tag')!.textContent).toBe('Incoming · only changed there')
  })

  it('puts a clip on a stack of more than one card, saying what it does', async () => {
    await show([FERRY])
    const clips = document.querySelectorAll('.merge-clip')
    expect(clips).toHaveLength(1)
    expect((clips[0] as HTMLElement).title).toBe('Drag the clip to move the whole stack, in order')
    expect(clips[0].closest('.merge-stack')!.getAttribute('data-side')).toBe('local')
  })

  it('says a side deleted the passage, and lets a removed paragraph be put back', async () => {
    await show([
      {
        ...FERRY,
        baseBody: body('A.', 'Going.', 'B.', 'Kept here.', 'C.'),
        localBody: body('A.', 'Going, edited.', 'B.', 'Kept here.', 'C.'),
        remoteBody: body('A.', 'B.', 'C.')
      }
    ])
    expect(document.querySelector('.merge-stack[data-side=incoming]')!.textContent).toMatch(
      /Deleted on your other computer\. Leave this side empty to agree\./
    )
    const removed = document.querySelector('.merge-removed')!
    expect(removed.textContent).toMatch(/^Removed on your other computer/)
    act(() => fireEvent.click(screen.getByText('Put back')))
    expect(document.querySelector('.merge-removed')).toBeNull()
    expect(document.querySelector('.merge-page')!.textContent).toContain('Kept here.')
  })

  it('counts the cards Finish will keep on the pad', async () => {
    await show([FERRY])
    expect(finishButton().textContent).toBe('Finish · 3 to scratch pad')
  })
})

describe('moving cards', () => {
  it('puts a whole stack into the gap, in order', async () => {
    await show([FERRY])
    act(() => fireEvent.click(screen.getByText('All into the gap')))
    expect(pageKinds().slice(1, 4)).toEqual(['merge-gap', 'card:d0.l0', 'card:d0.l1'])
    expect(stackCards('local')).toEqual([])
    expect(finishButton().textContent).toBe('Finish · 1 to scratch pad')
  })

  it('drops a card where the cursor shows, between the paragraphs nearest the pointer', async () => {
    await show([FERRY])
    const sheet = document.querySelector('.merge-page')!
    box(sheet, 300, 0, 400, 400)
    const items = [...sheet.querySelectorAll('[data-item]')]
    items.forEach((el, k) => box(el, 320, 20 + k * 60, 360, 40))
    const card = document.querySelector('[data-card="d0.i0"]')!
    // Between the first paragraph (20–60) and the gap (80–120).
    await act(async () => pointer(card, 'pointerdown', 5, 5))
    await act(async () => pointer(document, 'pointermove', 500, 71))
    const bar = document.querySelector('.merge-cursor') as HTMLElement
    expect(bar).not.toBeNull()
    expect(bar.style.top).toBe('70px')
    await act(async () => pointer(document, 'pointerup', 500, 71))
    expect(pageKinds().slice(0, 3)).toEqual(['merge-text', 'card:d0.i0', 'merge-gap'])
    expect(document.querySelector('.merge-cursor')).toBeNull()
  })

  it('moves a whole stack by its clip', async () => {
    await show([FERRY])
    const sheet = document.querySelector('.merge-page')!
    box(sheet, 300, 0, 400, 400)
    ;[...sheet.querySelectorAll('[data-item]')].forEach((el, k) =>
      box(el, 320, 20 + k * 60, 360, 40)
    )
    await drag(document.querySelector('.merge-clip')!, 500, 125)
    expect(pageKinds().slice(1, 4)).toEqual(['merge-gap', 'card:d0.l0', 'card:d0.l1'])
  })

  it('takes a card into the bin and puts it back on its stack', async () => {
    await show([FERRY])
    box(screen.getByRole('button', { name: /^Bin/ }), 0, 700, 80, 30)
    await drag(document.querySelector('[data-card="d0.i0"]')!, 40, 715)
    expect(screen.getByRole('button', { name: /^Bin/ }).textContent).toBe('Bin · 1')
    expect(stackCards('incoming')).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: /^Bin/ }))
    expect(document.querySelector('.merge-tray')!.textContent).toMatch(
      /Incoming · The Ferry: Two, as they had it\./
    )
    act(() => fireEvent.click(screen.getByText('Put back')))
    expect(stackCards('incoming')).toEqual(['d0.i0'])
  })

  it('takes a change only one side made off the page, and the paragraph it replaced comes back', async () => {
    await show([FERRY])
    box(screen.getByRole('button', { name: /^Scratch Pad/ }), 100, 700, 80, 30)
    await drag(document.querySelector('[data-card="c0"]')!, 140, 715)
    expect(document.querySelector('.merge-page')!.textContent).toContain('Four was here.')
    expect(screen.getByRole('button', { name: /^Scratch Pad/ }).textContent).toBe('Scratch Pad · 1')
  })

  it('does nothing for a press that never moves, or a drop on nothing', async () => {
    await show([FERRY])
    const before = pageKinds()
    const card = document.querySelector('[data-card="d0.l0"]')!
    // A press that moves two pixels, over the bin, is a click, not a drag.
    box(screen.getByRole('button', { name: /^Bin/ }), 0, 0, 80, 30)
    await act(async () => pointer(card, 'pointerdown', 5, 5))
    await act(async () => pointer(document, 'pointermove', 6, 6))
    await act(async () => pointer(document, 'pointerup', 6, 6))
    expect(screen.getByRole('button', { name: /^Bin/ }).textContent).toBe('Bin · 0')
    await drag(card, 2000, 2000)
    expect(pageKinds()).toEqual(before)
    expect(stackCards('local')).toEqual(['d0.l0', 'd0.l1'])
  })

  it('undoes with the button and with ⌘Z', async () => {
    await show([FERRY])
    act(() => fireEvent.click(screen.getByText('All into the gap')))
    act(() => fireEvent.click(screen.getByText('Into the gap')))
    fireEvent.keyDown(window, { key: 'z', metaKey: true })
    expect(stackCards('incoming')).toEqual(['d0.i0'])
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Undo' })))
    expect(stackCards('local')).toEqual(['d0.l0', 'd0.l1'])
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('Later', () => {
  it('sets the screen aside, keeps the conflicts waiting, and keeps the arrangement for next time', async () => {
    const path = await show([FERRY])
    act(() => fireEvent.click(screen.getByText('All into the gap')))
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Later' })))
    expect(state().syncConflicts).toBeNull()
    expect(state().waitingConflicts).toEqual([FERRY])
    cleanup()
    // Resolve… brings the same versions back, under newer save points.
    useWyrm.setState({
      syncConflicts: [FERRY],
      conflictHeads: { local: 'newer', remote: 'rem0te' }
    })
    render(<MergeScreen />)
    expect(stackCards('local')).toEqual([])
    expect(pageKinds().slice(1, 4)).toEqual(['merge-gap', 'card:d0.l0', 'card:d0.l1'])
    expect(recall(path)).toBeTruthy()
  })

  it('is Esc too, and Esc does nothing else: the view behind it stays where it was', async () => {
    vi.spyOn(api, 'getStatsSettings').mockResolvedValue(DEFAULT_STATS)
    vi.spyOn(api, 'getAppearance').mockResolvedValue(DEFAULT_APPEARANCE)
    vi.spyOn(api, 'getDailyStats').mockResolvedValue([])
    demoPath ??= (await api.getLastProjectPath())!
    await act(async () => {
      await useWyrm.getState().openRecentProject(demoPath!)
    })
    const { default: App } = await import('../src/renderer/src/App')
    await act(async () => {
      render(<App />)
    })
    // On a detour (the scratch pad) when the conflicts come up.
    act(() => useWyrm.getState().showScratchPad())
    act(() => useWyrm.setState({ syncConflicts: [FERRY], conflictHeads: HEADS }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(state().syncConflicts).toBeNull()
    expect(state().mainView.kind).toBe('scratch')
  })

  it('starts a chapter again when it came back changed', async () => {
    await show([FERRY])
    act(() => fireEvent.click(screen.getByText('All into the gap')))
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Later' })))
    cleanup()
    useWyrm.setState({
      syncConflicts: [
        { ...FERRY, localBody: body('One.', 'Typed since.', 'Three.', 'Four was here.', 'Five.') }
      ],
      conflictHeads: HEADS
    })
    render(<MergeScreen />)
    expect(pageKinds()).not.toContain('card:d0.l0')
  })
})

describe('Finish', () => {
  it('first asks for every choice, going to the page that needs one', async () => {
    await show([FERRY, BINDER])
    const resolve = vi.spyOn(api, 'resolveSyncConflicts')
    await act(async () => fireEvent.click(finishButton()))
    expect(resolve).not.toHaveBeenCalled()
    expect(document.querySelector('.merge-page-count')!.textContent).toBe('Page 2 of 2')
    expect(document.querySelector('.merge-hint')!.textContent).toBe(
      'Choose which version of “Binder & project settings” to keep first.'
    )
  })

  it('sends each chapter as arranged, each choice, and every card kept or left as a scrap', async () => {
    const path = await show([FERRY, BINDER])
    act(() => fireEvent.click(screen.getByText('All into the gap')))
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Next page' })))
    act(() => fireEvent.click(screen.getByText('Take your other computer’s')))
    const resolve = vi
      .spyOn(api, 'resolveSyncConflicts')
      .mockResolvedValue({ status: 'merged', at: Date.now(), pushed: true })
    await act(async () => fireEvent.click(finishButton()))
    expect(resolve).toHaveBeenCalledTimes(1)
    const [sentPath, answer] = resolve.mock.calls[0]
    expect(sentPath).toBe(path)
    expect(answer.pinned).toEqual(HEADS)
    expect(answer.choices).toEqual([
      {
        path: 'documents/ferry.md',
        resolution: 'arranged',
        body: body(
          'One.',
          'Two, as I had it.',
          'Somewhere below, an engine.',
          'Three.',
          'Four, as they had it.',
          'Five.'
        )
      },
      { path: 'project.json', resolution: 'theirs' }
    ])
    expect(answer.scraps).toEqual([
      expect.objectContaining({
        body: 'Two, as they had it.',
        how: 'incoming',
        fromDoc: 'ferry',
        fromTitle: 'The Ferry'
      })
    ])
    expect(state().syncConflicts).toBeNull()
    expect(recall(path)).toBeUndefined()
  })

  it('puts a fresh list on screen when the work changed, keeping what had not, and says why', async () => {
    await show([FERRY, BINDER])
    act(() => fireEvent.click(screen.getByText('All into the gap')))
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Next page' })))
    act(() => fireEvent.click(screen.getByText('Keep this computer’s')))
    const changed = { ...BINDER, localBody: '{ "a": 3 }' }
    vi.spyOn(api, 'resolveSyncConflicts').mockResolvedValue({
      status: 'conflicts',
      conflicts: [FERRY, changed],
      heads: { local: 'moved', remote: 'rem0te' },
      moved: true
    })
    await act(async () => fireEvent.click(finishButton()))
    await waitFor(() =>
      expect(document.querySelector('.merge-hint')!.textContent).toMatch(/^Your work changed/)
    )
    expect(state().conflictHeads).toEqual({ local: 'moved', remote: 'rem0te' })
    // The writer stays where they were: the chapter that changed asks again…
    expect(document.querySelector('.merge-page-count')!.textContent).toBe('Page 2 of 2')
    expect(screen.getByText('Keep this computer’s').getAttribute('aria-pressed')).toBe('false')
    // …and the one that had not is as they left it.
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Previous page' })))
    expect(stackCards('local')).toEqual([])
    expect(pageKinds()).toContain('card:d0.l0')
  })

  it('keeps the screen and says why when combining fails', async () => {
    await show([FERRY])
    vi.spyOn(api, 'resolveSyncConflicts').mockResolvedValue({
      status: 'error',
      detail: 'disk full'
    })
    await act(async () => fireEvent.click(finishButton()))
    expect(screen.getByRole('alert').textContent).toBe('disk full')
    expect(state().syncConflicts).toEqual([FERRY])
  })
})

describe('in the window', () => {
  it('takes the window in place of the binder and the page, with no dialog over it', async () => {
    vi.spyOn(api, 'getStatsSettings').mockResolvedValue(DEFAULT_STATS)
    vi.spyOn(api, 'getAppearance').mockResolvedValue(DEFAULT_APPEARANCE)
    vi.spyOn(api, 'getDailyStats').mockResolvedValue([])
    demoPath ??= (await api.getLastProjectPath())!
    await act(async () => {
      await useWyrm.getState().openRecentProject(demoPath!)
    })
    const { default: App } = await import('../src/renderer/src/App')
    await act(async () => {
      render(<App />)
    })
    expect(document.querySelector('.binder')).not.toBeNull()
    act(() => useWyrm.setState({ syncConflicts: [FERRY], conflictHeads: HEADS }))
    expect(document.querySelector('.merge-screen')).not.toBeNull()
    expect(document.querySelector('.binder')).toBeNull()
    expect(document.querySelector('.dialog-overlay')).toBeNull()
    act(() => useWyrm.getState().dismissConflicts())
    expect(document.querySelector('.merge-screen')).toBeNull()
    expect(document.querySelector('.binder')).not.toBeNull()
  })
})
