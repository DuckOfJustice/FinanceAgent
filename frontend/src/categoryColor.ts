// Kategorien sind nutzerverwaltet statt einer festen Liste. Server speichert optional einen
// Farb-Slot (z.B. "miete") pro Kategorie - wenn vorhanden, hat der Vorrang. Ohne gespeicherte
// Farbe (aeltere Kategorie, nie umgefaerbt) wird deterministisch in einen der Palette-Slots
// gehasht, damit trotzdem jede Kategorie eine stabile Farbe hat.
export const CATEGORY_COLOR_SLOTS = [
  'lebensmittel', 'miete', 'freizeit', 'transport', 'versicherung', 'gehalt', 'abo', 'gesundheit',
  'diva', 'partnerkarten', 'stromgas', 'vertraege',
] as const

export type CategoryColorSlot = typeof CATEGORY_COLOR_SLOTS[number]

const FALLBACK_COLOR_VAR = 'var(--cat-sonstiges)'

function slotToVar(slot: string): string {
  return `var(--cat-${slot})`
}

function hashSlot(name: string): CategoryColorSlot {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return CATEGORY_COLOR_SLOTS[Math.abs(hash) % CATEGORY_COLOR_SLOTS.length]
}

// color: der vom Server gespeicherte Slot-Key der Kategorie (falls vorhanden/bekannt).
export function categoryColor(name: string, color?: string | null): string {
  if (name === 'Sonstiges') return FALLBACK_COLOR_VAR
  if (color) return slotToVar(color)
  return slotToVar(hashSlot(name))
}

// Fuer den Farb-Picker im Bearbeiten-Dialog: liefert einen Slot, den noch keine andere
// Kategorie nutzt (Backend macht beim Anlegen ohne Farbwahl dasselbe) - Duplikate werden erst
// vermieden, wenn wirklich alle Slots vergeben sind, dann die am seltensten genutzte.
export function pickUnusedColorSlot(usedColors: Array<string | null | undefined>): CategoryColorSlot {
  const used = new Set(usedColors.filter((c): c is string => !!c))
  const free = CATEGORY_COLOR_SLOTS.find(slot => !used.has(slot))
  if (free) return free

  const counts = new Map<string, number>()
  for (const c of usedColors) {
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  let least: CategoryColorSlot = CATEGORY_COLOR_SLOTS[0]
  let leastCount = Infinity
  for (const slot of CATEGORY_COLOR_SLOTS) {
    const n = counts.get(slot) ?? 0
    if (n < leastCount) {
      leastCount = n
      least = slot
    }
  }
  return least
}
