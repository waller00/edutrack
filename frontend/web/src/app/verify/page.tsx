'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import { RegistrationNextSteps } from '@/components/auth/RegistrationNextSteps'
import { ResendVerificationEmail } from '@/components/auth/ResendVerificationEmail'

export default function VerifyPage() {
  const [status, setStatus] = useState<'loading'|'ok'|'error'>('loading')
  const [pendingApproval, setPendingApproval] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(globalThis.location.search)
    const token = params.get('token')
    if (!token) { setStatus('error'); return }
    api<{ pendingApproval?: boolean }>('/auth/verify', { method: 'POST', body: JSON.stringify({ token }) })
      .then((res) => {
        setPendingApproval(Boolean(res?.pendingApproval))
        setStatus('ok')
      })
      .catch(() => setStatus('error'))
  }, [])

  return (
    <main className="grid min-h-screen place-items-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-2xl border bg-white p-5 text-center shadow sm:p-6">
        {status === 'loading' && <p>Verificando…</p>}
        {status === 'ok' && (
          <>
            <h1 className="text-xl font-semibold mb-2">Correo verificado</h1>
            {pendingApproval ? (
              <>
                <p className="mb-4 text-sm text-gray-600">
                  Listo, confirmaste tu correo. Ahora administración tiene que aprobar tu cuenta; cuando lo haga,
                  vas a poder ingresar.
                </p>
                <RegistrationNextSteps stage="approval" />
              </>
            ) : (
              <p className="text-sm text-gray-600">Tu correo ha sido verificado correctamente.</p>
            )}
            <a href="/" className="inline-block mt-4 px-4 py-2 bg-black text-white rounded">Ir al inicio</a>
          </>
        )}
        {status === 'error' && (
          <>
            <h1 className="text-xl font-semibold mb-2">Enlace inválido o expirado</h1>
            <p className="mb-4 text-sm text-gray-600">
              El enlace ya se usó o venció (dura 24 horas). Si ya verificaste tu correo, no necesitás otro: sólo
              falta que administración apruebe tu cuenta. Si no, pedí uno nuevo.
            </p>
            <ResendVerificationEmail />
            <a href="/" className="inline-block mt-4 px-4 py-2 bg-black text-white rounded">Ir al inicio</a>
          </>
        )}
      </div>
    </main>
  )
}
