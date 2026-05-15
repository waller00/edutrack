'use client'

import RoleGuard from '@/components/RoleGuard'
import { useAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { api } from '@/lib/api'
import { useState } from 'react'
import { Loader2 } from 'lucide-react'

type ComparePayload = {
  a: {
    id: string
    code: number
    label: string
    studentsTotal: number
    coursesCount: number
    studentsByStatus: Record<string, number>
  }
  b: {
    id: string
    code: number
    label: string
    studentsTotal: number
    coursesCount: number
    studentsByStatus: Record<string, number>
  }
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Activo',
  WITHDRAWN: 'Abandonó',
  GRADUATED: 'Egresó',
  TRANSFERRED: 'Transferido',
}

export default function CompareSchoolYearsPage() {
  const { years } = useAdminSchoolYear()
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [data, setData] = useState<ComparePayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function loadCompare() {
    setErr('')
    setData(null)
    if (!a || !b || a === b) {
      setErr('Elegí dos ciclos distintos.')
      return
    }
    setLoading(true)
    try {
      const r = await api<ComparePayload>(`/admin/school-years/compare-metrics?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`)
      setData(r)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo cargar la comparación')
    } finally {
      setLoading(false)
    }
  }

  return (
    <RoleGuard allow={['ADMIN']}>
      <main className="mx-auto max-w-4xl p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-950">Comparar ciclos lectivos</h1>
          <p className="text-sm text-gray-600 mt-1">
            Totales de estudiantes (por estado de matrícula) y cantidad de cursos catalogados por ciclo. Los datos
            operativos (eventos, asistencias) se filtran en cada módulo según el selector global.
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Ciclo A</label>
            <select className="rounded-lg border border-gray-200 px-3 py-2 text-sm min-w-[220px]" value={a} onChange={(e) => setA(e.target.value)}>
              <option value="">—</option>
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.code} — {y.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Ciclo B</label>
            <select className="rounded-lg border border-gray-200 px-3 py-2 text-sm min-w-[220px]" value={b} onChange={(e) => setB(e.target.value)}>
              <option value="">—</option>
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.code} — {y.label}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={loading} onClick={() => void loadCompare()}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Comparar
          </button>
        </div>

        {err && <p className="text-sm text-red-600">{err}</p>}

        {data && (
          <div className="grid gap-4 md:grid-cols-2">
            {[data.a, data.b].map((side) => (
              <div key={side.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
                <h2 className="font-semibold text-gray-900">
                  {side.code} — {side.label}
                </h2>
                <p className="text-sm text-gray-600">
                  Estudiantes: <strong>{side.studentsTotal}</strong> · Cursos: <strong>{side.coursesCount}</strong>
                </p>
                <ul className="text-sm space-y-1">
                  {Object.entries(side.studentsByStatus).map(([k, v]) => (
                    <li key={k} className="flex justify-between gap-2">
                      <span>{STATUS_LABEL[k] ?? k}</span>
                      <span className="font-medium">{v}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </main>
    </RoleGuard>
  )
}
