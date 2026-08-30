import { useEffect, useMemo, useState } from 'react'

type CategorySummary = { category: string; totalAmount: number }
type Transaction = { bookingDate: string; amount: number; counterpartyName: string | null; purpose: string }

// Feste Zuordnung statt zyklischer Farben - bleibt ueber Monate stabil erkennbar.
// "Sonstiges" bekommt bewusst Grau statt einer 9. generierten Farbe (Palette hat nur 8 Slots).
const CATEGORY_COLORS: Record<string, string> = {
  Lebensmittel: 'var(--cat-lebensmittel)',
  Miete: 'var(--cat-miete)',
  Transport: 'var(--cat-transport)',
  Gehalt: 'var(--cat-gehalt)',
  Abo: 'var(--cat-abo)',
  Sonstiges: 'var(--cat-sonstiges)',
  Diva: 'var(--cat-diva)',
  Partnerkarten: 'var(--cat-partnerkarten)',
  'Strom und Gas': 'var(--cat-stromgas)',
  'Verträge': 'var(--cat-vertraege)',
}
const FALLBACK_COLOR = 'var(--cat-sonstiges)'

const iconProps = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const IconRefresh = () => (
  <svg {...iconProps}><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
)

const IconSparkles = () => (
  <svg {...iconProps}><path d="M12 3v4M12 17v4M5 12H1M23 12h-4M7.05 7.05 4.22 4.22M19.78 19.78l-2.83-2.83M16.95 7.05l2.83-2.83M4.22 19.78l2.83-2.83" /></svg>
)

const IconTrendUp = () => (
  <svg {...iconProps} width={13} height={13} strokeWidth={2.5}><path d="M12 19V5M5 12l7-7 7 7" /></svg>
)

const IconTrendDown = () => (
  <svg {...iconProps} width={13} height={13} strokeWidth={2.5}><path d="M12 5v14M19 12l-7 7-7-7" /></svg>
)

