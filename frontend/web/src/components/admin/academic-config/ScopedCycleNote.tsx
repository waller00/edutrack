'use client'

import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'

export default function ScopedCycleNote() {
  const schoolYear = useOptionalAdminSchoolYear()
  const id = schoolYear?.selectedId ?? schoolYear?.activeId
  const year = schoolYear?.years.find((item) => item.id === id)
  return (
    <p className="text-xs text-slate-500">
      {year
        ? `Ciclo lectivo: ${year.code}`
        : 'Se aplica al ciclo lectivo seleccionado.'}
      {schoolYear?.allYears &&
        ' · Esta sección usa el ciclo activo, incluso al ver todos los ciclos.'}
    </p>
  )
}
