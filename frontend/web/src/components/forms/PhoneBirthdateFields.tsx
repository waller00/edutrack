'use client'

import { AlertCircle } from 'lucide-react'
import DateField from './DateField'

type PhoneBirthdateFieldsProps = {
  phoneLocal: string
  birthdate: string
  onPhoneChange: (value: string) => void
  onBirthdateChange: (value: string) => void
  birthdateRequired?: boolean
  /** Errores de validación en vivo; opcionales para no afectar a los formularios que no los usan. */
  phoneError?: string
  birthdateError?: string
  onPhoneBlur?: () => void
  onBirthdateBlur?: () => void
}

function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" className="mt-1 flex items-start gap-1.5 text-sm text-red-600">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </p>
  )
}

export default function PhoneBirthdateFields({
  phoneLocal,
  birthdate,
  onPhoneChange,
  onBirthdateChange,
  birthdateRequired = false,
  phoneError,
  birthdateError,
  onPhoneBlur,
  onBirthdateBlur,
}: PhoneBirthdateFieldsProps) {
  return (
    <>
      <div>
        <label htmlFor="phone-local-input" className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <span>Celular (Uruguay)</span>
          <span className="text-xs font-normal text-gray-400">(opcional)</span>
        </label>
        <div className="flex gap-2 items-center">
          <span className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-700 select-none text-sm font-medium">+598</span>
          <input
            id="phone-local-input"
            value={phoneLocal}
            onChange={(e) => onPhoneChange(e.target.value)}
            onBlur={onPhoneBlur}
            placeholder="094481122"
            inputMode="numeric"
            autoComplete="tel-national"
            aria-invalid={Boolean(phoneError)}
            className={`input-field flex-1 ${phoneError ? 'border-red-300 focus:border-red-500 focus:ring-red-200' : ''}`}
            aria-describedby={phoneError ? 'phone-local-error' : 'phone-local-hint'}
          />
        </div>
        {phoneError ? (
          <FieldError id="phone-local-error" message={phoneError} />
        ) : (
          <p id="phone-local-hint" className="mt-1 text-xs text-gray-500">
            Solo celular: 9 dígitos comenzando con 09 (no incluyas +598).
          </p>
        )}
      </div>

      <div>
        <label htmlFor="birthdate-input" className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <span>Fecha de nacimiento</span>
          {birthdateRequired ? (
            <>
              <span aria-hidden className="text-red-500">
                *
              </span>
              <span className="sr-only">(obligatorio)</span>
            </>
          ) : null}
        </label>
        <DateField
          id="birthdate-input"
          value={birthdate}
          onChange={onBirthdateChange}
          onBlur={onBirthdateBlur}
          required={birthdateRequired}
          max={new Date().toISOString().split('T')[0]}
          aria-invalid={Boolean(birthdateError)}
          aria-describedby={birthdateError ? 'birthdate-error' : 'birthdate-hint'}
        />
        {birthdateError ? (
          <FieldError id="birthdate-error" message={birthdateError} />
        ) : (
          <p id="birthdate-hint" className="mt-1 text-xs text-gray-500">
            Formato: día/mes/año (dd/mm/aaaa).
          </p>
        )}
      </div>
    </>
  )
}
