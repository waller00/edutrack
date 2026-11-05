'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Contenedor con scroll (tablas anchas, o altas con el encabezado fijo) que se puede recorrer con
 * el teclado.
 *
 * Un `div` con `overflow-x-auto` no recibe foco: quien navega con Tab no podía desplazar la tabla
 * ni llegar a las columnas de la derecha. Cuando el contenido desborda, el contenedor se vuelve
 * enfocable (las flechas lo desplazan) y una región con nombre; si entra entero, no agrega una
 * parada de Tab inútil.
 */
export default function ScrollRegion({
  label,
  className = '',
  tour,
  children,
}: Readonly<{
  label: string
  className?: string
  /** Ancla del onboarding (`data-tour`), cuando un globo señala la tabla. */
  tour?: string
  children: ReactNode
}>) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollable, setScrollable] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // También hacia abajo: una tabla con alto máximo (encabezado fijo) se desplaza en las dos direcciones.
    const check = () => setScrollable(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
    check()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(check)
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      data-tour={tour}
      className={className}
      role={scrollable ? 'region' : undefined}
      aria-label={scrollable ? label : undefined}
      tabIndex={scrollable ? 0 : undefined}
    >
      {children}
    </div>
  )
}
