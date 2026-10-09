import { formatTimeInUruguay } from '@/lib/forms/datetime-uy'
import { addDaysYmd, todayYmdUruguay } from '@/lib/libreta/absence-day'
import { formatRollCallDay } from '@/lib/rollcall/rollcall-phase'

/**
 * Cuándo llegó un aviso, corto: "ahora", "hace 5 min", "hace 2 h", "ayer 18:30", "08/10".
 * Los días se cuentan en hora de Uruguay: "ayer" es el día civil anterior, no 24 h atrás.
 */
export function relativeTime(iso: string, now = new Date()): string {
  const at = new Date(iso)
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000)
  if (minutes < 1) return 'ahora'
  if (minutes < 60) return `hace ${minutes} min`

  const day = todayYmdUruguay(at)
  const today = todayYmdUruguay(now)
  if (day === today) return `hace ${Math.floor(minutes / 60)} h`
  if (day === addDaysYmd(today, -1)) return `ayer ${formatTimeInUruguay(at)}`

  const [year, month, date] = day.split('-')
  return year === today.slice(0, 4) ? `${date}/${month}` : `${date}/${month}/${year.slice(2)}`
}

/** Título del grupo de un día en la lista de avisos: "Hoy", "Ayer", "Jueves 8 de octubre". */
export function dayGroupLabel(iso: string, now = new Date()): string {
  const day = todayYmdUruguay(new Date(iso))
  const today = todayYmdUruguay(now)
  if (day === today) return 'Hoy'
  if (day === addDaysYmd(today, -1)) return 'Ayer'
  const label = formatRollCallDay(day)
  return day.slice(0, 4) === today.slice(0, 4) ? label : `${label} de ${day.slice(0, 4)}`
}

/** La hora de cada aviso dentro de su día: hoy, hace cuánto; otro día, la hora. */
export function timeWithinDay(iso: string, now = new Date()): string {
  return todayYmdUruguay(new Date(iso)) === todayYmdUruguay(now) ? relativeTime(iso, now) : formatTimeInUruguay(iso)
}
