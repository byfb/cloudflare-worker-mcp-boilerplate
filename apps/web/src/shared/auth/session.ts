import { ApiError, apiFetch } from '@/shared/api'
import { errorMessage } from '@/shared/lib'

export interface SessionUser { user_id: string; username: string; csrf: string }
export type Navigate = (path: string) => void

export async function loadSession(): Promise<{ user: SessionUser | null; error: string | null }> {
  try {
    return { user: await apiFetch<SessionUser>('/api/auth/me'), error: null }
  } catch (failure) {
    return {
      user: null,
      error: failure instanceof ApiError && failure.status === 401
        ? null : errorMessage(failure, 'Could not load your session'),
    }
  }
}
