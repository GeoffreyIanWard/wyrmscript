import { Fragment, useEffect, useReducer, useRef, useState } from 'react'
import type {
  FocusEvent as ReactFocusEvent,
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject
} from 'react'
import type { ConflictResolution, SyncConflict } from '../../../shared/types'
import {
  pageItems,
  styledRuns,
  type CardRun,
  type MergeCard,
  type MergeItem,
  type MergeSide
} from '../lib/mergePages'
import {
  answerOf,
  arrange,
  choose,
  clearNote,
  dropIndex,
  forget,
  intoGap,
  keySpots,
  keyStart,
  keyStep,
  leaveNote,
  leftovers,
  noteFor,
  pagesOf,
  placeOn,
  putBack,
  recall,
  remember,
  stackOf,
  takeOff,
  tray,
  unchosen,
  whenWritten,
  type Arrangement,
  type ChoiceChapter,
  type ProseChapter
} from '../lib/mergeScreen'
import { errorMessage } from '../lib/errors'
import { afterKeysUp } from '../lib/keys'
import { useWyrm } from '../store'
import { PaperClip } from './PaperClip'

/** What the hint line says when there is nothing else to say. */
const HINT =
  'Drag a card onto the page, or Tab to it and press Return; the cursor shows where it lands. Drag a stack’s clip to move it all. Underlined words changed.'

/** What it says with a card, or the clip, in keyboard focus. */
const CARD_HINT =
  'Return picks the card up. Delete bins it; S keeps it on the scratch pad. ↑ ↓ for the next card, Tab for the next stack or the page.'
const CLIP_HINT =
  'The clip: Return picks up the whole stack, in order. Delete bins it all; S keeps it all on the scratch pad.'

/** And with cards in hand. */
const holdHint = (n: number): string => {
  const them = n > 1 ? 'them' : 'it'
  return `In hand: ↑ ↓ move the cursor, Return puts ${them} there, Esc puts ${them} back. Delete bins ${them}; S keeps ${them} on the scratch pad.`
}

const SIDE_NAME: Record<MergeCard['side'], string> = {
  local: 'Local',
  incoming: 'Incoming',
  both: 'Both edits'
}

const whereName = (side: MergeSide): string =>
  side === 'local' ? 'this computer' : 'your other computer'

function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * F-51 step 4: the merge screen — where the writer puts a chapter changed on
 * two computers back together, in place of the page. It comes up when a sync
 * the writer asked for finds conflicts (`syncConflicts`), and while it is up
 * the project does not sync.
 *
 * A fresh list while it is up (the versions moved under an answer) is laid
 * out again in place, keeping every chapter that has not changed as the
 * writer arranged it (`arrange`), and says why.
 *
 * App draws it over the window's own body, which stays mounted beneath it
 * (inert), so the page keeps its editor, and anything half-typed in an entry
 * its draft, while the writer arranges — and a merge that lands reaches the
 * page as any sync's does.
 */
export function MergeScreen(): JSX.Element | null {
  const project = useWyrm((s) => s.project)
  const conflicts = useWyrm((s) => s.syncConflicts)
  if (!project || !conflicts) return null
  return <Screen key={project.path} path={project.path} conflicts={conflicts} />
}

/** What the screen says when a fresh list comes up under it. */
const MOVED =
  'Your work changed while you were arranging it. Everything that had not changed is as you left it.'

interface State {
  arr: Arrangement
  undo: Arrangement[]
}

type Action =
  | { type: 'move'; move: (arr: Arrangement) => Arrangement }
  | { type: 'undo' }
  | { type: 'fresh'; conflicts: SyncConflict[] }

function reduce(state: State, action: Action): State {
  if (action.type === 'fresh') {
    // A fresh list: what had not changed stays, and undo starts again — a
    // step back would be to versions that are no longer there.
    return { arr: arrange(action.conflicts, state.arr), undo: [] }
  }
  if (action.type === 'undo') {
    if (state.undo.length === 0) return state
    return { arr: state.undo[state.undo.length - 1], undo: state.undo.slice(0, -1) }
  }
  const arr = action.move(state.arr)
  return arr === state.arr ? state : { arr, undo: [...state.undo.slice(-99), state.arr] }
}

/** Where a card being dragged would land. */
type Target =
  | { kind: 'page'; index: number; bar: number }
  | { kind: 'bin' }
  | { kind: 'pad' }
  | { kind: 'stack' }

interface Drag {
  chapter: number
  ids: string[]
  x: number
  y: number
  started: boolean
}

/**
 * The keyboard's way round the screen: Tab goes between the stacks and the
 * page (a roving tab stop each), ↑ and ↓ between the cards in one. Every
 * card, and a stack's clip, carries its place as `data-nav` and `data-key`.
 */
type Region = 'local' | 'incoming' | 'both' | 'page'

/** Cards picked up from the keyboard, and where the cursor would put them. */
interface Held {
  chapter: number
  pageId: string
  /** What picked them up: a card, or a stack's clip (`clip`). */
  region: Region
  key: string
  ids: string[]
  /** An index into the chapter's items, one of `keySpots`. */
  at: number
}

