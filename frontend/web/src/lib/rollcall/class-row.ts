import type { BlockedReason } from './rollcall-window'
import type { SessionStatus } from './rollcall-status'
import type { PersonRef, RollCallTiming } from './rollcall-phase'

/** Una clase de un día con su pase de lista, como la devuelven `my-classes` y `reminder`. */
export type RollCallClassRow = {
  eventId: string
  ymd: string
  title: string
  subject: string | null
  course: string | null
  orientation: string | null
  startAt: string
  endAt: string
  /** Titular de la clase. */
  teacher: PersonRef | null
  /** Quien la cubre ese día, si hay suplencia. */
  substitute: PersonRef | null
  /** Quien mira es el suplente. */
  isSubstitution: boolean
  nonWorkingDay: string | null
  rollCall: {
    sessionId: string | null
    status: SessionStatus
    takenAt: string | null
    takenBy: string | null
    rosterSize: number | null
    canEdit: boolean
    blockedReason: BlockedReason
    opensAt: string
    editableUntil: string | null
  }
}

export function timingOf(row: Pick<RollCallClassRow, 'endAt' | 'rollCall'>): RollCallTiming {
  return {
    status: row.rollCall.status,
    blockedReason: row.rollCall.blockedReason,
    opensAt: row.rollCall.opensAt,
    endAt: row.endAt,
    editableUntil: row.rollCall.editableUntil,
    takenAt: row.rollCall.takenAt,
  }
}

/** La planilla de una clase: siempre `eventId` y día por separado, nunca el id compuesto. */
export function rollCallHref(row: { eventId: string; ymd: string }): string {
  return `/me/roll-call/${row.eventId}/${row.ymd}`
}

/** Evento que dispara la planilla al guardar, para que el aviso de arriba se actualice. */
export const ROLL_CALL_SAVED_EVENT = 'edutrack:rollcall-saved'
