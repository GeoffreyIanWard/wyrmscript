// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The mock reads window.wyrm at module scope; provide a bare window.
vi.stubGlobal('window', {})

const { createMockApi } = await import('../src/renderer/src/lib/api')

async function setup(): Promise<{
  api: ReturnType<typeof createMockApi>
  path: string
  docId: string
}> {
  const api = createMockApi()
  const path = (await api.getLastProjectPath())!
  const info = (await api.openProjectPath(path))!
  // find "A Knock at Night" (the doc with fabricated history)
  const findDoc = (nodes: any[]): string | null => {
    for (const n of nodes) {
      if (n.type === 'doc' && n.title === 'A Knock at Night') return n.id
      const hit = n.children ? findDoc(n.children) : null
      if (hit) return hit
    }
    return null
  }
  return { api, path, docId: findDoc(info.data.binder as any[])! }
}

describe('mock api variant/restore interplay', () => {
  it('a variant snapshot is unaffected by a later restore', async () => {
    const { api, path, docId } = await setup()
    const full = (await api.readDoc(path, docId)).body
    expect(full).toContain('Drowned Saints')

    const variant = await api.createVariant(path, docId, 'Full confrontation')

    // restore the oldest short draft
    const log = await api.log(path, docId)
    const oldest = log[log.length - 1]
    await api.restoreDocToRef(path, docId, oldest.oid, 'Back to first pass')
    const nowShort = (await api.readDoc(path, docId)).body
    expect(nowShort.startsWith('The knock came after midnight.')).toBe(true)

    // the variant must still hold the FULL text
    const variantDoc = await api.readDocAtRef(path, docId, variant.branch)
    expect(variantDoc?.body).toBe(full)

    // adopting the variant brings the full text back
    await api.restoreDocToRef(path, docId, variant.branch, 'Adopt variant')
    expect((await api.readDoc(path, docId)).body).toBe(full)
  })
})
