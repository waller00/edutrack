import { apiBaseUrl } from '@/lib/api/base-url'

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
      ? 'API sin respuesta'
      : 'No se pudo conectar con la API'
    const error = new Error(message) as Error & { status?: number }
    error.status = 0
    throw error
  } finally {
    clearTimeout(timeout)
  }

  if (!res.ok) {
    const errorData = await parseErrorJson(res);
    let errorMessage = `API ${res.status}`;
    if (errorData?.message) {
      errorMessage = String(errorData.message);
    }
    if (errorData?.detail != null && String(errorData.detail).trim() !== "") {
      errorMessage = `${errorMessage} — ${String(errorData.detail)}`;
    }
    const error = new Error(errorMessage) as Error & { status?: number; data?: unknown };
    error.status = res.status;
    if (errorData !== null) {
      error.data = errorData;
    }
    throw error;
  }
  return res.json() as Promise<T>
}

async function parseErrorJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const data = await res.json();
    return data && typeof data === 'object' ? data as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
