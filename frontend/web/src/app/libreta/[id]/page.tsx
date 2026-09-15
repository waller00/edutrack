'use client'

import { useState } from 'react'
import { useLibreta } from '@/contexts/LibretaContext'
import StudentGrid from '@/components/libreta/StudentGrid'
import StudentSheet from '@/components/libreta/StudentSheet'
import ExportButtons from '@/components/gradebook/ExportButtons'

/** Portada de la libreta: lista del grupo (las secciones ya están en el menú izquierdo). */
export default function LibretaHomePage() {
  const { gradeBookId, detail } = useLibreta()
  const [openStudentId, setOpenStudentId] = useState<string | null>(null)
  if (!detail) return null

  return (
    <div className="space-y-4">
      <section>
        <h2 className="mb-1 text-sm font-semibold text-gray-900">Lista del grupo</h2>
        <p className="mb-2 text-xs text-gray-500">
          Tocá un estudiante para ver su hoja: datos, materias que arrastra y adecuaciones a tener en
          cuenta al calificar.
        </p>
        <StudentGrid
          gradeBookId={gradeBookId}
          students={detail.students}
          onOpenStudent={setOpenStudentId}
        />
      </section>

      <ExportButtons gradeBookId={gradeBookId} />

      {openStudentId && (
        <StudentSheet
          gradeBookId={gradeBookId}
          studentId={openStudentId}
          onClose={() => setOpenStudentId(null)}
        />
      )}
    </div>
  )
}
