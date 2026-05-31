import { describe, expect, it } from 'vitest'
import { TEACHERS_LICEO, teacherDisplayName } from './teachers-liceo.js'

describe('teachers-liceo', () => {
  it('tiene 29 docentes con email @liceo.test', () => {
    expect(TEACHERS_LICEO).toHaveLength(29)
    for (const t of TEACHERS_LICEO) {
      expect(t.email).toMatch(/@liceo\.test$/)
      expect(t.firstName.length).toBeGreaterThan(0)
      expect(t.lastName.length).toBeGreaterThan(0)
      expect(teacherDisplayName(t)).toBe(`${t.firstName} ${t.lastName}`)
    }
  })

  it('usernames únicos', () => {
    const usernames = TEACHERS_LICEO.map((t) => t.username)
    expect(new Set(usernames).size).toBe(usernames.length)
  })
})
