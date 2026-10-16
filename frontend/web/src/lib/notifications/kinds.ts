import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, Bell, BellRing, BookOpen, CalendarDays, ClipboardCheck, HeartPulse, MessageSquare } from 'lucide-react'

/** Cómo se ve un aviso según su tipo: el ícono y el color acompañan, la etiqueta dice qué es. */
export type NotificationKind = {
  label: string
  Icon: LucideIcon
  /** Fondo y color del ícono; nunca es la única señal (RNF 7.2): va con la etiqueta. */
  tone: string
}

const LIBRETA = 'bg-emerald-50 text-emerald-700'

export function notificationKind(type: string): NotificationKind {
  if (type.startsWith('LICENSE_')) return { label: 'Licencias', Icon: HeartPulse, tone: 'bg-rose-50 text-rose-700' }
  if (type === 'EVENT_ASSIGNED') return { label: 'Agenda', Icon: CalendarDays, tone: 'bg-sky-50 text-sky-700' }
  if (type === 'ATTENDANCE_INCIDENT') return { label: 'Asistencia', Icon: AlertTriangle, tone: 'bg-amber-50 text-amber-700' }
  if (type === 'GRADEBOOK_MESSAGE') return { label: 'Libreta', Icon: MessageSquare, tone: LIBRETA }
  if (type.startsWith('GRADEBOOK_')) return { label: 'Libreta', Icon: BookOpen, tone: LIBRETA }
  if (type === 'ROLL_CALL_LATE') return { label: 'Pase de lista', Icon: ClipboardCheck, tone: 'bg-amber-50 text-amber-700' }
  if (type === 'STUDENT_ALERT') return { label: 'Alertas', Icon: BellRing, tone: 'bg-orange-50 text-orange-700' }
  return { label: 'Aviso', Icon: Bell, tone: 'bg-slate-100 text-slate-600' }
}
