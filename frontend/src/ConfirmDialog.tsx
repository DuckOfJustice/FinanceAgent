import { useEffect, useRef } from 'react'

// Ersetzt window.confirm() an allen Stellen im UI - der native Browser-Dialog laesst sich nicht
// stylen und sprengt das dunkle Design komplett (helles System-Popup mit Standard-Buttons).
// Natives <dialog> statt window.confirm() bringt Fokus-Trap/Escape weiterhin gratis mit,
// sieht aber aus wie der Rest der App.
type ConfirmDialogProps = {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Bestätigen',
  cancelLabel = 'Abbrechen',
  danger = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="category-modal confirm-modal"
      onClose={onClose}
      onClick={e => { if (e.target === dialogRef.current) dialogRef.current?.close() }}
    >
      <div className="category-modal-inner confirm-modal-inner">
        <h2 className="confirm-modal-title">{title}</h2>
        <p className="confirm-modal-message">{message}</p>
        <div className="confirm-modal-actions">
          <button type="button" onClick={() => dialogRef.current?.close()}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'confirm-modal-danger' : 'confirm-modal-primary'}
            onClick={() => {
              onConfirm()
              dialogRef.current?.close()
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
