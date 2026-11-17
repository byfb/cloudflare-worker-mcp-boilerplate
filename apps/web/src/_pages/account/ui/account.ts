import { apiFetch, authenticatedRequest } from '@/shared/api'
import { element, errorMessage, showError } from '@/shared/lib'
import type { SessionUser } from '@/shared/auth'

interface Connection {
  client_key: string; display_name: string; client_version: string
  first_seen_at: number; last_seen_at: number; tool_call_count: number; enabled: boolean
}
interface Identity { email: string | null; linked_at: string }

export async function initializeAccount(user: SessionUser) {
  const account = element('[data-account]')
  const error = element('[data-account-error]')
  const list = element('[data-connections]')
  const status = element('[data-connections-status]')
  const identities = element('[data-identities]')
  const template = element<HTMLTemplateElement>('[data-connection-template]')
  let pending = false
  element('[data-username]').textContent = user.username

  async function reload() {
    const [clients, linked] = await Promise.all([
      apiFetch<{ connections: Connection[] }>('/api/mcp-connections'),
      apiFetch<{ identities: Identity[] }>('/api/auth/access-identities'),
    ])
    identities.replaceChildren(...linked.identities.map((identity) => {
      const paragraph = document.createElement('p')
      paragraph.textContent = identity.email ?? 'Linked identity'
      return paragraph
    }))
    list.replaceChildren(...clients.connections.map((connection) => {
      const row = template.content.cloneNode(true) as DocumentFragment
      element('[data-client-name]', row).textContent = connection.display_name
      element('[data-client-status]', row).textContent = `${connection.enabled ? 'Connected' : 'Disconnected'} · ${connection.tool_call_count} tool calls`
      const toggle = element<HTMLButtonElement>('[data-toggle-connection]', row)
      toggle.textContent = connection.enabled ? 'Disconnect' : 'Reconnect'
      toggle.disabled = pending
      toggle.addEventListener('click', () => { void mutate('/api/mcp-connections', 'PATCH', { client_key: connection.client_key, enabled: !connection.enabled }) })
      const forget = element<HTMLButtonElement>('[data-forget-connection]', row)
      forget.hidden = connection.enabled
      forget.disabled = pending
      forget.addEventListener('click', () => { void mutate('/api/mcp-connections', 'DELETE', { client_key: connection.client_key }) })
      return row
    }))
    list.hidden = clients.connections.length === 0
    status.hidden = clients.connections.length > 0
    status.textContent = 'No applications connected yet.'
  }

  async function mutate(path: string, method: string, body?: object) {
    if (pending) return
    pending = true
    account.querySelectorAll('button').forEach((button) => { button.disabled = true })
    showError(error, null)
    try {
      await authenticatedRequest(user.csrf, path, { method, ...(body ? { body: JSON.stringify(body) } : {}) })
      await reload()
    } catch (failure) {
      showError(error, errorMessage(failure, 'Request failed'))
    } finally {
      pending = false
      account.querySelectorAll('button').forEach((button) => { button.disabled = false })
    }
  }

  element('[data-link-identity]').addEventListener('click', () => { void mutate('/api/auth/access-link', 'POST') })
  try {
    await reload()
  } catch (failure) {
    showError(error, errorMessage(failure, 'Could not load account'))
    status.hidden = true
  }
}
