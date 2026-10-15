'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'

export type ComboboxStudent = {
  studentId: string
  firstName: string
  lastName: string
  documentId?: string | null
}

/** Sin tildes ni mayúsculas: "Pérez" se encuentra escribiendo "perez". */
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

export function studentOptionLabel(student: ComboboxStudent): string {
  return `${student.lastName.toUpperCase()}, ${student.firstName}`
}

/**
 * ¿El alumno coincide con lo escrito? Cada palabra tiene que aparecer en el nombre, el apellido
 * o la cédula, en cualquier orden: "ana per" y "perez ana" encuentran a Ana Pérez.
 */
export function studentMatches(student: ComboboxStudent, query: string): boolean {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = normalizeSearch(`${student.lastName} ${student.firstName}`)
  const digits = (student.documentId ?? '').replace(/\D/g, '')
  return words.every((word) => {
    if (haystack.includes(word)) return true
    const wordDigits = word.replace(/\D/g, '')
    return wordDigits.length > 0 && wordDigits === word.replace(/[.\-]/g, '') && digits.includes(wordDigits)
  })
}

type Option = { student: ComboboxStudent | null; number: number | null }

/**
 * Selector de alumno con búsqueda al escribir. Si recibe `allLabel`, la primera opción es "todos"
 * (`null`): así "Todos los alumnos" no es un filtro aparte sino una opción del mismo desplegable.
 *
 * Patrón combobox de ARIA 1.2: el foco queda en el campo y las flechas recorren la lista.
 */
export default function StudentCombobox({
  students,
  value,
  onChange,
  allLabel,
  label,
  hideLabel = false,
  numbered = false,
  disabled = false,
  className = '',
  placeholder = 'Buscar por nombre, apellido o cédula',
}: {
  students: readonly ComboboxStudent[]
  /** `studentId` elegido, o `null` para la opción "todos". */
  value: string | null
  onChange: (studentId: string | null) => void
  /** Texto de la opción "todos"; sin él no hay opción "todos". */
  allLabel?: string
  label: string
  hideLabel?: boolean
  /** Antepone el número de lista (el orden en `students`), como en la libreta. */
  numbered?: boolean
  disabled?: boolean
  className?: string
  placeholder?: string
}) {
  const id = useId()
  const listId = `${id}-list`
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const selected = value ? students.find((s) => s.studentId === value) ?? null : null
  const selectedIndex = selected ? students.indexOf(selected) : -1
  const display = selected
    ? `${numbered ? `${selectedIndex + 1}. ` : ''}${studentOptionLabel(selected)}`
    : allLabel ?? ''

  const options = useMemo<Option[]>(() => {
    const matching = students
      .map((student, index) => ({ student, number: index + 1 }))
      .filter(({ student }) => studentMatches(student, query))
    // "Todos" sólo se ofrece mientras no se está buscando a alguien en particular.
    return allLabel && !query.trim() ? [{ student: null, number: null }, ...matching] : matching
  }, [students, query, allLabel])

  useEffect(() => {
    if (!open) return
    document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [active, open, id])

  function openList() {
    if (disabled) return
    setQuery('')
    // Arranca sobre la opción elegida, para que las flechas sigan desde ahí.
    const current = selected ? students.indexOf(selected) + (allLabel ? 1 : 0) : 0
    setActive(Math.max(0, current))
    setOpen(true)
  }

  function close() {
    setOpen(false)
    setQuery('')
  }

  function choose(option: Option | undefined) {
    if (!option) return
    onChange(option.student?.studentId ?? null)
    close()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        openList()
        return
      }
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((current) => Math.min(Math.max(current + step, 0), Math.max(options.length - 1, 0)))
    } else if (event.key === 'Enter') {
      if (!open) return
      event.preventDefault()
      choose(options[active])
    } else if (event.key === 'Escape') {
      if (!open) return
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (event.key === 'Home' && open) {
      event.preventDefault()
      setActive(0)
    } else if (event.key === 'End' && open) {
      event.preventDefault()
      setActive(Math.max(options.length - 1, 0))
    }
  }

  const activeOption = open ? options[active] : undefined

  return (
    <div
      className={`relative min-w-0 ${className}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close()
      }}
    >
      <label htmlFor={`${id}-input`} className={hideLabel ? 'sr-only' : 'mb-1 block text-xs text-gray-600'}>
        {label}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeOption ? `${id}-option-${active}` : undefined}
          autoComplete="off"
          disabled={disabled}
          value={open ? query : display}
          placeholder={open ? placeholder : display || placeholder}
          onFocus={openList}
          onClick={() => {
            if (!open) openList()
          }}
          onChange={(event) => {
            if (!open) setOpen(true)
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          className="w-full rounded border border-slate-300 bg-white py-1.5 pl-8 pr-8 text-sm text-slate-800 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/40 disabled:opacity-50"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? 'Cerrar la lista' : 'Abrir la lista'}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) close()
            else {
              openList()
              inputRef.current?.focus()
            }
          }}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-50"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto overscroll-contain rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500" role="presentation">
              Ningún alumno coincide con «{query.trim()}».
            </li>
          ) : (
            options.map((option, index) => {
              const isSelected = option.student ? option.student.studentId === value : value === null
              return (
                <li
                  key={option.student?.studentId ?? '__all__'}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  // `mousedown` y no `click`: el blur del campo cerraría la lista antes del clic.
                  onMouseDown={(event) => {
                    event.preventDefault()
                    choose(option)
                  }}
                  onMouseEnter={() => setActive(index)}
                  className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm ${
                    index === active ? 'bg-emerald-50 text-emerald-900' : 'text-slate-800'
                  } ${option.student ? '' : 'font-medium'}`}
                >
                  <span className="min-w-0 truncate">
                    {option.student ? (
                      <>
                        {numbered && <span className="mr-1 tabular-nums text-slate-400">{option.number}.</span>}
                        {studentOptionLabel(option.student)}
                        {option.student.documentId && (
                          <span className="ml-2 font-mono text-xs text-slate-400">{option.student.documentId}</span>
                        )}
                      </>
                    ) : (
                      allLabel
                    )}
                  </span>
                  {isSelected && <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />}
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}
