// Kategorien sind jetzt nutzerverwaltet statt einer festen Liste - eine feste Name->Farbe-Map
// waere staendig veraltet. Stattdessen deterministisch in eines der 8 --cat-*-Palette-Slots hashen,
// damit jede Kategorie (alt oder neu) eine stabile Farbe bekommt, ohne Map-Pflege.
const CATEGORY_PALETTE = [
  'var(--cat-lebensmittel)',
  'var(--cat-miete)',
  'var(--cat-freizeit)',
  'var(--cat-transport)',
  'var(--cat-versicherung)',
  'var(--cat-gehalt)',
  'var(--cat-abo)',
  'var(--cat-gesundheit)',
]

const FALLBACK_COLOR = 'var(--cat-sonstiges)'

export function categoryColor(name: string): string {
  if (name === 'Sonstiges') return FALLBACK_COLOR

  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return CATEGORY_PALETTE[Math.abs(hash) % CATEGORY_PALETTE.length]
}
