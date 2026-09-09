import { apiBaseUrl } from '@/lib/api/base-url'

/**
 * Lectura y escritura de contenido binario contra la API.
 *
 * `api()` no sirve para esto: siempre termina en `res.json()` y fuerza
 * `Content-Type: application/json`. Y leer la foto con `<img src>` tampoco, porque el endpoint va
 * autenticado por la cookie `sid`: con `COOKIE_SAMESITE=lax` una request de imagen cross-origin no
 * la manda y el navegador sólo muestra el ícono de imagen rota, sin error que se pueda mostrar.
 * Con `fetch` + `createObjectURL` la cookie viaja igual que en el resto de la app y un 404 se puede
 * distinguir de un fallo real.
 */

async function messageFromError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json()
    if (data && typeof data === 'object' && 'message' in data) return String((data as any).message)
  } catch {
    /* el cuerpo no era JSON */
  }
  return fallback
}

function apiError(message: string, status: number): Error & { status: number } {
  const error = new Error(message) as Error & { status: number }
  error.status = status
  return error
}

/** Devuelve `null` si el recurso no existe (404), para poder dibujar un vacío en vez de un error. */
export async function apiBlob(path: string): Promise<Blob | null> {
  const res = await fetch(`${apiBaseUrl()}${path}`, { credentials: 'include', cache: 'no-store' })
  if (res.status === 404) return null
  if (!res.ok) throw apiError(await messageFromError(res, `API ${res.status}`), res.status)
  return res.blob()
}

/** Manda el archivo tal cual, sin base64: el `Content-Type` es el tipo real del contenido. */
export async function apiUpload<T>(path: string, file: Blob, method = 'PUT'): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method,
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': file.type },
    body: file,
  })
  if (!res.ok) throw apiError(await messageFromError(res, `API ${res.status}`), res.status)
  return res.json() as Promise<T>
}
