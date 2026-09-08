'use client'

import Link from 'next/link'
import { useLibreta } from '@/contexts/LibretaContext'
import StudentGrid from '@/components/libreta/StudentGrid'
import ExportButtons from '@/components/gradebook/ExportButtons'
import { LIBRETA_SECTIONS, sectionHref } from '@/lib/libreta/menu'

/** Portada de la libreta: el grupo y los accesos rápidos a cada sección. */
export default function LibretaHomePage() {
  const { gradeBookId, detail } = useLibreta()
  if (!detail) return null

  return (
    <div className="space-y-4">
      <section>
        <h2 className="mb-1 text-sm font-semibold text-gray-900">Lista del grupo</h2>
        <p className="mb-2 text-xs text-gray-500">
          Matrículas activas del ciclo. Las altas y bajas se reflejan solas; lo ya cargado no se toca.
        </p>
        <StudentGrid students={detail.students} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">¿Qué querés hacer?</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {LIBRETA_SECTIONS.map((section) => (
            <li key={section.id}>
              <Link
                href={sectionHref(gradeBookId, section.id)}
                className="block rounded-lg border border-gray-200 bg-white p-3 transition hover:border-emerald-300 hover:shadow-sm"
              >
                <span className="block text-sm font-medium text-gray-900">{section.label}</span>
                <span className="block text-xs text-gray-500">{section.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <ExportButtons gradeBookId={gradeBookId} />
    </div>
  )
}
