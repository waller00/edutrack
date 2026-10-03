/**
 * Helpers para mostrar fechas como dd/mm/yyyy en inputs, manteniendo el valor real en
 * yyyy-mm-dd (el formato que usan `<input type="date">`, las APIs y las validaciones).
 *
 * Existe porque el `<input type="date">` nativo muestra la fecha según el locale del navegador
 * (en EE. UU. queda mm/dd/yyyy) y eso no se puede forzar. Ver `components/forms/DateField`.
 */

/** yyyy-mm-dd → dd/mm/yyyy; '' si no es una fecha completa. */
export function ymdToDmy(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

/** dd/mm/yyyy → yyyy-mm-dd; '' si está incompleto o el día/mes no existen. */
export function dmyToYmd(dmy: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy)
  if (!m) return ''
  const [, dd, mm, yyyy] = m
  const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  if (d.getUTCDate() !== Number(dd) || d.getUTCMonth() + 1 !== Number(mm)) return ''
  return `${yyyy}-${mm}-${dd}`
}

/** Aplica la máscara dd/mm/yyyy a lo tipeado (solo dígitos, con barras). */
export function maskDmy(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}
