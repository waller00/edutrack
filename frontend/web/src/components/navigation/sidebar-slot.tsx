'use client'

import { createContext, useContext } from 'react'

/**
 * Un hueco arriba del menú lateral donde una sección puede poner un control propio.
 *
 * Lo usa el selector de ciclo lectivo: vive en `AdminShell`, dentro del proveedor del ciclo, pero
 * se dibuja en el menú con un portal, así no ocupa una barra entera arriba de cada pantalla. Mover
 * el proveedor al layout raíz para alcanzarlo desde el menú cambiaba el comportamiento de las
 * páginas personales, que hoy no filtran por ciclo.
 */
export type SidebarSlot = {
  /** Elemento del menú donde dibujar; `null` mientras el menú no está (sin sesión, tests). */
  slot: HTMLElement | null
  /** El menú está contraído a íconos. */
  rail: boolean
  /** Abre el menú contraído. */
  expand: () => void
}

export const SidebarSlotContext = createContext<SidebarSlot>({ slot: null, rail: false, expand: () => {} })

export function useSidebarSlot(): SidebarSlot {
  return useContext(SidebarSlotContext)
}
