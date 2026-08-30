import MonthlyDashboard from './MonthlyDashboard'

export default function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <span className="app-logo" aria-hidden="true">💶</span>
          <div>
            <div className="app-name">FinanceAgent</div>
            <div className="app-tagline">Persönliches Finanz-Dashboard</div>
          </div>
        </div>
      </header>

      <main className="app-main">
        <MonthlyDashboard />
      </main>
    </div>
  )
}
