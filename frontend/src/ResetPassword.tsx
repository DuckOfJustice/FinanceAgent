import { useEffect, useState } from 'react'

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => '')
  return text || fallback
}

export default function ResetPassword({ token, onDone }: { token: string; onDone: () => void }) {
  const [username, setUsername] = useState<string | null | undefined>(undefined)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    fetch(`/api/auth/reset-password/${token}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => setUsername(data ? data.username : null))
  }, [token])

  const submit = async () => {
    if (!password) {
      setError('Neues Passwort darf nicht leer sein.')
      return
    }
    setSubmitting(true)
    setError(null)
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword: password }),
    })
    if (res.ok) {
      setDone(true)
    } else {
      setError(await errorMessage(res, 'Zurücksetzen fehlgeschlagen.'))
    }
    setSubmitting(false)
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <img className="auth-logo" src="/duck-icon.png" alt="" />
          <div className="auth-name">FinanceDuck</div>
          <div className="auth-tagline">Finanzen mit Quak-Faktor</div>
        </div>

        {username === undefined ? (
          <p>Lade...</p>
        ) : username === null ? (
          <>
            <p>Dieser Link ist ungültig oder abgelaufen. Bitte einen neuen Link vom Admin anfordern.</p>
            <button type="button" className="btn-primary" onClick={onDone}>Zum Login</button>
          </>
        ) : done ? (
          <>
            <p>Das Passwort für <strong>{username}</strong> wurde geändert.</p>
            <button type="button" className="btn-primary" onClick={onDone}>Zum Login</button>
          </>
        ) : (
          <form onSubmit={e => { e.preventDefault(); submit() }}>
            <p>Neues Passwort für <strong>{username}</strong> festlegen.</p>
            <div className="auth-fields">
              <input
                type="password"
                placeholder="Neues Passwort"
                aria-label="Neues Passwort"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
              />
            </div>

            {error && <p className="auth-error">{error}</p>}

            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Speichert...' : 'Passwort setzen'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
