import { ApiError, authenticatedRequest } from '../lib/api'
import { element, errorMessage, showError } from '../lib/dom'
import { loadSession, type Navigate } from '../lib/session'
import { initializeAccount } from './account'
import { initializeHome } from './home'
import { initializeSignIn } from './sign-in'

export async function startPage(navigate: Navigate = (path) => window.location.replace(path)) {
  const banner = element('[data-offline]')
  const updateOnlineStatus = () => { banner.hidden = navigator.onLine }
  updateOnlineStatus()
  window.addEventListener('online', updateOnlineStatus)
  window.addEventListener('offline', updateOnlineStatus)
  window.addEventListener('pagehide', () => {
    window.removeEventListener('online', updateOnlineStatus)
    window.removeEventListener('offline', updateOnlineStatus)
  }, { once: true })

  const { user, error } = await loadSession()
  const page = document.body.dataset.page
  const publicPage = page === 'login' || page === 'register'
  if (!user && !publicPage) { navigate('/login'); return }
  if (user && publicPage) { navigate('/'); return }

  element('[data-session-loading]').hidden = true
  element('[data-page-content]').hidden = false
  element('[data-auth-header]').hidden = !user

  if (user) {
    const signOut = element<HTMLButtonElement>('[data-sign-out]')
    signOut.addEventListener('click', async () => {
      signOut.disabled = true
      const errorNode = element('[data-shell-error]')
      showError(errorNode, null)
      try {
        try {
          await authenticatedRequest(user.csrf, '/api/auth/logout', { method: 'POST' })
        } catch (failure) {
          if (!(failure instanceof ApiError && failure.status === 401)) throw failure
        }
        navigate('/login')
      } catch (failure) {
        showError(errorNode, errorMessage(failure, 'Sign-out failed'))
      } finally {
        signOut.disabled = false
      }
    })
    if (page === 'account') await initializeAccount(user)
    else await initializeHome()
  } else {
    initializeSignIn(error, navigate)
  }
}
