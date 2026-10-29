// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SyncConflict, SyncHeads, SyncOutcome } from '../src/shared/types'
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
  boxMain()
  return demoPath
}

/** The scrolling area the page and stacks are seen through, above the foot. */
const boxMain = (): void => box(document.querySelector('.merge-main')!, 0, 0, 1200, 690)

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
    // The card under it keeps its words clear of the wire.
    expect(clips[0].closest('.merge-card')!.classList.contains('clipped')).toBe(true)
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

  it('takes a drop past the edge of the main area, where the page runs on unseen, as a drop on nothing', async () => {
    await show([FERRY])
    // A long page, running on beneath the foot.
    const sheet = document.querySelector('.merge-page')!
    box(sheet, 300, 0, 400, 1400)
    ;[...sheet.querySelectorAll('[data-item]')].forEach((el, k) =>
      box(el, 320, 20 + k * 200, 360, 180)
    )
    const before = pageKinds()
    await act(async () =>
      pointer(document.querySelector('[data-card="d0.i0"]')!, 'pointerdown', 5, 5)
    )
    await act(async () => pointer(document, 'pointermove', 500, 715))
    expect(document.querySelector('.merge-cursor')).toBeNull()
    await act(async () => pointer(document, 'pointerup', 500, 715))
    expect(pageKinds()).toEqual(before)
    expect(stackCards('incoming')).toEqual(['d0.i0'])
  })

  it('follows the page when it scrolls under a still pointer, and lands where the cursor shows', async () => {
    await show([FERRY])
    const sheet = document.querySelector('.merge-page')!
    const lay = (top: number): void => {
      box(sheet, 300, top, 400, 400)
      ;[...sheet.querySelectorAll('[data-item]')].forEach((el, k) =>
        box(el, 320, top + 20 + k * 60, 360, 40)
      )
    }
    lay(0)
    await act(async () =>
      pointer(document.querySelector('[data-card="d0.i0"]')!, 'pointerdown', 5, 5)
    )
    await act(async () => pointer(document, 'pointermove', 500, 71))
    expect((document.querySelector('.merge-cursor') as HTMLElement).style.top).toBe('70px')
    // The wheel scrolls the page up by a paragraph; the pointer has not moved.
    lay(-60)
    await act(async () => fireEvent.scroll(document.querySelector('.merge-main')!))
    // Now between the gap (20–60) and the next paragraph (80–120).
    expect((document.querySelector('.merge-cursor') as HTMLElement).style.top).toBe('130px')
    await act(async () => pointer(document, 'pointerup', 500, 71))
    expect(pageKinds().slice(0, 3)).toEqual(['merge-text', 'merge-gap', 'card:d0.i0'])
  })

  it('waits on ⌘Z while a card is in hand, and Esc drops it where it came from', async () => {
    await show([FERRY])
    const sheet = document.querySelector('.merge-page')!
    box(sheet, 300, 0, 400, 400)
    ;[...sheet.querySelectorAll('[data-item]')].forEach((el, k) =>
      box(el, 320, 20 + k * 60, 360, 40)
    )
    act(() => fireEvent.click(screen.getByText('All into the gap')))
    const placed = pageKinds()
    await act(async () =>
      pointer(document.querySelector('[data-card="d0.i0"]')!, 'pointerdown', 5, 5)
    )
    await act(async () => pointer(document, 'pointermove', 500, 71))
    act(() => {
      fireEvent.keyDown(window, { key: 'z', metaKey: true })
    })
    expect(pageKinds()).toEqual(placed)
    expect(document.querySelector('.merge-cursor')).not.toBeNull()
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(document.querySelector('.merge-cursor')).toBeNull()
    expect(state().syncConflicts).toEqual([FERRY])
    await act(async () => pointer(document, 'pointerup', 500, 71))
    expect(pageKinds()).toEqual(placed)
    expect(stackCards('incoming')).toEqual(['d0.i0'])
  })

  it('is no move to drop a card back where it was: Undo stays off', async () => {
    await show([FERRY])
    const sheet = document.querySelector('.merge-page')!
    box(sheet, 300, 0, 400, 400)
    ;[...sheet.querySelectorAll('[data-item]')].forEach((el, k) =>
      box(el, 320, 20 + k * 60, 360, 40)
    )
    // c0 is the fourth item (200–240); its own top boundary is at 190.
    await drag(document.querySelector('[data-card="c0"]')!, 500, 190)
    expect(pageKinds()).toEqual(['merge-text', 'merge-gap', 'merge-text', 'card:c0', 'merge-text'])
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('puts a card dropped on a stack on the stack of the page in front', async () => {
    // Two disputes whose pages both show the other computer's P3 (c0).
    const ps = (f: (i: number) => string): string =>
      bodyOf(Array.from({ length: 9 }, (_, i) => f(i)))
    await show([
      {
        ...FERRY,
        baseBody: ps((i) => `P${i}.`),
        localBody: ps((i) => (i === 1 || i === 5 ? `P${i} mine.` : `P${i}.`)),
        remoteBody: ps((i) => (i === 1 || i === 3 || i === 5 ? `P${i} theirs.` : `P${i}.`))
      }
    ])
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Next page' })))
    expect(document.querySelector('.merge-page-count')!.textContent).toBe('Page 2 of 2')
    expect(pageKinds()).toContain('card:c0')
    box(document.querySelector('.merge-stack[data-side=incoming]')!, 900, 0, 280, 600)
    await drag(document.querySelector('[data-card="c0"]')!, 1000, 300)
    expect(pageKinds()).not.toContain('card:c0')
    expect(stackCards('incoming')).toContain('c0')
  })

  it('keeps the Both edits card’s place under the page, so a placed one can go back to it', async () => {
    await show([
      {
        ...FERRY,
        baseBody: body('Before.', 'The cat sat on the mat today.', 'After.'),
        localBody: body('Before.', 'The cat sat on the red mat today.', 'After.'),
        remoteBody: body('Before.', 'The dog sat on the mat today.', 'After.')
      }
    ])
    const sheet = document.querySelector('.merge-page')!
    box(sheet, 300, 0, 400, 300)
    ;[...sheet.querySelectorAll('[data-item]')].forEach((el, k) =>
      box(el, 320, 20 + k * 60, 360, 40)
    )
    expect(document.querySelector('.merge-both')!.textContent).toContain(
      'The dog sat on the red mat today.'
    )
    // Onto the page, after the gap (80–120).
    await drag(document.querySelector('[data-card="d0.both"]')!, 500, 125)
    expect(pageKinds()).toContain('card:d0.both')
    const slot = document.querySelector('.merge-both')!
    expect(slot.textContent).toContain('Nothing left here.')
    box(slot, 400, 320, 300, 120)
    await drag(document.querySelector('.merge-page [data-card="d0.both"]')!, 500, 380)
    expect(pageKinds()).not.toContain('card:d0.both')
    expect(document.querySelector('.merge-both [data-card="d0.both"]')).not.toBeNull()
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
    // Again with App listening after the screen: Focus Mode on and off
    // makes App listen again.
    act(() => useWyrm.setState({ syncConflicts: [FERRY], conflictHeads: HEADS }))
    for (let k = 0; k < 2; k++) {
      act(() => {
        fireEvent.keyDown(window, { key: 'ƒ', code: 'KeyF', altKey: true, metaKey: true })
      })
    }
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

  it('moves nothing while it is on its way: what is sent is what the screen shows', async () => {
    await show([FERRY])
    const sheet = document.querySelector('.merge-page')!
    box(sheet, 300, 0, 400, 400)
    ;[...sheet.querySelectorAll('[data-item]')].forEach((el, k) =>
      box(el, 320, 20 + k * 60, 360, 40)
    )
    act(() => fireEvent.click(screen.getByText('All into the gap')))
    let land: (o: SyncOutcome) => void = () => {}
    const resolve = vi
      .spyOn(api, 'resolveSyncConflicts')
      .mockImplementation(() => new Promise((r) => (land = r)))
    await act(async () => fireEvent.click(finishButton()))
    expect(finishButton().textContent).toBe('Combining…')
    const shown = pageKinds()
    act(() => fireEvent.click(screen.getByText('Into the gap')))
    // A card cannot even be picked up: no cursor follows it.
    await act(async () => pointer(document.querySelector('[data-card="c0"]')!, 'pointerdown', 5, 5))
    await act(async () => pointer(document, 'pointermove', 500, 10))
    expect(document.querySelector('.merge-cursor')).toBeNull()
    await act(async () => pointer(document, 'pointerup', 500, 10))
    act(() => {
      fireEvent.keyDown(window, { key: 'z', metaKey: true })
    })
    expect(pageKinds()).toEqual(shown)
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Later' }) as HTMLButtonElement).disabled).toBe(true)
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(state().syncConflicts).toEqual([FERRY])
    await act(async () => land({ status: 'merged', at: Date.now(), pushed: true }))
    expect(resolve.mock.calls[0][1].choices[0]).toMatchObject({
      body: body(
        'One.',
        'Two, as I had it.',
        'Somewhere below, an engine.',
        'Three.',
        'Four, as they had it.',
        'Five.'
      )
    })
  })

  it('says what became of an answer that came back after the screen had gone', async () => {
    const path = await show([FERRY])
    let land: (o: SyncOutcome) => void = () => {}
    vi.spyOn(api, 'resolveSyncConflicts').mockImplementation(() => new Promise((r) => (land = r)))
    await act(async () => fireEvent.click(finishButton()))
    // Another novel comes forward, taking the screen down meanwhile.
    cleanup()
    await act(async () => land({ status: 'error', detail: 'disk full' }))
    render(<MergeScreen />)
    expect(screen.getByRole('alert').textContent).toBe('disk full')
    // Said once: the next time, the screen has nothing to report.
    cleanup()
    render(<MergeScreen />)
    expect(screen.queryByRole('alert')).toBeNull()
    // A fresh list that lands meanwhile says why the page changed.
    await act(async () => fireEvent.click(finishButton()))
    cleanup()
    await act(async () =>
      land({
        status: 'conflicts',
        conflicts: [{ ...FERRY, localBody: body('One.', 'Typed since.', 'Three.') }],
        heads: { local: 'moved', remote: 'rem0te' },
        moved: true
      })
    )
    render(<MergeScreen />)
    expect(document.querySelector('.merge-hint')!.textContent).toMatch(/^Your work changed/)
    expect(recall(path)).toBeTruthy()
  })
})

describe('in the window', () => {
  async function app(): Promise<void> {
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
  }
  const conflictsUp = (): void =>
    act(() => useWyrm.setState({ syncConflicts: [FERRY], conflictHeads: HEADS }))

  it('covers the binder and the page, with no dialog over it, and leaves them as they were', async () => {
    await app()
    expect(document.querySelector('.binder')).not.toBeNull()
    conflictsUp()
    expect(document.querySelector('.merge-screen')).not.toBeNull()
    const panes = document.querySelector('.window-panes')!
    expect(panes.classList.contains('covered')).toBe(true)
    expect(panes.hasAttribute('inert')).toBe(true)
    expect(panes.querySelector('.binder')).not.toBeNull()
    expect(document.querySelector('.dialog-overlay')).toBeNull()
    act(() => useWyrm.getState().dismissConflicts())
    expect(document.querySelector('.merge-screen')).toBeNull()
    expect(panes.classList.contains('covered')).toBe(false)
    expect(panes.hasAttribute('inert')).toBe(false)
  })

  it('keeps the page’s editor under it, so a merge that lands reaches the page', async () => {
    await app()
    const { project, activeDoc, editor } = state()
    expect(editor).not.toBeNull()
    onTestFinished(() => api.writeDoc(project!.path, activeDoc!))
    conflictsUp()
    expect(state().editor).toBe(editor)
    vi.spyOn(api, 'resolveSyncConflicts').mockImplementation(async () => {
      // As the engine does: the merged chapter is on disk when it answers.
      await api.writeDoc(project!.path, { ...activeDoc!, body: 'The merged chapter.\n' })
      return { status: 'merged', at: Date.now(), pushed: true }
    })
    await act(async () => fireEvent.click(finishButton()))
    expect(state().syncConflicts).toBeNull()
    expect(state().editor!.getText()).toBe('The merged chapter.')
  })

  it('keeps an entry’s unsaved draft under it', async () => {
    await app()
    act(() => useWyrm.getState().showEntity(state().entities[0].id))
    const name = document.querySelector('.entity-main .text-field') as HTMLInputElement
    act(() => fireEvent.change(name, { target: { value: 'A new name' } }))
    expect(document.querySelector('.entity-dirty')).not.toBeNull()
    name.focus()
    conflictsUp()
    // Nothing typed reaches a field nobody can see.
    expect(document.activeElement).toBe(document.querySelector('.merge-screen'))
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Later' })))
    expect((document.querySelector('.entity-main .text-field') as HTMLInputElement).value).toBe(
      'A new name'
    )
    expect(document.querySelector('.entity-dirty')).not.toBeNull()
  })

  it('takes Esc from the board beneath it, though the board’s string tool is up', async () => {
    demoPath ??= (await api.getLastProjectPath())!
    const docs = await api.readAllDocs(demoPath)
    // Two scenes, so the board has cards to string.
    for (const d of docs.slice(0, 2)) {
      await api.writeDoc(demoPath, { ...d, meta: { ...d.meta, tags: ['scene'] } })
    }
    onTestFinished(async () => {
      for (const d of docs.slice(0, 2)) await api.writeDoc(demoPath!, d)
    })
    await app()
    act(() => useWyrm.getState().showCorkboard())
    const tool = await screen.findByRole('button', { name: 'String' })
    // The board reads its scenes as it opens.
    await waitFor(() => expect((tool as HTMLButtonElement).disabled).toBe(false))
    act(() => fireEvent.click(tool))
    expect(tool.getAttribute('aria-pressed')).toBe('true')
    conflictsUp()
    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' })
    })
    expect(state().syncConflicts).toBeNull()
    expect(tool.getAttribute('aria-pressed')).toBe('true')
  })

  it('lets an open menu and guided help take their own Esc first', async () => {
    await app()
    conflictsUp()
    const file = screen.getByRole('menuitem', { name: 'File' })
    act(() => fireEvent.mouseDown(file))
    expect(document.querySelector('.menu-drop')).not.toBeNull()
    act(() => {
      fireEvent.keyDown(file, { key: 'Escape' })
    })
    expect(document.querySelector('.menu-drop')).toBeNull()
    expect(state().syncConflicts).toEqual([FERRY])
    act(() => useWyrm.getState().setHelpMode(true))
    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' })
    })
    expect(state().helpMode).toBe(false)
    expect(state().syncConflicts).toEqual([FERRY])
    // With neither, Esc is Later.
    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' })
    })
    expect(state().syncConflicts).toBeNull()
  })
})

