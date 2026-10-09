import { APP_TIMEZONE, formatTimeInUruguay } from '@/lib/forms/datetime-uy'
import { weekdayNameEs } from '@/lib/libreta/absence-day'
import type { BlockedReason } from './rollcall-window'
import type { SessionStatus } from './rollcall-status'

/** Lo que hace falta de una lista para saber en qué momento está. */
export type RollCallTiming = {
  status: SessionStatus
  blockedReason: BlockedReason
  /** Desde cuándo se puede pasar: 10 minutos antes del inicio de la clase. */
  opensAt: string
  endAt: string
  editableUntil: string | null
  takenAt: string | null
}

/**
 * Momento de la lista de una clase, según la hora:
 * - `UPCOMING`: todavía no abrió;
 * - `OPEN`: abierta, con la clase en curso, sin pasar;
 * - `OVERDUE`: la clase terminó y la lista sigue sin pasar, todavía en plazo;
 * - `TAKEN`: pasada, y todavía se puede corregir;
 * - `CLOSED`: pasada, ya fuera de plazo;
 * - `EXPIRED`: sin pasar, fuera de plazo;
 * - `LOCKED`: cerrada por administración;
 * - `NOT_ASSIGNED`: no es una clase de quien mira.
 *
 * Se calcula con la hora del cliente y no con `canEdit`: el servidor responde una vez y la pantalla
 * queda abierta, así que "todavía no abrió" tiene que pasar solo a "abierta".
 */
export type RollCallPhase = 'UPCOMING' | 'OPEN' | 'OVERDUE' | 'TAKEN' | 'CLOSED' | 'EXPIRED' | 'LOCKED' | 'NOT_ASSIGNED'

export function rollCallPhase(timing: RollCallTiming, now = new Date()): RollCallPhase {
  if (timing.blockedReason === 'LOCKED') return 'LOCKED'
  if (timing.blockedReason === 'NOT_ASSIGNED') return 'NOT_ASSIGNED'
  const at = now.getTime()
  const inWindow = !timing.editableUntil || at <= new Date(timing.editableUntil).getTime()
  if (timing.status === 'TAKEN') return inWindow ? 'TAKEN' : 'CLOSED'
  if (at < new Date(timing.opensAt).getTime()) return 'UPCOMING'
  if (!inWindow) return 'EXPIRED'
  return at <= new Date(timing.endAt).getTime() ? 'OPEN' : 'OVERDUE'
}

/** Fases en las que el docente todavía puede (y debería) pasar la lista. */
export function isRollCallDue(phase: RollCallPhase): boolean {
  return phase === 'OPEN' || phase === 'OVERDUE'
}

/** Texto del distintivo: nunca sólo color (RNF 7.2). */
export function rollCallPhaseLabel(phase: RollCallPhase, timing: Pick<RollCallTiming, 'opensAt' | 'takenAt'>): string {
  switch (phase) {
    case 'UPCOMING':
      return `Abre ${formatTimeInUruguay(timing.opensAt)}`
    case 'OPEN':
      return 'Pasá la lista'
    case 'OVERDUE':
      return 'Sin pasar'
    case 'TAKEN':
      return timing.takenAt ? `Pasada ${formatTimeInUruguay(timing.takenAt)}` : 'Pasada'
    case 'CLOSED':
      return 'Cerrada'
    case 'EXPIRED':
      return 'Fuera de plazo'
    case 'LOCKED':
      return 'Cerrada por administración'
    default:
      return 'No es tu clase'
  }
}

export function rollCallPhaseChipClass(phase: RollCallPhase): string {
  switch (phase) {
    case 'OPEN':
      return 'bg-emerald-600 text-white'
    case 'OVERDUE':
      return 'bg-amber-100 text-amber-900'
    case 'TAKEN':
      return 'bg-emerald-100 text-emerald-800'
    case 'EXPIRED':
      return 'bg-red-100 text-red-800'
    default:
      return 'bg-gray-100 text-gray-600'
  }
}

/** La lista de una clase en el resumen del día de administración (`/analytics/attendance-timeline`). */
export type DayRollCall = {
  eventId: string
  ymd: string
  status: SessionStatus
  takenAt: string | null
  takenBy: string | null
  opensAt: string
  endAt: string
}

