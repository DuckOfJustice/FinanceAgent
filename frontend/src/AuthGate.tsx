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
      <form
        className="auth-card"
        onSubmit={e => { e.preventDefault(); submit() }}
      >
        <h1 className="auth-title">FinanceDuck</h1>
        <div className="auth-tabs">
          <button type="button" className={mode === 'login' ? 'is-active' : ''} onClick={() => { setMode('login'); setError(null) }}>Anmelden</button>
          <button type="button" className={mode === 'register' ? 'is-active' : ''} onClick={() => { setMode('register'); setError(null) }}>Registrieren</button>
        </div>
        <input type="text" placeholder="Benutzername" value={username} onChange={e => setUsername(e.target.value)} autoFocus />
        <input type="password" placeholder="Passwort" value={password} onChange={e => setPassword(e.target.value)} />
        {error && <p className="category-row-error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Bitte warten...' : mode === 'login' ? 'Anmelden' : 'Registrieren'}
        </button>
      </form>
    </div>
  )
}
