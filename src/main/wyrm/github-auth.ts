import type { GithubRepo, SignInPoll } from '../../shared/types'
/**
 * GitHub OAuth device flow (brief §7): the writer signs in once by typing a
 * short code into github.com — no tokens pasted, no client secret anywhere.
 * The OAuth app's client id is public by design; the token that comes back is
 * the only secret, and storing it is the caller's job (encrypted, app-level).
 *
 * Electron-free on purpose: `fetchFn` is injected so the whole flow is
 * testable with a scripted fetch.
 */

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface DeviceFlowSession {
  deviceCode: string
  userCode: string
  verificationUri: string
  /** ms since epoch when the code stops working. */
  expiresAt: number
  /** Current poll spacing; GitHub can ask us to slow down. */
  intervalMs: number
  /** ms since epoch before which a poll must not reach GitHub. */
  nextPollAt?: number
  /** Set once GitHub has handed it over, so a failed account lookup can be retried. */
  token?: string
  loginFailures?: number
}

export type DevicePollResult =
  | { state: 'pending'; held?: boolean }
  | { state: 'ok'; token: string }
  | { state: 'error'; detail: string }

/**
 * WyrmStar's own OAuth app, built in so a new computer can sign in with no
 * setup — it used to ask every writer to register an OAuth app of their own
 * and paste its id, once per computer. Public by design, as above: it names
 * the app, not an account, and each writer still signs in to their own
 * GitHub and approves access there. A client id saved in settings (the old
 * paste-it-in step, or a writer who wants their own app) still wins.
 */
export const BUILT_IN_CLIENT_ID = 'Ov23liudhPpDFxOdmR8M'

/** The client id to sign in with: a saved one, else the built-in one. */
export function clientIdOf(saved: string | undefined): string {
  return saved?.trim() || BUILT_IN_CLIENT_ID
}

const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const API = 'https://api.github.com'

/**
 * GitHub's device endpoints put their real diagnosis in the JSON body — and
 * do not always pair it with a 2xx. Throwing on status alone would replace
 * "device flow is not enabled on this OAuth app", the single likeliest setup
 * mistake, with an opaque number. So the body is read first and only an
 * unreadable one falls back to the status.
 */
function postInit(body: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  return (await response.json().catch(() => null)) as Record<string, unknown> | null
}

async function postJson(
  fetchFn: FetchLike,
  url: string,
  body: Record<string, string>
): Promise<Record<string, unknown>> {
  const response = await fetchFn(url, postInit(body))
  const data = await readJson(response)
  if (data == null) {
    throw new Error(
      response.status === 404
        ? 'GitHub did not recognise that client id. Check it, and that the OAuth app has Device Flow enabled.'
        : `GitHub answered ${response.status} for ${url}`
    )
  }
  return data
}

export async function startDeviceFlow(
  clientId: string,
  fetchFn: FetchLike = fetch
): Promise<DeviceFlowSession> {
  // scope=repo: private repositories are the default for manuscripts.
  const data = await postJson(fetchFn, DEVICE_CODE_URL, { client_id: clientId, scope: 'repo' })
  if (typeof data.device_code !== 'string' || !data.device_code) {
    throw new Error(
      data.error === 'device_flow_disabled'
        ? 'That OAuth app does not have Device Flow enabled — turn it on in its GitHub settings.'
        : String(data.error_description ?? data.error ?? 'GitHub would not start the sign-in.')
    )
  }
  const expiresIn = Number(data.expires_in ?? 900)
  return {
    deviceCode: String(data.device_code ?? ''),
    userCode: String(data.user_code ?? ''),
    verificationUri: String(data.verification_uri ?? 'https://github.com/login/device'),
    expiresAt: Date.now() + expiresIn * 1000,
    intervalMs: Math.max(1, Number(data.interval ?? 5)) * 1000
  }
}

/** Headroom on top of GitHub's interval, against clocks and timers that run a little early. */
export const POLL_MARGIN_MS = 1000

/**
 * How long one poll may take. Without a limit, a request held by a dead
 * connection or a proxy kept the caller waiting on it for minutes, with
 * nothing else allowed to ask.
 */
export const POLL_TIMEOUT_MS = 15_000

/**
 * One poll step. The caller may call as often as it likes: this holds back
 * any call that comes sooner than `session.intervalMs` after the last one
 * that reached GitHub, and answers it pending. It used to leave the spacing
 * to the caller, which ticked every 5s regardless. One slow_down then made
 * every later poll too soon, each one earning another slow_down, so an
 * approved sign-in was never seen.
 */
