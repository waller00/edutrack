'use client'

import { useEffect, useState } from 'react'

/**
 * La hora actual, refrescada cada `intervalMs`. Sirve para pantallas que cambian con el reloj
 * (una lista que abre a las 09:50) sin volver a pedir datos al servidor.
 */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
