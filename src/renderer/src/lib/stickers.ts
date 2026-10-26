import { colourOf } from '../../../shared/types'
import type { BoardSticker, StickerKind, StringColour } from '../../../shared/types'

/** The names of the corkboard's stickers and colours (F-45). */

export const STICKER_NAME: Record<StickerKind, string> = {
  star: 'Star',
  heart: 'Heart',
  dot: 'Dot',
  question: 'Question mark',
  exclamation: 'Exclamation mark',
  check: 'Tick',
  cross: 'Cross',
  arrow: 'Arrow'
}

export const COLOUR_NAME: Record<StringColour, string> = {
  red: 'Red',
  blue: 'Blue',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green'
}

/** A sticker's size on the board, in pixels. */
export const STICKER_SIZE = 28

/** What a sticker is, to a screen reader: "Red star". */
export const stickerName = (s: Pick<BoardSticker, 'kind' | 'colour'>): string =>
  `${COLOUR_NAME[colourOf(s)]} ${STICKER_NAME[s.kind].toLowerCase()}`
