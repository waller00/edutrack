/** Etiquetas para campos del API de licencias médicas (Zod). */
const MEDICAL_LEAVE_FIELD_LABELS: Record<string, string> = {
  userId: 'Usuario',
  type: 'Tipo de licencia',
  startDate: 'Fecha de inicio',
  endDate: 'Fecha de fin',
  reason: 'Motivo',
  notes: 'Notas',
}

type ZodLikeIssue = {
  path?: (string | number)[]
  message?: string
  code?: string
  minimum?: number
  type?: string
  validation?: string
}

function fieldLabel(path: (string | number)[] | undefined): string {
  if (!path || path.length === 0) return 'Formulario'
  const key = String(path[0])
  return MEDICAL_LEAVE_FIELD_LABELS[key] || key
}

function describeIssue(issue: ZodLikeIssue): string {
  const { code, message, minimum, type, validation } = issue
  const msg = message || ''

  if (code === 'invalid_type' && msg === 'Required') {
    return 'falta completar este dato'
  }
  if (code === 'too_small' && type === 'string' && typeof minimum === 'number' && minimum >= 1) {
    return 'no puede estar vacío'
  }
  if (code === 'too_big' && type === 'string') {
    return 'es demasiado largo'
  }
  if (code === 'invalid_string' && validation === 'datetime') {
    return 'fecha u hora inválida'
  }
  if (code === 'invalid_string' && validation === 'uuid') {
    return 'identificador inválido'
  }
  if (msg.includes('at least') && msg.includes('character')) {
    return 'no puede estar vacío'
  }
  if (msg === 'Invalid datetime') {
    return 'fecha u hora inválida'
  }

  return msg || 'valor inválido'
}

/**
 * Arma un texto legible a partir del error lanzado por `api()` (status + `data` del JSON).
 * Incluye detalle por campo cuando el backend envía `issues` o `errors` (Zod).
 */
export function formatValidationErrorFromApi(error: unknown): string {
  const err = error as {
    message?: string
    data?: { message?: string; errors?: ZodLikeIssue[]; issues?: ZodLikeIssue[] }
  }

  const data = err?.data
  const issues = data?.issues ?? data?.errors
  const headline = (data?.message || err?.message || 'Error').replace(/^Error:\s*/i, '').trim()

  if (!issues || !Array.isArray(issues) || issues.length === 0) {
    return headline.startsWith('❌') ? headline : `❌ ${headline}`
  }

  const bullets = issues.map((issue) => {
    const label = fieldLabel(issue.path)
    const detail = describeIssue(issue)
    return `• ${label}: ${detail}`
  })

  const intro = headline.toLowerCase().includes('inválid') ? 'Revisá lo siguiente:' : `${headline}:`
  return `❌ ${intro}\n${bullets.join('\n')}`
}
