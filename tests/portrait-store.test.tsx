// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import type { Entity } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm, __disposeAll } from '../src/renderer/src/store'

/**
 * F-47: a portrait on a character or location, through the real store
 * against the mock.
 *
 * What is worth pinning is the two ways this goes silently wrong on disk. A
 * cancelled picker must write nothing — re-saving the entry would stamp
 * `modified` and, worse, could record a filename for an image that was never
 * copied. And clearing must *delete* the key: an explicit `undefined` in
 * entity frontmatter is exactly what gray-matter throws on (the rule
 * `removeEntityFromBoard` follows), so the object handed to `writeEntity` is
 * checked for the key's absence, not its value.
 */

let demoPath: string | null = null

async function openDemo(): Promise<string> {
  demoPath ??= (await api.getLastProjectPath())!
  await act(async () => {
    await useWyrm.getState().openRecentProject(demoPath!)
  })
  await clearPortraits(demoPath!)
  return demoPath!
}

/**
 * The mock keeps entities in a module-level map that outlives a test, so a
 * portrait set by one test would still be there for the next and the "null
 * when there is none" case would become unreachable.
 */
async function clearPortraits(path: string): Promise<void> {
  for (const e of await api.listEntities(path)) {
    if (e.portrait == null) continue
    await api.removePortrait(path, e.id)
    const clean = { ...e }
    delete clean.portrait
    await api.writeEntity(path, clean)
  }
  await act(async () => {
    await useWyrm.getState().loadEntities()
  })
}

/** A bible entry from the demo project, by name. */
async function entityNamed(path: string, name: string): Promise<Entity> {
  const entity = (await api.listEntities(path)).find((e) => e.name === name)
  if (!entity) throw new Error(`no entity named ${name} in the demo project`)
  return entity
}

/** The entry as the mock now holds it — what the real app would read back from disk. */
async function stored(path: string, id: string): Promise<Entity | undefined> {
  return (await api.listEntities(path)).find((e) => e.id === id)
}

const inStore = (id: string): Entity | undefined =>
  useWyrm.getState().entities.find((e) => e.id === id)

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  useWyrm.setState({ project: null, booted: false, parked: {}, openPaths: [], editor: null })
  __disposeAll()
})

describe('setPortrait', () => {
  it('records the copied image on the entry, on disk and in the store', async () => {
    const path = await openDemo()
    const elara = await entityNamed(path, 'Elara Voss')

    let ok = false
    await act(async () => {
      ok = await useWyrm.getState().setPortrait(elara.id)
    })

    expect(ok).toBe(true)
    const expected = `characters/${elara.id}.png`
    expect((await stored(path, elara.id))?.portrait).toBe(expected)
    expect(inStore(elara.id)?.portrait).toBe(expected)
  })

  it('names a location by its own collection folder', async () => {
    const path = await openDemo()
    const harrowgate = await entityNamed(path, 'Harrowgate')

    await act(async () => {
      await useWyrm.getState().setPortrait(harrowgate.id)
    })

    expect((await stored(path, harrowgate.id))?.portrait).toBe(`world/${harrowgate.id}.png`)
  })

  it('writes nothing when the picker is cancelled, and says so', async () => {
    const path = await openDemo()
    const elara = await entityNamed(path, 'Elara Voss')
    vi.spyOn(api, 'importPortrait').mockResolvedValue(null)
    const write = vi.spyOn(api, 'writeEntity')

    let ok = true
    await act(async () => {
      ok = await useWyrm.getState().setPortrait(elara.id)
    })

    expect(ok).toBe(false)
    expect(write).not.toHaveBeenCalled()
    expect((await stored(path, elara.id))?.portrait).toBeUndefined()
    expect(inStore(elara.id)?.portrait).toBeUndefined()
  })
})

describe('clearPortrait', () => {
  it('deletes the image and drops the key from the entry rather than blanking it', async () => {
    const path = await openDemo()
    const elara = await entityNamed(path, 'Elara Voss')
    await act(async () => {
      await useWyrm.getState().setPortrait(elara.id)
    })
    const remove = vi.spyOn(api, 'removePortrait')
    const write = vi.spyOn(api, 'writeEntity')

    await act(async () => {
      await useWyrm.getState().clearPortrait(elara.id)
    })

    expect(remove).toHaveBeenCalledWith(path, elara.id)
    expect(write).toHaveBeenCalledTimes(1)
    const written = write.mock.calls[0][1]
    // Absence, not value: `portrait: undefined` would serialize as a key and
    // throw inside gray-matter on the real writer.
    expect('portrait' in written).toBe(false)
    expect((await stored(path, elara.id))?.portrait).toBeUndefined()
    expect(inStore(elara.id)?.portrait).toBeUndefined()
  })
})

describe('readPortrait', () => {
  it('answers a data: URL once a portrait is set, and null once it is cleared', async () => {
    const path = await openDemo()
    const elara = await entityNamed(path, 'Elara Voss')
    await expect(api.readPortrait(path, elara.id)).resolves.toBeNull()

    await act(async () => {
      await useWyrm.getState().setPortrait(elara.id)
    })
    await expect(api.readPortrait(path, elara.id)).resolves.toMatch(/^data:image\/png;base64,/)

    await act(async () => {
      await useWyrm.getState().clearPortrait(elara.id)
    })
    await expect(api.readPortrait(path, elara.id)).resolves.toBeNull()
  })
})
