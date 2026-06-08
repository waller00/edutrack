import { describe, it, expect, vi } from 'vitest'
import {
  addDaysYmd,
  effectiveWindowIncludesYmd,
  splitEventDefinitionForEdit,
  uyStartOfDayUtc,
  ymdInUruguay,
} from './event-versioning.js'

describe('helpers de fecha', () => {
  it('addDaysYmd suma y resta días', () => {
    expect(addDaysYmd('2025-06-02', -1)).toBe('2025-06-01')
    expect(addDaysYmd('2025-06-30', 1)).toBe('2025-07-01')
  })

  it('uyStartOfDayUtc / ymdInUruguay son inversos a nivel de día', () => {
    expect(ymdInUruguay(uyStartOfDayUtc('2025-06-02'))).toBe('2025-06-02')
  })
})

describe('effectiveWindowIncludesYmd', () => {
  const from = uyStartOfDayUtc('2025-06-01')
  const until = uyStartOfDayUtc('2025-06-30')

  it('incluye fechas dentro de la ventana', () => {
    expect(effectiveWindowIncludesYmd(from, until, '2025-06-15')).toBe(true)
  })
  it('excluye fechas anteriores al inicio', () => {
    expect(effectiveWindowIncludesYmd(from, until, '2025-05-31')).toBe(false)
  })
  it('excluye fechas posteriores al fin', () => {
    expect(effectiveWindowIncludesYmd(from, until, '2025-07-01')).toBe(false)
  })
  it('sin límites incluye cualquier fecha', () => {
    expect(effectiveWindowIncludesYmd(null, null, '2030-01-01')).toBe(true)
  })
})

describe('splitEventDefinitionForEdit', () => {
  it('cierra la versión vieja y crea la nueva con la familia y la vigencia correctas', async () => {
    const created = { id: 'new-1', assignedUserId: null }
    const tx = {
      event: {
        create: vi.fn().mockResolvedValue(created),
        update: vi.fn().mockResolvedValue({ id: 'old-1' }),
      },
    }

    const result = await splitEventDefinitionForEdit(tx as any, {
      existing: { id: 'old-1', revisionOf: null },
      cutoffYmd: '2025-06-02',
      data: { title: 'Nueva', recurrenceEnd: null },
    })

    expect(result).toBe(created)
    // Nueva versión: revisionOf = raíz (id del viejo), effectiveFrom = corte.
    const createArg = tx.event.create.mock.calls[0][0].data
    expect(createArg.revisionOf).toBe('old-1')
    expect(ymdInUruguay(createArg.effectiveFrom)).toBe('2025-06-02')
    // Versión vieja: se cierra el día anterior al corte y apunta a la nueva.
    const updateArg = tx.event.update.mock.calls[0][0]
    expect(updateArg.where).toEqual({ id: 'old-1' })
    expect(ymdInUruguay(updateArg.data.effectiveUntil)).toBe('2025-06-01')
    expect(updateArg.data.supersededById).toBe('new-1')
  })

  it('preserva la raíz cuando el evento editado ya es una versión hija', async () => {
    const tx = {
      event: {
        create: vi.fn().mockResolvedValue({ id: 'new-2' }),
        update: vi.fn().mockResolvedValue({}),
      },
    }
    await splitEventDefinitionForEdit(tx as any, {
      existing: { id: 'child-1', revisionOf: 'root-1' },
      cutoffYmd: '2025-06-02',
      data: {},
    })
    expect(tx.event.create.mock.calls[0][0].data.revisionOf).toBe('root-1')
  })
})
