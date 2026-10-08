import { useEffect, useState } from 'react'
import { apiBlob } from '@/lib/api/binary'

/**
 * Foto de un alumno dentro de una libreta, pedida una sola vez por sesión.
 *
 * Cada pantalla de la libreta repetía el mismo `useEffect` y Calificaciones pedía dos veces la de
 * cada alumno (la tarjeta y su miniatura): treinta alumnos eran sesenta pedidos, cada uno cargando
 * el grupo para validar que el alumno es de la libreta. Las URLs quedan vivas mientras dure la
 * sesión: son pocas y chicas, y revocarlas rompería la que otra pantalla está mostrando.
 */
const photoCache = new Map<string, Promise<string | null>>()

function loadPhoto(gradeBookId: string, studentId: string): Promise<string | null> {
  const key = `${gradeBookId}:${studentId}`
  const cached = photoCache.get(key)
  if (cached) return cached
  const pending = apiBlob(`/gradebook/${gradeBookId}/students/${studentId}/photo`)
    .then((blob) => (blob ? URL.createObjectURL(blob) : null))
    .catch(() => {
      // Un error no se cachea: la próxima vez se vuelve a intentar.
      photoCache.delete(key)
      return null
    })
  photoCache.set(key, pending)
  return pending
}

export function useStudentPhoto(
  gradeBookId: string,
  studentId: string | null | undefined,
  hasPhoto: boolean | null | undefined,
): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!hasPhoto || !studentId) {
      setUrl(null)
      return
    }
    let cancelled = false
    void loadPhoto(gradeBookId, studentId).then((loaded) => {
      if (!cancelled) setUrl(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [gradeBookId, studentId, hasPhoto])

  return url
}

/** Para los tests: cada uno arranca sin fotos en caché. */
export function clearStudentPhotoCache(): void {
  photoCache.clear()
}
