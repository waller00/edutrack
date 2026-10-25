'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useLibreta } from '@/contexts/LibretaContext'

/**
 * La sección "Mensajes de Dirección y Adscripción" se retiró: la supervisión le escribe al docente
 * por la mensajería 1 a 1 y lo observado en el visado se ve en "Cierre de períodos". Los avisos
 * viejos de la campana todavía apuntan acá, así que se redirige en vez de dar 404.
 */
export default function Page() {
  const { gradeBookId } = useLibreta()
  const router = useRouter()
  useEffect(() => {
    router.replace(`/libreta/${gradeBookId}/cierre`)
  }, [router, gradeBookId])
  return null
}
