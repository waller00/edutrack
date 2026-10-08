import { apiBaseUrl } from '@/lib/api/client'

/**
 * Nombre del archivo que manda el servidor. Primero `filename*` (UTF-8, conserva las tildes de un
 * apellido); si no está o viene mal codificado, el `filename` ASCII; si no, el de respaldo.
 */
export function filenameFromDisposition(header: string | null | undefined, fallback: string): string {
  if (!header) return fallback
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim())
    } catch {
      // `filename*` mal codificado: sigue con el ASCII.
    }
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? fallback
}

async function downloadErrorText(res: Response): Promise<string> {
  if (res.status === 403) return 'No tenés permiso para descargar este archivo.'
  try {
    const data = (await res.json()) as { message?: string } | null
    if (data?.message) return data.message
  } catch {
    // La respuesta no es JSON: alcanza con el código.
  }
  return `No se pudo generar el archivo (${res.status})`
}

/**
 * Descarga un archivo de la API.
 *
 * Va por `fetch` + blob y no por un `<a href>` directo porque la API vive en otro origen y la
 * sesión viaja en una cookie: un enlace plano no la mandaría y la descarga daría 401.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}${path}`, { credentials: 'include', cache: 'no-store' })
  if (!res.ok) throw new Error(await downloadErrorText(res))

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filenameFromDisposition(res.headers.get('Content-Disposition'), fallbackName)
  link.click()
  URL.revokeObjectURL(url)
}
