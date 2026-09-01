import { useEffect, useRef, useState } from 'react'
import ConfirmDialog from './ConfirmDialog'

type AdminUser = { id: number; username: string; isAdmin: boolean; hasBankConfig: boolean; bankConnected: boolean }
type ConfigForm = { appId: string; privateKeyPem: string; aspspName: string; aspspCountry: string; accountIban: string }

const emptyForm: ConfigForm = { appId: '', privateKeyPem: '', aspspName: '', aspspCountry: 'DE', accountIban: '' }

const iconProps = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const IconTrash = () => (
  <svg {...iconProps}><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" /></svg>
)

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => '')
  return text || fallback
}

export default function AdminPanel({ open, onClose, currentUsername }: { open: boolean; onClose: () => void; currentUsername: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<ConfigForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<AdminUser | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const loadUsers = () => {
    setLoading(true)
    fetch('/api/admin/users')
      .then(r => {
        if (r.status === 401) { window.location.reload(); return null }
        return r.json()
      })
      .then(list => { if (list) setUsers(list) })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      loadUsers()
      setEditingId(null)
      setError(null)
      setConfirmDelete(null)
      setDeleteError(null)
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  const startEdit = (userId: number) => {
    setEditingId(userId)
    setForm(emptyForm)
    setError(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setError(null)
  }

  const save = async (userId: number) => {
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/admin/users/${userId}/enablebanking-config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (res.ok) {
      setEditingId(null)
      setForm(emptyForm)
      loadUsers()
    } else {
      setError(await errorMessage(res, 'Fehler beim Speichern.'))
    }
    setSaving(false)
  }

  const deleteUser = async (u: AdminUser) => {
    setDeleteError(null)
    const res = await fetch(`/api/admin/users/${u.id}`, { method: 'DELETE' })
    if (res.ok) {
      if (editingId === u.id) cancelEdit()
      loadUsers()
    } else {
      setDeleteError(await errorMessage(res, 'Fehler beim Löschen.'))
    }
  }

  const [resetError, setResetError] = useState<string | null>(null)

  const resetConnection = async (u: AdminUser) => {
    setResetError(null)
    const res = await fetch(`/api/admin/users/${u.id}/reset-bank-connection`, { method: 'POST' })
    if (res.ok) {
      loadUsers()
    } else {
      setResetError(await errorMessage(res, 'Fehler beim Zuruecksetzen.'))
    }
  }

  const [resetLinks, setResetLinks] = useState<Record<number, string>>({})
  const [resetLinkError, setResetLinkError] = useState<string | null>(null)

  const createResetLink = async (u: AdminUser) => {
    setResetLinkError(null)
    const res = await fetch(`/api/admin/users/${u.id}/password-reset-link`, { method: 'POST' })
    if (res.ok) {
      const { url } = await res.json()
      setResetLinks(prev => ({ ...prev, [u.id]: url }))
      navigator.clipboard?.writeText(url).catch(() => {})
    } else {
      setResetLinkError(await errorMessage(res, 'Fehler beim Erstellen des Links.'))
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="category-modal admin-modal"
      onClose={onClose}
      onClick={e => { if (e.target === dialogRef.current) dialogRef.current?.close() }}
    >
      <div className="category-modal-inner">
        <div className="category-modal-header">
          <h2 className="panel-title" style={{ margin: 0 }}>Nutzer verwalten</h2>
          <button type="button" className="icon-button" onClick={() => dialogRef.current?.close()} aria-label="Schließen">×</button>
        </div>

        {deleteError && <p className="admin-panel-error">{deleteError}</p>}
        {resetError && <p className="admin-panel-error">{resetError}</p>}
        {resetLinkError && <p className="admin-panel-error">{resetLinkError}</p>}

        {loading ? (
          <ul className="category-list">
            {Array.from({ length: 3 }, (_, i) => (
              <li key={i} className="category-row">
                <div className="category-row-main category-row-skeleton">
                  <span className="skeleton-dot" />
                  <span className="skeleton-text" />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="category-list">
            {users.map(u => (
              <li key={u.id} className="category-row">
                <div className="category-row-main admin-row">
                  <span className="category-name">
                    {u.username}
                    {u.isAdmin && <span className="admin-tag">Admin</span>}
                  </span>
                  <div className="admin-row-meta">
                    <span className={`admin-status${u.bankConnected ? ' is-connected' : ''}`}>
                      {u.bankConnected ? 'Bank verbunden' : u.hasBankConfig ? 'Konfiguriert, nicht verbunden' : 'Keine Bank-Config'}
                    </span>
                    <button type="button" onClick={() => (editingId === u.id ? cancelEdit() : startEdit(u.id))}>
                      {editingId === u.id ? 'Schließen' : 'Bank-Config bearbeiten'}
                    </button>
                    {u.bankConnected && (
                      <button type="button" onClick={() => resetConnection(u)}>
                        Verbindung zurücksetzen
                      </button>
                    )}
                    <button type="button" onClick={() => createResetLink(u)}>
                      Passwort-Reset-Link erstellen
                    </button>
                    {u.username !== currentUsername && (
                      <button
                        type="button"
                        className="icon-button icon-button-danger"
                        onClick={() => setConfirmDelete(u)}
                        aria-label={`"${u.username}" löschen`}
                      >
                        <IconTrash />
                      </button>
                    )}
                  </div>
                </div>

                {resetLinks[u.id] && (
                  <p className="admin-reset-link">
                    Link (in Zwischenablage kopiert):
                    <input
                      readOnly
                      value={resetLinks[u.id]}
                      onFocus={e => e.target.select()}
                    />
                  </p>
                )}

                {editingId === u.id && (
                  <div className="admin-config-form">
                    <label className="admin-field">
                      <span>App-ID</span>
                      <input value={form.appId} onChange={e => setForm({ ...form, appId: e.target.value })} autoComplete="off" />
                    </label>
                    <label className="admin-field">
                      <span>Private Key (PEM)</span>
                      <textarea
                        className="admin-pem-input"
                        placeholder="-----BEGIN PRIVATE KEY-----"
                        value={form.privateKeyPem}
                        onChange={e => setForm({ ...form, privateKeyPem: e.target.value })}
                        autoComplete="off"
                        spellCheck={false}
                        rows={4}
                      />
                    </label>
                    <div className="admin-field-row">
                      <label className="admin-field">
                        <span>Aspsp-Name</span>
                        <input value={form.aspspName} onChange={e => setForm({ ...form, aspspName: e.target.value })} autoComplete="off" />
                      </label>
                      <label className="admin-field admin-field-narrow">
                        <span>Land</span>
                        <input value={form.aspspCountry} onChange={e => setForm({ ...form, aspspCountry: e.target.value })} autoComplete="off" maxLength={2} />
                      </label>
                    </div>
                    <label className="admin-field">
                      <span>Konto-IBAN</span>
                      <input value={form.accountIban} onChange={e => setForm({ ...form, accountIban: e.target.value })} autoComplete="off" />
                    </label>

                    {error && <p className="admin-config-error">{error}</p>}

                    <div className="admin-config-actions">
                      <button type="button" onClick={cancelEdit} disabled={saving}>Abbrechen</button>
                      <button type="button" className="btn-primary" onClick={() => save(u.id)} disabled={saving}>
                        {saving ? 'Speichert...' : 'Speichern'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <ConfirmDialog
          open={confirmDelete !== null}
          title="Nutzer löschen"
          message={confirmDelete ? `"${confirmDelete.username}" löschen? Alle Kategorien, Regeln und Buchungen dieses Nutzers werden unwiderruflich mitgelöscht.` : ''}
          confirmLabel="Löschen"
          danger
          onConfirm={() => { if (confirmDelete) deleteUser(confirmDelete) }}
          onClose={() => setConfirmDelete(null)}
        />
      </div>
    </dialog>
  )
}
