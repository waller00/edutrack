import type { Prisma } from '@prisma/client'

export type QueryAssistantScope = {
  schoolYearId?: string
  schoolYearCode?: number
  allYears?: boolean
}

export function eventSchoolYearWhere(scope?: QueryAssistantScope): Prisma.EventWhereInput {
  if (!scope?.schoolYearId || scope.allYears) return {}
  return { schoolYearId: scope.schoolYearId }
}

export function relatedEventSchoolYearWhere(scope?: QueryAssistantScope): { event?: Prisma.EventWhereInput } {
  const event = eventSchoolYearWhere(scope)
  return Object.keys(event).length > 0 ? { event } : {}
}

export function schoolYearSummarySuffix(scope?: QueryAssistantScope): string {
  if (scope?.allYears) return ' (todos los ciclos lectivos)'
  if (scope?.schoolYearId) return ' (ciclo lectivo seleccionado)'
  return ''
}
