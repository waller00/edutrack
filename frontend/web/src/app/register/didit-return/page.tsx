'use client'

import { useEffect, useState } from 'react'

/**
 * Didit exige callback HTTPS (p. ej. ngrok). Si el usuario abrió el registro en
 * http://localhost:3000, al terminar Didit abre esta URL en ngrok. Redirigimos al mismo
 * path con los query params para que /register retome el token y el polling.
 *
 * .env del frontend: NEXT_PUBLIC_DIDIT_BROWSER_RETURN_URL=http://localhost:3000
 * Didit callback: https://TU-NGROK.ngrok-free.app/register/didit-return?liveness=1
 * (o sin ?liveness=1 si Didit lo añade solo con verificationSessionId; entonces cubrimos en register.)
 */
export default function RegisterDiditReturnPage() {
  const [msg, setMsg] = useState('Redirigiendo al registro…')

  useEffect(() => {
    const base = (process.env.NEXT_PUBLIC_DIDIT_BROWSER_RETURN_URL || '').trim().replace(/\/$/, '')
    if (!base) {
      setMsg(
        'Falta NEXT_PUBLIC_DIDIT_BROWSER_RETURN_URL (ej. http://localhost:3000). Definila en el .env del frontend, reconstruí la imagen si usás Docker, y usá esta ruta en DIDIT_CALLBACK_URL vía ngrok.',
      )
      return
    }
    try {
      const u = new URL(base)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        setMsg('URL de retorno no válida.')
        return
      }
    } catch {
      setMsg('NEXT_PUBLIC_DIDIT_BROWSER_RETURN_URL no es una URL válida.')
      return
    }
    const qs = typeof window !== 'undefined' ? window.location.search : ''
    window.location.replace(`${base}/register${qs}`)
  }, [])

  return (
    <main className="responsive-page max-w-lg text-center text-gray-700">
      <p>{msg}</p>
    </main>
  )
}
