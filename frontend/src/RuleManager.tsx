import { Fragment, useEffect, useRef, useState } from 'react'
import { categoryColor } from './categoryColor'
import ConfirmDialog from './ConfirmDialog'

type Category = { id: number; name: string; color: string | null }
type Rule = { id: number; pattern: string; categoryId: number; categoryName: string }

const iconProps = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const IconClose = () => (
  <svg {...iconProps} width={16} height={16}><path d="M18 6 6 18M6 6l12 12" /></svg>
)
const IconTrash = () => (
  <svg {...iconProps}><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" /></svg>
)
const IconPlus = () => (
  <svg {...iconProps}><path d="M12 5v14M5 12h14" /></svg>
)
const IconSearch = () => (
  <svg {...iconProps} width={14} height={14}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
)

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => '')
  return text || fallback
}

// Nach Kategorie gruppiert statt strikt alphabetisch nach Muster - bei vielen Regeln
// findet man "was gehoert zu X" so viel schneller als in einer flachen Musterliste.
function sortRules(rules: Rule[]): Rule[] {
  return [...rules].sort((a, b) =>
    a.categoryName.localeCompare(b.categoryName, 'de') || a.pattern.localeCompare(b.pattern, 'de')
  )
}

export default function RuleManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  const [rules, setRules] = useState<Rule[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(false)

  const [filterText, setFilterText] = useState('')

  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<{ id: number; message: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Rule | null>(null)

  const [newPattern, setNewPattern] = useState('')
  const [newCategoryId, setNewCategoryId] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [addSaving, setAddSaving] = useState(false)

  const loadData = () => {
    setLoading(true)
    Promise.all([
      fetch('/api/rules').then(r => r.json()),
      fetch('/api/categories').then(r => r.json()),
    ])
      .then(([rulesList, categoriesList]: [Rule[], Category[]]) => {
        setRules(sortRules(rulesList))
        setCategories(categoriesList)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      loadData()
      setDeleteError(null)
      setNewPattern('')
      setNewCategoryId('')
      setAddError(null)
      setFilterText('')
      setConfirmDelete(null)
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  const deleteRule = async (r: Rule) => {
    setDeletingId(r.id)
    setDeleteError(null)
    const res = await fetch(`/api/rules/${r.id}`, { method: 'DELETE' })
    if (res.ok) {
      setRules(prev => prev.filter(x => x.id !== r.id))
    } else {
      setDeleteError({ id: r.id, message: await errorMessage(res, 'Fehler beim Löschen.') })
    }
    setDeletingId(null)
  }

  const addRule = async () => {
    const pattern = newPattern.trim()
    if (!pattern) {
      setAddError('Muster darf nicht leer sein.')
      return
    }
    if (!newCategoryId) {
      setAddError('Bitte eine Kategorie wählen.')
      return
    }
    setAddSaving(true)
    setAddError(null)
    const res = await fetch('/api/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern, categoryId: Number(newCategoryId) }),
    })
    if (res.ok) {
      const created: Rule = await res.json()
      setRules(prev => sortRules([...prev.filter(r => r.id !== created.id), created]))
      setNewPattern('')
      setNewCategoryId('')
    } else {
      setAddError(await errorMessage(res, 'Fehler beim Anlegen.'))
    }
    setAddSaving(false)
  }

  const query = filterText.trim().toLowerCase()
  const filteredRules = query
    ? rules.filter(r => r.pattern.toLowerCase().includes(query) || r.categoryName.toLowerCase().includes(query))
    : rules

  // Anzahl Regeln je Kategorie fuer die Gruppenkoepfe - einmal vorab zaehlen statt
  // pro Zeile ueber die gesamte gefilterte Liste zu filtern.
  const groupCounts = new Map<string, number>()
  for (const r of filteredRules) {
    groupCounts.set(r.categoryName, (groupCounts.get(r.categoryName) ?? 0) + 1)
  }

  // Farbe kommt von der Kategorie, nicht von der Regel - ueber den Namen nachschlagen, damit
  // die Gruppenkoepfe dieselbe Farbe wie "Kategorien verwalten" zeigen.
  const colorByName = new Map(categories.map(c => [c.name, c.color]))

  return (
    <dialog
      ref={dialogRef}
      className="category-modal rule-modal"
      onClose={onClose}
      onClick={e => { if (e.target === dialogRef.current) dialogRef.current?.close() }}
    >
      <div className="category-modal-inner">
        <div className="category-modal-header">
          <h2 className="panel-title" style={{ margin: 0 }}>
            Regeln verwalten
            {rules.length > 0 && <span className="category-modal-count"> · {rules.length}</span>}
          </h2>
          <button type="button" className="icon-button" onClick={() => dialogRef.current?.close()} aria-label="Schließen">
            <IconClose />
          </button>
        </div>

        {rules.length > 0 && (
          <div className="category-search-wrap">
            <IconSearch />
            <input
              type="text"
              className="category-search"
              placeholder="Regeln durchsuchen…"
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
            />
          </div>
        )}

        {loading ? (
          <ul className="category-list">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="category-row">
                <div className="category-row-main category-row-skeleton">
                  <span className="skeleton-dot" />
                  <span className="skeleton-text" />
                </div>
              </li>
            ))}
          </ul>
        ) : rules.length === 0 ? (
          <p className="muted-text">Noch keine Regeln.</p>
        ) : filteredRules.length === 0 ? (
          <p className="muted-text">Keine Regeln gefunden.</p>
        ) : (
          <ul className="category-list">
            {filteredRules.map((r, i) => {
              const isNewGroup = i === 0 || filteredRules[i - 1].categoryName !== r.categoryName
              return (
                <Fragment key={r.id}>
                  {isNewGroup && (
                    <li className="rule-group-header">
                      <span className="cat-dot" style={{ background: categoryColor(r.categoryName, colorByName.get(r.categoryName)) }} />
                      <span>{r.categoryName}</span>
                      <span className="rule-group-count">{groupCounts.get(r.categoryName)}</span>
                    </li>
                  )}
                  <li className="category-row">
                    <div className="category-row-main">
                      <span className="category-name">{r.pattern}</span>
                      <div className="category-row-actions">
                        <button
                          type="button"
                          className="icon-button icon-button-danger"
                          onClick={() => setConfirmDelete(r)}
                          disabled={deletingId === r.id}
                          aria-label={`Regel "${r.pattern}" löschen`}
                        >
                          <IconTrash />
                        </button>
                      </div>
                    </div>
                    {deleteError?.id === r.id && <p className="category-row-error">{deleteError.message}</p>}
                  </li>
                </Fragment>
              )
            })}
          </ul>
        )}

        <ConfirmDialog
          open={confirmDelete !== null}
          title="Regel löschen"
          message={confirmDelete ? `Regel "${confirmDelete.pattern}" → "${confirmDelete.categoryName}" löschen?` : ''}
          confirmLabel="Löschen"
          danger
          onConfirm={() => { if (confirmDelete) deleteRule(confirmDelete) }}
          onClose={() => setConfirmDelete(null)}
        />

        <div className="category-add">
          <div className="category-add-row">
            <input
              type="text"
              placeholder="Verwendungszweck-Muster"
              value={newPattern}
              onChange={e => setNewPattern(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addRule() }}
              disabled={addSaving}
            />
            <select value={newCategoryId} onChange={e => setNewCategoryId(e.target.value)} disabled={addSaving}>
              <option value="" disabled>Kategorie…</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button type="button" onClick={addRule} disabled={addSaving}>
              <IconPlus />
              Hinzufügen
            </button>
          </div>
          {addError && <p className="category-row-error">{addError}</p>}
        </div>
      </div>
    </dialog>
  )
}
