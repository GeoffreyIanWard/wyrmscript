import { useEffect, useRef, useState } from 'react'
import type { JSX, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { STICKER_KINDS, STRING_COLOURS, colourOf } from '../../../shared/types'
import { COLOUR_NAME, STICKER_NAME, STICKER_SIZE, stickerName } from '../lib/stickers'
import type { BoardSticker, StickerKind, StringColour } from '../../../shared/types'

/**
 * The corkboard's stickers and its colours (F-45): what a sticker looks like,
 * a sticker stuck on the board, the picker that chooses one, and the five
 * swatches that colour strings and stickers alike.
 *
 * A sticker is drawn as a die-cut one is: its shape filled with its colour,
 * a paper rim round it, the symbol (a question mark, a tick) cut out in
 * paper. On a one-colour screen the colour is the screen's ink.
 */

/** A disc, for the stickers that are a symbol on a round badge. */
const DISC = 'M 12 1.5 A 10.5 10.5 0 1 1 11.99 1.5 Z'

/** Each sticker: its body (filled with its colour) and the symbol cut out of
 *  it in paper, on a 24 × 24 grid. */
const ART: Record<StickerKind, { body: string; symbol?: string; dot?: string }> = {
  star: {
    body: 'M 12 1.5 L 14.9 8.6 L 22.5 9.2 L 16.7 14.2 L 18.5 21.6 L 12 17.6 L 5.5 21.6 L 7.3 14.2 L 1.5 9.2 L 9.1 8.6 Z'
  },
  heart: {
    body: 'M 12 21 C 4 15.5 1.5 11.5 1.5 8 C 1.5 4.8 4 2.5 7 2.5 C 9.2 2.5 11 3.8 12 5.6 C 13 3.8 14.8 2.5 17 2.5 C 20 2.5 22.5 4.8 22.5 8 C 22.5 11.5 20 15.5 12 21 Z'
  },
  dot: { body: 'M 12 3 A 9 9 0 1 1 11.99 3 Z' },
  question: {
    body: DISC,
    symbol: 'M 8.6 9 Q 8.6 5.6 12 5.6 Q 15.4 5.6 15.4 8.8 Q 15.4 10.8 12.6 12 Q 12 12.4 12 14.2',
    dot: 'M 12 16.4 A 1.4 1.4 0 1 1 11.99 16.4 Z'
  },
  exclamation: {
    body: DISC,
    symbol: 'M 12 5.6 L 12 13.4',
    dot: 'M 12 16.4 A 1.4 1.4 0 1 1 11.99 16.4 Z'
  },
  check: { body: DISC, symbol: 'M 6.8 12.4 L 10.4 16 L 17.4 8.2' },
  cross: { body: DISC, symbol: 'M 8 8 L 16 16 M 16 8 L 8 16' },
  arrow: { body: 'M 1.5 9 H 12.5 V 3.5 L 22.5 12 L 12.5 20.5 V 15 H 1.5 Z' }
}

/** A sticker's picture, at any size. */
export function StickerGlyph({
  kind,
  size = STICKER_SIZE
}: {
  kind: StickerKind
  size?: number
}): JSX.Element {
  const art = ART[kind]
  return (
    <svg
      className="sticker-glyph"
      width={size}
      height={size}
      viewBox="-1 -1 26 26"
      aria-hidden="true"
    >
      <path className="sticker-body" d={art.body} />
      {art.symbol && <path className="sticker-symbol" d={art.symbol} />}
      {art.dot && <path className="sticker-dot" d={art.dot} />}
    </svg>
  )
}

/**
 * A sticker stuck on the board. A press and a drag moves it — and where it
 * is let go decides what it is stuck to, a card or the cork; Delete takes it
 * off. Its press is its own (stopped), so moving a sticker on a card never
 * moves the card.
 */
export function StickerOnBoard({
  sticker,
  where,
  left,
  top,
  onMoved,
  onRemove
}: {
  sticker: BoardSticker
  /** Where it is, for its name: "on A Knock at Night", "on the cork". */
  where: string
  /** Its centre, in its container's coordinates (a card's, or the board's). */
  left: number
  top: number
  /** Let go after a drag: how far it went, on screen. */
  onMoved: (dx: number, dy: number, at: { clientX: number; clientY: number }) => void
  onRemove: () => void
}): JSX.Element {
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null)
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const start = { x: e.clientX, y: e.clientY }
    let moved = false
    // Tracked on the document, as a card's drag is: a quick flick whose
    // first move lands off the sticker is still heard.
    const move = (ev: PointerEvent): void => {
      const d = { x: ev.clientX - start.x, y: ev.clientY - start.y }
      if (!moved && Math.hypot(d.x, d.y) < 3) return
      moved = true
      setOffset(d)
    }
    const up = (ev: PointerEvent): void => {
      stop.current?.()
      setOffset(null)
      if (!moved) return
      // A drag that ends over something else (another card) has its click
      // fired on what the two share — the board, which would take it for a
      // click on the cork and, with a sticker in hand, stick another one
      // there. The click that ends a drag is the drag's: swallowed, once.
      // Not every drag ends in a click, so the next press or key retires
      // it, never a timer: a page in the background holds timers back,
      // and the writer's next real click was swallowed instead.
      const retire = (): void => {
        document.removeEventListener('click', swallow, true)
        document.removeEventListener('pointerdown', retire, true)
        document.removeEventListener('keydown', retire, true)
      }
      const swallow = (c: MouseEvent): void => {
        c.stopPropagation()
        c.preventDefault()
        retire()
      }
      document.addEventListener('click', swallow, true)
      document.addEventListener('pointerdown', retire, true)
      document.addEventListener('keydown', retire, true)
      onMoved(ev.clientX - start.x, ev.clientY - start.y, ev)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
    stop.current = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      stop.current = null
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return
    e.preventDefault()
    e.stopPropagation()
    onRemove()
  }

  return (
    <button
      type="button"
      className={`board-sticker colour-${colourOf(sticker)}${offset ? ' dragging' : ''}`}
      data-help="board-sticker"
      data-sticker={sticker.id}
      aria-label={`${stickerName(sticker)} sticker ${where}. Drag to move it; Delete takes it off.`}
      style={{
        left: left + (offset?.x ?? 0),
        top: top + (offset?.y ?? 0),
        transform: `translate(-50%, -50%) rotate(${sticker.rotation}deg)`
      }}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      // A click on a sticker is not a click on the card under it.
      onClick={(e) => e.stopPropagation()}
    >
      <StickerGlyph kind={sticker.kind} />
    </button>
  )
}

