'use client'

import { Check } from 'lucide-react'

export const REGISTER_STEPS = ['Tus datos', 'Verificación', 'Revisión'] as const

/** Indicador de progreso del alta. `current` es 0-based. */
export default function RegisterStepper({ current }: { current: number }) {
  return (
    <nav aria-label="Progreso del registro" className="mb-8">
      <ol className="flex items-center gap-2">
        {REGISTER_STEPS.map((label, index) => {
          const done = index < current
          const active = index === current
          return (
            <li key={label} className="flex flex-1 items-center gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                    done
                      ? 'bg-emerald-600 text-white'
                      : active
                        ? 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-500'
                        : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  {done ? <Check className="h-4 w-4" /> : index + 1}
                </span>
                <span
                  className={`truncate text-sm ${active ? 'font-semibold text-gray-900' : 'text-gray-500'}`}
                  aria-current={active ? 'step' : undefined}
                >
                  {label}
                  <span className="sr-only">
                    {done ? ' (completado)' : active ? ' (paso actual)' : ' (pendiente)'}
                  </span>
                </span>
              </div>
              {index < REGISTER_STEPS.length - 1 ? (
                <span
                  aria-hidden
                  className={`hidden h-px flex-1 sm:block ${done ? 'bg-emerald-500' : 'bg-gray-200'}`}
                />
              ) : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
