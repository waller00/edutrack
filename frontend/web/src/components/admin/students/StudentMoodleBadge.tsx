'use client'

import { Loader2, Mail, UserPlus } from 'lucide-react'
import { getMoodleStatusView } from '@/lib/admin/students-display'
import type { MoodleAccountStatus } from './student-types'

type Props = {
  moodle: MoodleAccountStatus | undefined
  studentName: string
  pending: boolean
  /** `null` en las vistas de sólo lectura (la tabla no crea cuentas). */
  onAction: ((action: 'provision' | 'resend') => void) | null
  /** Muestra la explicación de una línea; se usa en la ficha, no en la tabla. */
  withHint?: boolean
}

/** Estado Moodle y su acción. Único punto de verdad: lo usan la tabla, las tarjetas y la ficha. */
export default function StudentMoodleBadge({
  moodle,
  studentName,
  pending,
  onAction,
  withHint = false,
}: Props) {
  const view = getMoodleStatusView(moodle?.state, {
    linked: moodle?.linked,
    canProvision: moodle?.canProvision,
  })
  const actionable = onAction !== null && view.action !== 'none'

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${view.className}`}>
          {view.label}
        </span>
        {actionable && (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
            disabled={pending}
            onClick={() => onAction(view.action as 'provision' | 'resend')}
            aria-label={`${view.actionLabel} de ${studentName}`}
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : view.action === 'provision' ? (
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Mail className="h-3.5 w-3.5" aria-hidden />
            )}
            {view.actionLabel}
          </button>
        )}
        {moodle?.welcomeSentAt ? (
          <span className="text-[11px] text-gray-400">Enviado {moodle.welcomeSentAt.slice(0, 10)}</span>
        ) : null}
      </div>
      {withHint && <p className="text-[11px] leading-snug text-gray-500">{view.hint}</p>}
    </div>
  )
}
