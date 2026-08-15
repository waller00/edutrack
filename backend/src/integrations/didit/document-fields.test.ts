import { describe, expect, it } from 'vitest'
import { extractDiditDocumentFields, normalizeDiditDate } from './document-fields.js'

describe('normalizeDiditDate', () => {
  it('normaliza los formatos que devuelve Didit', () => {
    expect(normalizeDiditDate('1990-01-15')).toBe('1990-01-15')
    expect(normalizeDiditDate('1990-01-15T00:00:00Z')).toBe('1990-01-15')
    expect(normalizeDiditDate('15/01/1990')).toBe('1990-01-15')
    expect(normalizeDiditDate('5/1/1990')).toBe('1990-01-05')
    expect(normalizeDiditDate('19900115')).toBe('1990-01-15')
  })

  it('descarta valores no interpretables', () => {
    expect(normalizeDiditDate('')).toBeUndefined()
    expect(normalizeDiditDate('no es fecha')).toBeUndefined()
    expect(normalizeDiditDate('32/13/1990')).toBeUndefined()
  })
})

describe('extractDiditDocumentFields', () => {
  it('lee el OCR desde id_verification (objeto)', () => {
    const decision = {
      session_id: 'abc',
      status: 'Approved',
      id_verification: {
        first_name: 'JUAN CARLOS',
        last_name: 'PEREZ RODRIGUEZ',
        document_number: '1.234.567-8',
        date_of_birth: '1990-01-15',
        expiration_date: '2030-06-10',
      },
    }

    expect(extractDiditDocumentFields(decision)).toEqual({
      firstName: 'JUAN CARLOS',
      lastName: 'PEREZ RODRIGUEZ',
      documentNumber: '1.234.567-8',
      dateOfBirth: '1990-01-15',
      expirationDate: '2030-06-10',
    })
  })

  it('lee el OCR desde id_verifications (array) y formatos de fecha con barras', () => {
    const decision = {
      id_verifications: [
        {
          firstName: 'ANA',
          surname: 'GOMEZ',
          personal_number: '4.567.890-1',
          dateOfBirth: '02/03/1985',
          date_of_expiry: '11/12/2029',
        },
      ],
    }

    expect(extractDiditDocumentFields(decision)).toEqual({
      firstName: 'ANA',
      lastName: 'GOMEZ',
      documentNumber: '4.567.890-1',
      dateOfBirth: '1985-03-02',
      expirationDate: '2029-12-11',
    })
  })

  it('deriva nombre y apellido desde full_name cuando no vienen separados', () => {
    const fields = extractDiditDocumentFields({
      id_verification: { full_name: 'MARIA LOPEZ SILVA', document_number: '9876543' },
    })

    expect(fields.firstName).toBe('MARIA')
    expect(fields.lastName).toBe('LOPEZ SILVA')
    expect(fields.fullName).toBe('MARIA LOPEZ SILVA')
  })

  it('prioriza el contenedor de OCR sobre datos sueltos de la decisión', () => {
    const decision = {
      // Lo que el formulario mandó como vendor_data no debe ganarle al documento.
      vendor_data: { first_name: 'DECLARADO', last_name: 'DECLARADO' },
      id_verification: { first_name: 'REAL', last_name: 'DOCUMENTO' },
    }

    const fields = extractDiditDocumentFields(decision)
    expect(fields.firstName).toBe('REAL')
    expect(fields.lastName).toBe('DOCUMENTO')
  })

  it('deja undefined lo que no aparece, sin inventar valores', () => {
    expect(extractDiditDocumentFields({ id_verification: { first_name: 'SOLO' } })).toEqual({
      firstName: 'SOLO',
    })
    expect(extractDiditDocumentFields(null)).toEqual({})
    expect(extractDiditDocumentFields('texto')).toEqual({})
  })

  it('no se cuelga con referencias circulares', () => {
    const decision: Record<string, unknown> = { id_verification: { first_name: 'JUAN' } }
    decision.self = decision

    expect(extractDiditDocumentFields(decision).firstName).toBe('JUAN')
  })
})
