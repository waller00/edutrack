'use client'

import { Loader2, Mail } from 'lucide-react'
import { canResendMoodleWelcome, getMoodleStatusView } from '@/lib/admin/students-display'
import type { MoodleAccountStatus } from './student-types'

type Props = {
  moodle: MoodleAccountStatus | undefined
  studentName: string
  resending: boolean
  onResend: (() => void) | null
}

/** Estado Moodle + reenvío. Único punto de verdad: lo usan la tabla, las tarjetas y el modal. */
export default function StudentMoodleBadge({ moodle, studentName, resending, onResend }: Props) {
  const view = getMoodleStatusView(moodle?.state)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${view.className}`}>{view.label}</span>
      {onResend && canResendMoodleWelcome(moodle?.state) ? (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
          disabled={resending}
          onClick={onResend}
          aria-label={`Reenviar correo Moodle a ${studentName}`}
        >
          {resending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Mail className="h-3.5 w-3.5" aria-hidden />
          )}
          Reenviar
        </button>
      ) : null}
      {moodle?.welcomeSentAt ? (
        <span className="text-[11px] text-gray-400">Enviado {moodle.welcomeSentAt.slice(0, 10)}</span>
      ) : null}
    </div>
  )
}
