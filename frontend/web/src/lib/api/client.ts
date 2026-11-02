import { apiBaseUrl } from '@/lib/api/base-url'
import { isSpecificMessage, NO_CONNECTION_MESSAGE, statusMessage, TOO_SLOW_MESSAGE } from '@/lib/api/friendly-error'

export { apiBaseUrl }

type ApiRequestInit = RequestInit & {
  timeoutMs?: number
}

export async function api<T>(path: string, init?: ApiRequestInit): Promise<T> {
  const apiUrl = apiBaseUrl()
  const controller = new AbortController()
  const { timeoutMs = 12000, signal, headers, ...restInit } = init ?? {}
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetch(`${apiUrl}${path}`, {
      credentials: "include",
      ...restInit,
      headers: { "Content-Type": "application/json", ...(headers || {}) },
      cache: "no-store",
      signal: signal || controller.signal,
    })
  } catch (err) {
    const message = err instanceof DOMException && err.name === 'AbortError'
      ? TOO_SLOW_MESSAGE
      : NO_CONNECTION_MESSAGE
    const error = new Error(message) as Error & { status?: number }
    error.status = 0
    throw error
  } finally {
    clearTimeout(timeout)
  }

  if (!res.ok) {
    const errorData = await parseErrorJson(res);
    // Un mensaje genérico ("Error interno del servidor") o ninguno: el que corresponde al código,
    // en palabras de quien usa la pantalla. `specific` dice si el sistema explicó qué pasó.
    const specific = isSpecificMessage(errorData?.message);
    let errorMessage = specific ? String(errorData?.message).trim() : statusMessage(res.status);
    // `detail` a veces es un objeto (las secciones de un visado): sólo se agrega si es texto.
    if (specific && typeof errorData?.detail === "string" && errorData.detail.trim() !== "") {
      errorMessage = `${errorMessage} — ${errorData.detail}`;
    }
    const error = new Error(errorMessage) as Error & { status?: number; data?: unknown; specific?: boolean };
    error.status = res.status;
    error.specific = specific;
    if (errorData !== null) {
      // Las pantallas que leen `data.message` muestran lo mismo que `message`.
      error.data = specific ? errorData : { ...errorData, message: errorMessage };
    }
    throw error;
  }
  // 204/205 y cuerpos vacíos (DELETE) no se pueden parsear como JSON.
  if (res.status === 204 || res.status === 205) {
    return undefined as T
  }
  const text = await res.text()
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined as T
  }
}

async function parseErrorJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const data = await res.json();
    return data && typeof data === 'object' ? data as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
