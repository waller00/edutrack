'use client'
import { useEffect } from 'react'
import { loginUrl } from '@/lib/auth/urls'

/** Recupero de contraseña gestionado por Keycloak (enlace "¿Olvidaste tu contraseña?"). */
export default function ForgotPage() {
  useEffect(() => {
    window.location.replace(loginUrl('/login'))
  }, [])
  return (
    <main className="min-h-screen gradient-light flex items-center justify-center p-4">
      <p className="text-gray-600">Redirigiendo al inicio de sesión…</p>
    </main>
  )
}
