import {
  buildMedicalLeavesQueryString,
  formatLicenseAdminUserDisplayName,
  getLicenseAdminDefaultStartDate,
  getLicenseStatusBadgeClass,
  getLicenseStatusLabel,
  getLicenseTypeLabel,
} from '@/lib/admin/licenses-display'

describe('admin-licenses-display', () => {
  it('fecha inicio año', () => {
    expect(getLicenseAdminDefaultStartDate(2024)).toBe('2024-01-01')
  })

  it('query string', () => {
    expect(buildMedicalLeavesQueryString({ userId: '', type: '', status: '', startDate: '', endDate: '' })).toBe('')
    const q = buildMedicalLeavesQueryString({
      userId: 'u1',
      type: 'MEDICAL_LEAVE',
      status: 'ACTIVE',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
    })
    expect(q).toContain('userId=u1')
    expect(q).toContain('type=MEDICAL_LEAVE')
  })

  it('nombre usuario', () => {
    expect(formatLicenseAdminUserDisplayName({ email: 'a@b.com', firstName: 'A', lastName: 'B' })).toBe('A B')
    expect(formatLicenseAdminUserDisplayName({ email: 'a@b.com', username: 'u' })).toBe('u')
    expect(formatLicenseAdminUserDisplayName({ email: 'a@b.com' })).toBe('a@b.com')
  })

  it('tipo y estado', () => {
    expect(getLicenseTypeLabel('MEDICAL_LEAVE')).toContain('Médica')
    expect(getLicenseStatusLabel('ACTIVE')).toBe('Activa')
    expect(getLicenseStatusBadgeClass('INACTIVE')).toContain('red')
    expect(getLicenseStatusBadgeClass('UNKNOWN')).toContain('gray')
  })
})
