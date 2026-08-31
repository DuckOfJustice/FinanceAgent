import { useState } from 'react'

// Ersetzt zwei native <input type="date"> im "Von/Bis"-Popover - der native Kalender dazu ist
// ein unstylbares Browser-Overlay im hellen System-Design (siehe Screenshot), das mit dem Rest
// der dunklen App bricht. Eigenes Zwei-Monats-Grid statt dessen, gleiche Optik wie die uebrigen Panels.
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

const pad2 = (n: number) => String(n).padStart(2, '0')
const toIso = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const fromIso = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1)
const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

// Montag=0..Sonntag=6 statt JS-Standard (Sonntag=0) - deutsche Kalenderwoche beginnt am Montag.
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7
}

function buildMonthDays(month: Date): (Date | null)[] {
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const leading = mondayIndex(startOfMonth(month))
  const cells: (Date | null)[] = Array.from({ length: leading }, () => null)
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(new Date(month.getFullYear(), month.getMonth(), day))
  }
  return cells
}

type Props = {
  from: string
  to: string
  onChange: (from: string, to: string) => void
  onDone: () => void
}

export default function DateRangeCalendar({ from, to, onChange, onDone }: Props) {
  const fromDate = fromIso(from)
  const toDate = fromIso(to)

  const [baseMonth, setBaseMonth] = useState(() => startOfMonth(fromDate))
  // 'start': naechster Klick beginnt einen neuen Bereich. 'end': ein Startdatum wurde eben
  // gesetzt, naechster Klick legt das Enddatum fest (oder verschiebt den Start, falls davor).
  const [rangeStep, setRangeStep] = useState<'start' | 'end'>('start')
  const [hoverIso, setHoverIso] = useState<string | null>(null)

  const previewTo = rangeStep === 'end' && hoverIso ? fromIso(hoverIso) : toDate

  const handleDayClick = (day: Date) => {
    const iso = toIso(day)
    if (rangeStep === 'start') {
      onChange(iso, iso)
      setRangeStep('end')
      return
    }
    if (day < fromDate) {
      onChange(iso, iso)
      return
    }
    onChange(from, iso)
    setRangeStep('start')
  }

  const renderMonth = (month: Date, isFirst: boolean) => (
    <div className="range-calendar-month" key={`${month.getFullYear()}-${month.getMonth()}`}>
      <div className="range-calendar-month-header">
        {isFirst ? (
          <button type="button" className="range-calendar-nav" onClick={() => setBaseMonth(m => addMonths(m, -1))} aria-label="Vorheriger Monat">
            ‹
          </button>
        ) : <span className="range-calendar-nav-spacer" />}
        <span>{MONTH_NAMES[month.getMonth()]} {month.getFullYear()}</span>
        {!isFirst ? (
          <button type="button" className="range-calendar-nav" onClick={() => setBaseMonth(m => addMonths(m, 1))} aria-label="Nächster Monat">
            ›
          </button>
        ) : <span className="range-calendar-nav-spacer" />}
      </div>
      <div className="range-calendar-weekdays">
        {WEEKDAYS.map(w => <span key={w}>{w}</span>)}
      </div>
      <div className="range-calendar-grid">
        {buildMonthDays(month).map((day, i) => {
          if (!day) return <span key={i} className="range-calendar-cell is-empty" />
          const isStart = isSameDay(day, fromDate)
          const isEnd = isSameDay(day, previewTo)
          const inRange = day > fromDate && day < previewTo
          const isToday = isSameDay(day, new Date())
          return (
            <button
              type="button"
              key={i}
              className={[
                'range-calendar-cell',
                (isStart || isEnd) ? 'is-selected' : '',
                inRange ? 'is-in-range' : '',
                isToday ? 'is-today' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => handleDayClick(day)}
              onMouseEnter={() => setHoverIso(toIso(day))}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="range-calendar" onMouseLeave={() => setHoverIso(null)}>
      <div className="range-calendar-months">
        {renderMonth(baseMonth, true)}
        {renderMonth(addMonths(baseMonth, 1), false)}
      </div>
      <div className="range-calendar-footer">
        <span className="range-calendar-summary">
          {from === to
            ? fromDate.toLocaleDateString('de-DE')
            : `${fromDate.toLocaleDateString('de-DE')} – ${toDate.toLocaleDateString('de-DE')}`}
        </span>
        <button type="button" className="range-calendar-done" onClick={onDone}>
          Fertig
        </button>
      </div>
    </div>
  )
}
