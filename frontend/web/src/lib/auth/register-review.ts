import {
  getRegisterVerificationFieldLabel,
  type RegisterVerificationEntry,
  type RegisterVerificationResults,
} from '@/lib/auth/register-form-validation'

/** Datos que Didit leyó del documento (`documentFields` de `/auth/didit/register-field-verify`). */
export type DiditDocumentFields = {
  firstName?: string
  lastName?: string
  fullName?: string
  /** Cédula de la persona (no el número de serie del cartón). */
  documentNumber?: string
  documentNumberCandidates?: string[]
  dateOfBirth?: string
  expirationDate?: string
}

export type ReviewRowStatus = 'match' | 'mismatch' | 'unknown'

export type ReviewRow = {
  field: string
  label: string
  /** Lo que el usuario declaró en el paso 1. */
  declared: string
  /** Lo que dice el documento, cuando Didit lo devolvió. */
  fromDocument?: string
  status: ReviewRowStatus
  message: string
}

/** ✓ = coincide, ✗ = contradice, ⚠️ = no lo pudimos determinar. */
export function getReviewRowStatus(entry: RegisterVerificationEntry): ReviewRowStatus {
  const message = String(entry?.message ?? '')
  if (message.includes('✓')) return 'match'
  if (message.includes('✗')) return 'mismatch'
  return 'unknown'
}

/** Filas del mapeo declarado ↔ documento, en orden estable. */
export function buildReviewRows(
  results: RegisterVerificationResults | null,
  documentFields?: DiditDocumentFields,
): ReviewRow[] {
  if (!results?.verification) return []

  const documentByField: Record<string, string | undefined> = {
    firstName: documentFields?.firstName,
    lastName: documentFields?.lastName,
    nationalId: documentFields?.documentNumber,
    birthdate: documentFields?.dateOfBirth,
    nationalIdDocumentExpiresAt: documentFields?.expirationDate,
  }

  const order = ['firstName', 'lastName', 'nationalId', 'birthdate', 'nationalIdDocumentExpiresAt']
  const keys = Object.keys(results.verification)
  const sorted = [...keys].sort((a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib)
  })

  return sorted.map((field) => {
    const entry = results.verification[field]
    return {
      field,
      label: getRegisterVerificationFieldLabel(field),
      declared: entry.provided,
      fromDocument: documentByField[field] ?? entry.extracted,
      status: getReviewRowStatus(entry),
      message: entry.message,
    }
  })
}

/**
 * Solo se puede confirmar el alta si **todas** las filas coinciden. Un `unknown`
 * tampoco alcanza: si no pudimos leer el dato, no afirmamos que esté bien.
 */
export function canConfirmRegistration(rows: ReviewRow[]): boolean {
  return rows.length > 0 && rows.every((row) => row.status === 'match')
}

/** Motivo por el que no se puede confirmar, para explicarlo en pantalla. */
export function getReviewBlockingReason(rows: ReviewRow[]): string | null {
  if (rows.length === 0) return 'Todavía no verificaste tu identidad.'

  const mismatched = rows.filter((r) => r.status === 'mismatch')
  if (mismatched.length > 0) {
    const labels = mismatched.map((r) => r.label.toLowerCase()).join(', ')
    return `Lo que declaraste no coincide con tu documento en: ${labels}. Volvé al paso 1 y corregilo.`
  }

  const unknown = rows.filter((r) => r.status === 'unknown')
  if (unknown.length > 0) {
    const labels = unknown.map((r) => r.label.toLowerCase()).join(', ')
    return `No pudimos confirmar con el documento: ${labels}. Volvé a verificar tu identidad.`
  }

  return null
}
