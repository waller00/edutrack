'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'
import { registerLogRocketUserIdentify } from '@/lib/observability/user-session'

/**
 * Inicializa LogRocket (session replay) SOLO en produccion y solo si hay App ID.
 *
 * Privacidad: EduTrack maneja datos de estudiantes/padres (menores). Por eso:
 * - inputSanitizer: enmascara TODOS los valores de inputs (contrasenas, cedula, etc.).
 * - textSanitizer: enmascara texto visible para no grabar nombres, emails o cedulas en tablas.
 * - urlSanitizer: elimina query params con tokens o ids de verificaciones externas.
 * - se identifica al usuario unicamente por id (sin email ni nombre).
 *
 * En testing/dev no se carga: las sesiones serian sinteticas y gastarian cuota.
 */
export function Observability() {
  useEffect(() => {
    const appId = process.env.NEXT_PUBLIC_LOGROCKET_APP_ID
    const enabledInThisEnv =
      process.env.NODE_ENV === 'production' ||
      process.env.NEXT_PUBLIC_LOGROCKET_FORCE === 'true'

    if (!appId || !enabledInThisEnv) return

    let cancelled = false
    void import('logrocket').then((mod) => {
      if (cancelled) return
      const LogRocket = mod.default
      LogRocket.init(appId, {
        browser: {
          urlSanitizer: (url) => {
            try {
              const clean = new URL(url)
              clean.search = ''
              return clean.toString()
            } catch {
              return null
            }
          },
        },
        dom: {
          inputSanitizer: true,
          textSanitizer: true,
          disablePageTitles: true,
        },
        network: {
          // No grabar cuerpos de request/response (pueden traer datos sensibles).
          requestSanitizer: (request) => {
            request.headers = {}
            request.body = undefined
            return request
          },
          responseSanitizer: (response) => {
            response.body = undefined
            return response
          },
        },
      })
      LogRocket.getSessionURL((sessionURL) => {
        Sentry.setContext('logrocket', { sessionURL })
      })
      registerLogRocketUserIdentify((userId) => {
        LogRocket.identify(userId)
      })
    })

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
