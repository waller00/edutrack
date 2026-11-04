import { describe, expect, it } from 'vitest'
import { groupRowsByMoment } from './class-row'

describe('groupRowsByMoment', () => {
  it('separa ahora, sin pasar, más tarde y el resto', () => {
    const rows = (['OPEN', 'OVERDUE', 'UPCOMING', 'TAKEN', 'COVERED', 'EXPIRED'] as const).map((phase) => ({ phase }))
    const groups = groupRowsByMoment(rows)
    expect(groups.now.map((r) => r.phase)).toEqual(['OPEN'])
    expect(groups.overdue.map((r) => r.phase)).toEqual(['OVERDUE'])
    expect(groups.later.map((r) => r.phase)).toEqual(['UPCOMING'])
    expect(groups.done.map((r) => r.phase)).toEqual(['TAKEN', 'COVERED', 'EXPIRED'])
  })
})
