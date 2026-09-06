import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db/prisma.js'
import { resolveMoodleAcademicScope } from '../../integrations/moodle/scope.js'

/**
 * Generación automática de libretas (RF-020).
 *
 * EduTrack no tiene una tabla de "asignación docente": quién dicta qué a quién sólo existe en los
 * eventos de clase. Así que la libreta se deriva de ahí, agrupando los eventos por su scope
 * académico — la misma clave que ya usa la integración Moodle, de modo que libreta y curso Moodle
 * son la misma cosa vista desde dos lados.
 *
 * Es idempotente: correrlo de nuevo actualiza el titular y no duplica nada.
 */

export type ProvisionSummary = {
  schoolYearId: string
  created: number
  updated: number
  /** Eventos de clase que no pudieron mapearse (sin asignatura o sin oferta). */
  skippedEvents: number
  /** Scopes descartados porque el curso no está ofertado ese ciclo. */
  skippedNotOffered: number
}

type ClassEvent = {
  id: string
  revisionOf: string | null
  assignedUserId: string | null
  userId: string
  schoolYearId: string
  courseOfferingId: string | null
  subjectId: string | null
  orientationId: string | null
  courseOrientationId: string | null
  startDate: Date
}

type ScopeGroup = {
  scopeKey: string
  schoolYearId: string
  courseOfferingId: string
  subjectId: string
  orientationId: string | null
  courseOrientationId: string | null
  teacherUserId: string | null
  /** Inicio del evento más reciente del grupo: define qué titular gana. */
  latestStart: number
}

/**
 * Identidad estable de una serie de eventos. Editar una serie crea una versión nueva, así que sin
 * esto el mismo horario contaría varias veces al elegir el titular vigente.
 */
export function eventFamilyId(event: { id: string; revisionOf: string | null }): string {
  return event.revisionOf ?? event.id
}

/**
 * Agrupa los eventos por scope académico y elige el titular.
 *
 * Gana el docente del evento **más reciente** del scope: si a mitad de año cambia el profesor de
 * una asignatura, la libreta pasa a nombre del nuevo sin perder lo ya cargado. Una sola versión
 * por serie (`eventFamilyId`) entra en la comparación.
 */
export function groupEventsByScope(events: readonly ClassEvent[]): {
  groups: Map<string, ScopeGroup>
  /** Eventos que no identifican una libreta (sin oferta o sin asignatura). */
  skipped: number
} {
  const groups = new Map<string, ScopeGroup>()
  const seenFamilies = new Map<string, Set<string>>()
  let skipped = 0

  for (const event of events) {
    const scope = resolveMoodleAcademicScope({
      schoolYearId: event.schoolYearId,
      courseOfferingId: event.courseOfferingId,
      subjectId: event.subjectId,
      orientationId: event.orientationId,
      courseOrientationId: event.courseOrientationId,
    })
    // Sin oferta o sin asignatura el evento no identifica una libreta (una reunión, un turno).
    if (!scope) {
      skipped++
      continue
    }

    const family = eventFamilyId(event)
    const families = seenFamilies.get(scope.key) ?? new Set<string>()
    const isNewFamily = !families.has(family)
    families.add(family)
    seenFamilies.set(scope.key, families)

    const teacherUserId = event.assignedUserId ?? null
    const start = event.startDate.getTime()
    const existing = groups.get(scope.key)

    if (!existing) {
      groups.set(scope.key, {
        scopeKey: scope.key,
        schoolYearId: scope.schoolYearId,
        courseOfferingId: scope.courseOfferingId,
        subjectId: scope.subjectId,
        orientationId: scope.orientationId,
        courseOrientationId: scope.courseOrientationId,
        teacherUserId,
        latestStart: start,
      })
      continue
    }

    if (isNewFamily && start > existing.latestStart && teacherUserId) {
      existing.teacherUserId = teacherUserId
      existing.latestStart = start
    }
  }

  return { groups, skipped }
}

/** Eventos de clase del ciclo que pueden originar una libreta. */
async function loadClassEvents(db: PrismaClient, schoolYearId: string): Promise<ClassEvent[]> {
  return db.event.findMany({
    where: {
      schoolYearId,
      type: 'CLASE',
      status: { not: 'CANCELLED' },
      // Las excepciones puntuales de una serie no aportan scope propio.
      parentEventId: null,
      courseOfferingId: { not: null },
      subjectId: { not: null },
    },
    select: {
      id: true,
      revisionOf: true,
      assignedUserId: true,
      userId: true,
      schoolYearId: true,
      courseOfferingId: true,
      subjectId: true,
      orientationId: true,
      courseOrientationId: true,
      startDate: true,
    },
  }) as unknown as Promise<ClassEvent[]>
}

/**
 * Ofertas vigentes del ciclo. Un curso que dejó de ofertarse (por ejemplo 2.º EMS en 2026) no
 * genera libretas aunque hayan quedado eventos viejos apuntándole. Se consulta en una sola query
 * y no una por scope.
 */
async function loadOfferedIds(db: PrismaClient, schoolYearId: string): Promise<Set<string>> {
  const rows = await db.courseOffering.findMany({
    where: {
      schoolYearId,
      isActive: true,
      isOffered: true,
      visibleInFilters: true,
      course: { isActive: true },
    },
    select: { id: true },
  })
  return new Set(rows.map((row) => row.id))
}

export async function provisionGradeBooks(
  schoolYearId: string,
  db: PrismaClient = defaultPrisma,
): Promise<ProvisionSummary> {
  const events = await loadClassEvents(db, schoolYearId)
  const { groups, skipped } = groupEventsByScope(events)
  const offered = await loadOfferedIds(db, schoolYearId)

  const summary: ProvisionSummary = {
    schoolYearId,
    created: 0,
    updated: 0,
    skippedEvents: skipped,
    skippedNotOffered: 0,
  }

  for (const group of groups.values()) {
    if (!offered.has(group.courseOfferingId)) {
      summary.skippedNotOffered++
      continue
    }

    const existing = await db.gradeBook.findUnique({
      where: { scopeKey: group.scopeKey },
      select: { id: true },
    })

    if (existing) {
      await db.gradeBook.update({
        where: { id: existing.id },
        // Sólo el titular se refresca. El resto de la identidad está en `scopeKey` y no cambia,
        // y `status` puede haberlo puesto el cierre de año: el provisioning no lo revive.
        data: { teacherUserId: group.teacherUserId },
      })
      summary.updated++
      continue
    }

    await db.gradeBook.create({
      data: {
        scopeKey: group.scopeKey,
        schoolYearId: group.schoolYearId,
        courseOfferingId: group.courseOfferingId,
        subjectId: group.subjectId,
        orientationId: group.orientationId,
        courseOrientationId: group.courseOrientationId,
        teacherUserId: group.teacherUserId,
      },
    })
    summary.created++
  }

  return summary
}
