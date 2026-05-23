'use client'

import { Eye, EyeOff } from 'lucide-react'

type Props = {
  visible: boolean
  onToggle: () => void
  /** Fragmento para aria-label, p. ej. "contraseña", "confirmación", "contraseña actual". */
  field?: string
}

export function PasswordVisibilityToggle({ visible, onToggle, field = 'contraseña' }: Props) {
  const hideLabel = `Ocultar ${field}`
  const showLabel = `Mostrar ${field}`

  return (
    <button
      type="button"
      onClick={onToggle}
      className="absolute inset-y-0 right-0 pr-3 flex items-center rounded-md text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-0"
      aria-label={visible ? hideLabel : showLabel}
    >
      {visible ? (
        <EyeOff className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
      ) : (
        <Eye className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
      )}
    </button>
  )
}
