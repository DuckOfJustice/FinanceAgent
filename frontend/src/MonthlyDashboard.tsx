import { useEffect, useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, Legend } from 'recharts'

type CategorySummary = { category: string; totalAmount: number }

const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff8042', '#a4de6c', '#d0ed57', '#8dd1e1', '#83a6ed', '#d885a3']

export default function MonthlyDashboard() {
  const [data, setData] = useState<CategorySummary[]>([])
  const [loading, setLoading] = useState(false)
  const month = new Date().toISOString().slice(0, 7)

  const loadSummary = () => {
    fetch(`/api/summary?month=${month}`)
      .then(r => r.json())
      .then(setData)
  }

  useEffect(loadSummary, [month])

  const refresh = async () => {
    setLoading(true)
    await fetch('/api/refresh', { method: 'POST' })
    loadSummary()
    setLoading(false)
  }

  return (
    <div>
      <button onClick={refresh} disabled={loading}>
        {loading ? 'Laedt...' : 'Umsaetze abrufen & kategorisieren'}
      </button>

      {data.length === 0 ? (
        <p>Keine Daten fuer {month}. Erst "Umsaetze abrufen" klicken.</p>
      ) : (
        <PieChart width={400} height={400}>
          <Pie data={data} dataKey="totalAmount" nameKey="category" label cx="50%" cy="50%" outerRadius={150}>
            {data.map((entry, i) => (
              <Cell key={entry.category} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(v: number) => `${v.toFixed(2)} €`} />
          <Legend />
        </PieChart>
      )}
    </div>
  )
}
