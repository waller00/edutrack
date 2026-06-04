'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api/client'

export default function VerifyPage() {
  const [status, setStatus] = useState<'loading'|'ok'|'error'>('loading')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    if (!token) { setStatus('error'); return }
    api('/auth/verify', { method: 'POST', body: JSON.stringify({ token }) })
      .then(() => setStatus('ok'))
      .catch(() => setStatus('error'))
  }, [])

  return (
    <main className="grid min-h-screen place-items-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-2xl border bg-white p-5 text-center shadow sm:p-6">
        {status === 'loading' && <p>Verificando…</p>}
        {status === 'ok' && (
          <>
            <h1 className="text-xl font-semibold mb-2">Correo verificado</h1>
            <p className="text-sm text-gray-600">Tu correo ha sido verificado correctamente.</p>
            <a href="/" className="inline-block mt-4 px-4 py-2 bg-black text-white rounded">Ir al inicio</a>
          </>
        )}
        {status === 'error' && (
          <>
            <h1 className="text-xl font-semibold mb-2">Enlace inválido o expirado</h1>
            <p className="text-sm text-gray-600">Solicita un nuevo correo de verificación desde tu cuenta.</p>
            <a href="/" className="inline-block mt-4 px-4 py-2 bg-black text-white rounded">Ir al inicio</a>
          </>
        )}
      </div>
    </main>
  )
} 
