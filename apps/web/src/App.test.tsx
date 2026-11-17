import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import App from './App'

afterEach(() => vi.unstubAllGlobals())
describe('starter application', () => {
  it('signs in, shows the workspace, and signs out with the CSRF token', async () => {
    const calls: { path: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
      calls.push({ path, init })
      if (path === '/api/auth/me') return new Response(JSON.stringify({ code: 'unauthenticated' }), { status: 401 })
      if (path === '/api/auth/login') return Response.json({ user_id: 'member-id', username: 'member', csrf: 'test-csrf' })
      if (path === '/api/auth/logout') return new Response(null, { status: 204 })
      if (path === '/api/health') return Response.json({ ok: true })
      throw new Error(`Unexpected request: ${path}`)
    }))
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    await user.type(await screen.findByLabelText('Username'), 'member')
    await user.type(screen.getByLabelText('Password'), 'password-example')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Ready for your next idea.')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Connected' })).toBeInTheDocument()
    const login = calls.find(({ path }) => path === '/api/auth/login')!
    expect(JSON.parse(login.init.body as string)).toEqual({ username: 'member', password: 'password-example' })
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByLabelText('Username')).toBeInTheDocument()
    const logout = calls.find(({ path }) => path === '/api/auth/logout')!
    expect(new Headers(logout.init.headers).get('X-CSRF-Token')).toBe('test-csrf')
  })
})
