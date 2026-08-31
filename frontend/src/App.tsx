import { useRef, useState } from 'react'
import MonthlyDashboard from './MonthlyDashboard'
import CategoryManager from './CategoryManager'
import RuleManager from './RuleManager'

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

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => '')
  return text || fallback
}

export default function App() {
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)
  const [ruleManagerOpen, setRuleManagerOpen] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importLoading, setImportLoading] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)

  const importCamt053 = async (file: File) => {
    setImportLoading(true)
    setImportMessage(null)
    const body = new FormData()
    body.append('file', file)
    const res = await fetch('/api/import/camt053', { method: 'POST', body })
    if (res.ok) {
      const { imported, total } = await res.json()
      setImportMessage(`${imported} von ${total} Buchungen importiert.`)
      setRefreshToken(t => t + 1)
    } else {
      setImportMessage(await errorMessage(res, 'Fehler beim Import.'))
    }
    setImportLoading(false)
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-brand">
            <span className="app-logo-badge" aria-hidden="true">💶🦆</span>
            <div>
              <div className="app-name">FinanceDuck</div>
              <div className="app-tagline">Finanzen mit Quak-Faktor</div>
            </div>
          </div>

          <nav className="app-nav" aria-label="Bereich">
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
              hidden
              onChange={e => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) importCamt053(file)
              }}
            />
          </nav>
        </div>
        {importMessage && <p className="status-text">{importMessage}</p>}
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
    </div>
  )
}
