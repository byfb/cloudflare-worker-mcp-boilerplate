import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'

const Home = lazy(() => import('./pages/Home'))
const Account = lazy(() => import('./pages/Account'))
const SignIn = lazy(() => import('./pages/SignIn'))

function Shell() {
  const { user, loading, signOut } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(!navigator.onLine)
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  if (loading) return <main className="loading" role="status">Loading your workspace…</main>
  return <>
    {offline && <div className="banner" role="status">You’re offline. Connect to use your account.</div>}
    {user && <header className="header"><Link className="brand" to="/"><img src="/icon.svg" width="28" height="28" alt="" /> App Starter</Link>
      <nav aria-label="Main"><Link to="/">Home</Link><Link to="/account">Account</Link><button className="secondary" onClick={() => signOut().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Sign-out failed'))}>Sign out</button></nav>
    </header>}
    {error && <p role="alert" className="error container">{error}</p>}
    <Suspense fallback={<main className="loading" role="status">Loading…</main>}><Routes>
      <Route path="/login" element={<SignIn />} />
      <Route path="/register" element={<SignIn register />} />
      <Route path="/" element={user ? <Home /> : <Navigate to="/login" replace />} />
      <Route path="/account" element={user ? <Account /> : <Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></Suspense>
  </>
}
export default function App() { return <AuthProvider><Shell /></AuthProvider> }
