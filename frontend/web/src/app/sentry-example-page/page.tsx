'use client'

import * as Sentry from '@sentry/nextjs'
import { useState } from 'react'

export default function SentryExamplePage() {
  const [status, setStatus] = useState('')

  async function sendTestEvent() {
    setStatus('Enviando evento...')
    Sentry.captureException(new Error('Sentry frontend smoke test'))
    await Sentry.flush(2000)
    setStatus('Evento enviado. Revisá Sentry en unos segundos.')
  }

  return (
    <main className="min-h-screen gradient-light flex items-center justify-center p-4">
      <section className="card w-full max-w-md text-center">
        <h1 className="mb-3 text-2xl font-bold text-gray-950">Sentry test</h1>
        <button type="button" onClick={sendTestEvent} className="btn-primary w-full justify-center">
          Enviar error de prueba
        </button>
        {status && <p className="mt-4 text-sm text-gray-600">{status}</p>}
      </section>
    </main>
  )
}
