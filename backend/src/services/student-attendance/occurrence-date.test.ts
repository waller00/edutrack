import { describe, expect, it } from 'vitest'
import { uruguayWallToUtc } from '../../config/app-timezone.js'
import { uyStartOfDayUtc } from '../events/event-versioning.js'
import { occurrenceDateOf } from './roll-call.js'

/**
 * `StudentAttendanceSession.occurrenceDate` se usa para buscar la suplencia del día por la
 * clave única `eventId_date`. Si ese instante difiere aunque sea un milisegundo del que
 * escribe `resolveSubstitutionOccurrence`, el lookup falla y un suplente legítimo recibe un
 * 403 silencioso: es el tipo de bug que solo aparece en producción y solo para suplentes.
 */
describe('occurrenceDateOf ≡ Substitution.date', () => {
  const ymds = ['2026-01-15', '2026-03-01', '2026-05-05', '2026-07-20', '2026-10-04', '2026-12-31']

  it.each(ymds)('coincide con uruguayWallToUtc(%s, 0, 0), que es lo que persiste la suplencia', (ymd) => {
    expect(occurrenceDateOf(ymd).getTime()).toBe(uruguayWallToUtc(ymd, 0, 0).getTime())
  })

  it.each(ymds)('coincide con uyStartOfDayUtc(%s) usado por el versionado de eventos', (ymd) => {
    expect(occurrenceDateOf(ymd).getTime()).toBe(uyStartOfDayUtc(ymd).getTime())
  })

  it('NO coincide con new Date(ymd), que interpreta el día en UTC', () => {
    // Guarda explícita contra la regresión más tentadora del módulo.
    expect(occurrenceDateOf('2026-05-05').getTime()).not.toBe(new Date('2026-05-05').getTime())
  })
})
