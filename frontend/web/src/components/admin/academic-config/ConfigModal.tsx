'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'

type Props = {
  title: string
  hint?: string
  saving: boolean
  error: string | null
  submitLabel?: string
  onSubmit: () => void
  onClose: () => void
  children: React.ReactNode
}

/** Marco común de los formularios de configuración académica: título, error, guardar y cerrar. */
export default function ConfigModal({
  title,
  hint,
  saving,
  error,
  submitLabel = 'Guardar',
  onSubmit,
  onClose,
  children,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="responsive-modal" role="dialog" aria-modal="true" aria-labelledby="config-modal-title">
      <form
        className="responsive-modal-panel max-w-2xl space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit()
        }}
      >
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="config-modal-title" className="text-lg font-semibold text-gray-900">
              {title}
            </h2>
            {hint && <p className="mt-0.5 text-sm text-gray-600">{hint}</p>}
          </div>
          <button ref={closeRef} type="button" aria-label="Cerrar" onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        <div className="space-y-3">{children}</div>

        <footer className="flex justify-end gap-2 border-t border-gray-100 pt-3">
          <button type="button" className="btn-secondary text-sm" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary text-sm" disabled={saving}>
            <PendingButtonContent pending={saving} pendingText="Guardando…" idle={submitLabel} />
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  )
}
