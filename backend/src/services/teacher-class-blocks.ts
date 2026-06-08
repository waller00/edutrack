import { DateTime } from 'luxon'
import { APP_TIMEZONE, uruguayWallToUtc, uruguayYmdEndOfDayToUtc } from '../config/app-timezone.js'

export type ClassEventSlot = {
  id: string
  title: string
  type: string
  startTime: Date
  endTime: Date
}

/**
 * Agrupa clases correlativas del mismo día: mismo bloque si el hueco entre fin e inicio siguiente
 * es estrictamente menor a `bridgeGapMinutes`. Si gap >= umbral → nuevo bloque (exige nueva entrada).
 */
export function buildContiguousClassBlocks(slots: ClassEventSlot[], bridgeGapMinutes: number): ClassEventSlot[][] {
  if (slots.length === 0) return []
  const sorted = [...slots].sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
  const blocks: ClassEventSlot[][] = []
  let cur: ClassEventSlot[] = [sorted[0]!]
  for (let i = 1; i < sorted.length; i++) {
    const prev = cur[cur.length - 1]!
    const next = sorted[i]!
    const gapMin = (next.startTime.getTime() - prev.endTime.getTime()) / (1000 * 60)
    if (gapMin < bridgeGapMinutes) {
      cur.push(next)
    } else {
      blocks.push(cur)
      cur = [next]
    }
  }
  blocks.push(cur)
  return blocks
}

export function earlyEntryWindowMinutes(bridgeGapMinutes: number): number {
  return Math.min(240, Math.max(90, bridgeGapMinutes))
}

export function findBlockContainingInstant(
  at: Date,
  blocks: ClassEventSlot[][],
  earlyEntryMinutes: number,
): ClassEventSlot[] | null {
  for (const block of blocks) {
    const first = block[0]!
    const last = block[block.length - 1]!
    const winStart = new Date(first.startTime.getTime() - earlyEntryMinutes * 60 * 1000)
    if (at.getTime() >= winStart.getTime() && at.getTime() <= last.endTime.getTime()) {
      return block
    }
  }
  return null
}

/** Localiza el bloque que contiene un evento (p. ej. ancla de CHECK_IN abierto). */
export function findBlockContainingEventId(eventId: string, blocks: ClassEventSlot[][]): ClassEventSlot[] | null {
  for (const block of blocks) {
    if (block.some((e) => e.id === eventId)) return block
  }
  return null
}

export async function fetchTeacherClassSlotsForUruguayDay(tx: any, userId: string, at: Date): Promise<ClassEventSlot[]> {
  const ymd = DateTime.fromJSDate(at, { zone: 'utc' }).setZone(APP_TIMEZONE).toFormat('yyyy-MM-dd')
  const dayStart = uruguayWallToUtc(ymd, 0, 0)
  const dayEnd = uruguayYmdEndOfDayToUtc(ymd)
  const rows = await tx.event.findMany({
    where: {
      assignedUserId: userId,
      type: { in: ['CLASE', 'JORNADA_LABORAL', 'REUNION'] },
      status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
      startTime: { not: null },
      endTime: { not: null },
      AND: [{ startTime: { lte: dayEnd } }, { endTime: { gte: dayStart } }],
    },
    select: { id: true, title: true, type: true, startTime: true, endTime: true },
    orderBy: { startTime: 'asc' },
  })
  const substitutionRows = await tx.$queryRaw<
    { eventId: string; title: string; type: string; startTime: Date; endTime: Date }[]
  >`
    SELECT s."eventId", e."title", e."type"::text AS "type", s."startTime", s."endTime"
    FROM "Substitution" s
    JOIN "Event" e ON e."id" = s."eventId"
    WHERE s."substituteUserId" = ${userId}
      AND s."date" >= ${dayStart}
      AND s."date" <= ${dayEnd}
      AND e."type" IN ('CLASE'::"EventType", 'JORNADA_LABORAL'::"EventType", 'REUNION'::"EventType")
      AND e."status" IN ('SCHEDULED'::"EventStatus", 'IN_PROGRESS'::"EventStatus")
    ORDER BY s."startTime" ASC
  `

  return [
    ...rows.map((r: { id: string; title: string; type: string; startTime: Date; endTime: Date }) => ({
    id: r.id,
    title: r.title,
    type: r.type,
    startTime: new Date(r.startTime),
    endTime: new Date(r.endTime),
    })),
    ...substitutionRows.map((r) => ({
      id: r.eventId,
      title: `${r.title} (suplencia)`,
      type: r.type,
      startTime: new Date(r.startTime),
      endTime: new Date(r.endTime),
    })),
  ].sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
}
