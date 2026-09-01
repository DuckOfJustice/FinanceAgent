import { useState } from 'react'

type AuthUser = { username: string; isAdmin: boolean }

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => '')
  return text || fallback
}

export default function AuthGate({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const switchMode = (next: 'login' | 'register') => {
    setMode(next)
    setError(null)
  }

  const submit = async () => {
    if (!username.trim() || !password) {
      setError('Benutzername und Passwort duerfen nicht leer sein.')
      return
    }
    setSubmitting(true)
    setError(null)
    const res = await fetch(`/api/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), password }),
    })
    if (res.ok) {
      const user: AuthUser = await res.json()
      onAuthenticated(user)
    } else {
      setError(await errorMessage(res, mode === 'login' ? 'Login fehlgeschlagen.' : 'Registrierung fehlgeschlagen.'))
    }
    setSubmitting(false)
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={e => { e.preventDefault(); submit() }}>
        <div className="auth-brand">
          <img className="auth-logo" src="/duck-icon.png" alt="" />
          <div className="auth-name">FinanceDuck</div>
          <div className="auth-tagline">Finanzen mit Quak-Faktor</div>
        </div>

        <div className="auth-tabs">
          <button type="button" aria-pressed={mode === 'login'} className={mode === 'login' ? 'is-active' : ''} onClick={() => switchMode('login')}>
            Anmelden
          </button>
          <button type="button" aria-pressed={mode === 'register'} className={mode === 'register' ? 'is-active' : ''} onClick={() => switchMode('register')}>
            Registrieren
          </button>
        </div>

        <div className="auth-fields">
          <input
            type="text"
            placeholder="Benutzername"
            aria-label="Benutzername"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
          />
          <input
            type="password"
            placeholder="Passwort"
            aria-label="Passwort"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </div>

        {error && <p className="auth-error">{error}</p>}

        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Bitte warten...' : mode === 'login' ? 'Anmelden' : 'Registrieren'}
        </button>
      </form>
    </div>
  )
}
