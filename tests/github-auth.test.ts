import { describe, expect, it } from 'vitest'
import {
  createPrivateRepo,
  fetchGithubLogin,
  pollDeviceFlow,
  startDeviceFlow,
  type DeviceFlowSession
} from '../src/main/wyrm/github-auth'

/** Scripted fetch: each call shifts the next canned response and records the request. */
function scriptedFetch(responses: { status?: number; json: unknown }[]): {
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>
  calls: { url: string; body: unknown }[]
} {
  const calls: { url: string; body: unknown }[] = []
  return {
    calls,
    fetchFn: async (url, init) => {
      const next = responses.shift()
      if (!next) throw new Error('scripted fetch ran out of responses')
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return {
        ok: (next.status ?? 200) < 400,
        status: next.status ?? 200,
        json: async () => next.json
      } as Response
    }
  }
}

function session(overrides: Partial<DeviceFlowSession> = {}): DeviceFlowSession {
  return {
    deviceCode: 'dev123',
    userCode: 'WYRM-1234',
    verificationUri: 'https://github.com/login/device',
    expiresAt: Date.now() + 900_000,
    intervalMs: 5000,
    ...overrides
  }
}

describe('device flow', () => {
  it('starts a session with the code the writer will type', async () => {
    const { fetchFn, calls } = scriptedFetch([
      {
        json: {
          device_code: 'dev123',
          user_code: 'WYRM-1234',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5
        }
      }
    ])
    const s = await startDeviceFlow('client-abc', fetchFn)
    expect(s.userCode).toBe('WYRM-1234')
    expect(s.intervalMs).toBe(5000)
    expect(s.expiresAt).toBeGreaterThan(Date.now())
    expect(calls[0].body).toMatchObject({ client_id: 'client-abc', scope: 'repo' })
  })

  it('stays pending, honors slow_down, then lands the token', async () => {
    const { fetchFn } = scriptedFetch([
      { json: { error: 'authorization_pending' } },
      { json: { error: 'slow_down', interval: 10 } },
      { json: { access_token: 'gho_secret' } }
    ])
    const s = session()
    expect(await pollDeviceFlow('c', s, fetchFn)).toEqual({ state: 'pending' })
    expect(await pollDeviceFlow('c', s, fetchFn)).toEqual({ state: 'pending' })
    expect(s.intervalMs).toBe(15_000) // 5s + GitHub's requested 10s
    expect(await pollDeviceFlow('c', s, fetchFn)).toEqual({ state: 'ok', token: 'gho_secret' })
  })

  it('reports a declined sign-in as a decision, not a crash', async () => {
    const { fetchFn } = scriptedFetch([{ json: { error: 'access_denied' } }])
    const result = await pollDeviceFlow('c', session(), fetchFn)
    expect(result.state).toBe('error')
    if (result.state === 'error') expect(result.detail).toContain('declined')
  })

  it('treats an expired code as final without calling GitHub again', async () => {
    const { fetchFn, calls } = scriptedFetch([])
    const result = await pollDeviceFlow('c', session({ expiresAt: Date.now() - 1 }), fetchFn)
    expect(result.state).toBe('error')
    expect(calls).toHaveLength(0)
  })
})

describe('api calls', () => {
  it('reads the signed-in account name', async () => {
    const { fetchFn, calls } = scriptedFetch([{ json: { login: 'geoffrey' } }])
    expect(await fetchGithubLogin('tok', fetchFn)).toBe('geoffrey')
    expect(calls[0].url).toContain('/user')
  })

  it('creates the project home private, with no auto-init', async () => {
    const { fetchFn, calls } = scriptedFetch([
      { status: 201, json: { clone_url: 'https://github.com/g/novel.git' } }
    ])
    expect(await createPrivateRepo('tok', 'novel', fetchFn)).toBe('https://github.com/g/novel.git')
    expect(calls[0].body).toMatchObject({ name: 'novel', private: true, auto_init: false })
  })

  it('explains a name collision instead of failing generically', async () => {
    const { fetchFn } = scriptedFetch([{ status: 422, json: {} }])
    await expect(createPrivateRepo('tok', 'novel', fetchFn)).rejects.toThrow(/already exists/)
  })
})
