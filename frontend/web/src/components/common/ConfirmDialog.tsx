'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { PendingButtonContent } from './PendingButtonContent'

type Props = {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'default'
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Confirmación de una acción destructiva. Reemplaza a `globalThis.confirm()`, que no se puede
 * estilar, no se puede testear y bloquea el hilo del navegador.
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'danger',
  pending = false,
  onConfirm,
  onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // El foco arranca en Cancelar: la opción segura no debe activarse con un Enter distraído.
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return createPortal(
    <div className="responsive-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="responsive-modal-panel max-w-md space-y-4">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
              tone === 'danger' ? 'bg-red-100' : 'bg-emerald-100'
            }`}
          >
            <AlertTriangle
              className={`h-5 w-5 ${tone === 'danger' ? 'text-red-600' : 'text-emerald-600'}`}
              aria-hidden
            />
          </div>
          <div className="min-w-0">
            <h2 id="confirm-title" className="text-lg font-semibold text-gray-900">
              {title}
            </h2>
            <p className="mt-1 text-sm text-gray-600">{message}</p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button ref={cancelRef} type="button" className="btn-secondary text-sm" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`${tone === 'danger' ? 'btn-danger' : 'btn-primary'} text-sm`}
            disabled={pending}
            onClick={onConfirm}
          >
            <PendingButtonContent pending={pending} pendingText="Procesando…" idle={confirmLabel} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
