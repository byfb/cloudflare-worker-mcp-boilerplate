import { apiFetch } from '../lib/api'
import { element } from '../lib/dom'

export async function initializeHome() {
  const status = element('[data-health]')
  try {
    const health = await apiFetch<{ ok: boolean }>('/api/health')
    status.textContent = health.ok ? 'Connected' : 'Service unavailable'
  } catch {
    status.textContent = 'Service unavailable'
  }
}
