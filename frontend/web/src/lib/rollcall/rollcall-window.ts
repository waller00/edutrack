import { formatDateTimeInUruguay } from '@/lib/forms/datetime-uy'

export type BlockedReason = 'LOCKED' | 'WINDOW_EXPIRED' | 'NOT_ASSIGNED' | 'NOT_STARTED' | null

/** El servidor manda `editableUntil`; el cliente solo lo formatea o compara. */
export function isEditableNow(editableUntil: string | null, canEdit: boolean, now = new Date()): boolean {
  if (!canEdit) return false
  if (!editableUntil) return true
  return now.getTime() <= new Date(editableUntil).getTime()
}

/** Texto que explica por qué no se puede editar, o hasta cuándo se puede. */
export function editWindowNotice(params: {
  canEdit: boolean
  blockedReason: BlockedReason
  editableUntil: string | null
}): string | null {
  if (!params.canEdit) {
    switch (params.blockedReason) {
      case 'LOCKED':
        return 'Administración cerró esta planilla. Pedile el cambio a secretaría.'
      case 'WINDOW_EXPIRED':
        return 'Venció el plazo para editar esta lista. Pedile el cambio a secretaría.'
      case 'NOT_ASSIGNED':
        return 'No sos el docente de esta clase.'
      default:
        return 'Esta lista no se puede editar.'
    }
  }
  if (!params.editableUntil) return null
  return `Podés editar esta lista hasta el ${formatDateTimeInUruguay(params.editableUntil)}.`
}
