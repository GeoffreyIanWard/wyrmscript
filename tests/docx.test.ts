import { describe, expect, it } from 'vitest'
import type { CompileBlock } from '../src/shared/types'
import { docxBytes } from '../src/renderer/src/lib/docx'

/* ---------- a minimal ZIP reader, just enough to check what docxBytes wrote ---------- */

interface ZipEntry {
  name: string
  data: Uint8Array
  crc32: number
  compressedSize: number
  uncompressedSize: number
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Parses the end-of-central-directory record and central directory, in that order (the spec way to read a zip). */
function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // Find the end-of-central-directory record by scanning back from the end
  // for its signature (there's no comment in our output, so it's exactly 22
  // bytes from EOF, but scan anyway to keep the reader honest).
  let eocdOffset = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset === -1) throw new Error('end of central directory record not found')

  const totalEntries = view.getUint16(eocdOffset + 10, true)
  const centralDirOffset = view.getUint32(eocdOffset + 16, true)

  const entries: ZipEntry[] = []
  let pos = centralDirOffset
  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) {
      throw new Error(`bad central directory signature at entry ${i}`)
    }
    const compressionMethod = view.getUint16(pos + 10, true)
    const fileCrc32 = view.getUint32(pos + 16, true)
    const compressedSize = view.getUint32(pos + 20, true)
    const uncompressedSize = view.getUint32(pos + 24, true)
    const nameLength = view.getUint16(pos + 28, true)
    const extraLength = view.getUint16(pos + 30, true)
    const commentLength = view.getUint16(pos + 32, true)
    const localHeaderOffset = view.getUint32(pos + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + nameLength))

    expect(compressionMethod).toBe(0) // stored, not deflated

    // Read the payload back out via the local file header (offsets validate independently of the central directory's own bookkeeping).
    const lv = new DataView(bytes.buffer, bytes.byteOffset + localHeaderOffset, 30)
    expect(lv.getUint32(0, true)).toBe(0x04034b50)
    const localNameLength = lv.getUint16(26, true)
    const localExtraLength = lv.getUint16(28, true)
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
    const data = bytes.slice(dataStart, dataStart + uncompressedSize)

    entries.push({ name, data, crc32: fileCrc32, compressedSize, uncompressedSize })
    pos += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function textOf(entries: ZipEntry[], name: string): string {
  const entry = entries.find((e) => e.name === name)
  if (!entry) throw new Error(`entry not found: ${name}`)
  return new TextDecoder().decode(entry.data)
}

/**
 * A minimal tag-balance check (open/close tag names form a valid stack),
 * skipping self-closing tags and the `<?xml ...?>` declaration. No DOMParser
 * is available in vitest's node environment, and pulling in an XML parser
 * would violate the zero-dependency constraint this module is tested under.
 */
function hasBalancedTags(xml: string): boolean {
  const stack: string[] = []
  const tagPattern = /<(\/?)([\w:]+)[^>]*?(\/?)>/g
  let match: RegExpExecArray | null
  while ((match = tagPattern.exec(xml)) !== null) {
    const [, closing, name, selfClosing] = match
    if (name.startsWith('?')) continue
    if (selfClosing) continue
    if (closing) {
      if (stack.pop() !== name) return false
    } else {
      stack.push(name)
    }
  }
  return stack.length === 0
}

/* ---------- fixtures ---------- */

const KITCHEN_SINK: CompileBlock[] = [
  { kind: 'titlePage', title: 'The Manuscript', lines: ['by Author Name', 'A Novel'] },
  { kind: 'heading', level: 1, text: 'Part One' },
  { kind: 'heading', level: 2, text: 'Chapter 1' },
  { kind: 'separator', text: '#' },
  { kind: 'separator', text: '' },
  { kind: 'pageBreak' },
  {
    kind: 'paragraph',
    runs: [
      { text: 'Plain, ' },
      { text: 'bold', bold: true },
      { text: ', ' },
      { text: 'italic', italic: true },
      { text: ', and ' },
      { text: 'highlighted', highlight: true },
      { text: ' text with a break here:' },
      { break: true },
      { text: 'and a line with Tom & Jerry <escaped> characters.' }
    ]
  }
]

