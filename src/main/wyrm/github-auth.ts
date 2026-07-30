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
}

export type DevicePollResult =
  { state: 'pending' } | { state: 'ok'; token: string } | { state: 'error'; detail: string }

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
async function postJson(
  fetchFn: FetchLike,
  url: string,
  body: Record<string, string>
): Promise<Record<string, unknown>> {
  const response = await fetchFn(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null
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

/**
 * One poll step. The caller owns the cadence (`session.intervalMs`, which
 * this bumps when GitHub says slow_down) and the deadline (`expiresAt`).
 */
export async function pollDeviceFlow(
  clientId: string,
  session: DeviceFlowSession,
  fetchFn: FetchLike = fetch
): Promise<DevicePollResult> {
  if (Date.now() > session.expiresAt) {
    return { state: 'error', detail: 'That sign-in code expired. Start again to get a new one.' }
  }
  const data = await postJson(fetchFn, ACCESS_TOKEN_URL, {
    client_id: clientId,
    device_code: session.deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
  })
  if (typeof data.access_token === 'string' && data.access_token) {
    return { state: 'ok', token: data.access_token }
  }
  switch (data.error) {
    case 'authorization_pending':
      return { state: 'pending' }
    case 'slow_down':
      session.intervalMs += Math.max(1, Number(data.interval ?? 5)) * 1000
      return { state: 'pending' }
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
