'use client'

import { AlertCircle, Check } from 'lucide-react'

/**
 * Campo de formulario con la obligatoriedad visible y el error al lado del input.
 *
 * El asterisco va acompañado de texto para lectores de pantalla (`aria-hidden` en el
 * símbolo + "obligatorio" en `sr-only`): el color y el símbolo solos no comunican nada
 * a quien no ve la pantalla.
 */
export default function FormField({
  id,
  label,
  required = false,
  error,
  hint,
  valid = false,
  children,
  className = '',
}: {
  id: string
  label: string
  required?: boolean
  /** Mensaje a mostrar; se asume ya filtrado por "campo tocado". */
  error?: string
  hint?: string
  /** Muestra el tilde de campo correcto (solo cuando el usuario ya escribió algo). */
  valid?: boolean
  children: React.ReactNode
  className?: string
}) {
  const errorId = `${id}-error`
  const hintId = `${id}-hint`

  return (
    <div className={className}>
      <label htmlFor={id} className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-700">
        <span>{label}</span>
        {required ? (
          <>
            <span aria-hidden className="text-red-500">
              *
            </span>
            <span className="sr-only">(obligatorio)</span>
          </>
        ) : (
          <span className="text-xs font-normal text-gray-400">(opcional)</span>
        )}
        {valid && !error ? <Check className="h-4 w-4 text-emerald-600" aria-hidden /> : null}
      </label>

      {children}

      {hint && !error ? (
        <p id={hintId} className="mt-1 text-xs text-gray-500">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="mt-1 flex items-start gap-1.5 text-sm text-red-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  )
}

/** Clases del input según su estado de validación. */
export function fieldInputClass(base: string, error?: string, valid?: boolean): string {
  if (error) return `${base} border-red-300 focus:border-red-500 focus:ring-red-200`
  if (valid) return `${base} border-emerald-300`
  return base
}
