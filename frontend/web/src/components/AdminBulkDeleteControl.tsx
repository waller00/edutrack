'use client'

type AdminBulkDeleteControlProps = {
  entityLabel: string
  warningText: string
  busy?: boolean
  onConfirm: () => void | Promise<void>
}

export default function AdminBulkDeleteControl({
  entityLabel,
  warningText,
  busy = false,
  onConfirm,
}: AdminBulkDeleteControlProps) {
  const confirmId = `bulk-delete-confirm-${entityLabel.toLowerCase().replace(/\s+/g, '-')}`

  return (
    <details className="rounded-lg border border-red-200 bg-red-50 p-4">
      <summary className="cursor-pointer list-none font-medium text-red-700">
        Eliminar todos los registros de {entityLabel}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-sm text-red-800">{warningText}</p>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor={confirmId} className="text-sm font-medium text-red-900">
            Escribe `ELIMINAR` para habilitar la acción final
          </label>
          <input
            id={confirmId}
            type="text"
            pattern="ELIMINAR"
            required
            placeholder="ELIMINAR"
            className="rounded border border-red-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const input = document.getElementById(confirmId) as HTMLInputElement | null
              if (!input) return
              if (input.value.trim() !== 'ELIMINAR') {
                input.setCustomValidity('Debes escribir ELIMINAR para continuar')
                input.reportValidity()
                return
              }
              input.setCustomValidity('')
              void onConfirm()
            }}
            className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
          >
            {busy ? 'Eliminando...' : `Sí, eliminar todos los registros de ${entityLabel}`}
          </button>
        </div>
        <p className="text-xs text-red-700">Esta operación es destructiva y no se puede deshacer.</p>
      </div>
    </details>
  )
}
