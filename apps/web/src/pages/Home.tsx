import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'

export default function Home() {
  const [status, setStatus] = useState('Checking connection…')
  useEffect(() => {
    const controller = new AbortController()
    apiFetch<{ ok: boolean }>('/api/health', { signal: controller.signal })
      .then((health) => setStatus(health.ok ? 'Connected' : 'Service unavailable'))
      .catch(() => { if (!controller.signal.aborted) setStatus('Service unavailable') })
    return () => controller.abort()
  }, [])
  return <main className="container">
    <p className="eyebrow">YOUR WORKSPACE</p>
    <h1>Ready for your next idea.</h1>
    <p className="lead">This is the starting point for your application.</p>
    <div className="cards">
      <section className="panel"><p className="eyebrow">ACCOUNT</p><h2>Make yourself at home</h2><p>Manage your sign-in and connected applications.</p><Link to="/account">Open account settings →</Link></section>
      <section className="panel"><p className="eyebrow">CONNECTION</p><h2 aria-live="polite">{status}</h2><p>Your workspace is ready when you are.</p></section>
    </div>
  </main>
}
