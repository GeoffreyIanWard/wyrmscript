import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BUILT_IN_CLIENT_ID,
  clientIdOf,
  createPrivateRepo,
  fetchGithubLogin,
  LOGIN_ATTEMPTS,
  POLL_MARGIN_MS,
  createDeviceSignIn,
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

afterEach(() => {
  vi.useRealTimers()
})

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
    vi.useFakeTimers()
    const { fetchFn } = scriptedFetch([
      { json: { error: 'authorization_pending' } },
      { json: { error: 'slow_down', interval: 10 } },
      { json: { access_token: 'gho_secret' } }
    ])
    const s = session()
    expect(await pollDeviceFlow('c', s, fetchFn)).toEqual({ state: 'pending' })
    vi.advanceTimersByTime(s.intervalMs + POLL_MARGIN_MS)
    expect(await pollDeviceFlow('c', s, fetchFn)).toEqual({ state: 'pending' })
    expect(s.intervalMs).toBe(10_000) // GitHub's new interval, not added to the old one
    vi.advanceTimersByTime(s.intervalMs + POLL_MARGIN_MS)
    expect(await pollDeviceFlow('c', s, fetchFn)).toEqual({ state: 'ok', token: 'gho_secret' })
  })

  it('takes the interval GitHub names when it is longer than five seconds more', async () => {
    const { fetchFn } = scriptedFetch([{ json: { error: 'slow_down', interval: 20 } }])
    const s = session()
    await pollDeviceFlow('c', s, fetchFn)
    expect(s.intervalMs).toBe(20_000)
  })

  it('never slows down by less than five seconds, whatever GitHub names', async () => {
    const { fetchFn } = scriptedFetch([{ json: { error: 'slow_down', interval: 5 } }])
    const s = session({ intervalMs: 10_000 })
    await pollDeviceFlow('c', s, fetchFn)
    expect(s.intervalMs).toBe(15_000)
  })

  it('holds polls for the new, longer interval after a slow_down', async () => {
    vi.useFakeTimers()
    const { fetchFn, calls } = scriptedFetch([
      { json: { error: 'slow_down', interval: 10 } },
      { json: { error: 'authorization_pending' } }
    ])
    const s = session()
    await pollDeviceFlow('c', s, fetchFn)
    vi.advanceTimersByTime(8000) // past the old 5s + margin, short of the new 10s
    expect(await pollDeviceFlow('c', s, fetchFn)).toEqual({ state: 'pending', held: true })
    expect(calls).toHaveLength(1)
    vi.advanceTimersByTime(3000)
    await pollDeviceFlow('c', s, fetchFn)
    expect(calls).toHaveLength(2)
  })

  it('keeps waiting through a dropped connection', async () => {
    const s = session()
    const offline = async (): Promise<Response> => {
      throw new TypeError('fetch failed')
    }
    expect(await pollDeviceFlow('c', s, offline)).toEqual({ state: 'pending' })
  })

  it('keeps waiting through a request that never answers', async () => {
    const s = session()
    const stalled = (_url: string, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      })
    expect(await pollDeviceFlow('c', s, stalled, 20)).toEqual({ state: 'pending' })
  })

  it('keeps waiting through a busy GitHub, but not through a broken request', async () => {
    const { fetchFn } = scriptedFetch([
      { status: 502, json: null },
      { status: 429, json: null },
      { status: 400, json: null }
    ])
    const s = session({ intervalMs: 0 })
    const again = (): void => {
      s.nextPollAt = undefined
    }
    expect(await pollDeviceFlow('c', s, fetchFn)).toEqual({ state: 'pending' })
    again()
    expect(await pollDeviceFlow('c', s, fetchFn)).toEqual({ state: 'pending' })
    again()
    await expect(pollDeviceFlow('c', s, fetchFn)).rejects.toThrow(/400/)
  })

  // GitHub times requests as they arrive. A slow poll followed by a quick one
  // arrives closer together than they were sent.
  it('spaces polls from the answer, so a slow one cannot crowd the next', async () => {
    vi.useFakeTimers()
    const latencies = [3000, 0, 3000, 0, 3000, 0]
    let last = -Infinity
    let slowDowns = 0
    const github = async (): Promise<Response> => {
      vi.advanceTimersByTime(latencies.shift() ?? 0)
      const now = Date.now()
      if (now - last < 5000) slowDowns++
      last = now
      return {
        ok: true,
        status: 200,
        json: async () => ({ error: 'authorization_pending' })
      } as Response
    }
    const s = session()
    for (let tick = 0; tick < 40; tick++) {
      await pollDeviceFlow('c', s, github)
      vi.advanceTimersByTime(1000)
    }
    expect(latencies).toHaveLength(0)
    expect(slowDowns).toBe(0)
  })

  it('slows down by five seconds when GitHub names no interval', async () => {
    const { fetchFn } = scriptedFetch([{ json: { error: 'slow_down' } }])
    const s = session()
    await pollDeviceFlow('c', s, fetchFn)
    expect(s.intervalMs).toBe(10_000)
  })

  it('answers a poll that comes too soon without asking GitHub', async () => {
    vi.useFakeTimers()
    const { fetchFn, calls } = scriptedFetch([
      { json: { error: 'authorization_pending' } },
      { json: { access_token: 'gho_secret' } }
    ])
    const s = session()
    await pollDeviceFlow('c', s, fetchFn)
    vi.advanceTimersByTime(s.intervalMs)
    expect(await pollDeviceFlow('c', s, fetchFn)).toEqual({ state: 'pending', held: true })
    expect(calls).toHaveLength(1)
    vi.advanceTimersByTime(POLL_MARGIN_MS)
    expect(await pollDeviceFlow('c', s, fetchFn)).toEqual({ state: 'ok', token: 'gho_secret' })
  })

  it('holds a poll made while the last one is still on its way', async () => {
    const { fetchFn, calls } = scriptedFetch([{ json: { error: 'authorization_pending' } }])
    const s = session()
    const first = pollDeviceFlow('c', s, fetchFn)
    expect(await pollDeviceFlow('c', s, fetchFn)).toEqual({ state: 'pending', held: true })
    await first
    expect(calls).toHaveLength(1)
  })

  // The Windows report: approved on GitHub, never noticed by the app. A
  // caller ticking on a fixed cadence a hair under GitHub's interval earned
  // a slow_down, and every poll after that was too soon again.
  it('sees an approval even when the caller ticks faster than GitHub allows', async () => {
    vi.useFakeTimers()
    let interval = 5000
    let last = -Infinity
    const approvedAt = Date.now() + 20_000
    const github = async (): Promise<Response> => {
      const now = Date.now()
      const tooSoon = now - last < interval
      last = now
      let json: unknown
      if (tooSoon) {
        interval += 5000
        json = { error: 'slow_down', interval: interval / 1000 }
      } else if (now < approvedAt) json = { error: 'authorization_pending' }
      else json = { access_token: 'gho_secret' }
      return { ok: true, status: 200, json: async () => json } as Response
    }
    const s = session()
    for (let tick = 0; tick < 120; tick++) {
      const result = await pollDeviceFlow('c', s, github)
      if (result.state === 'ok') return
      expect(result.state).toBe('pending')
      vi.advanceTimersByTime(4999)
    }
    throw new Error('never saw the approval')
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

describe('the sign-in the main process runs', () => {
  /** A fetch that answers by URL: the token endpoint, then the account. */
  function github(handlers: {
    token: () => unknown
    user?: () => { status?: number; json: unknown }
  }): { fetchFn: (url: string) => Promise<Response>; tokenCalls: () => number } {
    let tokenCalls = 0
    return {
      tokenCalls: () => tokenCalls,
      fetchFn: async (url) => {
        if (url.includes('/login/device/code')) {
          return okJson({ device_code: `dev${Math.random()}`, user_code: 'C', interval: 0 })
        }
        if (url.includes('/access_token')) {
          tokenCalls++
          return okJson(handlers.token())
        }
        const user = handlers.user?.() ?? { json: { login: 'geoffrey' } }
        return {
          ok: (user.status ?? 200) < 400,
          status: user.status ?? 200,
          json: async () => user.json
        } as Response
      }
    }
  }
  function okJson(json: unknown): Response {
    return { ok: true, status: 200, json: async () => json } as Response
  }

  it('lets a slow poll from an old code leave a newer sign-in alone', async () => {
    let release: (() => void) | null = null
    let first = true
    const fake = github({ token: () => ({ error: 'expired_token' }) })
    const slowFirst = async (url: string): Promise<Response> => {
      if (url.includes('/access_token') && first) {
        first = false
        await new Promise<void>((r) => (release = r))
      }
      return fake.fetchFn(url)
    }
    const signIn = createDeviceSignIn(async () => {}, slowFirst)
    await signIn.start('c')
    const oldPoll = signIn.poll('c')
    await signIn.start('c') // the writer starts again while it is still out
    release!()
    expect((await oldPoll).state).toBe('error')
    // The new code is still the one running.
    const next = await signIn.poll('c')
    expect(next).not.toEqual({ state: 'error', detail: 'No sign-in is running.' })
  })

  it('keeps an approved token and retries reading the account', async () => {
    const saved: string[] = []
    let userTries = 0
    const fake = github({
      token: () => ({ access_token: 'gho_secret' }),
      user: () => (++userTries === 1 ? { status: 502, json: {} } : { json: { login: 'geoffrey' } })
    })
    const signIn = createDeviceSignIn(async (token, login) => {
      saved.push(`${token}:${login}`)
    }, fake.fetchFn)
    await signIn.start('c')
    expect(await signIn.poll('c')).toEqual({ state: 'pending' })
    expect(await signIn.poll('c')).toEqual({ state: 'ok', login: 'geoffrey' })
    expect(fake.tokenCalls()).toBe(1) // the spent code is not redeemed again
    expect(saved).toEqual(['gho_secret:geoffrey'])
  })

  it('reports the account it could not read, after a few tries', async () => {
    const fake = github({
      token: () => ({ access_token: 'gho_secret' }),
      user: () => ({ status: 407, json: {} })
    })
    const signIn = createDeviceSignIn(async () => {}, fake.fetchFn)
    await signIn.start('c')
    for (let i = 1; i < LOGIN_ATTEMPTS; i++) {
      expect(await signIn.poll('c')).toEqual({ state: 'pending' })
    }
    await expect(signIn.poll('c')).rejects.toThrow(/407/)
    expect(await signIn.poll('c')).toEqual({ state: 'error', detail: 'No sign-in is running.' })
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

describe('which client id signs in', () => {
  it('uses the app’s own on a computer that has never set one', () => {
    expect(clientIdOf(undefined)).toBe(BUILT_IN_CLIENT_ID)
    expect(clientIdOf('')).toBe(BUILT_IN_CLIENT_ID)
    expect(clientIdOf('   ')).toBe(BUILT_IN_CLIENT_ID)
    expect(BUILT_IN_CLIENT_ID).toMatch(/^Ov23li[A-Za-z0-9]+$/)
  })

  it('lets a saved one win, trimmed', () => {
    expect(clientIdOf('  Iv1.mine ')).toBe('Iv1.mine')
  })
})
