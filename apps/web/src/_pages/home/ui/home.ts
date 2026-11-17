import { apiFetch } from '@/shared/api'
import { element } from '@/shared/lib'

export async function initializeHome() {
  const status = element('[data-health]')
  try {
    const health = await apiFetch<{ ok: boolean }>('/api/health')
    status.textContent = health.ok ? 'Connected' : 'Service unavailable'
  } catch {
    status.textContent = 'Service unavailable'
  }
}
