import {
  isStrongPassword,
  getPasswordStrength,
  getStrengthBarClass,
} from '@/lib/auth/password-strength'

describe('password-strength', () => {
  it('detects strong passwords using the project rules', () => {
    expect(isStrongPassword('Abcd1234')).toBe(true)
    expect(isStrongPassword('abcdefghi')).toBe(false)
  })

  it('returns zero strength for empty password', () => {
    expect(getPasswordStrength('')).toBe(0)
  })

  it('returns 100 for strong passwords and caps weak passwords at 75', () => {
    expect(getPasswordStrength('Abcd1234')).toBe(100)
    expect(getPasswordStrength('abcdefghij')).toBe(75)
    expect(getPasswordStrength('abc')).toBe(24)
  })

  it('maps strength ranges to stable color classes', () => {
    expect(getStrengthBarClass(90)).toBe('bg-emerald-500')
    expect(getStrengthBarClass(70)).toBe('bg-yellow-500')
    expect(getStrengthBarClass(20)).toBe('bg-red-500')
  })
})
