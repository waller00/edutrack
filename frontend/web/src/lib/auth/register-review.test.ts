import { describe, expect, it } from 'vitest'
import {
  buildReviewRows,
  canConfirmRegistration,
  getReviewBlockingReason,
  getReviewRowStatus,
} from '@/lib/auth/register-review'
import type { RegisterVerificationResults } from '@/lib/auth/register-form-validation'

function results(verification: RegisterVerificationResults['verification']): RegisterVerificationResults {
  return { verifiedFields: 0, totalFields: Object.keys(verification).length, verification }
}

const ALL_OK = results({
  firstName: { provided: 'Juan', extracted: 'JUAN', message: '✓ Nombre verificado correctamente (Didit)' },
  lastName: { provided: 'Pérez', extracted: 'PEREZ', message: '✓ Apellidos verificados correctamente (Didit)' },
  nationalId: { provided: '1.234.567-2', extracted: '1.234.567-2', message: '✓ Cédula verificada correctamente (Didit)' },
  birthdate: { provided: '1990-01-15', extracted: '1990-01-15', message: '✓ Fecha de nacimiento verificada correctamente (Didit)' },
  nationalIdDocumentExpiresAt: { provided: '—', extracted: '2032-06-10', message: '✓ Documento vigente: vencimiento 2032-06-10' },
})

describe('getReviewRowStatus', () => {
  it('clasifica por el prefijo del mensaje', () => {
    expect(getReviewRowStatus({ provided: 'x', message: '✓ ok' })).toBe('match')
    expect(getReviewRowStatus({ provided: 'x', message: '✗ no coincide' })).toBe('mismatch')
    expect(getReviewRowStatus({ provided: 'x', message: '⚠️ no se pudo leer' })).toBe('unknown')
  })
})

describe('buildReviewRows', () => {
  it('ordena las filas y mapea el valor real del documento', () => {
    const rows = buildReviewRows(ALL_OK, {
      firstName: 'JUAN',
      lastName: 'PEREZ',
      documentNumber: '1.234.567-2',
      dateOfBirth: '1990-01-15',
      expirationDate: '2032-06-10',
    })

    expect(rows.map((r) => r.field)).toEqual([
      'firstName',
      'lastName',
      'nationalId',
      'birthdate',
      'nationalIdDocumentExpiresAt',
    ])
    expect(rows[0]).toMatchObject({ declared: 'Juan', fromDocument: 'JUAN', status: 'match' })
  })

  it('prefiere documentFields sobre el extracted de la entrada', () => {
    const rows = buildReviewRows(
      results({ firstName: { provided: 'Juan', extracted: 'ECO', message: '✗ No coincide' } }),
      { firstName: 'PEDRO' },
    )

    expect(rows[0].fromDocument).toBe('PEDRO')
    expect(rows[0].status).toBe('mismatch')
  })

  it('devuelve vacío sin verificación', () => {
    expect(buildReviewRows(null)).toEqual([])
  })
})

describe('canConfirmRegistration', () => {
  it('permite confirmar solo si todo coincide', () => {
    expect(canConfirmRegistration(buildReviewRows(ALL_OK))).toBe(true)
  })

  it('bloquea si algún campo no coincide', () => {
    const rows = buildReviewRows(
      results({
        firstName: { provided: 'Juan', extracted: 'PEDRO', message: '✗ No coincide: el documento dice «PEDRO».' },
        lastName: { provided: 'Pérez', extracted: 'PEREZ', message: '✓ ok' },
      }),
    )

    expect(canConfirmRegistration(rows)).toBe(false)
    expect(getReviewBlockingReason(rows)).toMatch(/no coincide/i)
    expect(getReviewBlockingReason(rows)).toMatch(/nombre/i)
  })

  it('bloquea también cuando un campo quedó sin confirmar', () => {
    const rows = buildReviewRows(
      results({
        firstName: { provided: 'Juan', message: '✓ ok' },
        nationalIdDocumentExpiresAt: { provided: '—', message: '⚠️ No pudimos determinar la fecha' },
      }),
    )

    expect(canConfirmRegistration(rows)).toBe(false)
    expect(getReviewBlockingReason(rows)).toMatch(/No pudimos confirmar/i)
  })

  it('bloquea si no hay verificación todavía', () => {
    expect(canConfirmRegistration([])).toBe(false)
    expect(getReviewBlockingReason([])).toMatch(/Todavía no verificaste/i)
  })

  it('no da motivo de bloqueo cuando está todo bien', () => {
    expect(getReviewBlockingReason(buildReviewRows(ALL_OK))).toBeNull()
  })
})
