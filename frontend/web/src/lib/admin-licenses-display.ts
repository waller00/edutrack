export function getLicenseAdminDefaultStartDate(referenceYear?: number): string {
  const y = referenceYear ?? new Date().getFullYear()
  return `${y}-01-01`
}

export type MedicalLeavesFilterParams = {
  userId: string
  type: string
  status: string
  startDate: string
  endDate: string
}

export function buildMedicalLeavesQueryString(f: MedicalLeavesFilterParams): string {
  const params = new URLSearchParams()
  if (f.userId) params.set('userId', f.userId)
  if (f.type) params.set('type', f.type)
  if (f.status) params.set('status', f.status)
  if (f.startDate) params.set('startDate', f.startDate)
  if (f.endDate) params.set('endDate', f.endDate)
  return params.toString()
}

export function formatLicenseAdminUserDisplayName(user: {
  firstName?: string
  lastName?: string
  username?: string
  email: string
}): string {
  if (user.firstName && user.lastName) return `${user.firstName} ${user.lastName}`
  return user.username || user.email
}

export function getLicenseTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    MEDICAL_LEAVE: 'Licencia Médica',
    WORK_LEAVE: 'Licencia Laboral',
    OTHER: 'Otro',
  }
  return labels[type] || type
}

export function getLicenseStatusBadgeClass(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'bg-green-100 text-green-800'
    case 'INACTIVE':
      return 'bg-red-100 text-red-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

export function getLicenseStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    ACTIVE: 'Activa',
    INACTIVE: 'Inactiva',
  }
  return labels[status] || status
}

/** Texto único para el enlace/botón de certificado (URL o adjunto en base64). */
export function getMedicalLeaveCertificateLinkLabel(_certificate: string): string {
  return 'Ver Certificado'
}
