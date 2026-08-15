'use client'

import { AlertTriangle, ArrowLeft, Check, X } from 'lucide-react'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'
import {
  buildReviewRows,
  canConfirmRegistration,
  getReviewBlockingReason,
  type DiditDocumentFields,
  type ReviewRowStatus,
} from '@/lib/auth/register-review'
import type { RegisterVerificationResults } from '@/lib/auth/register-form-validation'

const STATUS_STYLES: Record<ReviewRowStatus, { icon: React.ReactNode; row: string; text: string; label: string }> = {
  match: {
    icon: <Check className="h-4 w-4" aria-hidden />,
    row: 'border-emerald-200 bg-emerald-50/60',
    text: 'text-emerald-700',
    label: 'Coincide',
  },
  mismatch: {
    icon: <X className="h-4 w-4" aria-hidden />,
    row: 'border-red-200 bg-red-50/60',
    text: 'text-red-700',
    label: 'No coincide',
  },
  unknown: {
    icon: <AlertTriangle className="h-4 w-4" aria-hidden />,
    row: 'border-amber-200 bg-amber-50/60',
    text: 'text-amber-700',
    label: 'Sin confirmar',
  },
}

/**
 * Paso 3: muestra el mapeo entre lo que declaró el usuario y lo que Didit leyó del
 * documento. Solo habilita «Terminar» si todas las filas coinciden; si no, el único
 * camino es volver a corregir.
 */
export default function RegisterReview({
  verificationResults,
  documentFields,
  account,
  submitting,
  onBack,
  onConfirm,
}: {
  verificationResults: RegisterVerificationResults | null
  documentFields?: DiditDocumentFields
  /** Datos que no vienen del documento pero se crean con la cuenta. */
  account: { email: string; phone: string; roleLabel: string }
  submitting: boolean
  onBack: () => void
  onConfirm: () => void
}) {
  const rows = buildReviewRows(verificationResults, documentFields)
  const canConfirm = canConfirmRegistration(rows)
  const blockingReason = getReviewBlockingReason(rows)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Revisá tus datos</h2>
        <p className="mt-1 text-sm text-gray-600">
          Comparamos lo que ingresaste con lo que leímos de tu documento. Si está todo bien, terminá el
          registro; si algo no coincide, volvé y corregilo.
        </p>
      </div>

      <div className="space-y-2">
        {rows.map((row) => {
          const style = STATUS_STYLES[row.status]
          return (
            <div key={row.field} className={`rounded-xl border p-4 ${style.row}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium text-gray-900">{row.label}</p>
                <span className={`flex shrink-0 items-center gap-1 text-sm font-medium ${style.text}`}>
                  {style.icon}
                  {style.label}
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="text-gray-500">Ingresaste:</dt>
                  <dd className="min-w-0 break-words font-medium text-gray-900">{row.declared || '—'}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-gray-500">Tu documento dice:</dt>
                  <dd className="min-w-0 break-words font-medium text-gray-900">
                    {row.fromDocument || <span className="font-normal text-gray-400">no lo pudimos leer</span>}
                  </dd>
                </div>
              </dl>

              {row.status !== 'match' && (
                <p className={`mt-2 text-sm ${style.text}`}>{row.message}</p>
              )}
            </div>
          )
        })}
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-800">Datos de la cuenta</h3>
        <dl className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="text-gray-500">Correo:</dt>
            <dd className="min-w-0 break-all font-medium text-gray-900">{account.email}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-gray-500">Celular:</dt>
            <dd className="font-medium text-gray-900">{account.phone || '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-gray-500">Perfil:</dt>
            <dd className="font-medium text-gray-900">{account.roleLabel}</dd>
          </div>
        </dl>
      </div>

      {blockingReason && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-700">{blockingReason}</p>
        </div>
      )}

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
          title={canConfirm ? undefined : (blockingReason ?? undefined)}
        >
          <PendingButtonContent pending={submitting} pendingText="Creando cuenta…" idle="Terminar registro" />
        </button>
      </div>
    </div>
  )
}
