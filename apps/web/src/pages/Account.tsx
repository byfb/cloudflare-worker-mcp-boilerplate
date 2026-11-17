import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { apiFetch, authenticatedRequest } from '../lib/api'

interface Connection {
  client_key: string; display_name: string; client_version: string
  first_seen_at: number; last_seen_at: number; tool_call_count: number; enabled: boolean
}
interface Identity { email: string | null; linked_at: string }

export default function Account() {
  const { user } = useAuth()
  const [connections, setConnections] = useState<Connection[]>([])
  const [identities, setIdentities] = useState<Identity[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(true)
  const reload = useCallback(async () => {
    const [clients, linked] = await Promise.all([
      apiFetch<{ connections: Connection[] }>('/api/mcp-connections'),
      apiFetch<{ identities: Identity[] }>('/api/auth/access-identities'),
    ])
    setConnections(clients.connections)
    setIdentities(linked.identities)
  }, [])
  useEffect(() => {
    reload().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Could not load account')).finally(() => setLoading(false))
  }, [reload])

  async function mutate(path: string, method: string, body?: object) {
    if (!user) return
    setPending(true); setError(null)
    try {
      await authenticatedRequest(user.csrf, path, { method, ...(body ? { body: JSON.stringify(body) } : {}) })
      await reload()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Request failed') }
    finally { setPending(false) }
  }

  return <main className="container narrow">
    <p className="eyebrow">SETTINGS</p><h1>Your account</h1>
    {error && <p role="alert" className="error">{error}</p>}
    <section className="panel"><h2>Profile</h2><p className="muted">Username</p><strong>{user?.username}</strong></section>
    <section className="panel"><h2>Organization sign-in</h2>
      <p>Link your access-provider identity to sign in and authorize application connections.</p>
      {identities.map((identity, index) => <p key={index}>{identity.email ?? 'Linked identity'}</p>)}
      <button className="secondary" disabled={pending} onClick={() => mutate('/api/auth/access-link', 'POST')}>Link current Access identity</button>
    </section>
    <section className="panel"><h2>Connected applications</h2>
      <p className="muted">These controls apply to the client name reported by each application. Disconnecting here does not revoke the provider’s OAuth grant.</p>
      {loading ? <p role="status">Loading connections…</p> : connections.length === 0 ? <p>No applications connected yet.</p> :
        <ul className="connections">{connections.map((connection) => <li key={connection.client_key}>
          <div><strong>{connection.display_name}</strong><p className="muted">{connection.enabled ? 'Connected' : 'Disconnected'} · {connection.tool_call_count} tool calls</p></div>
          <div className="actions"><button className="secondary" disabled={pending} onClick={() => mutate('/api/mcp-connections', 'PATCH', { client_key: connection.client_key, enabled: !connection.enabled })}>{connection.enabled ? 'Disconnect' : 'Reconnect'}</button>
            {!connection.enabled && <button className="secondary" disabled={pending} onClick={() => mutate('/api/mcp-connections', 'DELETE', { client_key: connection.client_key })}>Forget</button>}</div>
        </li>)}</ul>}
    </section>
  </main>
}
