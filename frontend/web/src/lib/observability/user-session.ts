'use client'

import * as Sentry from '@sentry/nextjs'

let logRocketIdentify: ((userId: string) => void) | null = null
let pendingUserId: string | null = null

export function isLogRocketEnabled() {
  return Boolean(
    process.env.NEXT_PUBLIC_LOGROCKET_APP_ID &&
      (process.env.NODE_ENV === 'production' ||
        process.env.NEXT_PUBLIC_LOGROCKET_FORCE === 'true'),
  )
}

export function registerLogRocketUserIdentify(fn: (userId: string) => void) {
  logRocketIdentify = fn
  if (pendingUserId) {
    fn(pendingUserId)
    pendingUserId = null
  }
}

/** Vincula la sesion autenticada en Sentry y LogRocket (solo id, sin PII). */
export function identifyObservabilityUser(userId: string) {
  if (!userId) return

  Sentry.setUser({ id: userId })

  if (!isLogRocketEnabled()) return

  if (logRocketIdentify) {
    logRocketIdentify(userId)
  } else {
    pendingUserId = userId
  }
}

export function clearObservabilityUser() {
  Sentry.setUser(null)
  pendingUserId = null
}
