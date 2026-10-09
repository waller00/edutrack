'use client'

import { Loader2, Mail, Trash2, UserPlus } from 'lucide-react'
import UserActionsMenu from '@/components/admin/UserActionsMenu'
import { getMoodleStatusView } from '@/lib/admin/students-display'
import type { StudentListRow } from './student-types'

type Props = {
  row: StudentListRow
  allYears: boolean
  pending: boolean
  onDelete: (row: StudentListRow) => void
  onResendMoodle: (row: StudentListRow) => void
}

export default function StudentActionsMenu({ row, allYears, pending, onDelete, onResendMoodle }: Props) {
  const name = `${row.firstName} ${row.lastName}${allYears && row.schoolYearCode ? ` (${row.schoolYearCode})` : ''}`
  const view = getMoodleStatusView(row.moodle?.state, row.moodle)
  if (pending) return <span role="status" aria-label={`Actualizando aula virtual de ${name}`} className="inline-flex h-10 w-10 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" aria-hidden /></span>

  return <UserActionsMenu name={name} actions={[
    ...(view.action !== 'none' ? [{ label: view.actionLabel, icon: view.action === 'resend' ? Mail : UserPlus, onSelect: () => onResendMoodle(row) }] : []),
    { label: 'Eliminar estudiante', icon: Trash2, destructive: true, onSelect: () => onDelete(row) },
  ]} />
}