export async function pollDeviceFlow(
  clientId: string,
  session: DeviceFlowSession,
  fetchFn: FetchLike = fetch,
  timeoutMs = POLL_TIMEOUT_MS
): Promise<DevicePollResult> {
  if (Date.now() > session.expiresAt) {
    return { state: 'error', detail: 'That sign-in code expired. Start again to get a new one.' }
  }
  const now = Date.now()
  if (session.nextPollAt != null && now < session.nextPollAt) {
    return { state: 'pending', held: true }
  }
  // Set before the request goes, so a call made while it is in flight waits.
  session.nextPollAt = now + session.intervalMs + POLL_MARGIN_MS
  // A dropped connection, a stalled request, or a busy GitHub is not the end
  // of the sign-in: the code stays good until it expires (RFC 8628 §3.5), and
  // the writer may approve it the moment after.
  let response: Response
  try {
    response = await fetchFn(ACCESS_TOKEN_URL, {
      ...postInit({
        client_id: clientId,
        device_code: session.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      }),
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch {
    session.nextPollAt = Date.now() + session.intervalMs + POLL_MARGIN_MS
    return { state: 'pending' }
  }
  const data = await readJson(response)
  // Counted again from the answer. GitHub times requests as they arrive, so
  // spacing them from when they were sent let a slow one followed by a quick
  // one land inside the interval.
  session.nextPollAt = Date.now() + session.intervalMs + POLL_MARGIN_MS
  if (data == null) {
    if (response.status >= 500 || response.status === 429) return { state: 'pending' }
    throw new Error(`GitHub answered ${response.status} for ${ACCESS_TOKEN_URL}`)
  }
  if (typeof data.access_token === 'string' && data.access_token) {
    return { state: 'ok', token: data.access_token }
  }
  switch (data.error) {
    case 'authorization_pending':
      return { state: 'pending' }
    case 'slow_down': {
      // GitHub sends the new interval itself; the spec's rule, five seconds
      // more, is the floor when it doesn't.
      const given = Number(data.interval) * 1000
      session.intervalMs = Math.max(session.intervalMs + 5000, Number.isFinite(given) ? given : 0)
      session.nextPollAt = Date.now() + session.intervalMs + POLL_MARGIN_MS
      return { state: 'pending' }
    }
    case 'expired_token':
      return { state: 'error', detail: 'That sign-in code expired. Start again to get a new one.' }
    case 'access_denied':
      return { state: 'error', detail: 'The sign-in was declined on GitHub.' }
    default:
      return {
        state: 'error',
        detail: String(data.error_description ?? data.error ?? 'Sign-in failed.')
      }
  }
}

function apiHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28'
  }
}

export async function fetchGithubLogin(token: string, fetchFn: FetchLike = fetch): Promise<string> {
  const response = await fetchFn(`${API}/user`, { headers: apiHeaders(token) })
  if (!response.ok) throw new Error(`Could not read the signed-in account (${response.status}).`)
  const data = (await response.json()) as { login?: string }
  if (!data.login) throw new Error('GitHub returned no account name.')
  return data.login
}

/**
 * The signed-in account's repositories, most recently pushed first (F-43).
 *
 * No new permission: `createPrivateRepo` already uses this endpoint, so the
 * token the writer has already granted covers reading the list. Asks for
 * everything the account can push to — a novel may well live in a repository
 * the writer was added to rather than one they own.
 */
export async function listUserRepos(
  token: string,
  fetchFn: FetchLike = fetch
): Promise<GithubRepo[]> {
  const response = await fetchFn(
    `${API}/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator`,
    {
      headers: apiHeaders(token)
    }
  )
  if (!response.ok) throw new Error(`Could not read your GitHub spaces (${response.status}).`)
  const data = (await response.json()) as {
    name?: string
    full_name?: string
    clone_url?: string
    private?: boolean
    pushed_at?: string
    updated_at?: string
  }[]
  return data
    .filter((r) => r.name && r.clone_url)
    .map((r) => ({
      name: r.name as string,
      fullName: r.full_name ?? (r.name as string),
      cloneUrl: r.clone_url as string,
      private: Boolean(r.private),
      updatedAt: r.pushed_at ?? r.updated_at ?? ''
    }))
}

/** Create the project's private home on GitHub. Returns the clone URL. */
export async function createPrivateRepo(
  token: string,
  name: string,
  fetchFn: FetchLike = fetch
): Promise<string> {
  const response = await fetchFn(`${API}/user/repos`, {
    method: 'POST',
    headers: { ...apiHeaders(token), 'Content-Type': 'application/json' },
    // No auto_init: the first sync must be a plain fast-forward into an empty
    // repository, not a merge with a README nobody asked for.
    body: JSON.stringify({ name, private: true, auto_init: false })
  })
  if (response.status === 422) {
    throw new Error(`A space named “${name}” already exists on this account — pick another name.`)
  }
  if (!response.ok) throw new Error(`GitHub would not create the space (${response.status}).`)
  const data = (await response.json()) as { clone_url?: string }
  if (!data.clone_url) throw new Error('GitHub returned no address for the new space.')
  return data.clone_url
}

/** How many times reading the account may fail before the sign-in reports it. */
export const LOGIN_ATTEMPTS = 3

export interface DeviceSignIn {
  start(clientId: string): Promise<DeviceFlowSession>
  poll(clientId: string): Promise<SignInPoll>
}

/**
 * The sign-in as the main process runs it: one session at a time, polled on
 * request, with the token saved once the account behind it is known.
 *
 * A poll only clears the session it polled. A slow poll from an earlier code
 * used to clear whichever session was current when it returned, so a new
 * sign-in started meanwhile was told "No sign-in is running".
 *
 * Once GitHub has handed the token over, the code is spent. If reading the
 * account then fails, the token is kept and the read retried on the next
 * poll, rather than throwing away a sign-in the writer already approved.
 */
export function createDeviceSignIn(
  save: (token: string, login: string) => Promise<void>,
  fetchFn: FetchLike = fetch
): DeviceSignIn {
  let session: DeviceFlowSession | null = null
  return {
    async start(clientId) {
      session = await startDeviceFlow(clientId, fetchFn)
      return session
    },
    async poll(clientId) {
      const s = session
      if (!s) return { state: 'error', detail: 'No sign-in is running.' }
      if (s.token == null) {
        const result = await pollDeviceFlow(clientId, s, fetchFn)
        if (result.state === 'pending') return result
        if (result.state === 'error') {
          if (session === s) session = null
          return result
        }
        s.token = result.token
      }
      let login: string
      try {
        login = await fetchGithubLogin(s.token, fetchFn)
      } catch (e) {
        s.loginFailures = (s.loginFailures ?? 0) + 1
        if (s.loginFailures < LOGIN_ATTEMPTS) return { state: 'pending' }
        if (session === s) session = null
        throw e
      }
      await save(s.token, login)
      if (session === s) session = null
      return { state: 'ok', login }
    }
  }
}
