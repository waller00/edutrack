'use client'
import { useState } from 'react'
import { api } from '@/lib/api/client'

export default function ForgotPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      setSent(true)
    } catch (err: any) {
      setError(err?.data?.message || err?.message || 'No se pudo enviar el correo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen gradient-light flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="card shadow-modern-lg">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100">
              <img src="/logo.svg" alt="EduTrack" className="h-10 w-10" />
            </div>
            <h1 className="mb-2 text-2xl font-bold text-gray-900">Recuperar contraseña</h1>
            <p className="text-gray-600">Te enviamos un enlace para crear una contraseña nueva.</p>
          </div>

          {sent ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              Si el correo está registrado, vas a recibir el enlace de recuperación en unos minutos.
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <label className="block text-sm font-medium text-gray-700">
                Correo
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-field mt-1"
                  placeholder="tu@correo.com"
                />
              </label>
              {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
              <button type="submit" disabled={busy} className="btn-primary w-full justify-center disabled:opacity-60">
                {busy ? 'Enviando…' : 'Enviar enlace'}
              </button>
            </form>
          )}

          <div className="mt-6 text-center">
            <a href="/login" className="text-sm font-medium text-emerald-700 hover:text-emerald-800">
              Volver al inicio de sesión
            </a>
          </div>
        </div>
      </div>
    </main>
  )
}
