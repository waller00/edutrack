'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, ArrowRight, Plus, Search, UserRound } from 'lucide-react'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/auth/permissions'
import { useReport } from '@/components/admin/student-reports/shared'
import ScrollRegion from '@/components/common/ScrollRegion'
import StudentAttendanceRecord from './StudentAttendanceRecord'
import type { RangeStudent } from './JustificationRangesPanel'

type Directory = { data: RangeStudent[]; total: number; page: number; pageSize: number }

export default function StudentAttendanceWorkspace() {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const year = useOptionalAdminSchoolYear()?.schoolYearScopedQuery ?? ''
  const canJustify = hasPermission(useOptionalAuth()?.me, 'student-attendance.justify', 'all')
  const studentId = params?.get('studentId') ?? ''
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<RangeStudent | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => { setTerm(q.trim()); setPage(1) }, 250)
    return () => clearTimeout(timer)
  }, [q])
  useEffect(() => { setPage(1) }, [year])
  const query = new URLSearchParams({ q: term, page: String(page) })
  const path = studentId ? null : withSchoolYear(`/admin/student-attendance/students?${query}`, year)
  const { data, loading, error } = useReport<Directory>(path)

  function openStudent(student: RangeStudent, add = false) {
    setSelected(student)
    const next = new URLSearchParams(params?.toString())
    next.set('studentId', student.id)
    next.delete('tab')
    if (add) next.set('action', 'justificar')
    else next.delete('action')
    router.push(`${pathname}?${next}`)
  }

  if (studentId) return (
    <div className="space-y-4">
      <button type="button" className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:underline" onClick={() => {
        const next = new URLSearchParams(params?.toString())
        next.delete('studentId'); next.delete('action')
        router.push(`${pathname}${next.size ? `?${next}` : ''}`)
      }}><ArrowLeft className="h-4 w-4" aria-hidden /> Todos los estudiantes</button>
      <StudentAttendanceRecord key={`${studentId}:${year}`} studentId={studentId} student={selected?.id === studentId ? selected : null} initiallyAdding={params?.get('action') === 'justificar'} />
    </div>
  )

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Asistencia por estudiante</h2>
          <p className="mt-1 text-sm text-slate-600">Buscá al estudiante para ver sus faltas, llegadas tarde y licencias o justificativos.</p>
        </div>
        {canJustify && <Link href="/admin/student-attendance?tab=justificaciones" className="btn-primary inline-flex items-center gap-2 text-sm"><Plus className="h-4 w-4" aria-hidden /> Agregar licencia o justificativo</Link>}
      </div>
      <label className="block max-w-xl text-sm font-medium text-slate-700">
        Buscar estudiante o curso{' '}
        <span className="relative mt-1 block">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" aria-hidden />
          <input className="input-field w-full pl-9" value={q} maxLength={80} onChange={(event) => setQ(event.target.value)} placeholder="Nombre, apellido, documento o curso" />
        </span>
      </label>
      {loading && <p role="status" className="text-sm text-slate-500">Cargando estudiantes…</p>}
      {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {!loading && !error && data?.data.length === 0 && <p className="py-8 text-center text-sm text-slate-500">{term ? 'No se encontraron estudiantes con esa búsqueda.' : 'No hay estudiantes matriculados en este ciclo.'}</p>}
      {!loading && !error && data && data.data.length > 0 && <>
        <ScrollRegion label="Estudiantes y acceso a su asistencia" className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="block w-full text-left text-sm sm:table">
            <thead className="hidden bg-slate-50 text-xs font-semibold uppercase text-slate-500 sm:table-header-group"><tr><th className="px-3 py-3">Estudiante</th><th className="px-3 py-3">Curso</th><th className="px-3 py-3">Acciones</th></tr></thead>
            <tbody className="block divide-y divide-slate-100 sm:table-row-group">{data.data.map((student) => <tr key={student.id} className="block py-2 hover:bg-slate-50/70 sm:table-row sm:py-0">
              <td className="block px-3 py-2 sm:table-cell sm:py-3"><button type="button" onClick={() => openStudent(student)} className="flex items-center gap-2 font-semibold text-emerald-800 hover:underline"><UserRound className="h-4 w-4 shrink-0" aria-hidden />{student.lastName}, {student.firstName}</button><p className="mt-1 pl-6 text-xs text-slate-500">{student.documentId || 'Sin documento registrado'}</p></td>
              <td className="block px-3 py-1 text-slate-600 sm:table-cell sm:py-3"><span className="sm:hidden">Curso: </span>{student.courseName || 'Sin curso'}</td>
              <td className="block px-3 py-2 sm:table-cell sm:py-3"><div className="flex flex-wrap gap-3"><button type="button" onClick={() => openStudent(student)} className="inline-flex items-center gap-1 py-1 font-medium text-emerald-700 hover:underline" aria-label={`Ver asistencia de ${student.firstName} ${student.lastName}`}>Ver asistencia<ArrowRight className="h-3.5 w-3.5" aria-hidden /></button>{canJustify && <button type="button" onClick={() => openStudent(student, true)} className="inline-flex items-center gap-1 py-1 font-medium text-emerald-700 hover:underline" aria-label={`Agregar licencia a ${student.firstName} ${student.lastName}`}><Plus className="h-3.5 w-3.5" aria-hidden />Licencia / justificativo</button>}</div></td>
            </tr>)}</tbody>
          </table>
        </ScrollRegion>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
          <span>{data.total} estudiante{data.total === 1 ? '' : 's'} · Página {page}</span>
          <div className="flex gap-2"><button type="button" className="btn-secondary text-sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</button><button type="button" className="btn-secondary text-sm" disabled={page * data.pageSize >= data.total} onClick={() => setPage((value) => value + 1)}>Siguiente</button></div>
        </div>
      </>}
    </section>
  )
}
