'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Loader2 } from 'lucide-react'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/auth/permissions'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import type { IndicatorAccess, indicatorPaths } from '@/lib/admin/student-indicators-sections'
import type { AttendanceStudent } from '@/lib/admin/student-indicators'
import type { ReportCardPeriod } from '@/lib/gradebook/report-card-periods'
import { studentName, Table } from '@/components/admin/student-reports/shared'
import type { IndicatorData } from './indicator-data'

export { studentName, Table }

/** Lo que comparte cada sección: quién mira, el ciclo y el boletín de referencia. */
export type IndicatorContext = {
  access: IndicatorAccess
  /** `schoolYearId=…` del selector del menú (vacío: el ciclo activo). */
  query: string
  /** El boletín elegido; `null` si el ciclo todavía no tiene. */
  period: ReportCardPeriod | null
  /** Ya se sabe qué boletines tiene el ciclo. */
  periodsReady: boolean
  /** Los ciclos del selector, para comparar año contra año. */
  schoolYearIds: string
  /** De dónde sale cada número (`null` mientras falta el ciclo o el boletín). */
  paths: ReturnType<typeof indicatorPaths>
  /** Abre otra sección con sus parámetros (`?seccion=riesgo&motivo=faltas`). */
  sectionHref: (params: Record<string, string>) => string
}

/** Un bloque de la sección, con su título y qué cuenta. */
export function Panel({
  title,
  description,
  children,
  actions,
  tour,
}: Readonly<{ title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode; tour?: string }>) {
  return (
    <section data-tour={tour} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {description && <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">{description}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  )
}

/**
 * Mientras no hay datos: "Calculando…" o el error con "Reintentar". Con datos (aunque se estén
 * actualizando) no dibuja nada y se sigue mostrando lo anterior.
 */
export function LoadState({ state, what }: Readonly<{ state: IndicatorData<unknown>; what: string }>) {
  if (state.error) {
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        No se pudo calcular {what}. {state.error}
        <button type="button" className="ml-2 font-semibold underline" onClick={state.retry}>
          Reintentar
        </button>
      </div>
    )
  }
  if (!state.data) {
    return (
      <p role="status" className="flex items-center gap-2 py-6 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Calculando {what}…
      </p>
    )
  }
  return null
}

export function EmptyNote({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">{children}</p>
}

/** El nombre abre la ficha de asistencia del estudiante, si quien mira puede verla. */
export function StudentName({ student, query }: Readonly<{ student: AttendanceStudent; query: string }>) {
  const canRead = hasPermission(useOptionalAuth()?.me, 'student-attendance.read', 'all')
  if (!canRead) return <span className="font-medium text-slate-900">{studentName(student)}</span>
  return (
    <Link
      href={withSchoolYear(`/admin/student-attendance?studentId=${encodeURIComponent(student.studentId)}`, query)}
      className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline"
      title="Ver la asistencia del estudiante"
    >
      {studentName(student)}
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
    </Link>
  )
}

/**
 * Una gráfica nunca es la única lectura: tiene nombre, una descripción para lectores de pantalla y
 * su tabla en "Ver datos de la gráfica".
 */
export function ChartFrame({
  label,
  description,
  height,
  children,
  table,
}: Readonly<{ label: string; description: string; height: number; children: ReactNode; table: ReactNode }>) {
  return (
    <div className="space-y-2">
      <div role="img" aria-label={label} className="w-full" style={{ height }}>
        {children}
      </div>
      <p className="sr-only">{description}</p>
      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer font-medium">Ver datos de la gráfica</summary>
        <div className="mt-2">{table}</div>
      </details>
    </div>
  )
}
