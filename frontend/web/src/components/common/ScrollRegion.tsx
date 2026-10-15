'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Contenedor con scroll horizontal (tablas anchas) que se puede recorrer con el teclado.
 *
 * Un `div` con `overflow-x-auto` no recibe foco: quien navega con Tab no podía desplazar la tabla
 * ni llegar a las columnas de la derecha. Cuando el contenido desborda, el contenedor se vuelve
 * enfocable (las flechas lo desplazan) y una región con nombre; si entra entero, no agrega una
 * parada de Tab inútil.
 */
export default function ScrollRegion({
  label,
  className = '',
  children,
}: Readonly<{ label: string; className?: string; children: ReactNode }>) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollable, setScrollable] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setScrollable(el.scrollWidth > el.clientWidth + 1)
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
      className={className}
      role={scrollable ? 'region' : undefined}
      aria-label={scrollable ? label : undefined}
      tabIndex={scrollable ? 0 : undefined}
    >
      {children}
    </div>
  )
}
