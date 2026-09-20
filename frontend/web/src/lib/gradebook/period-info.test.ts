import { describe, expect, it } from 'vitest'
import { periodInfoMessage } from '@/lib/gradebook/period-info'

describe('periodInfoMessage', () => {
  it('explica un período cerrado con fecha', () => {
    expect(
      periodInfoMessage({
        status: 'CLOSED',
        canEdit: false,
        closedAt: '2026-08-02T11:00:00.000Z',
      }),
    ).toMatch(/Período cerrado el día/)
  })

  it('explica la ventana cuando está habilitado', () => {
    expect(
      periodInfoMessage({
        status: 'OPEN',
        canEdit: true,
        startsOn: '2026-09-07',
        closesOn: '2026-09-22',
      }),
    ).toMatch(/Período habilitado desde 07\/09\/2026/)
  })

  it('marca no habilitado si no se puede editar', () => {
    expect(
      periodInfoMessage({
        status: 'OPEN',
        canEdit: false,
      }),
    ).toBe('Período no habilitado')
  })
})
