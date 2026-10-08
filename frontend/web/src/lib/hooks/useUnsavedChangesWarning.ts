import { useEffect } from 'react'

/**
 * Pide confirmación al cerrar o recargar la pestaña mientras haya cambios sin guardar (RNF 7.3).
 * Para los cambios de alumno o de libreta dentro de la pantalla, ver `confirmDiscard`.
 */
export function useUnsavedChangesWarning(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    globalThis.addEventListener('beforeunload', onBeforeUnload)
    return () => globalThis.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])
}

/** `true` si se puede seguir: no hay cambios, o el usuario acepta descartarlos. */
export function confirmDiscard(dirty: boolean, message: string): boolean {
  return !dirty || globalThis.confirm(message)
}
