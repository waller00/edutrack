'use client'

import { badgeFor } from '@/lib/libreta/badges'

export type StudentBadgeFocus = 'accommodations' | 'general' | 'pending' | 'exemptions'

/** Qué sección de la hoja abrir al tocar cada distintivo. */
export function focusForBadge(code: string): StudentBadgeFocus {
  switch (code.toUpperCase()) {
    case 'ADEC':
    case 'PEI':
    case 'INC':
      return 'accommodations'
    case 'GEN':
      return 'general'
    case 'PEND':
      return 'pending'
    case 'EXEN':
      return 'exemptions'
    default:
      return 'accommodations'
  }
}

/**
 * Chips ADEC / Gen / EXEN del Libro del Profesor.
 *
 * Cada chip lleva título (texto) además del color (RNF 7.2). Si `onSelect` viene, son botones
 * que abren la hoja del alumno en la sección correspondiente.
 */
export default function StudentBadges({
  codes,
  onSelect,
  className = '',
}: {
  codes: readonly string[] | undefined
  onSelect?: (code: string, focus: StudentBadgeFocus) => void
  className?: string
}) {
  if (!codes?.length) return null

  return (
    <ul className={`flex flex-wrap gap-1 ${className}`.trim()} aria-label="Distintivos del alumno">
      {codes.map((code) => {
        const badge = badgeFor(code)
        const focus = focusForBadge(code)
        const common =
          `inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badge.className}`
        if (onSelect) {
          return (
            <li key={code}>
              <button
                type="button"
                title={badge.label}
                aria-label={badge.label}
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect(code, focus)
                }}
                className={`${common} cursor-pointer hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500`}
              >
                {badge.code}
              </button>
            </li>
          )
        }
        return (
          <li key={code}>
            <span title={badge.label} className={common}>
              {badge.code}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
