'use client'

import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

type Props = {
  pending: boolean
  pendingText: string
  idle: ReactNode
}

/** Texto de botón con spinner accesible mientras `pending`. */
export function PendingButtonContent({ pending, pendingText, idle }: Props) {
  if (!pending) return <>{idle}</>
  return (
    <span className="inline-flex items-center justify-center gap-2">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
      <span>{pendingText}</span>
    </span>
  )
}
