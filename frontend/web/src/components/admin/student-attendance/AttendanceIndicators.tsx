'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { StreaksTab, ThresholdsTab } from '@/components/admin/student-reports/ReportTabs'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/auth/permissions'

export default function AttendanceIndicators() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const canRead = hasPermission(useOptionalAuth()?.me, 'student-attendance.read', 'all')
  const active = params?.get('tab') === 'faltas' ? 'faltas' : 'seguidas'
  return (
    <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-600">Alertas del ciclo para detectar quién necesita seguimiento. Abrí al estudiante para consultar sus faltas y registrar una licencia o justificativo.</p>
        {canRead && <Link href="/admin/student-attendance" className="text-sm font-medium text-emerald-700 hover:underline">Ir a asistencia por estudiante →</Link>}
      </div>
      <div role="tablist" aria-label="Indicadores de asistencia de estudiantes" data-tour="attendance-indicators.tabs" className="flex flex-wrap gap-1 border-b border-slate-200">
        {([{ id: 'seguidas', label: 'Faltas seguidas' }, { id: 'faltas', label: '18 y 25 faltas' }] as const).map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={active === tab.id} onClick={() => {
          const next = new URLSearchParams(params?.toString())
          next.set('tab', tab.id)
          router.replace(`${pathname}?${next}`, { scroll: false })
        }} className={`border-b-2 px-3 py-2 text-sm font-medium ${active === tab.id ? 'border-emerald-600 text-emerald-800' : 'border-transparent text-slate-600'}`}>{tab.label}</button>)}
      </div>
      <div role="tabpanel" aria-label={active === 'seguidas' ? 'Faltas seguidas' : '18 y 25 faltas'} data-tour="attendance-indicators.list">{active === 'seguidas' ? <StreaksTab /> : <ThresholdsTab />}</div>
    </section>
  )
}
