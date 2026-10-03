export type PeriodInfoInput = {
  status: 'OPEN' | 'CLOSED' | 'REOPENED' | string
  canEdit: boolean
  startsOn?: string | null
  endsOn?: string | null
  closesOn?: string | null
  closedAt?: string | null
}

/** dd/mm/aaaa HH:mm a partir de ISO o YYYY-MM-DD. */
export function formatClosureStamp(iso: string | null | undefined, withTime = true): string {
  if (!iso) return '—'
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00.000Z`) : new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
  if (!withTime || iso.length === 10) return date
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Texto del ícono Info. (estilo SIGED): cerrado / habilitado / no habilitado.
 */
export function periodInfoMessage(period: PeriodInfoInput): string {
  if (period.status === 'CLOSED') {
    if (period.closedAt) return `Período cerrado el día ${formatClosureStamp(period.closedAt)}`
    return 'Período cerrado'
  }
  if (!period.canEdit) return 'Período no habilitado'
  const from = period.startsOn ? formatClosureStamp(period.startsOn, false) : null
  const to = period.closesOn
    ? formatClosureStamp(period.closesOn, false)
    : period.endsOn
      ? formatClosureStamp(period.endsOn, false)
      : null
  if (from && to) return `Período habilitado desde ${from} 00:00 hasta ${to} 12:00`
  if (to) return `Período habilitado hasta ${to}`
  return 'Período habilitado para editar'
}