/** Para administración el plazo no corre: sólo importa si abrió, si está en curso y si se pasó. */
export function dayRollCallPhase(rollCall: DayRollCall, now = new Date()): RollCallPhase {
  return rollCallPhase({ ...rollCall, blockedReason: null, editableUntil: null }, now)
}

export function dayRollCallLabel(rollCall: DayRollCall, now = new Date()): string {
  switch (dayRollCallPhase(rollCall, now)) {
    case 'TAKEN': {
      const at = rollCall.takenAt ? ` ${formatTimeInUruguay(rollCall.takenAt)}` : ''
      return `Lista pasada${at}${rollCall.takenBy ? ` · ${rollCall.takenBy}` : ''}`
    }
    case 'UPCOMING':
      return `Lista: abre ${formatTimeInUruguay(rollCall.opensAt)}`
    case 'OPEN':
      return 'Lista abierta, sin pasar'
    default:
      return 'Lista sin pasar'
  }
}

export function dayRollCallChipClass(phase: RollCallPhase): string {
  switch (phase) {
    case 'TAKEN':
      return 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100'
    case 'OPEN':
      return 'bg-sky-50 text-sky-800 ring-1 ring-sky-100'
    case 'OVERDUE':
      return 'bg-amber-50 text-amber-900 ring-1 ring-amber-200'
    default:
      return 'bg-slate-50 text-slate-600 ring-1 ring-slate-200'
  }
}

/**
 * "Listas pasadas X de Y" del día: cuenta cada clase una vez (una suplencia aparece dos veces en
 * el resumen) y sólo las que ya abrieron.
 */
export function dayRollCallTally(rollCalls: readonly (DayRollCall | null | undefined)[], now = new Date()) {
  const seen = new Map<string, DayRollCall>()
  for (const rollCall of rollCalls) {
    if (rollCall) seen.set(`${rollCall.eventId}|${rollCall.ymd}`, rollCall)
  }
  const opened = [...seen.values()].filter((rollCall) => dayRollCallPhase(rollCall, now) !== 'UPCOMING')
  return { taken: opened.filter((rollCall) => rollCall.status === 'TAKEN').length, opened: opened.length }
}

/** "3.º B · Científico": el grupo es lo primero que el docente reconoce de una clase. */
export function classGroupLabel(course: string | null, orientation: string | null): string {
  return [course, orientation].filter(Boolean).join(' · ') || 'Sin grupo'
}

/** "Jueves 9 de octubre" a partir de un día civil YYYY-MM-DD. */
export function formatRollCallDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  // Mediodía UTC cae el mismo día en Uruguay: evita bordes por huso. Algunos ICU devuelven el mes
  // suelto en mayúscula ("Octubre"); en una fecha corrida va en minúscula.
  const month = new Intl.DateTimeFormat('es-UY', { timeZone: APP_TIMEZONE, month: 'long' })
    .format(new Date(Date.UTC(y, m - 1, d, 15, 0, 0)))
    .toLocaleLowerCase('es')
  return `${weekdayNameEs(ymd)} ${d} de ${month}`
}

export type PersonRef = { id: string; name: string }

/**
 * Quién da la clase, contado desde quien mira:
 * - suplente: "Suplencia: cubrís a Ana Pérez";
 * - titular cubierto: "La pasa Juan Gómez (suplencia)";
 * - administración (o quien no es titular): "Docente: Ana Pérez".
 * El titular que da su propia clase no necesita línea.
 */
export function classTeacherLine(params: {
  meId: string | null | undefined
  teacher: PersonRef | null
  substitute: PersonRef | null
}): string | null {
  const { meId, teacher, substitute } = params
  if (substitute && substitute.id === meId) return teacher ? `Suplencia: cubrís a ${teacher.name}` : 'Suplencia'
  if (substitute) {
    return teacher?.id === meId
      ? `La pasa ${substitute.name} (suplencia)`
      : `Docente: ${substitute.name}, suplente${teacher ? ` de ${teacher.name}` : ''}`
  }
  if (teacher && teacher.id !== meId) return `Docente: ${teacher.name}`
  return null
}
