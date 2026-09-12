export const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
export type TuitionStatus = 'paid' | 'pending' | 'none'
export const TUITION_STATUS_LABELS: Record<TuitionStatus, string> = {
  paid: 'Pagado', pending: 'Pendiente', none: 'Sin registrar',
}
export type TuitionMonth = {
  year: number
  month: number
  paid: boolean
  paidAt: string | null
  amountCents: number | null
  notes: string | null
}
export type TuitionStudent = {
  id: string
  firstName: string
  lastName: string
  documentId: string | null
  course: { id: string; name: string } | null
  tuitionMonths: TuitionMonth[]
}
export type TuitionList = {
  year: number
  month: number
  page: number
  pageSize: number
  total: number
  summary: {
    students: number
    paid: number
    pending: number
    none: number
    collectedCents: number
    pendingCents: number
    paidWithoutAmount: number
    pendingWithoutAmount: number
  }
  data: TuitionStudent[]
}
export function tuitionStatus(row?: TuitionMonth): TuitionStatus {
  return row ? row.paid ? 'paid' : 'pending' : 'none'
}
const money = new Intl.NumberFormat('es-UY', { style: 'currency', currency: 'UYU', maximumFractionDigits: 2 })
export function formatTuitionAmount(cents: number | null | undefined): string {
  return cents == null ? 'Sin importe' : money.format(cents / 100)
}
export function formatTuitionDate(value: string | null | undefined): string {
  if (!value) return '—'
  return value.slice(0, 10).split('-').reverse().join('/')
}
export function todayYmd(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
/** Acepta coma decimal local, sin convertir importes vacíos en cero. */
export function parseTuitionAmount(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return null
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error('Ingresá un importe positivo con hasta dos decimales.')
  const cents = Math.round(Number(normalized) * 100)
  if (!Number.isSafeInteger(cents) || cents > 2147483647) throw new Error('El importe es demasiado grande.')
  return cents
}
