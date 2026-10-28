// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { apiSettled, __tracked } from '../src/renderer/src/lib/api'

/**
 * Quitting waits for every call to the bridge still under way (F-49):
 * the saves the UI makes as it closes. The tracker has to see a slow call,
 * and one started by another as it finishes.
 */

const later = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

describe('calls still in flight', () => {
  it('waits for a slow call', async () => {
    let finished = false
    const bridge = __tracked({
      write: (): Promise<void> =>
        later(40).then(() => {
          finished = true
        })
    })
    void bridge.write()
    expect(await apiSettled(2000)).toBe(true)
    expect(finished).toBe(true)
  })

  it('waits for a call started while it waited', async () => {
    let second = false
    const bridge = __tracked({
      write: (): Promise<void> => later(20),
      flush: (): Promise<void> =>
        later(30).then(() => {
          second = true
        })
    })
    void bridge.write().then(() => void bridge.flush())
    expect(await apiSettled(2000)).toBe(true)
    expect(second).toBe(true)
  })

  it('gives up after its time, on a call that never ends', async () => {
    let unstick = (): void => {}
    const bridge = __tracked({
      write: (): Promise<void> => new Promise((done) => (unstick = done))
    })
    void bridge.write()
    expect(await apiSettled(30)).toBe(false)
    unstick()
    expect(await apiSettled(1000)).toBe(true)
  })
})
