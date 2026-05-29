import { isKeycloak } from '@/lib/auth/mode'

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

  const doFetch = async () =>
    fetch(`${apiUrl}${path}`, {
      credentials: "include",
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
      cache: "no-store",
    })

  let res = await doFetch()

  // En modo Keycloak (BFF) el refresh lo maneja el backend con la sesion
  // server-side; un 401 significa sesion ausente/expirada (no se reintenta aqui).
  if (res.status === 401 && !isKeycloak) {
    // intentar refresh una vez
    const r = await fetch(`${apiUrl}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
    if (r.ok) {
      res = await doFetch()
    }
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
