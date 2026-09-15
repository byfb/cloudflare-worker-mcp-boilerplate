import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export default function SignIn({ register = false }: { register?: boolean }) {
  const { user, signIn, signInWithAccess, error: sessionError } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  if (user) return <Navigate to="/" replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try { await signIn(register ? 'register' : 'login', username, password) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Sign-in failed') }
    finally { setPending(false) }
  }

  return <main className="auth-page">
    <section className="auth-intro"><img src="/icon.svg" width="48" height="48" alt="" />
      <p className="eyebrow">APP STARTER</p>
      <h1>A place to start.<br />Room to grow.</h1>
      <p>Your application begins here.</p>
    </section>
    <section className="panel auth-form">
      <h2>{register ? 'Create your account' : 'Welcome back'}</h2>
      <p className="muted">{register ? 'Choose a username and password to get started.' : 'Sign in to your workspace.'}</p>
      <form onSubmit={submit}>
        <label>Username<input autoComplete="username" required minLength={3} maxLength={32} pattern="[A-Za-z0-9_]+" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
        <label>Password<input type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={8} maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {(error || sessionError) && <p role="alert" className="error">{error || sessionError}</p>}
        <button disabled={pending} type="submit">{pending ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</button>
      </form>
      <p className="muted">{register ? 'Already have an account? ' : 'New here? '}<Link to={register ? '/login' : '/register'}>{register ? 'Sign in' : 'Create an account'}</Link></p>
      {!register && <details><summary>Organization sign-in</summary>
        <p className="muted">Use a previously linked access-provider account.</p>
        <button className="secondary" disabled={pending} onClick={async () => {
          setPending(true); setError(null)
          try { await signInWithAccess() } catch (failure) { setError(failure instanceof Error ? failure.message : 'Sign-in failed') }
          finally { setPending(false) }
        }}>Continue with Access</button>
      </details>}
    </section>
  </main>
}
