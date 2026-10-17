'use client'

import { useState } from 'react'
import { useLibreta } from '@/contexts/LibretaContext'
import StudentGrid from '@/components/libreta/StudentGrid'
import StudentSheet from '@/components/libreta/StudentSheet'
import type { StudentBadgeFocus } from '@/components/libreta/StudentBadges'
import ExportButtons from '@/components/gradebook/ExportButtons'

/** Portada de la libreta: lista del grupo (las secciones ya están en el menú izquierdo). */
export default function LibretaHomePage() {
  const { gradeBookId, detail } = useLibreta()
  const [openStudent, setOpenStudent] = useState<{
    studentId: string
    focus?: StudentBadgeFocus
  } | null>(null)
  if (!detail) return null

  return (
    <div className="space-y-4">
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Lista del grupo</h2>
          <p className="mt-1 text-sm text-slate-500">
            Abrí la ficha de un estudiante para consultar sus datos y adecuaciones, o entrá a sus evaluaciones.
          </p>
        </div>
        <StudentGrid
          gradeBookId={gradeBookId}
          students={detail.students}
          onOpenStudent={(studentId, focus) => setOpenStudent({ studentId, focus })}
        />
      </section>

      {/* Exportar es la libreta entera del titular: el suplente no la exporta. */}
      {!detail.access.ownWorkOnly && <ExportButtons gradeBookId={gradeBookId} />}

      {openStudent && (
        <StudentSheet
          gradeBookId={gradeBookId}
          studentId={openStudent.studentId}
          focusSection={openStudent.focus}
          onClose={() => setOpenStudent(null)}
        />
      )}
    </div>
  )
}
