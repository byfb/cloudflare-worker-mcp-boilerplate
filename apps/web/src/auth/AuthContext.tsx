import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { ApiError, apiFetch, authenticatedRequest } from '../lib/api'

export interface SessionUser { user_id: string; username: string; csrf: string }
interface AuthState {
  user: SessionUser | null
  loading: boolean
  error: string | null
  signIn(action: 'login' | 'register', username: string, password: string): Promise<void>
  signInWithAccess(): Promise<void>
  signOut(): Promise<void>
}
const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    apiFetch<SessionUser>('/api/auth/me', { signal: controller.signal })
      .then(setUser)
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return
        if (!(failure instanceof ApiError && failure.status === 401)) {
          setError(failure instanceof Error ? failure.message : 'Could not load your session')
        }
      }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  const signIn = useCallback(async (action: 'login' | 'register', username: string, password: string) => {
    const session = await apiFetch<SessionUser>(`/api/auth/${action}`, {
      method: 'POST', body: JSON.stringify({ username, password }),
    })
    setError(null)
    setUser(session)
  }, [])
  const signInWithAccess = useCallback(async () => {
    const session = await apiFetch<SessionUser>('/api/auth/access-session', { method: 'POST' })
    setError(null)
    setUser(session)
  }, [])
  const signOut = useCallback(async () => {
    if (!user) return
    try {
      await authenticatedRequest(user.csrf, '/api/auth/logout', { method: 'POST' })
    } catch (failure) {
      if (!(failure instanceof ApiError && failure.status === 401)) throw failure
    }
    setUser(null)
  }, [user])

  return <AuthContext.Provider value={{ user, loading, error, signIn, signInWithAccess, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('AuthProvider is required')
  return context
}
