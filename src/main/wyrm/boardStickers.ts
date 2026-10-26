import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import type { BoardSticker, StickerKind, StringColour } from '../../shared/types'
import { STICKER_KINDS, storedColour } from '../../shared/types'
import { assertPlainId, isPlainId } from './plainId'

/** The corkboard's stickers: one file each, as its strings are, so two
 *  devices sticking different stickers merge cleanly. */
const STICKERS_DIR = 'stickers'

function stickersDir(projectPath: string): string {
  return join(projectPath, STICKERS_DIR)
}

/** Refuses an id that is not plain (see `plainId.ts`), so neither a write
 *  nor a delete can reach outside the folder. */
function stickerPath(projectPath: string, id: string): string {
  assertPlainId(id, 'sticker')
  return join(stickersDir(projectPath), `${id}.md`)
}

interface BoardStickerFrontmatter {
  id: string
  kind: StickerKind
  colour?: StringColour
  rotation: number
  x: number
  y: number
  cardId?: string
  created: string
  modified: string
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Null for anything that is not a usable sticker: no plain id, a kind it
 *  does not know, or a place that is not a pair of numbers. */
function parseBoardStickerFile(raw: string): BoardSticker | null {
  const data = matter(raw).data as Partial<Record<keyof BoardStickerFrontmatter, unknown>>
  if (!isPlainId(data.id)) return null
  if (!(STICKER_KINDS as readonly unknown[]).includes(data.kind)) return null
  if (!isNumber(data.x) || !isNumber(data.y)) return null
  const sticker: BoardSticker = {
    id: data.id,
    kind: data.kind as StickerKind,
    rotation: isNumber(data.rotation) ? data.rotation : 0,
    x: data.x,
    y: data.y,
    created: typeof data.created === 'string' ? data.created : '',
    modified: typeof data.modified === 'string' ? data.modified : ''
  }
  const colour = storedColour(data.colour)
  if (colour) sticker.colour = colour
  if (typeof data.cardId === 'string' && data.cardId !== '') sticker.cardId = data.cardId
  return sticker
}

export async function writeBoardSticker(projectPath: string, s: BoardSticker): Promise<void> {
  const path = stickerPath(projectPath, s.id)
  await fsp.mkdir(stickersDir(projectPath), { recursive: true })
  const meta: BoardStickerFrontmatter = {
    id: s.id,
    kind: s.kind,
    rotation: Math.round(s.rotation * 10) / 10,
    x: Math.round(s.x),
    y: Math.round(s.y),
    created: s.created,
    modified: new Date().toISOString()
  }
  // Written only when set: gray-matter refuses undefined.
  const colour = storedColour(s.colour)
  if (colour) meta.colour = colour
  if (s.cardId) meta.cardId = s.cardId
  await fsp.writeFile(path, matter.stringify('', meta), 'utf8')
}

/** Every sticker in the project; none before the first is stuck down. */
export async function listBoardStickers(projectPath: string): Promise<BoardSticker[]> {
  const dir = stickersDir(projectPath)
  let files: string[]
  try {
    files = await fsp.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const stickers: BoardSticker[] = []
  for (const file of files) {
    if (!file.endsWith('.md')) continue
    try {
      const sticker = parseBoardStickerFile(await fsp.readFile(join(dir, file), 'utf8'))
      if (sticker) stickers.push(sticker)
    } catch {
      // Skip unparsable entries; see listEntities for the same rationale.
      continue
    }
  }
  return stickers
}

export async function deleteBoardSticker(projectPath: string, id: string): Promise<void> {
  // force: true means a missing file is not an error.
  await fsp.rm(stickerPath(projectPath, id), { force: true })
}
