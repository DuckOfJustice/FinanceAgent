import { useEffect, useRef, useState } from 'react'
import { CATEGORY_COLOR_SLOTS, categoryColor, pickUnusedColorSlot } from './categoryColor'
import ConfirmDialog from './ConfirmDialog'

type Category = { id: number; name: string; color: string | null; isFixkosten: boolean }

const iconProps = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const IconClose = () => (
  <svg {...iconProps} width={16} height={16}><path d="M18 6 6 18M6 6l12 12" /></svg>
)
const IconPencil = () => (
  <svg {...iconProps}><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z" /></svg>
)
const IconTrash = () => (
  <svg {...iconProps}><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" /></svg>
)
const IconCheck = () => (
  <svg {...iconProps}><path d="M20 6 9 17l-5-5" /></svg>
)
const IconPlus = () => (
  <svg {...iconProps}><path d="M12 5v14M5 12h14" /></svg>
)
const IconSearch = () => (
  <svg {...iconProps} width={14} height={14}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
)

// Liest die Fehlermeldung aus einer fehlgeschlagenen Response - Program.cs liefert bei
// Validierungsfehlern (400/409) einfachen Text im Body, kein JSON.
async function errorMessage(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => '')
  return text || fallback
}

export default function CategoryManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(false)

  const [filterText, setFilterText] = useState('')

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editColor, setEditColor] = useState<string>(CATEGORY_COLOR_SLOTS[0])
  const [editIsFixkosten, setEditIsFixkosten] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [editSaving, setEditSaving] = useState(false)

  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<{ id: number; message: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Category | null>(null)

  const [newName, setNewName] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [addSaving, setAddSaving] = useState(false)

  const sortByName = (list: Category[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, 'de'))

  const loadCategories = () => {
    setLoading(true)
    fetch('/api/categories')
      .then(r => r.json())
      .then((list: Category[]) => setCategories(sortByName(list)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      loadCategories()
      setEditingId(null)
      setDeleteError(null)
      setNewName('')
      setAddError(null)
      setFilterText('')
      setConfirmDelete(null)
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  const startEdit = (c: Category) => {
    setEditingId(c.id)
    setEditValue(c.name)
    // Bereits gespeicherte Farbe uebernehmen; ohne eine vorhandene direkt eine noch unbenutzte
    // vorauswaehlen, statt den Nutzer zu zwingen selbst eine zu suchen.
    setEditColor(c.color ?? pickUnusedColorSlot(categories.filter(x => x.id !== c.id).map(x => x.color)))
    setEditIsFixkosten(c.isFixkosten)
    setEditError(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditError(null)
  }

  const saveEdit = async (id: number) => {
    const name = editValue.trim()
    if (!name) {
      setEditError('Name darf nicht leer sein.')
      return
    }
    setEditSaving(true)
    setEditError(null)
    const res = await fetch(`/api/categories/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color: editColor, isFixkosten: editIsFixkosten }),
    })
    if (res.ok) {
      const updated: Category = await res.json()
      setCategories(prev => sortByName(prev.map(c => (c.id === id ? updated : c))))
      setEditingId(null)
    } else {
      setEditError(await errorMessage(res, 'Fehler beim Speichern.'))
    }
    setEditSaving(false)
  }

  const deleteCategory = async (c: Category) => {
    setDeletingId(c.id)
    setDeleteError(null)
    const res = await fetch(`/api/categories/${c.id}`, { method: 'DELETE' })
    if (res.ok) {
      setCategories(prev => prev.filter(x => x.id !== c.id))
    } else {
      setDeleteError({ id: c.id, message: await errorMessage(res, 'Fehler beim Löschen.') })
    }
    setDeletingId(null)
  }

  const addCategory = async () => {
    const name = newName.trim()
    if (!name) {
      setAddError('Name darf nicht leer sein.')
      return
    }
    setAddSaving(true)
    setAddError(null)
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (res.ok) {
      const created: Category = await res.json()
      setCategories(prev => sortByName([...prev, created]))
      setNewName('')
    } else {
      setAddError(await errorMessage(res, 'Fehler beim Anlegen.'))
    }
    setAddSaving(false)
  }

  const query = filterText.trim().toLowerCase()
  const filteredCategories = query ? categories.filter(c => c.name.toLowerCase().includes(query)) : categories

  return (
    <dialog
      ref={dialogRef}
      className="category-modal"
      onClose={onClose}
      onClick={e => { if (e.target === dialogRef.current) dialogRef.current?.close() }}
    >
      <div className="category-modal-inner">
        <div className="category-modal-header">
          <h2 className="panel-title" style={{ margin: 0 }}>
            Kategorien verwalten
            {categories.length > 0 && <span className="category-modal-count"> · {categories.length}</span>}
          </h2>
          <button type="button" className="icon-button" onClick={() => dialogRef.current?.close()} aria-label="Schließen">
            <IconClose />
          </button>
        </div>

        {categories.length > 0 && (
          <div className="category-search-wrap">
            <IconSearch />
            <input
              type="text"
              className="category-search"
              placeholder="Kategorien durchsuchen…"
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
        ) : filteredCategories.length === 0 ? (
          <p className="muted-text">{categories.length === 0 ? 'Noch keine Kategorien.' : 'Keine Kategorien gefunden.'}</p>
        ) : (
          <ul className="category-list">
            {filteredCategories.map(c => (
              <li key={c.id} className="category-row">
                <div className="category-row-main">
                  <span className="cat-dot" style={{ background: categoryColor(c.name, c.color) }} />
                  {editingId === c.id ? (
                    <>
                      <input
                        className="category-edit-input"
                        value={editValue}
                        autoFocus
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveEdit(c.id)
                          if (e.key === 'Escape') { e.stopPropagation(); cancelEdit() }
                        }}
                        disabled={editSaving}
                      />
                      <div className="category-row-actions">
                        <button type="button" className="icon-button" onClick={() => saveEdit(c.id)} disabled={editSaving} aria-label="Speichern">
                          <IconCheck />
                        </button>
                        <button type="button" className="icon-button" onClick={cancelEdit} disabled={editSaving} aria-label="Abbrechen">
                          <IconClose />
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="category-name">{c.name}</span>
                      <div className="category-row-actions">
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => startEdit(c)}
                          disabled={deletingId === c.id}
                          aria-label={`"${c.name}" umbenennen`}
                        >
                          <IconPencil />
                        </button>
                        {c.name !== 'Sonstiges' && (
                          <button
                            type="button"
                            className="icon-button icon-button-danger"
                            onClick={() => setConfirmDelete(c)}
                            disabled={deletingId === c.id}
                            aria-label={`"${c.name}" löschen`}
                          >
                            <IconTrash />
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
                {editingId === c.id && (
                  <div className="category-color-picker" role="radiogroup" aria-label="Farbe wählen">
                    {CATEGORY_COLOR_SLOTS.map(slot => (
                      <button
                        key={slot}
                        type="button"
                        role="radio"
                        aria-checked={editColor === slot}
                        aria-label={`Farbe ${slot}`}
                        className={`color-swatch${editColor === slot ? ' is-selected' : ''}`}
                        style={{ background: `var(--cat-${slot})` }}
                        onClick={() => setEditColor(slot)}
                        disabled={editSaving}
                      />
                    ))}
                  </div>
                )}
                {editingId === c.id && (
                  <label className="category-fixkosten-toggle">
                    <input
                      type="checkbox"
                      checked={editIsFixkosten}
                      onChange={e => setEditIsFixkosten(e.target.checked)}
                      disabled={editSaving}
                    />
                    Teil der Fixkosten
                  </label>
                )}
                {editingId === c.id && editError && <p className="category-row-error">{editError}</p>}
                {deleteError?.id === c.id && <p className="category-row-error">{deleteError.message}</p>}
              </li>
            ))}
          </ul>
        )}

        <ConfirmDialog
          open={confirmDelete !== null}
          title="Kategorie löschen"
          message={confirmDelete ? `"${confirmDelete.name}" löschen? Zugehörige Buchungen werden "Sonstiges" zugeordnet.` : ''}
          confirmLabel="Löschen"
          danger
          onConfirm={() => { if (confirmDelete) deleteCategory(confirmDelete) }}
          onClose={() => setConfirmDelete(null)}
        />

        <div className="category-add">
          <div className="category-add-row">
            <input
              type="text"
              placeholder="Neue Kategorie"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addCategory() }}
              disabled={addSaving}
            />
            <button type="button" onClick={addCategory} disabled={addSaving}>
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
