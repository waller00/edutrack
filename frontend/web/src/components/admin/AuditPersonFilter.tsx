'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, Search } from 'lucide-react'
import { api } from '@/lib/api/client'

export type AuditPerson = { id: string; name: string | null; email: string }
type UserPage = { data: AuditPerson[]; total: number }

export default function AuditPersonFilter({
  value,
  onChange,
}: {
  value: AuditPerson | null
  onChange: (person: AuditPerson | null) => void
}) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [users, setUsers] = useState<AuditPerson[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [active, setActive] = useState(-1)

  useEffect(() => {
    if (!open) return
    search.current?.focus()
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError('')
    const timer = window.setTimeout(
      async () => {
        try {
          const params = new URLSearchParams({
            page: String(page),
            pageSize: '20',
          })
          if (query.trim()) params.set('q', query.trim())
          const result = await api<UserPage>(
            `/admin/audit-logs/users?${params}`,
          )
          if (cancelled) return
          // La paginación es por offset: si se crea un usuario entre página y página, la siguiente
          // repite uno. Sin filtrar, la lista lo mostraba dos veces (y con la misma key).
          setUsers((current) =>
            page === 1
              ? result.data
              : [
                  ...current,
                  ...result.data.filter(
                    (user) => !current.some((seen) => seen.id === user.id),
                  ),
                ],
          )
          setTotal(result.total)
        } catch {
          if (!cancelled) setError('No se pudo cargar la lista de usuarios.')
        } finally {
          if (!cancelled) setLoading(false)
        }
      },
      query && page === 1 ? 250 : 0,
    )
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, query, page, retry])

  useEffect(() => {
    if (active >= 0) {
      document
        .getElementById(`${id}-option-${active}`)
        ?.scrollIntoView?.({ block: 'nearest' })
    }
  }, [active, id])

  function close() {
    setOpen(false)
    trigger.current?.focus()
  }

  function choose(person: AuditPerson | null) {
    onChange(person)
    close()
  }

  return (
    <div
      ref={root}
      className="relative min-w-0"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault()
          event.stopPropagation()
          close()
        }
      }}
    >
      <span
        id={`${id}-label`}
        className="mb-1 block text-sm font-medium text-slate-700"
      >
        Persona
      </span>
      <button
        ref={trigger}
        type="button"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        onClick={() => {
          if (!open) {
            setQuery('')
            setPage(1)
            setUsers([])
            setTotal(0)
            setLoading(true)
            setError('')
            setActive(-1)
          }
          setOpen((current) => !current)
        }}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
      >
        <span id={`${id}-value`} className="truncate">
          {value ? value.name || value.email : 'Todos los usuarios'}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      </button>
      {open && (
        <div
          id={`${id}-panel`}
          role="dialog"
          aria-label="Elegir persona"
          className="absolute left-0 top-full z-30 mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
        >
          <div className="relative mb-2">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              ref={search}
              role="combobox"
              aria-label="Buscar usuario por nombre o correo"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={`${id}-list`}
              aria-activedescendant={
                active >= 0 ? `${id}-option-${active}` : undefined
              }
              value={query}
              maxLength={120}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
                setUsers([])
                setTotal(0)
                setActive(-1)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  setActive((current) =>
                    event.key === 'ArrowDown'
                      ? Math.min(current + 1, users.length)
                      : Math.max(0, current - 1),
                  )
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  if (active >= 0)
                    choose(active === 0 ? null : users[active - 1])
                }
              }}
              placeholder="Nombre o correo"
              className="input-field min-h-11 pl-9 text-sm"
            />
          </div>
          <div
            id={`${id}-list`}
            role="listbox"
            aria-label="Usuarios"
            className="max-h-52 overflow-y-auto overscroll-contain"
          >
            {[null, ...users].map((person, index) => (
              <button
                key={person?.id || 'all'}
                id={`${id}-option-${index}`}
                type="button"
                role="option"
                aria-label={
                  person
                    ? [person.name, person.email].filter(Boolean).join(' ')
                    : 'Todos los usuarios'
                }
                aria-selected={
                  person ? person.id === value?.id : value === null
                }
                onClick={() => choose(person)}
                className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50 ${index === active ? 'bg-emerald-50' : ''}`}
              >
                <span className="min-w-0">
                  <span className="block break-words text-slate-800">
                    {person
                      ? person.name || person.email
                      : 'Todos los usuarios'}
                  </span>
                  {person?.name && (
                    <span className="mt-0.5 block break-all text-xs text-slate-500">
                      {person.email}
                    </span>
                  )}
                </span>
                {(person ? person.id === value?.id : value === null) && (
                  <Check
                    className="h-4 w-4 shrink-0 text-emerald-600"
                    aria-hidden
                  />
                )}
              </button>
            ))}
          </div>
          {error ? (
            <div role="alert" className="mt-2 text-xs text-red-700">
              <p>{error}</p>
              <button
                type="button"
                onClick={() => setRetry((current) => current + 1)}
                className="min-h-10 font-medium underline"
              >
                Reintentar usuarios
              </button>
            </div>
          ) : (
            <div className="mt-2 text-xs text-slate-500">
              <p role="status" className="flex items-center gap-2">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Buscando usuarios…
                  </>
                ) : users.length ? (
                  `${users.length} de ${total} usuarios`
                ) : (
                  'No se encontraron usuarios.'
                )}
              </p>
              {/* Queda montado mientras carga: si desapareciera, el foco del teclado se perdía. */}
              {users.length > 0 && users.length < total && (
                <button
                  type="button"
                  // `aria-disabled` y no `disabled`: un botón deshabilitado pierde el foco en Chrome.
                  aria-disabled={loading}
                  aria-busy={loading}
                  onClick={() => {
                    if (!loading) setPage((current) => current + 1)
                  }}
                  className="mt-1 min-h-10 w-full rounded-lg font-medium text-emerald-700 hover:bg-emerald-50 aria-disabled:opacity-60"
                >
                  Cargar más usuarios
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
