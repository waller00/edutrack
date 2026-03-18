export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'
  console.log('API URL:', apiUrl, 'Path:', path)
  
  const doFetch = async () =>
    fetch(`${apiUrl}${path}`, {
      credentials: "include",
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
      cache: "no-store",
    })

  let res = await doFetch()
  console.log('API Response status:', res.status)
  
  if (res.status === 401) {
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
    let errorMessage = `API ${res.status}`;
    try {
      const errorData = await res.json();
      if (errorData.message) {
        errorMessage = errorData.message;
      }
      // Create error with status and data
      const error = new Error(errorMessage) as any;
      error.status = res.status;
      error.data = errorData;
      throw error;
    } catch (parseError) {
      // If we can't parse JSON, throw with status
      const error = new Error(errorMessage) as any;
      error.status = res.status;
      throw error;
    }
  }
  return res.json() as Promise<T>
}
