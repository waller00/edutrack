import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RegisterReview from '@/components/auth/RegisterReview'
import type { RegisterVerificationResults } from '@/lib/auth/register-form-validation'

const ACCOUNT = { email: 'juan@example.com', phone: '+598 094481122', roleLabel: 'Docente' }

const ALL_MATCH: RegisterVerificationResults = {
  verifiedFields: 2,
  totalFields: 2,
  verification: {
    firstName: { provided: 'Juan', extracted: 'JUAN', message: '✓ Nombre verificado correctamente (Didit)' },
    nationalId: { provided: '1.234.567-2', extracted: '1.234.567-2', message: '✓ Cédula verificada correctamente (Didit)' },
  },
}

const WITH_MISMATCH: RegisterVerificationResults = {
  verifiedFields: 1,
  totalFields: 2,
  verification: {
    firstName: { provided: 'Juan', extracted: 'PEDRO', message: '✗ No coincide: el documento dice «PEDRO».' },
    nationalId: { provided: '1.234.567-2', extracted: '1.234.567-2', message: '✓ Cédula verificada correctamente (Didit)' },
  },
}

function renderReview(results: RegisterVerificationResults | null, overrides = {}) {
  const onBack = vi.fn()
  const onConfirm = vi.fn()
  render(
    <RegisterReview
      verificationResults={results}
      account={ACCOUNT}
      submitting={false}
      onBack={onBack}
      onConfirm={onConfirm}
      {...overrides}
    />,
  )
  return { onBack, onConfirm }
}

describe('RegisterReview', () => {
  it('muestra el mapeo entre lo declarado y lo que dice el documento', () => {
    renderReview(ALL_MATCH, { documentFields: { firstName: 'JUAN', documentNumber: '1.234.567-2' } })

    expect(screen.getByText('Juan')).toBeInTheDocument()
    expect(screen.getByText('JUAN')).toBeInTheDocument()
    expect(screen.getAllByText(/Tu documento dice:/i).length).toBeGreaterThan(0)
    expect(screen.getByText(ACCOUNT.email)).toBeInTheDocument()
    expect(screen.getByText('Docente')).toBeInTheDocument()
  })

  it('permite terminar cuando todo coincide', () => {
    const { onConfirm } = renderReview(ALL_MATCH)

    const finish = screen.getByRole('button', { name: /terminar registro/i })
    expect(finish).toBeEnabled()

    fireEvent.click(finish)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('obliga a volver cuando un dato no coincide', () => {
    const { onBack, onConfirm } = renderReview(WITH_MISMATCH, { documentFields: { firstName: 'PEDRO' } })

    expect(screen.getByRole('button', { name: /terminar registro/i })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(/no coincide con tu documento/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/nombre/i)
    expect(screen.getByText(/el documento dice «PEDRO»/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /volver y corregir/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('tampoco deja terminar si un campo quedó sin confirmar', () => {
    renderReview({
      verifiedFields: 0,
      totalFields: 1,
      verification: {
        nationalIdDocumentExpiresAt: { provided: '—', message: '⚠️ No pudimos determinar la fecha de vencimiento' },
      },
    })

    expect(screen.getByRole('button', { name: /terminar registro/i })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(/No pudimos confirmar/i)
  })

  it('indica cuando el documento no aportó un dato', () => {
    // Sin `extracted` ni `documentFields`: la verificación cayó al match por texto,
    // que confirma pero no sabe qué dice el documento.
    renderReview({
      verifiedFields: 1,
      totalFields: 1,
      verification: {
        firstName: { provided: 'Juan', message: '✓ Nombre verificado correctamente (Didit)' },
      },
    })

    expect(screen.getByText(/no lo pudimos leer/i)).toBeInTheDocument()
  })

  it('bloquea ambos botones mientras se está creando la cuenta', () => {
    renderReview(ALL_MATCH, { submitting: true })

    expect(screen.getByRole('button', { name: /creando cuenta/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /volver y corregir/i })).toBeDisabled()
  })
})
