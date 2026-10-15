'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { CircleHelp, X } from 'lucide-react'

export const GUIDE_DISMISSED_KEY = 'edutrack.guide.dismissed'

function readDismissed(): boolean {
  try {
    return globalThis.localStorage?.getItem(GUIDE_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeDismissed() {
  try {
    globalThis.localStorage?.setItem(GUIDE_DISMISSED_KEY, '1')
  } catch {
    /* sin storage, el aviso vuelve al recargar; no es motivo para romper Inicio */
  }
}

/**
 * Aviso de Inicio para quien recién llega: la Guía explica cada sección. Se cierra una vez y no
 * vuelve en este navegador. Se lee después de montar: en el servidor no hay storage, y así no
 * parpadea para quien ya lo cerró.
 */
export default function GuideWelcomeBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(!readDismissed())
  }, [])

  if (!visible) return null

  function dismiss() {
    writeDismissed()
    setVisible(false)
  }

  return (
    <aside
      aria-label="Guía para empezar"
      className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900"
    >
      <CircleHelp className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">¿Primera vez en EduTrack?</p>
        <p className="mt-0.5 text-sky-800">
          La guía explica qué hace cada sección del menú y la diferencia entre la asistencia del personal y la de los
          estudiantes.
        </p>
        <Link
          href="/guia"
          onClick={writeDismissed}
          className="mt-2 inline-flex font-semibold text-sky-900 underline hover:text-sky-700"
        >
          Ver la guía
        </Link>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded p-1 text-sky-700 hover:bg-sky-100"
        aria-label="No mostrar más"
        title="No mostrar más"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </aside>
  )
}