/**
 * Choosing a sticker: eight, in a small grid that drops from the Sticker
 * button. Esc closes it (stopped: Esc is also "back"); picking one closes it
 * and puts the board in sticking mode.
 */
export function StickerPicker({
  colour,
  current,
  onPick,
  onClose
}: {
  colour: StringColour
  current: StickerKind | null
  onPick: (kind: StickerKind) => void
  onClose: () => void
}): JSX.Element {
  const first = useRef<HTMLButtonElement | null>(null)
  useEffect(() => first.current?.focus(), [])
  return (
    <div
      className="sticker-picker"
      role="dialog"
      aria-label="Stickers"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }}
    >
      {STICKER_KINDS.map((kind, i) => (
        <button
          key={kind}
          ref={i === 0 ? first : undefined}
          type="button"
          className={`sticker-pick colour-${colour}${current === kind ? ' on' : ''}`}
          aria-pressed={current === kind}
          aria-label={STICKER_NAME[kind]}
          title={STICKER_NAME[kind]}
          onClick={() => onPick(kind)}
        >
          <StickerGlyph kind={kind} size={24} />
        </button>
      ))}
    </div>
  )
}

/** The five colours, as swatches: one is chosen. */
export function ColourSwatches({
  value,
  onChange,
  label = 'Colour',
  keepFocus = false
}: {
  value: StringColour
  onChange: (colour: StringColour) => void
  label?: string
  /** Pressing a swatch leaves focus where it was (a label being typed). */
  keepFocus?: boolean
}): JSX.Element {
  return (
    <span className="colour-swatches" role="radiogroup" aria-label={label}>
      {STRING_COLOURS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={COLOUR_NAME[c]}
          title={COLOUR_NAME[c]}
          className={`colour-swatch colour-${c}${value === c ? ' on' : ''}`}
          onPointerDown={(e) => {
            if (keepFocus) e.preventDefault()
          }}
          onMouseDown={(e) => {
            if (keepFocus) e.preventDefault()
          }}
          onClick={() => onChange(c)}
        >
          {/* A length of the string itself: its colour, and on a one-colour
              screen its dash, which is how the five are told apart there. */}
          <svg width="22" height="10" aria-hidden="true">
            <line className="swatch-string" x1="2" y1="5" x2="20" y2="5" />
          </svg>
        </button>
      ))}
    </span>
  )
}
