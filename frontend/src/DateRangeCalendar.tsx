import { useState } from 'react'
import { DayPicker, type DateRange } from 'react-day-picker'
import { de } from 'date-fns/locale'
import 'react-day-picker/dist/style.css'

// Ersetzt zwei native <input type="date"> im "Von/Bis"-Popover - der native Kalender dazu ist
// ein unstylbares Browser-Overlay im hellen System-Design, das mit dem Rest der dunklen App
// bricht. react-day-picker statt eigenem Grid, damit Tastatur-Navigation/A11y nicht selbst
// nachgebaut werden muss - Optik per CSS-Overrides (siehe .rdp-* Regeln in index.css) ans
// dunkle Theme angepasst.

const pad2 = (n: number) => String(n).padStart(2, '0')
const toIso = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const fromIso = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)

type Props = {
  from: string
  to: string
  onChange: (from: string, to: string) => void
  onDone: () => void
}

export default function DateRangeCalendar({ from, to, onChange, onDone }: Props) {
  const fromDate = fromIso(from)
  const toDate = fromIso(to)

  // Startmonat der zweimonatigen Ansicht - fest an "Von" gekoppelt, aber per Pfeilen
  // navigierbar, ohne dass sich dabei die eigentliche Auswahl (from/to) veraendert.
  const [month, setMonth] = useState(() => startOfMonth(fromDate))

  const selected: DateRange = { from: fromDate, to: toDate }

  const handleSelect = (range: DateRange | undefined) => {
    if (!range || !range.from) return
    const nextFrom = toIso(range.from)
    const nextTo = toIso(range.to ?? range.from)
    onChange(nextFrom, nextTo)
  }

  return (
    <div className="range-calendar">
      <DayPicker
        mode="range"
        locale={de}
        weekStartsOn={1}
        numberOfMonths={2}
        month={month}
        onMonthChange={setMonth}
        selected={selected}
        onSelect={handleSelect}
        showOutsideDays
      />
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
