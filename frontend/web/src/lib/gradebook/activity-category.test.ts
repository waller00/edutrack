import { describe, expect, it } from 'vitest'
import {
  activityCategory,
  averageHundredths,
} from './activity-category'

describe('activityCategory', () => {
  it('clasifica orales y escritos del catálogo DGES', () => {
    expect(activityCategory('ORAL')).toBe('oral')
    expect(activityCategory('EXPOSICION')).toBe('oral')
    expect(activityCategory('ESCRITO')).toBe('written')
    expect(activityCategory('TRABAJO_EN_CLASE')).toBe('other')
    expect(activityCategory(null)).toBe('other')
  })
})

describe('averageHundredths', () => {
  it('promedia e ignora nulos', () => {
    expect(averageHundredths([800, null, 600])).toBe(700)
    expect(averageHundredths([])).toBeNull()
    expect(averageHundredths([null, undefined])).toBeNull()
  })
})
