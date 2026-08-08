import { useEffect, useState } from 'react'
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

type CategorySummary = { category: string; totalAmount: number }

// Feste Zuordnung statt zyklischer Farben - bleibt ueber Monate stabil erkennbar.
// "Sonstiges" bekommt bewusst Grau statt einer 9. generierten Farbe (Palette hat nur 8 Slots).
const CATEGORY_COLORS: Record<string, string> = {
  Lebensmittel: 'var(--cat-lebensmittel)',
  Miete: 'var(--cat-miete)',
  Freizeit: 'var(--cat-freizeit)',
  Transport: 'var(--cat-transport)',
  Versicherung: 'var(--cat-versicherung)',
  Gehalt: 'var(--cat-gehalt)',
  Abo: 'var(--cat-abo)',
  Gesundheit: 'var(--cat-gesundheit)',
  Sonstiges: 'var(--cat-sonstiges)',
}
const FALLBACK_COLOR = 'var(--cat-sonstiges)'

const eur = (n: number) => `${n < 0 ? '-' : '+'}${Math.abs(n).toFixed(2)} €`

export default function MonthlyDashboard() {
  const [data, setData] = useState<CategorySummary[]>([])
  const [loading, setLoading] = useState(false)
  const month = new Date().toISOString().slice(0, 7)

  const loadSummary = () => {
    fetch(`/api/summary?month=${month}`)
      .then(r => r.json())
      .then((rows: CategorySummary[]) => {
        setData([...rows].sort((a, b) => Math.abs(b.totalAmount) - Math.abs(a.totalAmount)))
      })
  }

  useEffect(loadSummary, [month])

  const refresh = async () => {
    setLoading(true)
    await fetch('/api/refresh', { method: 'POST' })
    loadSummary()
    setLoading(false)
  }

  const chartData = data.map(d => ({ ...d, absAmount: Math.abs(d.totalAmount) }))
  const chartHeight = Math.max(chartData.length * 44, 120)

  return (
    <div>
      <button onClick={refresh} disabled={loading} style={{ marginBottom: '2rem' }}>
        {loading ? 'Lädt...' : 'Umsätze abrufen & kategorisieren'}
      </button>

      {data.length === 0 ? (
        <p style={{ color: 'var(--ink-secondary)' }}>Keine Daten für {month}. Erst "Umsätze abrufen" klicken.</p>
      ) : (
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            data={chartData}
            layout="vertical"
            barSize={20}
            margin={{ top: 4, right: 72, bottom: 4, left: 8 }}
          >
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="category"
              axisLine={false}
              tickLine={false}
              width={110}
              tick={{ fill: 'var(--ink-primary)', fontSize: 14 }}
            />
            <Tooltip
              formatter={(value: number, _name: string, item: { payload?: CategorySummary }) =>
                eur(item.payload?.totalAmount ?? value)
              }
              contentStyle={{
                background: 'var(--surface-card)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--ink-primary)',
              }}
              labelStyle={{ color: 'var(--ink-primary)' }}
            />
            <Bar dataKey="absAmount" radius={[0, 4, 4, 0]}>
              {chartData.map(d => (
                <Cell key={d.category} fill={CATEGORY_COLORS[d.category] ?? FALLBACK_COLOR} />
              ))}
              <LabelList
                dataKey="totalAmount"
                position="right"
                formatter={(v: number) => eur(v)}
                style={{ fill: 'var(--ink-secondary)', fontSize: 13 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
