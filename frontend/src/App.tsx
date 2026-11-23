import { useEffect, useRef, useState } from 'react'
import AuthGate from './AuthGate'
import ResetPassword from './ResetPassword'
import MonthlyDashboard from './MonthlyDashboard'
import CategoryManager from './CategoryManager'
import RuleManager from './RuleManager'
import AdminPanel from './AdminPanel'

const iconProps = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const IconTag = () => (
  <svg {...iconProps}>
    <path d="M4 4h6.5L20 13.5a2 2 0 0 1 0 2.83l-3.67 3.67a2 2 0 0 1-2.83 0L4 10.5V4Z" />
    <circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" stroke="none" />
  </svg>
)

const IconListChecks = () => (
  <svg {...iconProps}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17" />
  </svg>
)

const IconUpload = () => (
  <svg {...iconProps}>
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </svg>
)

const IconLink = () => (
  <svg {...iconProps}>
    <path d="M9 15 15 9" />
    <path d="M11 6.5 13 4.5a4 4 0 0 1 5.66 5.66L16.5 12.2" />
    <path d="M13 17.5 11 19.5a4 4 0 0 1-5.66-5.66L7.5 11.8" />
  </svg>
)

const IconUsers = () => (
  <svg {...iconProps}>
    <path d="M17 21v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1" />
    <circle cx="10" cy="7" r="3.2" />
    <path d="M22 21v-1a3.8 3.8 0 0 0-2.7-3.65" />
    <path d="M16 3.3a3.8 3.8 0 0 1 0 7.1" />
  </svg>
)

const IconLogout = () => (
  <svg {...iconProps}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
)

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => '')
  return text || fallback
}

