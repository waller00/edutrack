'use client'

import { ArrowLeft, Clock } from 'lucide-react'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'
import { buildReviewSummary, type RegisterReviewData } from '@/lib/auth/register-review'

/**
 * Paso 2: resumen de lo que ingresó el usuario antes de crear la cuenta. No hay verificación de
 * identidad en línea: la cuenta nace pendiente y administración la aprueba.
 */
export default function RegisterReview({
  data,
  canConfirm,
  submitting,
  onBack,
  onCancel,
  onConfirm,
}: {
  data: RegisterReviewData
  /** Los datos del paso 1 son válidos. */
  canConfirm: boolean
  submitting: boolean
  onBack: () => void
  /** Abandona el alta por completo. Sin esto el paso queda sin salida. */
  onCancel: () => void
  onConfirm: () => void
}) {
  const rows = buildReviewSummary(data)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Revisá tus datos</h2>
        <p className="mt-1 text-sm text-gray-600">
          Si está todo bien, terminá el registro; si algo está mal, volvé y corregilo.
        </p>
      </div>

      <dl className="grid grid-cols-1 gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="flex gap-2">
            <dt className="text-gray-500">{row.label}:</dt>
            <dd className="min-w-0 break-words font-medium text-gray-900">{row.value || '—'}</dd>
          </div>
        ))}
      </dl>

      <div className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
        <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>Tu cuenta queda pendiente hasta que administración revise tus datos y la apruebe.</p>
      </div>

      <div className="flex flex-col gap-3 border-t border-gray-200 pt-6 sm:flex-row">
        <button type="button" onClick={onBack} disabled={submitting} className="btn-secondary flex-1 justify-center">
          <ArrowLeft className="mr-1 h-4 w-4" aria-hidden />
          Volver y corregir
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!canConfirm || submitting}
          className="btn-primary flex-1 justify-center disabled:opacity-60"
        >
          <PendingButtonContent pending={submitting} pendingText="Creando cuenta…" idle="Terminar registro" />
        </button>
      </div>

      <div className="text-center">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="text-sm text-gray-500 underline underline-offset-2 hover:text-gray-700 disabled:opacity-60"
        >
          Cancelar registro
        </button>
      </div>
    </div>
  )
}
