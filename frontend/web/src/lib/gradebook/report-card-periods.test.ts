import { describe, expect, it } from 'vitest'
import { groupByLevel, lastClosedMeeting, nextMeeting, type ReportCardPeriod } from './report-card-periods'

const p = (id: string, closesOn: string | null, level: ReportCardPeriod['level'] = 'EBI'): ReportCardPeriod => ({
  id,
  name: id,
  level,
  closesOn,
})

describe('nextMeeting', () => {
  it('elige la primera reunión cuyo plazo no pasó', () => {
    expect(nextMeeting([p('e1', '2026-05-01'), p('e2', '2026-07-01'), p('e3', '2026-09-30')], '2026-06-10')?.id).toBe('e2')
  })

  it('si ya pasaron todas, la última', () => {
    expect(nextMeeting([p('e1', '2026-05-01'), p('e2', '2026-07-01')], '2026-12-01')?.id).toBe('e2')
  })
})

describe('lastClosedMeeting', () => {
  it('la última reunión que ya pasó: es la que tiene R', () => {
    expect(lastClosedMeeting([p('e1', '2026-05-01'), p('e2', '2026-07-01'), p('e3', '2026-09-30')], '2026-08-10')?.id).toBe('e2')
  })

  it('si no pasó ninguna, la primera', () => {
    expect(lastClosedMeeting([p('e1', '2026-05-01')], '2026-01-10')?.id).toBe('e1')
  })
})

describe('groupByLevel', () => {
  it('agrupa por nivel respetando el orden', () => {
    const groups = groupByLevel([p('e1', null), p('s1', null, 'EMS'), p('e2', null)])
    expect(groups.map(([level, items]) => [level, items.map((i) => i.id)])).toEqual([
      ['EBI', ['e1', 'e2']],
      ['EMS', ['s1']],
    ])
  })
})
