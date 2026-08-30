import { useEffect, useMemo, useRef, useState } from 'react'
import { categoryColor } from './categoryColor'

type CategorySummary = { category: string; totalAmount: number }
type Transaction = { bookingDate: string; amount: number; counterpartyName: string | null; purpose: string }

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

const IconCalendar = () => (
  <svg {...iconProps} width={14} height={14}><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
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

export default function MonthlyDashboard({ refreshToken = 0 }: { refreshToken?: number }) {
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

  // Von/Bis auf einen Button minimiert, der bei Klick das Popover mit den beiden
  // Datumsfeldern zeigt - schliesst sich per Klick ausserhalb wieder.
  const [rangeOpen, setRangeOpen] = useState(false)
  const rangeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!rangeOpen) return
    const onClick = (e: MouseEvent) => {
      if (rangeRef.current && !rangeRef.current.contains(e.target as Node)) {
        setRangeOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [rangeOpen])

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

  // Kategorien/Regeln werden jetzt oben in der Navbar verwaltet (App.tsx) - nach dem
  // Schliessen von "Kategorien verwalten" hier neu laden, falls sich Namen geaendert haben.
  const isFirstRefreshToken = useRef(true)
  useEffect(() => {
    if (isFirstRefreshToken.current) {
      isFirstRefreshToken.current = false
      return
    }
    loadSummary()
  }, [refreshToken])

  // Ohne ausgewaehlte Kategorie: juengste Buchungen im Zeitraum, damit die Liste beim
  // initialen Laden nicht leer ist. Mit Kategorie: wie bisher der volle Drilldown.
  useEffect(() => {
    setTransactionsLoading(true)
    const url = selectedCategory
      ? `/api/transactions?from=${from}&to=${to}&category=${encodeURIComponent(selectedCategory)}`
      : `/api/transactions?from=${from}&to=${to}`
    fetch(url)
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
  const incomeRows = chartData.filter(d => d.totalAmount >= 0)
  const expenseRows = chartData.filter(d => d.totalAmount < 0)
  const totalIncomeAbs = incomeRows.reduce((sum, d) => sum + d.absAmount, 0)
  const totalExpenseAbs = expenseRows.reduce((sum, d) => sum + d.absAmount, 0)

  const kpis = useMemo(() => {
    const income = data.filter(d => d.totalAmount > 0).reduce((sum, d) => sum + d.totalAmount, 0)
    const expenses = data.filter(d => d.totalAmount < 0).reduce((sum, d) => sum + d.totalAmount, 0)
    const balance = income + expenses
    const savingsRate = income > 0 ? (balance / income) * 100 : null
    return { income, expenses, balance, savingsRate }
  }, [data])

  const renderCatRow = (d: typeof chartData[number], groupTotal: number) => {
    const pct = groupTotal > 0 ? (d.absAmount / groupTotal) * 100 : 0
    const barPct = groupTotal > 0 ? Math.max(pct, 2) : 0
    const color = categoryColor(d.category)
    const isSelected = selectedCategory === d.category
    const dimmed = selectedCategory !== null && !isSelected
    return (
      <button
        key={d.category}
        type="button"
        className={`cat-row${isSelected ? ' is-selected' : ''}`}
        style={{
          opacity: dimmed ? 0.45 : 1,
          background: isSelected ? `color-mix(in srgb, ${color} 14%, transparent)` : undefined,
          boxShadow: isSelected ? `inset 3px 0 0 ${color}` : undefined,
        }}
        onClick={() => setSelectedCategory(prev => (prev === d.category ? null : d.category))}
      >
        <div className="cat-row-head">
          <span className="cat-name">
            <span className="cat-dot" style={{ background: color }} />
            {d.category}
          </span>
          <span className="cat-row-figures">
            <span className="cat-pct">{Math.round(pct)}%</span>
            <span className="cat-amount" style={{ color: d.totalAmount >= 0 ? 'var(--cat-gehalt)' : 'var(--ink-primary)' }}>
              {eur(d.totalAmount)}
            </span>
          </span>
        </div>
        <div className="cat-bar-track">
          <div className="cat-bar-fill" style={{ width: `${barPct}%`, background: color }} />
        </div>
      </button>
    )
  }

  return (
    <div>
      <div className="control-bar">
        <div className="control-bar-filters">
          <label className="field">
            <span className="field-label">Monat</span>
            <select value={selectedMonth} onChange={e => handleMonthSelect(e.target.value)}>
              {months.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>

          <div className="date-popover" ref={rangeRef}>
            <button type="button" className="date-popover-trigger" onClick={() => setRangeOpen(o => !o)}>
              <IconCalendar />
              {formatDe(from)} – {formatDe(to)}
            </button>

            {rangeOpen && (
              <div className="date-popover-panel">
                <label className="field field-compact">
                  <span className="field-label">Von</span>
                  <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
                </label>
                <label className="field field-compact">
                  <span className="field-label">Bis</span>
                  <input type="date" value={to} onChange={e => setTo(e.target.value)} />
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="control-bar-actions">
          <button onClick={refresh} disabled={refreshLoading}>
            <IconRefresh />
            {refreshLoading ? 'Lädt...' : 'Umsätze abrufen'}
          </button>

          <button onClick={recategorize} disabled={recategorizeLoading} title="Ordnet bereits gespeicherte Buchungen anhand der aktuellen Regeln neu zu">
            <IconSparkles />
            {recategorizeLoading ? 'Ordne neu zu...' : 'Neu kategorisieren'}
          </button>
        </div>
      </div>

      {refreshError && <p className="status-text status-critical-text">{refreshError}</p>}
      {recategorizeMsg && <p className="status-text">{recategorizeMsg}</p>}

      {data.length === 0 && !summaryLoading ? (
        <p className="muted-text">Keine Daten für diesen Zeitraum.</p>
      ) : (
        <>
          <div className="kpi-grid" style={{ opacity: summaryLoading ? 0.5 : 1, transition: 'opacity 0.15s ease-out' }}>
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

            <div className="kpi-card">
              <div className="kpi-label">
                <span className={`kpi-icon ${kpis.savingsRate === null || kpis.savingsRate >= 0 ? 'kpi-icon-up' : 'kpi-icon-down'}`}>
                  {kpis.savingsRate === null || kpis.savingsRate >= 0 ? <IconTrendUp /> : <IconTrendDown />}
                </span>
                Sparquote
              </div>
              <div
                className="kpi-value"
                style={{ color: kpis.savingsRate === null ? 'var(--ink-secondary)' : kpis.savingsRate >= 0 ? 'var(--cat-gehalt)' : 'var(--status-critical)' }}
              >
                {kpis.savingsRate === null ? '–' : `${kpis.savingsRate >= 0 ? '+' : ''}${kpis.savingsRate.toFixed(0)}%`}
              </div>
            </div>
          </div>

          <div className="panel categories-panel" style={{ opacity: summaryLoading ? 0.5 : 1, transition: 'opacity 0.15s ease-out' }}>
            <h2 className="panel-title">Kategorien</h2>

            {incomeRows.length > 0 && (
              <div className="cat-group">
                <div className="cat-group-label">
                  <span>Einnahmen</span>
                  <span>{eur(totalIncomeAbs)}</span>
                </div>
                <div className="cat-list">{incomeRows.map(d => renderCatRow(d, totalIncomeAbs))}</div>
              </div>
            )}

            {expenseRows.length > 0 && (
              <div className="cat-group">
                <div className="cat-group-label">
                  <span>Ausgaben</span>
                  <span>{eur(-totalExpenseAbs)}</span>
                </div>
                <div className="cat-list">{expenseRows.map(d => renderCatRow(d, totalExpenseAbs))}</div>
              </div>
            )}
          </div>

          <div className="panel buchungen-panel">
            <div className="buchungen-header">
              <h2 className="panel-title" style={{ margin: 0 }}>Buchungen</h2>
              {selectedCategory ? (
                <button type="button" className="filter-chip" onClick={() => setSelectedCategory(null)}>
                  <span className="cat-dot" style={{ background: categoryColor(selectedCategory) }} />
                  {selectedCategory}
                  <IconClose />
                </button>
              ) : (
                <span className="panel-subtitle">Letzte Buchungen im Zeitraum</span>
              )}
            </div>

            {transactionsLoading ? (
              <p className="muted-text">Lädt...</p>
            ) : transactions.length === 0 ? (
              <p className="muted-text">Keine Buchungen.</p>
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
          </div>
        </>
      )}
    </div>
  )
}
