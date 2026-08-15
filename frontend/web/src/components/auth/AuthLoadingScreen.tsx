import { Loader2 } from 'lucide-react'

/**
 * Placeholder a pantalla completa mientras se resuelve `/auth/me` o se ejecuta un
 * redirect. Ocupa el viewport a propósito: si los guards devolvieran `null`, el
 * header público de `UserNav` se colaría por debajo y provocaría un parpadeo de
 * contenido antes de llegar al login.
 */
export default function AuthLoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50/80" role="status" aria-live="polite">
      <Loader2 className="h-6 w-6 animate-spin text-emerald-600" aria-hidden />
      <span className="sr-only">Verificando sesión…</span>
    </div>
  )
}