describe('styles', () => {
  // jsdom applies no stylesheet, so these read the rules themselves.
  const css = readFileSync(join(__dirname, '../src/renderer/src/styles/retro.css'), 'utf8')
  const rule = (selector: string): string => {
    const at = css.indexOf(`${selector} {`)
    expect(at, selector).toBeGreaterThan(-1)
    return css.slice(at, css.indexOf('}', at))
  }

  it('draws a highlight on the screen in the palette’s inks, not the browser’s yellow', () => {
    expect(css).toMatch(
      /\.scrap-text mark,\s*\.merge-screen mark \{\s*background: var\(--highlight-bg\)/
    )
    // Every palette that redraws the page's highlight redraws the screen's.
    const palettes = [...css.matchAll(/\[data-palette='([a-z-]+)'\] \.page mark/g)].map((m) => m[1])
    expect(palettes.length).toBeGreaterThan(0)
    for (const name of palettes)
      expect(css).toContain(`[data-palette='${name}'] .merge-screen mark`)
  })

  it('keeps a clipped card’s words clear of the clip', () => {
    expect(rule('.merge-card.clipped')).toMatch(/padding-left: 34px/)
  })

  it('keeps the dither on a disabled button in the bar, so it is not an empty box', () => {
    expect(rule('.entity-main-bar .btn:disabled')).toMatch(/background-clip: text/)
  })

  it('hides what the screen covers without taking it out of the page', () => {
    expect(rule('.window-panes')).toMatch(/display: contents/)
    expect(rule('.window-panes.covered')).toMatch(/visibility: hidden/)
    expect(rule('.merge-screen')).toMatch(/position: absolute;\s*inset: 0/)
  })
})
