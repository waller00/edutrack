import { describe, expect, it } from 'vitest'
import { buildRegisterVerificationComparison } from './register-verification-from-decision.js'

const FUTURE_EXPIRY = `${new Date().getFullYear() + 5}-06-10`

function decisionWith(fields: Record<string, string>) {
  return { status: 'Approved', id_verification: { expiration_date: FUTURE_EXPIRY, ...fields } }
}

const DECLARED = {
  firstName: 'Juan Carlos',
  lastName: 'Pérez Rodríguez',
  nationalId: '1.234.567-8',
  birthdate: '1990-01-15',
}

describe('buildRegisterVerificationComparison con datos estructurados', () => {
  it('verifica todos los campos cuando el documento coincide', () => {
    const out = buildRegisterVerificationComparison(
      decisionWith({
        first_name: 'JUAN CARLOS',
        last_name: 'PEREZ RODRIGUEZ',
        document_number: '1.234.567-8',
        date_of_birth: '1990-01-15',
      }),
      DECLARED,
    )

    expect(out.verifiedFields).toBe(out.totalFields)
    expect(out.verification.firstName.message).toContain('✓')
    expect(out.verification.nationalId.message).toContain('✓')
    expect(out.verification.birthdate.message).toContain('✓')
  })

  it('tolera acentos y mayúsculas entre lo declarado y el OCR', () => {
    const out = buildRegisterVerificationComparison(
      decisionWith({ first_name: 'JUAN CARLOS', last_name: 'PEREZ RODRIGUEZ' }),
      DECLARED,
    )

    expect(out.verification.lastName.message).toContain('✓')
  })

  it('expone el valor real del documento cuando NO coincide', () => {
    const out = buildRegisterVerificationComparison(
      decisionWith({
        first_name: 'PEDRO',
        last_name: 'GOMEZ',
        document_number: '9.999.999-9',
        date_of_birth: '1985-03-02',
      }),
      DECLARED,
    )

    expect(out.verification.firstName.message).toContain('✗')
    expect(out.verification.firstName.extracted).toBe('PEDRO')
    expect(out.verification.firstName.message).toContain('PEDRO')

    expect(out.verification.nationalId.extracted).toBe('9.999.999-9')
    expect(out.verification.birthdate.extracted).toBe('1985-03-02')
    expect(out.verifiedFields).toBeLessThan(out.totalFields)
  })

  it('no marca como verificado un dato que el documento contradice, aunque aparezca en otra parte del JSON', () => {
    // El match por texto antiguo daba ✓ porque el nombre declarado viajaba en vendor_data.
    const decision = {
      vendor_data: JSON.stringify(DECLARED),
      id_verification: { first_name: 'PEDRO', last_name: 'GOMEZ', expiration_date: FUTURE_EXPIRY },
    }

    const out = buildRegisterVerificationComparison(decision, DECLARED)

    expect(out.verification.firstName.message).toContain('✗')
    expect(out.verification.firstName.extracted).toBe('PEDRO')
  })

  it('devuelve documentFields con lo leído del documento', () => {
    const out = buildRegisterVerificationComparison(
      decisionWith({ first_name: 'JUAN CARLOS', last_name: 'PEREZ RODRIGUEZ', document_number: '1.234.567-8' }),
      DECLARED,
    )

    expect(out.documentFields).toMatchObject({
      firstName: 'JUAN CARLOS',
      lastName: 'PEREZ RODRIGUEZ',
      documentNumber: '1.234.567-8',
      expirationDate: FUTURE_EXPIRY,
    })
  })

  it('marca el documento vencido usando la fecha estructurada', () => {
    const out = buildRegisterVerificationComparison(
      { id_verification: { first_name: 'JUAN CARLOS', expiration_date: '2001-06-10' } },
      DECLARED,
    )

    expect(out.verification.nationalIdDocumentExpiresAt.message).toContain('✗')
    expect(out.verification.nationalIdDocumentExpiresAt.message).toContain('vencido')
  })

  it('cae al match por texto cuando el OCR no trae campos estructurados', () => {
    const decision = { raw: 'JUAN CARLOS PEREZ RODRIGUEZ 12345678 1990-01-15 2032-06-10' }

    const out = buildRegisterVerificationComparison(decision, DECLARED)

    expect(out.verification.firstName.message).toContain('✓')
    // Sin dato estructurado no afirmamos qué dice el documento.
    expect(out.verification.firstName.extracted).toBeUndefined()
    expect(out.documentFields.firstName).toBeUndefined()
  })
})
