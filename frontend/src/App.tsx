import MonthlyDashboard from './MonthlyDashboard'

export default function App() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '2.5rem 1.5rem' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>FinanceAgent</h1>
      <MonthlyDashboard />
    </div>
  )
}
