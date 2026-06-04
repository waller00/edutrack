import { describe, expect, it } from 'vitest'
import { getDocumentExpiryValidationErrorFromDecision } from './register-verification-from-decision.js'

describe('getDocumentExpiryValidationErrorFromDecision', () => {
  it('rechaza sin fecha de nacimiento', () => {
    expect(getDocumentExpiryValidationErrorFromDecision({ text: '2030-01-01' }, '')).toContain(
      'fecha de nacimiento',
    )
  })

  it('rechaza documento vencido', () => {
    const decision = { raw: 'birth 1990-01-15 expiry 2000-06-10' }
    expect(getDocumentExpiryValidationErrorFromDecision(decision, '1990-01-15')).toContain('vencido')
  })

  it('acepta documento vigente', () => {
    const decision = { raw: 'birth 1990-01-15 expiry 2030-06-10' }
    expect(getDocumentExpiryValidationErrorFromDecision(decision, '1990-01-15')).toBeNull()
  })
})
