import { useEffect, useReducer, useRef, useState } from 'react'
import type { JSX, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
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
  dropIndex,
  forget,
  intoGap,
  leftovers,
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
import { useWyrm } from '../store'
import { PaperClip } from './PaperClip'

/** What the hint line says when there is nothing else to say. */
const HINT =
  'Drag a card onto the page; the cursor shows where it lands. Drag a stack’s clip to move it all. Underlined words changed.'

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

function Screen({ path, conflicts }: { path: string; conflicts: SyncConflict[] }): JSX.Element {
  const [{ arr, undo }, dispatch] = useReducer(reduce, null, () => ({
    arr: arrange(conflicts, recall(path)),
    undo: []
  }))
  const pages = pagesOf(arr)
  const [wanted, setAt] = useState(0)
  const at = Math.min(wanted, Math.max(0, pages.length - 1))
  const [trayOpen, setTrayOpen] = useState<'bin' | 'pad' | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // The store puts a fresh list on screen only when the versions moved under
  // an answer (a sync landing meanwhile leaves the list alone). It is laid
  // out again here, during render, as React has state follow a prop.
  const [shown, setShown] = useState(conflicts)
  if (shown !== conflicts) {
    setShown(conflicts)
    dispatch({ type: 'fresh', conflicts })
    setNote(MOVED)
  }
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState<(Drag & { target: Target | null }) | null>(null)

  const pageRef = useRef<HTMLDivElement>(null)
  const binRef = useRef<HTMLButtonElement>(null)
  const padRef = useRef<HTMLButtonElement>(null)
  const localRef = useRef<HTMLDivElement>(null)
  const incomingRef = useRef<HTMLDivElement>(null)
  const bothRef = useRef<HTMLDivElement>(null)
  const pending = useRef<Drag | null>(null)
  const unlisten = useRef<(() => void) | null>(null)

  // Kept while the app is open: Later, or another novel coming forward,
  // leaves what the writer arranged to come back to.
  useEffect(() => {
    remember(path, arr)
  }, [path, arr])

  const move = (fn: (a: Arrangement) => Arrangement): void => {
    setError(null)
    setNote(null)
    dispatch({ type: 'move', move: fn })
  }

  const later = (): void => {
    useWyrm.getState().dismissConflicts()
  }

  // ⌘Z undoes a move; Esc is Later, as it is "back" everywhere else. Both are
  // this screen's while it is up, and nobody else's.
  const keysRef = useRef({ later, undo: () => dispatch({ type: 'undo' }) })
  useEffect(() => {
    keysRef.current = { later, undo: () => dispatch({ type: 'undo' }) }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (document.querySelector('.dialog-overlay')) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        keysRef.current.later()
      } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.stopImmediatePropagation()
        keysRef.current.undo()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      unlisten.current?.()
    }
  }, [])

  const finish = async (): Promise<void> => {
    const blank = unchosen(arr)
    if (blank != null) {
      setAt(pages.findIndex((p) => p.chapter === blank))
      setNote(`Choose which version of “${arr[blank].title}” to keep first.`)
      return
    }
    const { choices, scraps } = answerOf(arr, new Date().toISOString(), newId)
    setBusy(true)
    setError(null)
    try {
      const outcome = await useWyrm.getState().resolveConflicts(choices, scraps)
      if (outcome.status === 'merged') {
        forget(path)
      } else if (outcome.status === 'error' || outcome.status === 'offline') {
        setError(outcome.detail)
      }
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
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
    if (e.button !== 0 || !page || chapter?.kind !== 'prose') return
    e.preventDefault()
    e.stopPropagation()
    const ch = chapter
    const p: Drag = { chapter: page.chapter, ids, x: e.clientX, y: e.clientY, started: false }
    pending.current = p
    const onMove = (ev: PointerEvent): void => {
      if (!p.started) {
        if (Math.hypot(ev.clientX - p.x, ev.clientY - p.y) < 4) return
        p.started = true
      }
      setDrag({
        ...p,
        x: ev.clientX,
        y: ev.clientY,
        target: targetAt(ev.clientX, ev.clientY, ch, ids, start)
      })
    }
    const stop = (): void => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onCancel)
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
        const to = target.kind === 'stack' ? 'stack' : target.kind
        move((a) => ids.reduce((acc, id) => takeOff(acc, p.chapter, id, to), a))
      }
    }
    const onCancel = (): void => stop()
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onCancel)
    unlisten.current = stop
  }

  const dragging = new Set(drag?.started ? drag.ids : [])

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
    const both = stackOf(chapter, sheet.id, 'both')
    const stack = (side: MergeSide): JSX.Element => (
      <Stack
        side={side}
        when={whenWritten(
          side === 'local' ? (conflict?.localAt ?? null) : (conflict?.remoteAt ?? null)
        )}
        deleted={dispute?.deleted === side}
        ids={stackOf(chapter, sheet.id, side)}
        cards={chapter.cards}
        dragging={dragging}
        hot={drag?.target?.kind === 'stack' && chapter.cards[drag.ids[0]]?.side === side}
        columnRef={side === 'local' ? localRef : incomingRef}
        onPress={(e, ids) => press(e, ids, start)}
        onIntoGap={
          dispute ? () => move((a) => intoGap(a, page.chapter, sheet.id, side)) : undefined
        }
      />
    )
    body = (
      <div className="merge-body">
        {stack('local')}
        <div className="merge-page-column">
          <div className="merge-page" ref={pageRef}>
            <div className="merge-page-head">
              <span>{chapter.title}</span>
              <span>
                {page.n} of {page.of}
              </span>
            </div>
            {shown.map((item) => (
              <PageItem
                key={item.id}
                item={item}
                cards={chapter.cards}
                lifted={item.kind === 'card' && dragging.has(item.id)}
                onPress={(e, id) => press(e, [id], start)}
                onPutBack={(id) => move((a) => putBack(a, page.chapter, id))}
              />
            ))}
            {drag?.target?.kind === 'page' && (
              <div className="merge-cursor" style={{ top: drag.target.bar }} aria-hidden />
            )}
          </div>
          {dispute?.both && both.length > 0 && (
            <div
              className={`merge-both${drag?.target?.kind === 'stack' && chapter.cards[drag.ids[0]]?.side === 'both' ? ' hot' : ''}`}
              ref={bothRef}
            >
              {both.map((id) => (
                <Card
                  key={id}
                  card={chapter.cards[id]}
                  lifted={dragging.has(id)}
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
    <div className="terminal merge-screen">
      <div className="entity-main-bar merge-bar">
        <span className="entity-kind">COMBINE</span>
        <span className="row-title">Changes from two computers</span>
        <span className="spacer" />
        <button
          type="button"
          className="btn small"
          aria-label="Previous page"
          disabled={at === 0}
          onClick={() => setAt(at - 1)}
        >
          ‹
        </button>
        <span className="merge-page-count">
          {pages.length === 0 ? 'Nothing to arrange' : `Page ${at + 1} of ${pages.length}`}
        </span>
        <button
          type="button"
          className="btn small"
          aria-label="Next page"
          disabled={at >= pages.length - 1}
          onClick={() => setAt(at + 1)}
        >
          ›
        </button>
      </div>
      <div className="merge-main">{body}</div>
      <div className="merge-foot">
        <button
          ref={binRef}
          type="button"
          className={`merge-drop${drag?.target?.kind === 'bin' ? ' hot' : ''}`}
          aria-expanded={trayOpen === 'bin'}
          onClick={() => setTrayOpen(trayOpen === 'bin' ? null : 'bin')}
        >
          Bin · {binned.length}
        </button>
        <button
          ref={padRef}
          type="button"
          className={`merge-drop${drag?.target?.kind === 'pad' ? ' hot' : ''}`}
          aria-expanded={trayOpen === 'pad'}
          onClick={() => setTrayOpen(trayOpen === 'pad' ? null : 'pad')}
        >
          Scratch Pad · {padded.length}
        </button>
        <span className="spacer" />
        <button
          type="button"
          className="btn"
          disabled={undo.length === 0}
          onClick={() => dispatch({ type: 'undo' })}
        >
          Undo
        </button>
        <button type="button" className="btn" onClick={later}>
          Later
        </button>
        <button type="button" className="btn default" disabled={busy} onClick={() => void finish()}>
          {busy ? 'Combining…' : left > 0 ? `Finish · ${left} to scratch pad` : 'Finish'}
        </button>
      </div>
      {trayOpen && (
        <div className="merge-tray">
          <div className="merge-tray-head">
            {trayOpen === 'bin'
              ? 'In the bin: kept until you finish, and in the history after.'
              : 'On the scratch pad: never part of the book.'}
          </div>
          {trayList.length === 0 ? (
            <div className="dialog-hint">Empty.</div>
          ) : (
            trayList.map(({ chapter: c, id }) => {
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
                    onClick={() => move((a) => takeOff(a, c, id, 'stack'))}
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
        {error ?? note ?? HINT}
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
  hot: boolean
  columnRef: RefObject<HTMLDivElement | null>
  onPress: (e: ReactPointerEvent, ids: string[]) => void
  onIntoGap?: () => void
}): JSX.Element {
  return (
    <div className={`merge-stack${hot ? ' hot' : ''}`} data-side={side} ref={columnRef}>
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
            lifted={dragging.has(id)}
            onPress={(e) => onPress(e, [id])}
            clip={k === 0 && ids.length > 1 ? (e: ReactPointerEvent) => onPress(e, ids) : undefined}
          />
        ))}
      </div>
      {onIntoGap && ids.length > 0 && (
        <button type="button" className="btn small" onClick={onIntoGap}>
          {ids.length > 1 ? 'All into the gap' : 'Into the gap'}
        </button>
      )}
    </div>
  )
}

function Card({
  card,
  lifted,
  onPress,
  clip
}: {
  card: MergeCard
  lifted: boolean
  onPress: (e: ReactPointerEvent) => void
  /** The paper clip on the top card of a stack, the handle for all of it. */
  clip?: (e: ReactPointerEvent) => void
}): JSX.Element {
  return (
    <div
      className={`merge-card${lifted ? ' lifted' : ''}`}
      data-card={card.id}
      onPointerDown={onPress}
    >
      {clip && (
        <span
          className="merge-clip"
          title="Drag the clip to move the whole stack, in order"
          onPointerDown={(e) => {
            e.stopPropagation()
            clip(e)
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
  onPress,
  onPutBack
}: {
  item: MergeItem
  cards: Record<string, MergeCard>
  lifted: boolean
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
      <div className="merge-gap" data-item>
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
      <div className="merge-removed" data-item>
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
      className={`merge-placed${lifted ? ' lifted' : ''}`}
      data-item
      data-card={card.id}
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
      <div className="merge-choice-options" role="group" aria-label="Which to keep">
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
