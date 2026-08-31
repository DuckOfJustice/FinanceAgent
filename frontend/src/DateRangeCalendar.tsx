import { useState } from 'react'
import { DayPicker, type DateRange } from 'react-day-picker'
import { de } from 'date-fns/locale'
import 'react-day-picker/dist/style.css'

// Ersetzt zwei native <input type="date"> im "Von/Bis"-Popover - der native Kalender dazu ist
// ein unstylbares Browser-Overlay im hellen System-Design, das mit dem Rest der dunklen App
// bricht. react-day-picker statt eigenem Grid, damit Tastatur-Navigation/A11y nicht selbst
// nachgebaut werden muss - Optik per CSS-Overrides (siehe .rdp-* Regeln in index.css) ans
// dunkle Theme angepasst.
//
// Eigene Klick-Logik statt react-day-pickers eingebautem "range"-Algorithmus (onSelect): der
// baut nach einem vollstaendigen Von/Bis standardmaessig bei jedem weiteren Klick einen
// komplett neuen Bereich auf (erster Klick = neuer Start), man kann also nicht einfach nur das
// "hintere" Datum verschieben. Hier wird stattdessen immer der naeher liegende Rand (Start oder
// Ende) auf das geklickte Datum gesetzt bzw. der Bereich erweitert, wenn ausserhalb geklickt wird.

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

  const handleDayClick = (day: Date) => {
    const clickedIso = toIso(day)

    // Ausserhalb des aktuellen Bereichs geklickt: einfach den jeweiligen Rand erweitern.
    if (day < fromDate) {
      onChange(clickedIso, to)
      return
    }
    if (day > toDate) {
      onChange(from, clickedIso)
      return
    }

    // Klick liegt innerhalb (oder genau auf einem Rand) des aktuellen Bereichs: den naeher
    // liegenden Rand auf das geklickte Datum ziehen, statt einen neuen Bereich zu starten.
    const distToStart = day.getTime() - fromDate.getTime()
    const distToEnd = toDate.getTime() - day.getTime()
    if (distToEnd <= distToStart) {
      onChange(from, clickedIso)
    } else {
      onChange(clickedIso, to)
    }
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
        onDayClick={handleDayClick}
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
