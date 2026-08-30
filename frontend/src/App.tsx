import MonthlyDashboard from './MonthlyDashboard'

export default function App() {
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
            <span className="app-nav-item is-active">Übersicht</span>
          </nav>
        </div>
      </header>

      <main className="app-main">
        <MonthlyDashboard />
      </main>
    </div>
  )
}
