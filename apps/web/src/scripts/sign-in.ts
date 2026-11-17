import { apiFetch } from '../lib/api'
import { element, errorMessage, showError } from '../lib/dom'
import type { Navigate, SessionUser } from '../lib/session'

export function initializeSignIn(sessionError: string | null, navigate: Navigate) {
  const form = element<HTMLFormElement>('[data-sign-in]')
  const error = element('[data-sign-in-error]')
  const submitButton = element<HTMLButtonElement>('button[type="submit"]', form)
  const accessButton = document.querySelector<HTMLButtonElement>('[data-access-sign-in]')
  const label = submitButton.textContent
  let pending = false
  showError(error, sessionError)

  async function signIn(path: string, body?: object) {
    if (pending) return
    pending = true
    submitButton.disabled = true
    submitButton.textContent = 'Please wait…'
    if (accessButton) accessButton.disabled = true
    showError(error, null)
    try {
      await apiFetch<SessionUser>(path, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) })
      navigate('/')
    } catch (failure) {
      showError(error, errorMessage(failure, 'Sign-in failed'))
    } finally {
      pending = false
      submitButton.disabled = false
      submitButton.textContent = label
      if (accessButton) accessButton.disabled = false
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const data = new FormData(form)
    void signIn(`/api/auth/${form.dataset.action}`, { username: data.get('username'), password: data.get('password') })
  })
  accessButton?.addEventListener('click', () => { void signIn('/api/auth/access-session') })
}
