import { experimental_AstroContainer as AstroContainer } from 'astro/container'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import Home from './pages/index.astro'
import Login from './pages/login.astro'
import Register from './pages/register.astro'
import Account from './pages/account.astro'
import { startPage } from './scripts/app'

const session = { user_id: 'member-id', username: 'member', csrf: 'test-csrf' }
const unauthorized = () => Response.json({ code: 'unauthenticated' }, { status: 401 })

async function mount(page: typeof Home) {
  const container = await AstroContainer.create()
  const html = await container.renderToString(page)
  const rendered = new DOMParser().parseFromString(html, 'text/html')
  document.head.innerHTML = rendered.head.innerHTML
  document.body.innerHTML = rendered.body.innerHTML
  document.body.dataset.page = rendered.body.dataset.page
}

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'))
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('Astro account pages', () => {
  it.each([Home, Account])('checks the session before revealing a private page', async (page) => {
    const fetcher = vi.fn(async () => unauthorized())
    vi.stubGlobal('fetch', fetcher)
    await mount(page)
    const navigate = vi.fn()
    await startPage(navigate)
    expect(navigate).toHaveBeenCalledWith('/login')
    expect(document.querySelector('[data-page-content]')).not.toBeVisible()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([Login, Register])('redirects signed-in users away from public account forms', async (page) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(session)))
    await mount(page)
    const navigate = vi.fn()
    await startPage(navigate)
    expect(navigate).toHaveBeenCalledWith('/')
    expect(document.querySelector('[data-page-content]')).not.toBeVisible()
  })

  it.each([
    { page: Login, action: 'login', button: 'Sign in' },
    { page: Register, action: 'register', button: 'Create account' },
  ])('submits the $action form and navigates after the session cookie is set', async ({ page, action, button }) => {
    const fetcher = vi.fn(async (path: string) => path === '/api/auth/me' ? unauthorized() : Response.json(session))
    vi.stubGlobal('fetch', fetcher)
    await mount(page)
    const navigate = vi.fn()
    await startPage(navigate)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Username'), 'member')
    await user.type(screen.getByLabelText('Password'), 'password-example')
    await user.click(screen.getByRole('button', { name: button }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'))
    expect(fetcher).toHaveBeenLastCalledWith(`/api/auth/${action}`, expect.objectContaining({
      method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'manual',
      body: JSON.stringify({ username: 'member', password: 'password-example' }),
    }))
  })

  it('reports a failed sign-in and permits another attempt', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path === '/api/auth/me' ? unauthorized()
      : Response.json({ message: 'Invalid username or password' }, { status: 401 })))
    await mount(Login)
    const navigate = vi.fn()
    await startPage(navigate)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Username'), 'member')
    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('bootstraps a linked Access session without submitting password fields', async () => {
    const fetcher = vi.fn(async (path: string) => path === '/api/auth/me' ? unauthorized() : Response.json(session))
    vi.stubGlobal('fetch', fetcher)
    await mount(Login)
    const navigate = vi.fn()
    await startPage(navigate)
    const user = userEvent.setup()
    await user.click(screen.getByText('Organization sign-in'))
    await user.click(screen.getByRole('button', { name: 'Continue with Access' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'))
    expect(fetcher).toHaveBeenLastCalledWith('/api/auth/access-session', expect.objectContaining({ method: 'POST' }))
  })

  it('shows health and sends CSRF when signing out', async () => {
    const calls: { path: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
      calls.push({ path, init })
      if (path === '/api/auth/me') return Response.json(session)
      if (path === '/api/health') return Response.json({ ok: true })
      return new Response(null, { status: 204 })
    }))
    await mount(Home)
    const navigate = vi.fn()
    await startPage(navigate)
    expect(screen.getByRole('heading', { name: 'Connected' })).toBeVisible()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login'))
    const logout = calls.find(({ path }) => path === '/api/auth/logout')!
    expect(new Headers(logout.init.headers).get('X-CSRF-Token')).toBe(session.csrf)
  })

  it('links identities and disconnects, reconnects, and forgets clients with CSRF', async () => {
    let connections = [{ client_key: 'example-client', display_name: '<img src=x onerror=alert(1)>', enabled: true, tool_call_count: 3 }]
    let identities: { email: string }[] = []
    const mutations: { path: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
      if (path === '/api/auth/me') return Response.json(session)
      if (init.method) {
        mutations.push({ path, init })
        if (path === '/api/auth/access-link') identities = [{ email: 'member@example.com' }]
        if (init.method === 'PATCH') connections[0].enabled = JSON.parse(init.body as string).enabled
        if (init.method === 'DELETE') connections = []
        return new Response(null, { status: 204 })
      }
      if (path === '/api/mcp-connections') return Response.json({ connections })
      return Response.json({ identities })
    }))
    await mount(Account)
    await startPage(vi.fn())
    expect(screen.getByText(session.username)).toBeVisible()
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible()
    expect(document.querySelector('[data-connections] img')).toBeNull()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Link current Access identity' }))
    expect(await screen.findByText('member@example.com')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(await screen.findByRole('button', { name: 'Reconnect' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Reconnect' }))
    expect(await screen.findByRole('button', { name: 'Disconnect' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    await user.click(await screen.findByRole('button', { name: 'Forget' }))
    expect(await screen.findByText('No applications connected yet.')).toBeVisible()
    expect(mutations.map(({ init }) => init.method)).toEqual(['POST', 'PATCH', 'PATCH', 'PATCH', 'DELETE'])
    for (const { init } of mutations) expect(new Headers(init.headers).get('X-CSRF-Token')).toBe(session.csrf)
    expect(JSON.parse(mutations.at(-1)!.init.body as string)).toEqual({ client_key: 'example-client' })
  })

  it('shows account failures and re-enables mutation controls', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
      if (path === '/api/auth/me') return Response.json(session)
      if (init.method) return Response.json({ message: 'Access identity unavailable' }, { status: 403 })
      if (path === '/api/mcp-connections') return Response.json({ connections: [] })
      return Response.json({ identities: [] })
    }))
    await mount(Account)
    await startPage(vi.fn())
    const link = screen.getByRole('button', { name: 'Link current Access identity' })
    await userEvent.setup().click(link)
    expect(await screen.findByRole('alert')).toHaveTextContent('Access identity unavailable')
    expect(link).toBeEnabled()
  })

  it('keeps the sign-in shell usable offline and updates the connection banner', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await mount(Login)
    await startPage(vi.fn())
    expect(screen.getByText('You’re offline. Connect to use your account.')).toBeVisible()
    expect(screen.getByLabelText('Username')).toBeVisible()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    expect(screen.getByText('You’re offline. Connect to use your account.')).not.toBeVisible()
  })
})
