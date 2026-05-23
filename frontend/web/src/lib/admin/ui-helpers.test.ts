import { getAdminFlashMessageClass } from '@/lib/admin/ui-helpers'

describe('getAdminFlashMessageClass', () => {
  it('éxito vs error', () => {
    expect(getAdminFlashMessageClass('✅ OK')).toContain('green')
    expect(getAdminFlashMessageClass('❌ falló')).toContain('red')
  })
})
