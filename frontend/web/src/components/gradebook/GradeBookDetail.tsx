'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Archive, ArrowLeft, Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { gradeBookTitle, studentFullName } from '@/lib/gradebook/labels'
import { ACCESS_LABELS, type GradeBookDetail as Detail } from '@/lib/gradebook/types'
import AssessmentsPanel from './AssessmentsPanel'
import PeriodsSection from './PeriodsSection'
import MessagesPanel from './MessagesPanel'
import ExportButtons from './ExportButtons'

function HeaderField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="text-sm font-medium text-gray-900">{value}</dd>
    </div>
  )
}

/** Encabezado de la libreta (RF-021). */
function Header({ detail }: { detail: Detail }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <HeaderField label="Ciclo lectivo" value={detail.schoolYear.label} />
        <HeaderField label="Curso" value={detail.course.name} />
        <HeaderField label="Orientación" value={detail.orientation ?? 'Tronco común'} />
        <HeaderField label="Asignatura" value={detail.subject.name} />
        <HeaderField label="Docente" value={detail.teacher?.name ?? 'Sin titular asignado'} />
        <HeaderField label="Estudiantes" value={String(detail.studentCount)} />
        <HeaderField label="Tu rol en la libreta" value={ACCESS_LABELS[detail.access.level]} />
        <HeaderField
          label="Estado"
          value={detail.status === 'ACTIVE' ? 'Abierta' : 'Ciclo cerrado · sólo lectura'}
        />
      </dl>
    </section>
  )
}

/** Lista del grupo (RF-030). */
function Roster({ detail }: { detail: Detail }) {
  if (detail.students.length === 0) {
    return (
      <p className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500">
        El grupo no tiene estudiantes matriculados en este ciclo.
      </p>
    )
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <header className="border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Lista del grupo</h2>
        <p className="text-xs text-gray-500">
          Matrículas activas del ciclo. Las altas y bajas se reflejan solas; el historial de lo ya
          cargado no se toca.
        </p>
      </header>
      <ol className="divide-y divide-gray-100">
        {detail.students.map((student, index) => (
          <li key={student.studentId} className="flex items-baseline gap-3 px-4 py-2">
            <span className="w-6 shrink-0 text-right text-xs text-gray-400">{index + 1}</span>
            <span className="text-sm text-gray-900">{studentFullName(student)}</span>
            {student.documentId && (
              <span className="ml-auto font-mono text-xs text-gray-500">{student.documentId}</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

export default function GradeBookDetail({ gradeBookId }: { gradeBookId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setDetail(await api<Detail>(`/gradebook/${gradeBookId}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la libreta')
    } finally {
      setLoading(false)
    }
  }, [gradeBookId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando libreta…
      </p>
    )
  }

  if (error || !detail) {
    return (
      <div className="space-y-3">
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error ?? 'No se pudo cargar la libreta'}
        </p>
        <Link href="/me/gradebook" className="inline-flex items-center gap-1 text-sm text-emerald-700 hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Volver a mis libretas
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/me/gradebook" className="inline-flex items-center gap-1 text-sm text-emerald-700 hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Mis libretas
        </Link>
        <p className="text-sm text-gray-600">{gradeBookTitle(detail)}</p>
      </div>

      {detail.status === 'ARCHIVED' && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <Archive className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Ciclo lectivo cerrado. La libreta pasó a histórico: se consulta y se exporta, pero no
          admite cambios. Para modificarla hay que reabrir el ciclo desde administración.
        </p>
      )}

      <Header detail={detail} />
      <ExportButtons gradeBookId={detail.id} />
      <AssessmentsPanel gradeBookId={detail.id} canGrade={detail.access.canGrade} />
      <PeriodsSection gradeBookId={detail.id} decimals={0} />
      <MessagesPanel gradeBookId={detail.id} readOnly={detail.status === 'ARCHIVED'} />
      <Roster detail={detail} />
    </div>
  )
}