/**
 * Where focus goes once a move is drawn, since the card that had it may
 * have gone: a card, wherever it is now (in `region` first, for a clip); the
 * nth card left in a place, or the place itself once it is empty; the nth
 * Put back left in the tray; or Finish, when an answer has come back and
 * left focus nowhere. Set only where a render is sure to follow, or it
 * would wait for some later one and pull focus back from wherever it went.
 */
type Want =
  | { card: string; region?: Region }
  | { region: Region; index: number }
  | { place: Region }
  | { tray: number }
  | { finish: true }

function Screen({ path, conflicts }: { path: string; conflicts: SyncConflict[] }): JSX.Element {
  const [{ arr, undo }, dispatch] = useReducer(reduce, null, () => ({
    arr: arrange(conflicts, recall(path)),
    undo: []
  }))
  const pages = pagesOf(arr)
  const [wanted, setAt] = useState(0)
  const at = Math.min(wanted, Math.max(0, pages.length - 1))
  const [trayOpen, setTrayOpen] = useState<'bin' | 'pad' | null>(null)
  // A word left by an answer that came back after the screen had gone.
  const [note, setNote] = useState<string | null>(() => {
    const left = noteFor(path)
    return left && !left.error ? left.text : null
  })
  const [error, setError] = useState<string | null>(() => {
    const left = noteFor(path)
    return left?.error ? left.text : null
  })
  // The store puts a fresh list on screen only when the versions moved under
  // an answer (a sync landing meanwhile leaves the list alone). It is laid
  // out again here, during render, as React has state follow a prop.
  const [held, setHeld] = useState<Held | null>(null)
  const [shown, setShown] = useState(conflicts)
  if (shown !== conflicts) {
    setShown(conflicts)
    dispatch({ type: 'fresh', conflicts })
    setNote(MOVED)
    setHeld(null)
  }
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState<(Drag & { target: Target | null }) | null>(null)
  // The card each place's tab stop is on, and what has keyboard focus now.
  const [active, setActive] = useState<Partial<Record<Region, string>>>({})
  const [focused, setFocused] = useState<{ region: Region; key: string } | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const finishRef = useRef<HTMLButtonElement>(null)
  const want = useRef<Want | null>(null)
  // Where focus was before the screen came up, to go back to as it goes.
  const before = useRef<HTMLElement | null>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const binRef = useRef<HTMLButtonElement>(null)
  const padRef = useRef<HTMLButtonElement>(null)
  const localRef = useRef<HTMLDivElement>(null)
  const incomingRef = useRef<HTMLDivElement>(null)
  const bothRef = useRef<HTMLDivElement>(null)
  const pending = useRef<Drag | null>(null)
  const unlisten = useRef<(() => void) | null>(null)
  // While Finish is on its way, nothing moves: the answer is what the screen
  // showed when it was pressed, and a move made meanwhile would be shown and
  // never sent. A ref as well as state, for handlers made before it changed.
  const busyRef = useRef(false)
  // Whether the screen is still up when an answer comes back.
  const alive = useRef(true)

  // Kept while the app is open: Later, or another novel coming forward,
  // leaves what the writer arranged to come back to.
  useEffect(() => {
    remember(path, arr)
  }, [path, arr])

  useEffect(() => {
    alive.current = true
    // A word left for this screen has been read by now.
    clearNote(path)
    // The window's body is inert beneath the screen: focus left in it (the
    // page, a field) comes here, so no key reaches what cannot be seen.
    const root = rootRef.current
    if (root && !root.contains(document.activeElement)) {
      // A ref, not a local: StrictMode's second run finds focus here already.
      const was = document.activeElement
      before.current = was instanceof HTMLElement && was !== document.body ? was : null
      root.focus({ preventScroll: true })
    }
    return () => {
      alive.current = false
      // Back where the writer was, the page as a rule, once the screen has
      // gone and what it covered can take focus again — unless focus has
      // somewhere else to be by then.
      const now = document.activeElement
      const was = before.current
      if (was?.isConnected && (!now || now === document.body || root?.contains(now))) {
        was.focus({ preventScroll: true })
      }
    }
  }, [path])

  // Any move puts down what the keyboard was holding.
  const move = (fn: (a: Arrangement) => Arrangement): void => {
    if (busyRef.current) return
    setError(null)
    setNote(null)
    setHeld(null)
    dispatch({ type: 'move', move: fn })
  }

  const later = (): void => {
    if (busyRef.current) return
    useWyrm.getState().dismissConflicts()
  }

  const goTo = (n: number): void => {
    setHeld(null)
    setAt(n)
  }

  // ⌘Z undoes a move; Esc is Later, as it is "back" everywhere else (App's
  // own Esc stands aside while the screen is up). Heard last, on the window:
  // an open menu, guided help or a dialog takes its own Esc first and stops
  // it. Mid-drag, or with cards in hand, Esc puts them back where they came
  // from and ⌘Z waits — the cursor is aimed at the page as it is drawn.
  const undoKey = (): void => {
    if (undo.length === 0) return
    // The card with focus may be put somewhere else: focus goes with it.
    const el = document.activeElement
    const { nav, key } =
      el instanceof HTMLElement && rootRef.current?.contains(el) ? el.dataset : {}
    if (nav && key) want.current = { card: key, region: nav as Region }
    dispatch({ type: 'undo' })
  }
  const putDown = (): void => setHeld(null)
  const keysRef = useRef({ later, undo: undoKey, holding: held != null, putDown })
  useEffect(() => {
    keysRef.current = { later, undo: undoKey, holding: held != null, putDown }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (document.querySelector('.dialog-overlay')) return
      const undoKey = (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z'
      if (e.key !== 'Escape' && !undoKey) return
      e.preventDefault()
      // App's window listener may come after this one (it re-registers), and
      // by then Later has taken the screen down and it would go back.
      e.stopImmediatePropagation()
      if (pending.current) {
        if (e.key === 'Escape') unlisten.current?.()
        return
      }
      if (keysRef.current.holding) {
        if (e.key === 'Escape') keysRef.current.putDown()
        return
      }
      if (busyRef.current) return
      if (e.key === 'Escape') keysRef.current.later()
      else keysRef.current.undo()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      unlisten.current?.()
    }
  }, [])

  const finish = async (): Promise<void> => {
    if (busyRef.current) return
    setHeld(null)
    const blank = unchosen(arr)
    if (blank != null) {
      goTo(pages.findIndex((p) => p.chapter === blank))
      setNote(`Choose which version of “${arr[blank].title}” to keep first.`)
      return
    }
    const { choices, scraps } = answerOf(arr, new Date().toISOString(), newId)
    busyRef.current = true
    setBusy(true)
    setError(null)
    let failed: string | null = null
    try {
      const outcome = await useWyrm.getState().resolveConflicts(choices, scraps)
      if (outcome.status === 'merged') {
        forget(path)
      } else if (outcome.status === 'error' || outcome.status === 'offline') {
        failed = outcome.detail
      } else if (outcome.status === 'conflicts' && !alive.current) {
        // A screen that is up lays the fresh list out and says so itself.
        leaveNote(path, { text: MOVED, error: false })
      }
    } catch (e) {
      failed = errorMessage(e)
    } finally {
      busyRef.current = false
      if (alive.current) {
        // While it was on its way the main area was inert and Finish off,
        // which leaves focus nowhere: back to Finish, if nothing took it.
        want.current = { finish: true }
        setBusy(false)
      }
    }
    if (failed != null) {
      // Said beside the buttons, or, if the screen went meanwhile, when it
      // next comes up: a failure nobody sees is a failure the writer trusts.
      if (alive.current) setError(failed)
      else leaveNote(path, { text: failed, error: true })
    }
  }

  const page = pages[at]
  const chapter = page ? arr[page.chapter] : undefined
  const binned = tray(arr, 'bin')
  const padded = tray(arr, 'pad')
  const left = leftovers(arr).length

  /* ---------- dragging ---------- */

  const targetAt = (
    x: number,
    y: number,
    ch: ProseChapter,
    ids: string[],
    start: number
  ): Target | null => {
    const inside = (el: Element | null): boolean => {
      if (!el) return false
      const r = el.getBoundingClientRect()
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
    }
    if (inside(binRef.current)) return { kind: 'bin' }
    if (inside(padRef.current)) return { kind: 'pad' }
    // The page and stacks scroll inside the main area: past its edge (over
    // the bars, or the foot away from the bin and pad) they are out of sight,
    // and a drop there is on nothing.
    if (!inside(mainRef.current)) return null
    const sheet = pageRef.current
    if (sheet && inside(sheet)) {
      const rects = [...sheet.querySelectorAll('[data-item]')].map((el) =>
        el.getBoundingClientRect()
      )
      const k = dropIndex(rects, y)
      const top = sheet.getBoundingClientRect().top
      const line =
        rects.length === 0
          ? top + 12
          : k === 0
            ? rects[0].top - 4
            : k === rects.length
              ? rects[k - 1].bottom + 4
              : (rects[k - 1].bottom + rects[k].top) / 2
      return { kind: 'page', index: start + k, bar: line - top }
    }
    const side = ch.cards[ids[0]]?.side
    const home = side === 'local' ? localRef : side === 'incoming' ? incomingRef : bothRef
    return inside(home.current) ? { kind: 'stack' } : null
  }

  /**
   * A press on a card (or a stack's clip) starts a drag, tracked on the
   * document from the press, as the corkboard's cards are — a fast first move
   * off the card is otherwise never heard. No capture is taken.
   */
  const press = (e: ReactPointerEvent, ids: string[], start: number): void => {
    if (e.button !== 0 || !page?.page || chapter?.kind !== 'prose' || busyRef.current) return
    e.preventDefault()
    e.stopPropagation()
    // The pointer takes over from the keyboard.
    setHeld(null)
    const ch = chapter
    const pageId = page.page.id
    const p: Drag = { chapter: page.chapter, ids, x: e.clientX, y: e.clientY, started: false }
    pending.current = p
    // Where the pointer is now: the page can scroll under a still pointer.
    let x = e.clientX
    let y = e.clientY
    const aim = (): void => setDrag({ ...p, x, y, target: targetAt(x, y, ch, ids, start) })
    const onMove = (ev: PointerEvent): void => {
      x = ev.clientX
      y = ev.clientY
      if (!p.started) {
        if (Math.hypot(x - p.x, y - p.y) < 4) return
        p.started = true
      }
      aim()
    }
    // A wheel scroll mid-drag sends no pointermove: aimed again, so the
    // cursor stays under the pointer and the drop lands where it shows.
    const onScroll = (): void => {
      if (p.started) aim()
    }
    const stop = (): void => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onCancel)
      document.removeEventListener('scroll', onScroll, true)
      unlisten.current = null
      pending.current = null
      setDrag(null)
    }
    const onUp = (ev: PointerEvent): void => {
      const target = p.started ? targetAt(ev.clientX, ev.clientY, ch, ids, start) : null
      stop()
      if (!target) return
      if (target.kind === 'page') move((a) => placeOn(a, p.chapter, target.index, ids))
      else {
        // A stack on this page: the card goes on the stack it was dropped on.
        const to = target.kind === 'stack' ? 'stack' : target.kind
        move((a) => ids.reduce((acc, id) => takeOff(acc, p.chapter, id, to, pageId), a))
      }
    }
    const onCancel = (): void => stop()
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onCancel)
    document.addEventListener('scroll', onScroll, true)
    unlisten.current = stop
  }

  const dragging = new Set(drag?.started ? drag.ids : [])

  /* ---------- the keyboard ---------- */

  // A hold is on the page in front: turning the page puts it down.
  const hand =
    held && page?.page && held.chapter === page.chapter && held.pageId === page.page.id
      ? held
      : null
  const holding = new Set(hand?.ids ?? [])

  // Each place's cards, in the order ↑ and ↓ go through them: a stack of
  // more than one starts with its clip, above its top card.
  const lists: Record<Region, string[]> = { local: [], incoming: [], both: [], page: [] }
  if (page?.page && chapter?.kind === 'prose') {
    for (const side of ['local', 'incoming'] as const) {
      const ids = stackOf(chapter, page.page.id, side)
      lists[side] = ids.length > 1 ? ['clip', ...ids] : ids
    }
    lists.both = stackOf(chapter, page.page.id, 'both')
    lists.page = pageItems(chapter.items, page.page)
      .shown.filter((i) => i.kind === 'card')
      .map((i) => i.id)
  }
  const cardsOf = (region: Region): string[] => lists[region].filter((k) => k !== 'clip')

  /** One tab stop a place: the card last focused there, or its top card. */
  const tabStop = (region: Region, key: string): 0 | -1 => {
    const keys = lists[region]
    const on = keys.includes(active[region] ?? '') ? active[region] : cardsOf(region)[0]
    return on === key ? 0 : -1
  }

  const onFocus = (e: ReactFocusEvent): void => {
    const { nav, key } = (e.target as HTMLElement).dataset
    if (!nav || !key) {
      setFocused(null)
      return
    }
    const region = nav as Region
    setActive((a) => (a[region] === key ? a : { ...a, [region]: key }))
    setFocused({ region, key })
  }

  const onBlur = (e: ReactFocusEvent): void => {
    const { nav, key } = (e.target as HTMLElement).dataset
    if (!nav) return
    setFocused(null)
    // Cards in hand are put down when focus goes elsewhere, by a click or
    // Tab — though not when the app loses focus to another program, which
    // is the one blur with nowhere to go and the document unfocused.
    const away = e.relatedTarget != null || document.hasFocus()
    if (held && held.region === nav && held.key === key && away) setHeld(null)
  }

  /** Cards into the bin or onto the pad; focus to the card after them. */
  const send = (ids: string[], to: 'bin' | 'pad', region: Region, index: number): void => {
    if (!page?.page) return
    const c = page.chapter
    const pageId = page.page.id
    move((a) => ids.reduce((acc, id) => takeOff(acc, c, id, to, pageId), a))
    want.current = { region, index }
  }

  /**
   * Return picks up the focused card (or, on the clip, its whole stack) and
   * shows the cursor where it would go; ↑ and ↓ move the cursor between the
   * paragraphs and Return puts the cards there. Delete bins, S keeps on the
   * scratch pad. Esc puts what is in hand back; with nothing in hand it is
   * Later, heard on the window.
   */
  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey || busyRef.current) return
    const { nav, key } = (e.target as HTMLElement).dataset
    if (!nav || !key || !page?.page || chapter?.kind !== 'prose') return
    const region = nav as Region
    const sheet = page.page
    const pick = e.key === 'Enter' || e.key === ' '
    const to =
      e.key === 'Delete' || e.key === 'Backspace'
        ? 'bin'
        : e.key.toLowerCase() === 's'
          ? 'pad'
          : null
    const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
    if (hand) {
      if (e.key === 'Tab') {
        setHeld(null)
        return
      }
      if (e.key === 'Escape') {
        // Its own Esc, so stopped: the cards go back, and the screen stays.
        e.preventDefault()
        e.stopPropagation()
        setHeld(null)
        return
      }
      if (!step && !pick && !to) return
      e.preventDefault()
      if (step) {
        setHeld({ ...hand, at: keyStep(keySpots(chapter, sheet, hand.ids), hand.at, step) })
      } else if (pick) {
        const { chapter: c, at: where, ids } = hand
        move((a) => placeOn(a, c, where, ids))
        want.current = { card: ids[0] }
      } else if (to) {
        send(hand.ids, to, hand.region, lists[hand.region].indexOf(hand.key))
      }
      return
    }
    if (!step && !pick && !to) return
    e.preventDefault()
    const k = lists[region].indexOf(key)
    if (step) {
      const next = lists[region][k + step]
      if (next) {
        rootRef.current
          ?.querySelector<HTMLElement>(`[data-nav="${region}"][data-key="${next}"]`)
          ?.focus()
      }
      return
    }
    const ids = key === 'clip' ? cardsOf(region) : [key]
    if (pick) {
      setHeld({
        chapter: page.chapter,
        pageId: sheet.id,
        region,
        key,
        ids,
        at: keyStart(chapter, sheet, ids)
      })
    } else if (to) {
      send(ids, to, region, k)
    }
  }

  // The cursor kept in sight as it moves down a long page.
  const cursorRef = useRef<HTMLDivElement>(null)
  const cursorAt = hand ? `${hand.pageId}:${hand.at}` : null
  useEffect(() => {
    if (cursorAt) cursorRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [cursorAt])

  // Focus follows a move, once it is drawn: the card that had it may have
  // gone. A button is focused only once the key that pressed it is up, or
  // Chromium hands that key to the new button too.
  useEffect(() => {
    const w = want.current
    const root = rootRef.current
    if (!w || !root) return
    want.current = null
    const one = (selector: string): HTMLElement | null => root.querySelector(selector)
    if ('card' in w) {
      const el =
        (w.region ? one(`[data-nav="${w.region}"][data-key="${w.card}"]`) : null) ??
        (w.card === 'clip' ? null : one(`[data-nav][data-key="${w.card}"]`))
      // Gone altogether (a clip whose stack undo broke up): the screen, so
      // the keys still have somewhere to go.
      ;(el ?? (root.contains(document.activeElement) ? null : root))?.focus()
    } else if ('region' in w) {
      // In the order ↑ and ↓ go, which puts a stack's clip first.
      const keys = lists[w.region]
      const next = keys[Math.min(w.index, keys.length - 1)]
      ;(
        (next ? one(`[data-nav="${w.region}"][data-key="${next}"]`) : null) ??
        one(`[data-place="${w.region}"]`)
      )?.focus()
    } else if ('place' in w) {
      one(`[data-place="${w.place}"]`)?.focus()
    } else if ('tray' in w) {
      const rows = root.querySelectorAll<HTMLElement>('[data-put-back]')
      const el = rows[Math.min(w.tray, rows.length - 1)] ?? one('.merge-tray')
      if (el) afterKeysUp(() => el.focus())
    } else {
      const now = document.activeElement
      if (now && now !== document.body) return
      afterKeysUp(() => finishRef.current?.focus())
    }
  })

  /* ---------- drawing ---------- */

  let body: ReactNode
  if (!page || !chapter) {
    body = (
      <div className="merge-nothing dialog-hint">
        Only blank lines changed, and they need no one’s eye. Finish to bring the work together.
      </div>
    )
  } else if (chapter.kind === 'choice') {
    body = (
      <ChoicePage
        chapter={chapter}
        conflict={conflicts.find((c) => c.path === chapter.path)}
        onChoose={(r) => move((a) => choose(a, page.chapter, r))}
      />
    )
  } else {
    const sheet = page.page!
    const { start, shown } = pageItems(chapter.items, sheet)
    const dispute = sheet.dispute
      ? chapter.merge.disputes.find((d) => d.id === sheet.dispute)
      : null
    const conflict = conflicts.find((c) => c.path === chapter.path)
    const both = lists.both
    const stack = (side: MergeSide): JSX.Element => (
      <Stack
        side={side}
        when={whenWritten(
          side === 'local' ? (conflict?.localAt ?? null) : (conflict?.remoteAt ?? null)
        )}
        deleted={dispute?.deleted === side}
        ids={cardsOf(side)}
        cards={chapter.cards}
        dragging={dragging}
        holding={holding}
        tabStop={(key) => tabStop(side, key)}
        hot={drag?.target?.kind === 'stack' && chapter.cards[drag.ids[0]]?.side === side}
        columnRef={side === 'local' ? localRef : incomingRef}
        onPress={(e, ids) => press(e, ids, start)}
        onIntoGap={
          dispute
            ? () => {
                const first = cardsOf(side)[0]
                move((a) => intoGap(a, page.chapter, sheet.id, side))
                // The button goes with the stack: focus to the stack's top
                // card, on the page now.
                if (first) want.current = { card: first }
              }
            : undefined
        }
      />
    )
    // The keyboard's cursor, in the page's own flow between two paragraphs.
    const keyCursor = (
      <div className="merge-cursor-slot" ref={cursorRef} aria-hidden>
        <div className="merge-cursor" />
      </div>
    )
    body = (
      <div className="merge-body">
        {stack('local')}
        <div className="merge-page-column">
          <div
            className="merge-page"
            ref={pageRef}
            data-place="page"
            tabIndex={-1}
            data-help="merge-page"
          >
            <div className="merge-page-head">
              <span>{chapter.title}</span>
              <span>
                {page.n} of {page.of}
              </span>
            </div>
            {shown.map((item, k) => (
              <Fragment key={item.id}>
                {hand?.at === start + k && keyCursor}
                <PageItem
                  item={item}
                  cards={chapter.cards}
                  lifted={item.kind === 'card' && dragging.has(item.id)}
                  held={item.kind === 'card' && holding.has(item.id)}
                  tab={item.kind === 'card' ? tabStop('page', item.id) : -1}
                  onPress={(e, id) => press(e, [id], start)}
                  onPutBack={(id) => {
                    move((a) => putBack(a, page.chapter, id))
                    // Its button goes with it.
                    want.current = { place: 'page' }
                  }}
                />
              </Fragment>
            ))}
            {hand?.at === start + shown.length && keyCursor}
            {drag?.target?.kind === 'page' && (
              <div className="merge-cursor" style={{ top: drag.target.bar }} aria-hidden />
            )}
          </div>
          {/* Drawn while the dispute offers the card, on the page or not, so
              a placed Both edits card can be dragged back to it. */}
          {dispute?.both && (
            <div
              className={`merge-both${drag?.target?.kind === 'stack' && chapter.cards[drag.ids[0]]?.side === 'both' ? ' hot' : ''}`}
              ref={bothRef}
              data-place="both"
              tabIndex={-1}
              data-help="merge-both"
            >
              <div className="merge-stack-head">
                <span className="merge-side">BOTH EDITS</span>
                <span className="merge-when">Each computer’s change, in one paragraph</span>
              </div>
              {both.length === 0 && <div className="merge-empty">Nothing left here.</div>}
              {both.map((id) => (
                <Card
                  key={id}
                  card={chapter.cards[id]}
                  region="both"
                  lifted={dragging.has(id)}
                  held={holding.has(id)}
                  tab={tabStop('both', id)}
                  onPress={(e) => press(e, [id], start)}
                />
              ))}
            </div>
          )}
        </div>
        {stack('incoming')}
      </div>
    )
  }

  const trayList = trayOpen === 'bin' ? binned : trayOpen === 'pad' ? padded : []
  const draggedCards =
    drag?.started && chapter?.kind === 'prose' ? drag.ids.map((id) => chapter.cards[id]) : []

  return (
    <div
      className="terminal merge-screen"
      ref={rootRef}
      tabIndex={-1}
      data-help="merge-screen"
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <div className="entity-main-bar merge-bar">
        <span className="entity-kind">COMBINE</span>
        <span className="row-title">Changes from two computers</span>
        <span className="spacer" />
        <button
          type="button"
          className="btn small"
          aria-label="Previous page"
          data-help="merge-pages"
          disabled={at === 0}
          onClick={() => goTo(at - 1)}
        >
          ‹
        </button>
        <span className="merge-page-count" data-help="merge-pages">
          {pages.length === 0 ? 'Nothing to arrange' : `Page ${at + 1} of ${pages.length}`}
        </span>
        <button
          type="button"
          className="btn small"
          aria-label="Next page"
          data-help="merge-pages"
          disabled={at >= pages.length - 1}
          onClick={() => goTo(at + 1)}
        >
          ›
        </button>
      </div>
      <div className="merge-main" ref={mainRef} inert={busy}>
        {body}
      </div>
      <div className="merge-foot">
        <button
          ref={binRef}
          type="button"
          className={`merge-drop${drag?.target?.kind === 'bin' ? ' hot' : ''}`}
          aria-expanded={trayOpen === 'bin'}
          data-help="merge-bin"
          onClick={() => setTrayOpen(trayOpen === 'bin' ? null : 'bin')}
        >
          Bin · {binned.length}
        </button>
        <button
          ref={padRef}
          type="button"
          className={`merge-drop${drag?.target?.kind === 'pad' ? ' hot' : ''}`}
          aria-expanded={trayOpen === 'pad'}
          data-help="merge-pad"
          onClick={() => setTrayOpen(trayOpen === 'pad' ? null : 'pad')}
        >
          Scratch Pad · {padded.length}
        </button>
        <span className="spacer" />
        <button
          type="button"
          className="btn"
          data-help="merge-undo"
          disabled={undo.length === 0 || busy}
          onClick={() => dispatch({ type: 'undo' })}
        >
          Undo
        </button>
        <button
          type="button"
          className="btn"
          data-help="merge-later"
          disabled={busy}
          onClick={later}
        >
          Later
        </button>
        <button
          ref={finishRef}
          type="button"
          className="btn default"
          data-help="merge-finish"
          disabled={busy}
          onClick={() => void finish()}
        >
          {busy ? 'Combining…' : left > 0 ? `Finish · ${left} to scratch pad` : 'Finish'}
        </button>
      </div>
      {trayOpen && (
        <div className="merge-tray" inert={busy} tabIndex={-1} data-help="merge-tray">
          <div className="merge-tray-head">
            {trayOpen === 'bin'
              ? 'In the bin: kept until you finish, and in the history after.'
              : 'On the scratch pad: never part of the book.'}
          </div>
          {trayList.length === 0 ? (
            <div className="dialog-hint">Empty.</div>
          ) : (
            trayList.map(({ chapter: c, id }, k) => {
              const ch = arr[c] as ProseChapter
              const card = ch.cards[id]
              return (
                <div key={`${c}:${id}`} className="merge-tray-row">
                  <span className="merge-tray-text">
                    {SIDE_NAME[card.side]} · {ch.title}: {card.runs.map((r) => r.text).join('')}
                  </span>
                  <button
                    type="button"
                    className="btn small"
                    data-put-back
                    onClick={() => {
                      move((a) => takeOff(a, c, id, 'stack'))
                      // Its row goes with it: focus to the next one's.
                      want.current = { tray: k }
                    }}
                  >
                    Put back
                  </button>
                </div>
              )
            })
          )}
        </div>
      )}
      <div className={`merge-hint${error ? ' error-text' : ''}`} role={error ? 'alert' : undefined}>
        {error ??
          (hand
            ? holdHint(hand.ids.length)
            : (note ?? (focused ? (focused.key === 'clip' ? CLIP_HINT : CARD_HINT) : HINT)))}
      </div>
      {draggedCards.length > 0 && drag && (
        <div className="merge-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden>
          {draggedCards.map((c) => (
            <div key={c.id} className="merge-card">
              <Runs runs={c.runs} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------- pieces ---------- */

function Stack({
  side,
  when,
  deleted,
  ids,
  cards,
  dragging,
  holding,
  tabStop,
  hot,
  columnRef,
  onPress,
  onIntoGap
}: {
  side: MergeSide
  when: string
  deleted: boolean
  ids: string[]
  cards: Record<string, MergeCard>
  dragging: Set<string>
  holding: Set<string>
  /** Whether a card (or `clip`) is this stack's one tab stop. */
  tabStop: (key: string) => 0 | -1
  hot: boolean
  columnRef: RefObject<HTMLDivElement | null>
  onPress: (e: ReactPointerEvent, ids: string[]) => void
  onIntoGap?: () => void
}): JSX.Element {
  return (
    <div
      className={`merge-stack${hot ? ' hot' : ''}`}
      data-side={side}
      ref={columnRef}
      data-place={side}
      tabIndex={-1}
      data-help="merge-stack"
    >
      <div className="merge-stack-head">
        <span className="merge-side">{side === 'local' ? 'LOCAL' : 'INCOMING'}</span>
        <span className="merge-when">
          {side === 'local' ? 'This computer' : 'Other computer'}
          {when ? ` · ${when}` : ''}
        </span>
      </div>
      {deleted && (
        <div className="merge-empty">
          Deleted on {whereName(side)}. Leave this side empty to agree.
        </div>
      )}
      {!deleted && ids.length === 0 && <div className="merge-empty">Nothing left here.</div>}
      <div className="merge-cards">
        {ids.map((id, k) => (
          <Card
            key={id}
            card={cards[id]}
            region={side}
            lifted={dragging.has(id)}
            held={holding.has(id)}
            tab={tabStop(id)}
            onPress={(e) => onPress(e, [id])}
            clip={
              k === 0 && ids.length > 1
                ? { press: (e: ReactPointerEvent) => onPress(e, ids), tab: tabStop('clip') }
                : undefined
            }
          />
        ))}
      </div>
      {onIntoGap && ids.length > 0 && (
        <button type="button" className="btn small" data-help="merge-into-gap" onClick={onIntoGap}>
          {ids.length > 1 ? 'All into the gap' : 'Into the gap'}
        </button>
      )}
    </div>
  )
}

function Card({
  card,
  region,
  lifted,
  held,
  tab,
  onPress,
  clip
}: {
  card: MergeCard
  region: Region
  lifted: boolean
  /** Picked up from the keyboard. */
  held: boolean
  tab: 0 | -1
  onPress: (e: ReactPointerEvent) => void
  /** The paper clip on the top card of a stack, the handle for all of it. */
  clip?: { press: (e: ReactPointerEvent) => void; tab: 0 | -1 }
}): JSX.Element {
  return (
    <div
      className={`merge-card${lifted ? ' lifted' : ''}${held ? ' held' : ''}${clip ? ' clipped' : ''}`}
      data-card={card.id}
      data-nav={region}
      data-key={card.id}
      tabIndex={tab}
      data-help="merge-card"
      onPointerDown={onPress}
    >
      {clip && (
        <span
          className="merge-clip"
          role="button"
          aria-label="The whole stack"
          title="Drag the clip to move the whole stack, in order"
          data-nav={region}
          data-key="clip"
          tabIndex={clip.tab}
          data-help="merge-clip"
          onPointerDown={(e) => {
            e.stopPropagation()
            clip.press(e)
          }}
        >
          <PaperClip />
        </span>
      )}
      <CardTags card={card} />
      <Runs runs={card.runs} />
    </div>
  )
}

function CardTags({ card }: { card: MergeCard }): JSX.Element | null {
  const tags = [
    ...(card.isNew ? ['New'] : []),
    ...(card.restyled ? ['Restyled'] : []),
    ...(card.cut ? ['Cut'] : [])
  ]
  if (tags.length === 0) return null
  return (
    <span className="merge-card-tags">
      {tags.map((t) => (
        <span key={t} className="merge-tag">
          {t}
        </span>
      ))}
    </span>
  )
}

function PageItem({
  item,
  cards,
  lifted,
  held,
  tab,
  onPress,
  onPutBack
}: {
  item: MergeItem
  cards: Record<string, MergeCard>
  lifted: boolean
  held: boolean
  tab: 0 | -1
  onPress: (e: ReactPointerEvent, id: string) => void
  onPutBack: (id: string) => void
}): JSX.Element | null {
  const spaced = (blanks: number): { marginTop?: string } =>
    blanks > 0 ? { marginTop: `${blanks * 1.7}em` } : {}
  if (item.kind === 'text') {
    return (
      <p className="merge-text" data-item style={spaced(item.blanks)}>
        <Runs runs={styledRuns(item.markdown)} />
      </p>
    )
  }
  if (item.kind === 'gap') {
    return (
      <div className="merge-gap" data-item data-help="merge-gap">
        <span className="merge-tag">
          {item.before.length > 0 ? 'Before · both changed this' : 'Both computers added here'}
        </span>
        {item.before.map((md, k) => (
          <p key={k} className="merge-was">
            <s>
              <Runs runs={styledRuns(md)} />
            </s>
          </p>
        ))}
      </div>
    )
  }
  if (item.kind === 'removed') {
    return (
      <div className="merge-removed" data-item data-help="merge-removed">
        <span className="merge-tag">Removed on {whereName(item.side)}</span>
        {item.before.map((p, k) => (
          <p key={k} className="merge-was">
            <s>
              <Runs runs={styledRuns(p.markdown)} />
            </s>
          </p>
        ))}
        <button type="button" className="btn small" onClick={() => onPutBack(item.id)}>
          Put back
        </button>
      </div>
    )
  }
  const card = cards[item.id]
  if (!card) return null
  return (
    <div
      className={`merge-placed${lifted ? ' lifted' : ''}${held ? ' held' : ''}`}
      data-item
      data-card={card.id}
      data-nav="page"
      data-key={card.id}
      tabIndex={tab}
      data-help="merge-placed"
      style={spaced(card.blanks)}
      onPointerDown={(e) => onPress(e, card.id)}
    >
      <span className="merge-tag">
        {SIDE_NAME[card.side]}
        {card.only ? ' · only changed there' : ''}
      </span>
      <CardTags card={card} />
      <p className="merge-text">
        <Runs runs={card.runs} />
      </p>
    </div>
  )
}

function ChoicePage({
  chapter,
  conflict,
  onChoose
}: {
  chapter: ChoiceChapter
  conflict: SyncConflict | undefined
  onChoose: (resolution: ConflictResolution) => void
}): JSX.Element {
  const options: { value: ConflictResolution; label: string }[] = [
    { value: 'mine', label: 'Keep this computer’s' },
    { value: 'theirs', label: 'Take your other computer’s' },
    ...(chapter.both
      ? [{ value: 'both' as const, label: 'Keep this computer’s, and the other as a variant' }]
      : [])
  ]
  const side = (
    label: string,
    body: string | null | undefined,
    when: number | null
  ): JSX.Element => (
    <section className="merge-choice-side">
      <div className="merge-stack-head">
        <span className="merge-side">{label === 'local' ? 'LOCAL' : 'INCOMING'}</span>
        <span className="merge-when">
          {label === 'local' ? 'This computer' : 'Other computer'}
          {when ? ` · ${whenWritten(when)}` : ''}
        </span>
      </div>
      <pre className="merge-choice-text">
        {body ?? `Deleted on ${whereName(label as MergeSide)}.`}
      </pre>
    </section>
  )
  return (
    <div className="merge-choice">
      <h3 className="merge-choice-title">{chapter.title}</h3>
      <p className="dialog-hint">
        This changed on both computers, and it is not prose to arrange: choose the one to keep. The
        other stays in the history.
      </p>
      <div className="merge-choice-sides">
        {side('local', conflict?.localBody, conflict?.localAt ?? null)}
        {side('incoming', conflict?.remoteBody, conflict?.remoteAt ?? null)}
      </div>
      <div
        className="merge-choice-options"
        role="group"
        aria-label="Which to keep"
        data-help="merge-choice"
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`btn${chapter.choice === o.value ? ' default' : ''}`}
            aria-pressed={chapter.choice === o.value}
            onClick={() => onChoose(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** A paragraph's runs, styled as the page styles them; the words a side
 *  changed underlined. */
function Runs({ runs }: { runs: CardRun[] }): JSX.Element {
  return (
    <>
      {runs.map((r, i) => {
        if (r.break) {
          // A hard break a side put in is marked, or it would not show.
          return r.changed ? (
            <span key={i}>
              <u className="merge-changed">↵</u>
              <br />
            </span>
          ) : (
            <br key={i} />
          )
        }
        let node: ReactNode = r.text
        if (r.highlight) node = <mark>{node}</mark>
        if (r.italic) node = <em>{node}</em>
        if (r.bold) node = <strong>{node}</strong>
        if (r.changed) node = <u className="merge-changed">{node}</u>
        return <span key={i}>{node}</span>
      })}
    </>
  )
}
