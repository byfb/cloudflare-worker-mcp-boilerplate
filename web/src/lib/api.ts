export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'manual' })
  if (response.type === 'opaqueredirect') {
    throw new ApiError(401, 'access_redirect', 'Your access session expired. Sign in through your access provider again.')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { code?: string; message?: string }
    throw new ApiError(response.status, body.code ?? 'request_failed', body.message ?? 'Request failed')
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}

export function authenticatedRequest<T>(csrf: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('X-CSRF-Token', csrf)
  return apiFetch<T>(path, { ...init, headers })
}
