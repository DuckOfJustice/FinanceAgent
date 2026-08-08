import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

type CategorySummary = { category: string; totalAmount: number }
type Transaction = { bookingDate: string; amount: number; counterpartyName: string | null; purpose: string }

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
const pad2 = (n: number) => String(n).padStart(2, '0')
const toIso = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const formatDe = (iso: string) => new Date(iso).toLocaleDateString('de-DE')

function monthRange(year: number, monthIndex0: number) {
  return {
    from: toIso(new Date(year, monthIndex0, 1)),
    to: toIso(new Date(year, monthIndex0 + 1, 0)),
  }
}

function monthOptions() {
  const now = new Date()
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const range = monthRange(d.getFullYear(), d.getMonth())
    return {
      value: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`,
      label: d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }),
      ...range,
    }
  })
}

const labelStyle = { display: 'flex', flexDirection: 'column' as const, gap: '0.25rem', fontSize: 13, color: 'var(--ink-secondary)' }
const cellPad = { padding: '0.5rem' }

export default function MonthlyDashboard() {
  const months = useMemo(monthOptions, [])
  const [selectedMonth, setSelectedMonth] = useState(months[0].value)
  const [from, setFrom] = useState(months[0].from)
  const [to, setTo] = useState(months[0].to)

  const [data, setData] = useState<CategorySummary[]>([])
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [refreshLoading, setRefreshLoading] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [transactionsLoading, setTransactionsLoading] = useState(false)

  const loadSummary = () => {
    setSummaryLoading(true)
    fetch(`/api/summary?from=${from}&to=${to}`)
      .then(r => r.json())
      .then((rows: CategorySummary[]) =>
        setData([...rows].sort((a, b) => Math.abs(b.totalAmount) - Math.abs(a.totalAmount)))
      )
      .finally(() => setSummaryLoading(false))
  }

  useEffect(() => {
    setSelectedCategory(null)
    loadSummary()
  }, [from, to])

  useEffect(() => {
    if (!selectedCategory) {
      setTransactions([])
      return
    }
    setTransactionsLoading(true)
    fetch(`/api/transactions?from=${from}&to=${to}&category=${encodeURIComponent(selectedCategory)}`)
      .then(r => r.json())
      .then(setTransactions)
      .finally(() => setTransactionsLoading(false))
  }, [selectedCategory, from, to])

  const refresh = async () => {
    setRefreshLoading(true)
    setRefreshError(null)
    const res = await fetch(`/api/refresh?from=${from}&to=${to}`, { method: 'POST' })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setRefreshError(body?.error ?? `Fehler beim Abrufen (${res.status}).`)
    } else {
      loadSummary()
    }
    setRefreshLoading(false)
  }

  const handleMonthSelect = (value: string) => {
    setSelectedMonth(value)
    const option = months.find(m => m.value === value)
    if (option) {
      setFrom(option.from)
      setTo(option.to)
    }
  }

  const chartData = data.map(d => ({ ...d, absAmount: Math.abs(d.totalAmount) }))
  const chartHeight = Math.max(chartData.length * 44, 120)

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end', marginBottom: '1rem' }}>
        <label style={labelStyle}>
          Monat
          <select value={selectedMonth} onChange={e => handleMonthSelect(e.target.value)}>
            {months.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </label>

        <label style={labelStyle}>
          Von
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </label>

        <label style={labelStyle}>
          Bis
          <input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </label>

        <button onClick={refresh} disabled={refreshLoading}>
          {refreshLoading ? 'Lädt...' : 'Umsätze abrufen & kategorisieren'}
        </button>
      </div>

      <p style={{ color: 'var(--ink-secondary)', fontSize: 14, marginTop: 0 }}>
        Zeitraum: {formatDe(from)} – {formatDe(to)}
      </p>

      {refreshError && (
        <p style={{ color: 'var(--status-critical)', fontSize: 14 }}>{refreshError}</p>
      )}

      {data.length === 0 && !summaryLoading ? (
        <p style={{ color: 'var(--ink-secondary)' }}>Keine Daten für diesen Zeitraum.</p>
      ) : (
        <div style={{ opacity: summaryLoading ? 0.5 : 1, transition: 'opacity 0.15s ease-out' }}>
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
              <Bar
                dataKey="absAmount"
                radius={[0, 4, 4, 0]}
                cursor="pointer"
                onClick={(entry: CategorySummary) =>
                  setSelectedCategory(prev => (prev === entry.category ? null : entry.category))
                }
              >
                {chartData.map(d => (
                  <Cell
                    key={d.category}
                    fill={CATEGORY_COLORS[d.category] ?? FALLBACK_COLOR}
                    opacity={selectedCategory && selectedCategory !== d.category ? 0.35 : 1}
                  />
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
        </div>
      )}

      {selectedCategory && (
        <div style={{ marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>{selectedCategory}</h2>
            <button onClick={() => setSelectedCategory(null)}>Schließen</button>
          </div>

          {transactionsLoading ? (
            <p style={{ color: 'var(--ink-secondary)' }}>Lädt...</p>
          ) : transactions.length === 0 ? (
            <p style={{ color: 'var(--ink-secondary)' }}>Keine Buchungen.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ ...cellPad, textAlign: 'left', paddingLeft: 0, color: 'var(--ink-muted)', fontWeight: 500 }}>Datum</th>
                  <th style={{ ...cellPad, textAlign: 'left', color: 'var(--ink-muted)', fontWeight: 500 }}>Gegenpartei</th>
                  <th style={{ ...cellPad, textAlign: 'left', color: 'var(--ink-muted)', fontWeight: 500 }}>Verwendungszweck</th>
                  <th style={{ ...cellPad, textAlign: 'right', paddingRight: 0, color: 'var(--ink-muted)', fontWeight: 500 }}>Betrag</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ ...cellPad, paddingLeft: 0, color: 'var(--ink-secondary)', whiteSpace: 'nowrap' }}>
                      {formatDe(t.bookingDate)}
                    </td>
                    <td style={{ ...cellPad, color: 'var(--ink-primary)' }}>{t.counterpartyName ?? '–'}</td>
                    <td style={{ ...cellPad, color: 'var(--ink-secondary)' }}>{t.purpose}</td>
                    <td style={{ ...cellPad, paddingRight: 0, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--ink-primary)' }}>
                      {eur(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
