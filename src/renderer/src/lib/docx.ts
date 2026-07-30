import type { CompileBlock, CompileInline } from '../../../shared/types'

/**
 * A dependency-free Office Open XML (.docx) writer. A .docx is a ZIP of a
 * handful of XML parts; both the ZIP container and the WordprocessingML are
 * built by hand here rather than pulled in as a library, per the compile
 * feature's "zero dependencies" constraint. Only the parts Word actually
 * requires are emitted — no styles.xml, no theme, no core properties — so
 * every run carries its own formatting instead of referencing a style.
 */

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

// Manuscript-ish serif default. Applied per-run (not via a shared style,
// since there is no styles.xml part) so bold/italic/highlight can layer on
// top without a style lookup.
const FONT_FAMILY = 'Times New Roman'
const BODY_SIZE = 24 // half-points => 12pt
const HEADING_SIZE: Record<1 | 2, number> = { 1: 32, 2: 28 } // 16pt / 14pt, both > body
const TITLE_SIZE = 36 // 18pt
const TITLE_LINE_SIZE = BODY_SIZE

/* ---------- XML escaping ---------- */

/**
 * Escapes the characters that would otherwise break XML well-formedness.
 * Used for both text-node content and attribute values, so it covers quotes
 * and apostrophes too even though most call sites only strictly need &/</>.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/* ---------- WordprocessingML fragment builders ---------- */

interface RunStyle {
  bold?: boolean
  italic?: boolean
  highlight?: boolean
  size: number
}

function runPropsXml(style: RunStyle): string {
  const parts = [
    `<w:rFonts w:ascii="${FONT_FAMILY}" w:hAnsi="${FONT_FAMILY}" w:cs="${FONT_FAMILY}"/>`
  ]
  if (style.bold) parts.push('<w:b/>')
  if (style.italic) parts.push('<w:i/>')
  if (style.highlight) parts.push('<w:highlight w:val="yellow"/>')
  parts.push(`<w:sz w:val="${style.size}"/>`, `<w:szCs w:val="${style.size}"/>`)
  return `<w:rPr>${parts.join('')}</w:rPr>`
}

function textRunXml(text: string, style: RunStyle): string {
  return `<w:r>${runPropsXml(style)}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
}

/** A `{ break: true }` inline is a line break *within* a paragraph (`<w:br/>`), not a new `<w:p>`. */
function inlineRunXml(inline: CompileInline, size: number): string {
  if ('break' in inline) return '<w:r><w:br/></w:r>'
  return textRunXml(inline.text, {
    size,
    bold: inline.bold,
    italic: inline.italic,
    highlight: inline.highlight
  })
}

const CENTER_PPR = '<w:pPr><w:jc w:val="center"/></w:pPr>'
const PAGE_BREAK_P = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'

function centeredParagraphXml(text: string, style: RunStyle): string {
  if (text === '') return `<w:p>${CENTER_PPR}</w:p>`
  return `<w:p>${CENTER_PPR}${textRunXml(text, style)}</w:p>`
}

function blockXml(block: CompileBlock): string {
  switch (block.kind) {
    case 'titlePage': {
      const paras = [centeredParagraphXml(block.title, { bold: true, size: TITLE_SIZE })]
      for (const line of block.lines) {
        paras.push(centeredParagraphXml(line, { size: TITLE_LINE_SIZE }))
      }
      paras.push(PAGE_BREAK_P)
      return paras.join('')
    }
    case 'heading':
      return `<w:p>${textRunXml(block.text, { bold: true, size: HEADING_SIZE[block.level] })}</w:p>`
    case 'separator':
      return centeredParagraphXml(block.text, { size: BODY_SIZE })
    case 'pageBreak':
      return PAGE_BREAK_P
    case 'paragraph':
      if (block.runs.length === 0) return '<w:p/>'
      return `<w:p>${block.runs.map((r) => inlineRunXml(r, BODY_SIZE)).join('')}</w:p>`
  }
}

// Letter page, 1" margins in twips (1440/in) — a plain, unsurprising default
// so the document opens ready to print rather than looking unfinished.
const SECT_PR =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>' +
  '</w:sectPr>'

function documentXml(blocks: CompileBlock[]): string {
  const body = blocks.map(blockXml).join('')
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NS}"><w:body>${body}${SECT_PR}</w:body></w:document>`
  )
}

const CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ' +
  'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>'

const PACKAGE_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" ' +
  'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
  'Target="word/document.xml"/>' +
  '</Relationships>'

// document.xml references nothing external (no images, no styles part), but
// the part still has to exist and be well-formed — Word looks for it by
// convention even when it's empty.
const DOCUMENT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'

/* ---------- ZIP container (stored, i.e. uncompressed, entries) ---------- */
//
// A real ZIP deflate implementation is a lot of surface area for a feature
// that only needs to produce four small XML parts. "Stored" (method 0) is a
// legal compression method in the ZIP spec — readers (including Word) must
// support it — so this sidesteps DEFLATE entirely at the cost of file size,
// which doesn't matter for a manuscript-sized document.

const CRC_TABLE = buildCrcTable()

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

interface ZipEntry {
  name: string
  data: Uint8Array
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

// Fixed DOS date/time (1980-01-01, the DOS epoch) rather than the real clock,
// so identical input always produces byte-identical output.
const DOS_TIME = 0
const DOS_DATE = 0x0021

function buildZip(entries: ZipEntry[]): Uint8Array {
  const nameEncoder = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const name = nameEncoder.encode(entry.name)
    const crc = crc32(entry.data)
    const size = entry.data.length

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true) // local file header signature
    lv.setUint16(4, 20, true) // version needed to extract (2.0)
    lv.setUint16(6, 0, true) // general purpose flag
    lv.setUint16(8, 0, true) // compression method: 0 = stored
    lv.setUint16(10, DOS_TIME, true)
    lv.setUint16(12, DOS_DATE, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true) // compressed size (== size, stored)
    lv.setUint32(22, size, true) // uncompressed size
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, 0, true) // extra field length
    local.set(name, 30)
    localParts.push(local, entry.data)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true) // central directory file header signature
    cv.setUint16(4, 20, true) // version made by
    cv.setUint16(6, 20, true) // version needed to extract
    cv.setUint16(8, 0, true) // general purpose flag
    cv.setUint16(10, 0, true) // compression method: stored
    cv.setUint16(12, DOS_TIME, true)
    cv.setUint16(14, DOS_DATE, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, name.length, true)
    cv.setUint16(30, 0, true) // extra field length
    cv.setUint16(32, 0, true) // file comment length
    cv.setUint16(34, 0, true) // disk number start
    cv.setUint16(36, 0, true) // internal file attributes
    cv.setUint32(38, 0, true) // external file attributes
    cv.setUint32(42, offset, true) // offset of local file header
    central.set(name, 46)
    centralParts.push(central)

    offset += local.length + entry.data.length
  }

  const centralDirOffset = offset
  const centralDir = concatBytes(centralParts)

  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true) // end of central directory signature
  ev.setUint16(4, 0, true) // disk number
  ev.setUint16(6, 0, true) // disk with central directory start
  ev.setUint16(8, entries.length, true) // entries on this disk
  ev.setUint16(10, entries.length, true) // total entries
  ev.setUint32(12, centralDir.length, true) // central directory size
  ev.setUint32(16, centralDirOffset, true) // central directory offset
  ev.setUint16(20, 0, true) // comment length

  return concatBytes([...localParts, centralDir, end])
}

/** Serialize compiled manuscript blocks into a .docx file's bytes. */
export function docxBytes(blocks: CompileBlock[]): Uint8Array {
  const encoder = new TextEncoder()
  // [Content_Types].xml first: some readers require it to be the first entry.
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES_XML) },
    { name: '_rels/.rels', data: encoder.encode(PACKAGE_RELS_XML) },
    { name: 'word/document.xml', data: encoder.encode(documentXml(blocks)) },
    { name: 'word/_rels/document.xml.rels', data: encoder.encode(DOCUMENT_RELS_XML) }
  ]
  return buildZip(entries)
}
