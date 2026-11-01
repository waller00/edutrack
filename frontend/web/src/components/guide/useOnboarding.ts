'use client'

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { onboardingSteps, onboardingStorageKey } from '@/lib/navigation/onboarding'
import type { ModuleId } from '@/lib/navigation/modules'

type Progress = { started: boolean; active: boolean; completed: string[]; current: string | null; dismissed: boolean }
const EMPTY: Progress = { started: false, active: false, completed: [], current: null, dismissed: false }
const EVENT = 'edutrack:onboarding'
const memory = new Map<string, string>()
const sessions = new WeakMap<object, string>()
let sessionCount = 0

function sessionKeyFor(me: object | null): string {
  if (!me) return 'anonymous'
  let key = sessions.get(me)
  if (!key) {
    key = `session:${++sessionCount}`
    sessions.set(me, key)
  }
  return key
}

function read(key: string): string {
  const fallback = memory.get(key)
  if (fallback !== undefined) return fallback
  try {
    return globalThis.localStorage.getItem(key) ?? ''
  } catch {
    return memory.get(key) ?? ''
  }
}

function parse(raw: string | null): Progress {
  try {
    const value: unknown = JSON.parse(raw || '{}')
    if (!value || typeof value !== 'object') return EMPTY
    const data = value as Partial<Progress>
    return {
      started: data.started === true,
      active: data.active === true,
      completed: Array.isArray(data.completed) ? data.completed.filter((id): id is string => typeof id === 'string') : [],
      current: typeof data.current === 'string' ? data.current : null,
      dismissed: data.dismissed === true,
    }
  } catch {
    return EMPTY
  }
}

function subscribe(listener: () => void) {
  globalThis.addEventListener('storage', listener)
  globalThis.addEventListener(EVENT, listener)
  return () => {
    globalThis.removeEventListener('storage', listener)
    globalThis.removeEventListener(EVENT, listener)
  }
}

const serverSnapshot = () => null

/** Comparte el recorrido entre Inicio, la guía y el acompañamiento dentro de cada pantalla. */
export function useOnboarding() {
  const { me } = useAuth()
  const key = onboardingStorageKey(me)
  // Sin identificador de cuenta sólo se conserva en memoria durante esta sesión.
  const sessionKey = key ?? sessionKeyFor(me)
  const getSnapshot = useCallback(() => key ? read(key) : memory.get(sessionKey) ?? '', [key, sessionKey])
  const raw = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot)
  const progress = useMemo(() => parse(raw), [raw])
  const steps = useMemo(() => onboardingSteps(me), [me])
  const completed = steps.filter((step) => progress.completed.includes(step.module.id))
  const pending = steps.filter((step) => !progress.completed.includes(step.module.id))
  const current = steps.find((step) => step.module.id === progress.current) ?? pending[0] ?? steps[0]
  const finished = steps.length > 0 && pending.length === 0

  function update(transform: (previous: Progress) => Progress) {
    const next = JSON.stringify(transform(parse(getSnapshot())))
    if (key) {
      try {
        globalThis.localStorage.setItem(key, next)
        memory.delete(sessionKey)
      } catch {
        memory.set(sessionKey, next)
      }
    } else memory.set(sessionKey, next)
    globalThis.dispatchEvent(new Event(EVENT))
  }

  function start(id?: ModuleId) {
    const step = steps.find((entry) => entry.module.id === id) ?? pending[0] ?? steps[0]
    if (!step) return
    update((previous) => ({ ...previous, started: true, active: true, current: step.module.id, dismissed: false }))
    return step.module.href
  }

  function complete() {
    if (!current) return
    const next = pending.find((step) => step.module.id !== current.module.id)
    update((previous) => ({
      ...previous,
      completed: [...new Set([...previous.completed, current.module.id])],
      current: next?.module.id ?? current.module.id,
      active: Boolean(next),
    }))
    return next?.module.href ?? '/guia'
  }

  return {
    ready: raw !== null, steps, progress, completed, pending, current, finished,
    start, complete,
    pause: () => update((previous) => ({ ...previous, active: false })),
    dismiss: () => update((previous) => ({ ...previous, dismissed: true })),
    restart: () => update(() => ({ ...EMPTY })),
  }
}