const IconClose = () => (
  <svg {...iconProps} width={14} height={14}><path d="M18 6 6 18M6 6l12 12" /></svg>
)

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

  const [recategorizeLoading, setRecategorizeLoading] = useState(false)
  const [recategorizeMsg, setRecategorizeMsg] = useState<string | null>(null)

  const loadSummary = () => {
    setSummaryLoading(true)
    fetch(`/api/summary?from=${from}&to=${to}`)
      .then(r => r.json())
      .then((rows: CategorySummary[]) =>
        setData([...rows].sort((a, b) => {
          if (a.category === 'Sonstiges') return 1
          if (b.category === 'Sonstiges') return -1
          const aPositive = a.totalAmount >= 0
          const bPositive = b.totalAmount >= 0
          if (aPositive !== bPositive) return aPositive ? -1 : 1
          return Math.abs(b.totalAmount) - Math.abs(a.totalAmount)
        }))
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

  const recategorize = async () => {
    setRecategorizeLoading(true)
    setRecategorizeMsg(null)
    const res = await fetch('/api/recategorize', { method: 'POST' })
    if (res.ok) {
      const body = await res.json()
      setRecategorizeMsg(`${body.changed} von ${body.total} Buchungen neu zugeordnet.`)
      setSelectedCategory(null)
      loadSummary()
    } else {
      setRecategorizeMsg(`Fehler bei der Neukategorisierung (${res.status}).`)
    }
    setRecategorizeLoading(false)
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
  const maxAbs = chartData.reduce((m, d) => Math.max(m, d.absAmount), 0)

  const kpis = useMemo(() => {
    const income = data.filter(d => d.totalAmount > 0).reduce((sum, d) => sum + d.totalAmount, 0)
    const expenses = data.filter(d => d.totalAmount < 0).reduce((sum, d) => sum + d.totalAmount, 0)
    return { income, expenses, balance: income + expenses }
  }, [data])

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-filters">
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
        </div>

        <div className="toolbar-actions">
          <button onClick={refresh} disabled={refreshLoading}>
            <IconRefresh />
            {refreshLoading ? 'Lädt...' : 'Umsätze abrufen & kategorisieren'}
          </button>

          <button onClick={recategorize} disabled={recategorizeLoading} title="Ordnet bereits gespeicherte Buchungen anhand der aktuellen Regeln/des Modells neu zu">
            <IconSparkles />
            {recategorizeLoading ? 'Ordne neu zu...' : 'Neu kategorisieren'}
          </button>
        </div>
      </div>

      <p style={{ color: 'var(--ink-secondary)', fontSize: 14, marginTop: 0 }}>
        Zeitraum: {formatDe(from)} – {formatDe(to)}
      </p>

      {refreshError && (
        <p style={{ color: 'var(--status-critical)', fontSize: 14 }}>{refreshError}</p>
      )}

      {recategorizeMsg && (
        <p style={{ color: 'var(--ink-secondary)', fontSize: 14 }}>{recategorizeMsg}</p>
      )}

      <div className="kpi-grid" style={{ marginBottom: '1.25rem', opacity: summaryLoading ? 0.5 : 1, transition: 'opacity 0.15s ease-out' }}>
        <div className="kpi-card">
          <div className="kpi-label">
            <span className="kpi-icon kpi-icon-up"><IconTrendUp /></span>
            Einnahmen
          </div>
          <div className="kpi-value" style={{ color: 'var(--cat-gehalt)' }}>{eur(kpis.income)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">
            <span className="kpi-icon kpi-icon-down"><IconTrendDown /></span>
            Ausgaben
          </div>
          <div className="kpi-value" style={{ color: 'var(--status-critical)' }}>{eur(kpis.expenses)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">
            <span className={`kpi-icon ${kpis.balance >= 0 ? 'kpi-icon-up' : 'kpi-icon-down'}`}>
              {kpis.balance >= 0 ? <IconTrendUp /> : <IconTrendDown />}
            </span>
            Saldo
          </div>
          <div className="kpi-value" style={{ color: kpis.balance >= 0 ? 'var(--cat-gehalt)' : 'var(--status-critical)' }}>
            {eur(kpis.balance)}
          </div>
        </div>
      </div>

      {data.length === 0 && !summaryLoading ? (
        <p style={{ color: 'var(--ink-secondary)' }}>Keine Daten für diesen Zeitraum.</p>
      ) : (
        <div className="dashboard-grid">
          <div className="panel" style={{ opacity: summaryLoading ? 0.5 : 1, transition: 'opacity 0.15s ease-out' }}>
            <h2 className="panel-title">Kategorien</h2>
            <div className="cat-list">
              {chartData.map(d => {
                const pct = maxAbs > 0 ? (d.absAmount / maxAbs) * 100 : 0
                const color = CATEGORY_COLORS[d.category] ?? FALLBACK_COLOR
                const dimmed = selectedCategory !== null && selectedCategory !== d.category
                return (
                  <button
                    key={d.category}
                    type="button"
                    className="cat-row"
                    style={{ opacity: dimmed ? 0.4 : 1 }}
                    onClick={() => setSelectedCategory(prev => (prev === d.category ? null : d.category))}
                  >
                    <div className="cat-row-head">
                      <span className="cat-name">
                        <span className="cat-dot" style={{ background: color }} />
                        {d.category}
                      </span>
                      <span
                        className="cat-amount"
                        style={{ color: d.totalAmount >= 0 ? 'var(--cat-gehalt)' : 'var(--ink-primary)' }}
                      >
                        {eur(d.totalAmount)}
                      </span>
                    </div>
                    <div className="cat-bar-track">
                      <div className="cat-bar-fill" style={{ width: `${Math.max(pct, 2)}%`, background: color }} />
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="panel">
            {selectedCategory ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.75rem' }}>
                  <h2 className="panel-title" style={{ margin: 0 }}>{selectedCategory}</h2>
                  <button onClick={() => setSelectedCategory(null)}><IconClose /> Schließen</button>
                </div>

                {transactionsLoading ? (
                  <p style={{ color: 'var(--ink-secondary)' }}>Lädt...</p>
                ) : transactions.length === 0 ? (
                  <p style={{ color: 'var(--ink-secondary)' }}>Keine Buchungen.</p>
                ) : (
                  <div className="tx-table-wrap">
                    <table>
                      <colgroup>
                        <col style={{ width: '80px' }} />
                        <col style={{ width: '25%' }} />
                        <col />
                        <col style={{ width: '112px' }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Datum</th>
                          <th>Gegenpartei</th>
                          <th>Verwendungszweck</th>
                          <th style={{ textAlign: 'right' }}>Betrag</th>
                        </tr>
                      </thead>
                      <tbody>
                        {transactions.map((t, i) => (
                          <tr key={i}>
                            <td style={{ color: 'var(--ink-secondary)', whiteSpace: 'nowrap' }}>
                              {formatDe(t.bookingDate)}
                            </td>
                            <td className="tx-counterparty" style={{ color: 'var(--ink-primary)' }} title={t.counterpartyName ?? undefined}>
                              {t.counterpartyName ?? '–'}
                            </td>
                            <td className="tx-purpose" title={t.purpose}>{t.purpose}</td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--ink-primary)', whiteSpace: 'nowrap' }}>
                              {eur(t.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <>
                <h2 className="panel-title">Buchungen</h2>
                <p style={{ color: 'var(--ink-secondary)', fontSize: 14 }}>
                  Klicke links auf eine Kategorie, um die zugehörigen Buchungen zu sehen.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
