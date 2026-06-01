import { describe, expect, it } from 'vitest'
import { uruguayWallToUtc } from '../../config/app-timezone.js'
import { timelineSortInstantOnDay } from './timeline-sort.js'

describe('timelineSortInstantOnDay', () => {
  const day = '2026-05-25'

  it('ordena 12:00 antes que 21:40 en el mismo día filtrado', () => {
    const noon = timelineSortInstantOnDay(day, uruguayWallToUtc(day, 12, 0))
    const evening = timelineSortInstantOnDay(day, uruguayWallToUtc(day, 21, 40))
    expect(noon.getTime()).toBeLessThan(evening.getTime())
  })

  it('mantiene 21:40 del día filtrado aunque el instante UTC caiga al día siguiente', () => {
    const eveningUtc = uruguayWallToUtc(day, 21, 40)
    const onFilteredDay = timelineSortInstantOnDay(day, eveningUtc)
    expect(onFilteredDay.getTime()).toBe(eveningUtc.getTime())
  })

  it('sin hora de referencia usa medianoche del día filtrado', () => {
    const midnight = timelineSortInstantOnDay(day)
    const expected = uruguayWallToUtc(day, 0, 0)
    expect(midnight.getTime()).toBe(expected.getTime())
  })
})
