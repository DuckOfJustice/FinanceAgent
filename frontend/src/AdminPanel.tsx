import { useEffect, useRef, useState } from 'react'

type AdminUser = { id: number; username: string; isAdmin: boolean; hasBankConfig: boolean }
type ConfigForm = { appId: string; privateKeyPem: string; aspspName: string; aspspCountry: string; accountIban: string }

const emptyForm: ConfigForm = { appId: '', privateKeyPem: '', aspspName: '', aspspCountry: 'DE', accountIban: '' }

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => '')
  return text || fallback
}

export default function AdminPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<ConfigForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadUsers = () => {
    fetch('/api/admin/users').then(r => {
      if (r.status === 401) { window.location.reload(); return null }
      return r.json()
    }).then(list => { if (list) setUsers(list) })
  }

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      loadUsers()
      setEditingId(null)
      setError(null)
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

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

  return (
    <dialog
      ref={dialogRef}
      className="category-modal"
      onClose={onClose}
      onClick={e => { if (e.target === dialogRef.current) dialogRef.current?.close() }}
    >
      <div className="category-modal-inner">
        <div className="category-modal-header">
          <h2 className="panel-title" style={{ margin: 0 }}>Nutzer verwalten</h2>
          <button type="button" className="icon-button" onClick={() => dialogRef.current?.close()} aria-label="Schließen">×</button>
        </div>

        <ul className="category-list">
          {users.map(u => (
            <li key={u.id} className="category-row">
              <div className="category-row-main">
                <span className="category-name">{u.username}{u.isAdmin ? ' (Admin)' : ''}</span>
                <span className="muted-text">{u.hasBankConfig ? 'Bank verbunden' : 'Keine Bank-Config'}</span>
                <button type="button" onClick={() => { setEditingId(u.id); setForm(emptyForm); setError(null) }}>
                  Bank-Config bearbeiten
                </button>
              </div>
              {editingId === u.id && (
                <div className="category-add">
                  <input placeholder="AppId" value={form.appId} onChange={e => setForm({ ...form, appId: e.target.value })} />
                  <textarea placeholder="Private Key (PEM)" value={form.privateKeyPem} onChange={e => setForm({ ...form, privateKeyPem: e.target.value })} rows={4} />
                  <input placeholder="Aspsp-Name" value={form.aspspName} onChange={e => setForm({ ...form, aspspName: e.target.value })} />
                  <input placeholder="Aspsp-Land (z.B. DE)" value={form.aspspCountry} onChange={e => setForm({ ...form, aspspCountry: e.target.value })} />
                  <input placeholder="Konto-IBAN" value={form.accountIban} onChange={e => setForm({ ...form, accountIban: e.target.value })} />
                  {error && <p className="category-row-error">{error}</p>}
                  <button type="button" onClick={() => save(u.id)} disabled={saving}>Speichern</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </dialog>
  )
}
