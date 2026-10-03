'use client'

/** Campos compartidos por los formularios de configuración académica. */

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-gray-600">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-gray-500">{hint}</p>}
    </div>
  )
}

export function Check({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string
  label: string
  hint?: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-start gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-gray-300"
      />
      <label htmlFor={id} className="text-sm text-gray-700">
        {label}
        {hint && <span className="block text-[11px] text-gray-500">{hint}</span>}
      </label>
    </div>
  )
}

export const inputClass = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm'