export default function App() {
  const [user, setUser] = useState<{ username: string; isAdmin: boolean; bankConnected: boolean } | null | undefined>(undefined)

  useEffect(() => {
    fetch('/api/auth/me').then(res => (res.ok ? res.json() : null)).then(setUser)
  }, [])

  const [connecting, setConnecting] = useState(false)
  const [connectMessage, setConnectMessage] = useState<string | null>(null)

  // /api/consent-callback leitet nach erfolgreichem Bank-Login hierher zurueck
  // (siehe Program.cs) - Erfolgsmeldung zeigen, dann den Marker aus der URL
  // entfernen, damit ein Reload sie nicht erneut anzeigt.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('bankConnected') === '1') {
      setConnectMessage('Bank erfolgreich verbunden.')
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  const connectBank = async () => {
    setConnecting(true)
    setConnectMessage(null)
    const res = await fetch('/api/consent-link', { method: 'POST' })
    if (res.ok) {
      const { url } = await res.json()
      window.location.href = url
    } else {
      setConnectMessage(await errorMessage(res, 'Bank-Verbindung fehlgeschlagen.'))
      setConnecting(false)
    }
  }

  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)
  const [ruleManagerOpen, setRuleManagerOpen] = useState(false)
  const [adminPanelOpen, setAdminPanelOpen] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importLoading, setImportLoading] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  type SkippedEntry = {
    bookingDate: string
    amount: number
    purpose: string
    matchedBy: 'externalId' | 'content'
    existingId: number
    sharedExternalId?: string
    existingBookingDate?: string
    existingAmount?: number
    existingPurpose?: string
    existingExternalId?: string
    newExternalId?: string
  }
  const [importSkipped, setImportSkipped] = useState<SkippedEntry[]>([])

  const importCamt053 = async (files: File[]) => {
    setImportLoading(true)
    setImportMessage(null)
    setImportSkipped([])
    const body = new FormData()
    for (const file of files) body.append('files', file)
    const res = await fetch('/api/import/camt053', { method: 'POST', body })
    if (res.ok) {
      const { imported, total, errors, skipped } = await res.json()
      const errorSuffix = errors.length > 0 ? ` (${errors.length} Datei(en) fehlgeschlagen: ${errors.map((e: { file: string }) => e.file).join(', ')})` : ''
      setImportMessage(`${imported} von ${total} Buchungen importiert.${errorSuffix}`)
      setImportSkipped(skipped ?? [])
      setRefreshToken(t => t + 1)
    } else {
      setImportMessage(await errorMessage(res, 'Fehler beim Import.'))
    }
    setImportLoading(false)
  }

  const resetToken = new URLSearchParams(window.location.search).get('resetToken')
  if (resetToken) {
    return (
      <ResetPassword
        token={resetToken}
        onDone={() => {
          window.history.replaceState(null, '', window.location.pathname)
          window.location.reload()
        }}
      />
    )
  }

  if (user === undefined) return null
  if (user === null) return <AuthGate onAuthenticated={setUser} />

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-brand">
            <img className="app-logo-badge" src="/duck-icon.png" alt="" aria-hidden="true" />
            <div>
              <div className="app-name">FinanceDuck</div>
              <div className="app-tagline">Finanzen mit Quak-Faktor</div>
            </div>
          </div>

          <div className="app-nav-groups">
            <nav className="app-nav" aria-label="Arbeitsbereich">
              <button type="button" className="app-nav-action" onClick={() => setCategoryManagerOpen(true)}>
                <IconTag />
                <span>Kategorien verwalten</span>
              </button>

              <button type="button" className="app-nav-action" onClick={() => setRuleManagerOpen(true)}>
                <IconListChecks />
                <span>Regeln verwalten</span>
              </button>

              <button type="button" className="app-nav-action" onClick={() => fileInputRef.current?.click()} disabled={importLoading}>
                <IconUpload />
                <span>{importLoading ? 'Importiere...' : 'CAMT.053 importieren'}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xml"
                multiple
                hidden
                onChange={e => {
                  // Array.from() vor dem Zuruecksetzen: e.target.files ist eine live FileList,
                  // die beim Leeren von e.target.value mitgeleert wird - danach waere sie leer.
                  const files = Array.from(e.target.files ?? [])
                  e.target.value = ''
                  if (files.length > 0) importCamt053(files)
                }}
              />
            </nav>

            <nav className="app-nav app-nav-group-account" aria-label="Konto">
              {user.isAdmin && (
                <button type="button" className="app-nav-action" onClick={() => setAdminPanelOpen(true)}>
                  <IconUsers />
                  <span>Nutzer verwalten</span>
                </button>
              )}

              {!user.bankConnected && (
                <button type="button" className="app-nav-action" onClick={connectBank} disabled={connecting}>
                  <IconLink />
                  <span>{connecting ? 'Verbinde...' : 'Bank verbinden'}</span>
                </button>
              )}

              <button type="button" className="app-nav-action" onClick={() => fetch('/api/auth/logout', { method: 'POST' }).then(() => setUser(null))}>
                <IconLogout />
                <span>{user.username} · Abmelden</span>
              </button>
            </nav>
          </div>
        </div>
        {connectMessage && <p className="status-text">{connectMessage}</p>}
        {importMessage && <p className="status-text">{importMessage}</p>}
        {importSkipped.length > 0 && (
          <ul className="status-text" style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
            {importSkipped.map((s, i) => (
              <li key={i}>
                {s.matchedBy === 'externalId' ? (
                  <>
                    {s.bookingDate} · {s.amount.toFixed(2)} € · {s.purpose} — gleiche Referenz "{s.sharedExternalId}" wie Buchung #{s.existingId}
                    {' '}({s.existingBookingDate} · {s.existingAmount?.toFixed(2)} € · {s.existingPurpose})
                  </>
                ) : (
                  <>
                    {s.bookingDate} · {s.amount.toFixed(2)} € · {s.purpose} — gleiches Datum/Betrag/Zweck wie Buchung #{s.existingId}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </header>

      <main className="app-main">
        <MonthlyDashboard refreshToken={refreshToken} />
      </main>

      <CategoryManager
        open={categoryManagerOpen}
        onClose={() => {
          setCategoryManagerOpen(false)
          setRefreshToken(t => t + 1)
        }}
      />

      <RuleManager open={ruleManagerOpen} onClose={() => setRuleManagerOpen(false)} />

      <AdminPanel open={adminPanelOpen} onClose={() => setAdminPanelOpen(false)} currentUsername={user.username} />
    </div>
  )
}
