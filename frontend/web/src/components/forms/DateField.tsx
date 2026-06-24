'use client'

import { useEffect, useState } from 'react'
import { Calendar } from 'lucide-react'
import { dmyToYmd, maskDmy, ymdToDmy } from '@/lib/forms/date-mask'

type DateFieldProps = {
  /** Valor real en yyyy-mm-dd ('' si vacío). */
  value: string
  /** Emite yyyy-mm-dd ('' si quedó incompleto/ inválido). */
  onChange: (value: string) => void
  id?: string
  name?: string
  /** yyyy-mm-dd para el calendario nativo. */
  min?: string
  max?: string
  required?: boolean
  disabled?: boolean
  className?: string
  placeholder?: string
  'aria-label'?: string
  'aria-describedby'?: string
  /** Muestra el botón de calendario nativo (default true). */
  withCalendar?: boolean
}

/**
 * Campo de fecha con formato fijo dd/mm/yyyy (independiente del locale del navegador).
 * Internamente es un input de texto con máscara; opcionalmente superpone un `<input type="date">`
 * transparente sobre el ícono de calendario para mantener el selector nativo. Siempre emite yyyy-mm-dd.
 */
export default function DateField({
  value,
  onChange,
  min,
  max,
  disabled,
  className = 'input-field',
  placeholder = 'dd/mm/aaaa',
  withCalendar = true,
  ...rest
}: DateFieldProps) {
  const [text, setText] = useState(() => ymdToDmy(value))

  useEffect(() => {
    // Resincroniza si el valor cambia desde afuera (borrador, lectura de DNI, reset de filtros…).
    if (value !== dmyToYmd(text)) setText(ymdToDmy(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function handleText(raw: string) {
    const masked = maskDmy(raw)
    setText(masked)
    onChange(dmyToYmd(masked))
  }

  return (
    <div className="relative">
      <input
        type="text"
        inputMode="numeric"
        value={text}
        onChange={(e) => handleText(e.target.value)}
        placeholder={placeholder}
        maxLength={10}
        disabled={disabled}
        className={withCalendar ? `${className} pr-10` : className}
        {...rest}
      />
      {withCalendar && (
        <>
          <Calendar
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            aria-hidden
          />
          <input
            type="date"
            tabIndex={-1}
            aria-hidden
            disabled={disabled}
            value={value}
            min={min}
            max={max}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-y-0 right-0 w-10 cursor-pointer opacity-0"
          />
        </>
      )}
    </div>
  )
}
