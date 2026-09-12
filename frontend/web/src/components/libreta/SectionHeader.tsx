'use client'

import { sectionById, type LibretaSectionId } from '@/lib/libreta/menu'

/** Encabezado de sección: repite qué se hace acá, para no depender de recordar el menú. */
export default function SectionHeader({ id }: { id: LibretaSectionId }) {
  const section = sectionById(id)
  if (!section) return null
  return (
    <header className="mb-3">
      <h2 className="text-base font-semibold text-gray-900">{section.label}</h2>
      <p className="text-sm text-gray-600">{section.hint}</p>
    </header>
  )
}