/* ---------- tests ---------- */

describe('docxBytes / zip structure', () => {
  it('produces the four expected parts with [Content_Types].xml first', () => {
    const entries = readZip(docxBytes(KITCHEN_SINK))
    expect(entries.map((e) => e.name)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
      'word/_rels/document.xml.rels'
    ])
  })

  it('stores each entry with a matching CRC-32 and equal compressed/uncompressed sizes', () => {
    const entries = readZip(docxBytes(KITCHEN_SINK))
    for (const entry of entries) {
      expect(entry.crc32).toBe(crc32(entry.data))
      expect(entry.compressedSize).toBe(entry.uncompressedSize)
      expect(entry.uncompressedSize).toBe(entry.data.length)
    }
  })

  it('produces a valid, parseable zip for empty input', () => {
    const entries = readZip(docxBytes([]))
    expect(entries.map((e) => e.name)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
      'word/_rels/document.xml.rels'
    ])
    for (const entry of entries) {
      expect(entry.crc32).toBe(crc32(entry.data))
    }
  })

  it('is deterministic: identical input produces byte-identical output', () => {
    const a = docxBytes(KITCHEN_SINK)
    const b = docxBytes(KITCHEN_SINK)
    expect(a).toEqual(b)
  })
})

describe('docxBytes / document.xml content', () => {
  it('marks bold runs with <w:b/>', () => {
    const xml = textOf(readZip(docxBytes(KITCHEN_SINK)), 'word/document.xml')
    expect(xml).toContain('<w:b/>')
  })

  it('marks italic runs with <w:i/>', () => {
    const xml = textOf(readZip(docxBytes(KITCHEN_SINK)), 'word/document.xml')
    expect(xml).toContain('<w:i/>')
  })

  it('marks highlighted runs with w:highlight', () => {
    const xml = textOf(readZip(docxBytes(KITCHEN_SINK)), 'word/document.xml')
    expect(xml).toContain('<w:highlight w:val="yellow"/>')
  })

  it('renders an in-paragraph break inline as <w:br/>', () => {
    const xml = textOf(readZip(docxBytes(KITCHEN_SINK)), 'word/document.xml')
    expect(xml).toContain('<w:br/>')
  })

  it('renders a pageBreak block as a page break', () => {
    const xml = textOf(readZip(docxBytes(KITCHEN_SINK)), 'word/document.xml')
    expect(xml).toContain('<w:br w:type="page"/>')
  })

  it('gives the title page a page break of its own', () => {
    const xml = textOf(
      readZip(docxBytes([{ kind: 'titlePage', title: 'T', lines: [] }])),
      'word/document.xml'
    )
    expect(xml).toContain('<w:br w:type="page"/>')
  })

  it('escapes & and < in run text', () => {
    const xml = textOf(readZip(docxBytes(KITCHEN_SINK)), 'word/document.xml')
    expect(xml).toContain('Tom &amp; Jerry &lt;escaped&gt; characters.')
    expect(xml).not.toContain('Tom & Jerry')
  })

  it('centers title-page and separator paragraphs', () => {
    const xml = textOf(readZip(docxBytes(KITCHEN_SINK)), 'word/document.xml')
    const centeredCount = (xml.match(/<w:jc w:val="center"\/>/g) ?? []).length
    // title + 2 lines + 2 separators (one with text, one empty) = 5
    expect(centeredCount).toBe(5)
  })

  it('gives heading level 1 a larger size than heading level 2', () => {
    const xml = textOf(
      readZip(
        docxBytes([
          { kind: 'heading', level: 1, text: 'Big' },
          { kind: 'heading', level: 2, text: 'Small' }
        ])
      ),
      'word/document.xml'
    )
    const sizes = [...xml.matchAll(/<w:sz w:val="(\d+)"\/>/g)].map((m) => Number(m[1]))
    expect(sizes[0]).toBeGreaterThan(sizes[1])
  })

  it('has balanced open/close tags (no DOM parser available in this environment)', () => {
    const xml = textOf(readZip(docxBytes(KITCHEN_SINK)), 'word/document.xml')
    expect(hasBalancedTags(xml)).toBe(true)
  })
})
