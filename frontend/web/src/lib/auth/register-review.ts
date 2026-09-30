/** Lo que el usuario completó en el paso 1, tal como se muestra en la revisión. */
export type RegisterReviewData = {
  firstName: string
  lastName: string
  nationalId: string
  /** YYYY-MM-DD */
  birthdate: string
  email: string
  phone: string
  roleLabel: string
}

export type ReviewSummaryRow = { label: string; value: string }

/** `1990-01-15` → `15/01/1990`. Sin fecha (o con otro formato) se devuelve tal cual. */
export function formatReviewDate(ymd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd.trim())
  return match ? `${match[3]}/${match[2]}/${match[1]}` : ymd
}

/** Filas del resumen, en el orden en que se completaron. */
export function buildReviewSummary(data: RegisterReviewData): ReviewSummaryRow[] {
  return [
    { label: 'Nombres', value: data.firstName.trim() },
    { label: 'Apellidos', value: data.lastName.trim() },
    { label: 'Cédula', value: data.nationalId.trim() },
    { label: 'Fecha de nacimiento', value: formatReviewDate(data.birthdate) },
    { label: 'Correo', value: data.email.trim() },
    { label: 'Celular', value: data.phone.trim() },
    { label: 'Perfil', value: data.roleLabel },
  ]
}
