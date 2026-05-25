/**
 * Textos legibles para la columna "Detalle" de auditoría (personal administrativo no técnico).
 */

const LOGIN_FAILURE_REASONS: Record<string, string> = {
  UNKNOWN_IDENTIFIER_OR_NO_PASSWORD: 'Usuario o contraseña incorrectos.',
  ACCOUNT_INACTIVE: 'La cuenta está desactivada.',
  ACCOUNT_LOCKED: 'La cuenta estaba bloqueada por intentos fallidos.',
  INVALID_PASSWORD: 'La contraseña no coincide.',
}

const MEDICAL_LEAVE_TYPE_LABELS: Record<string, string> = {
  MEDICAL_LEAVE: 'Licencia médica',
  WORK_LEAVE: 'Permiso laboral',
  OTHER: 'Otro tipo de permiso',
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  JORNADA_LABORAL: 'Jornada laboral',
  REUNION: 'Reunión',
  CLASE: 'Clase',
  EVENTO: 'Evento',
  CAPACITACION: 'Capacitación',
  CITA_MEDICA: 'Cita médica',
}

const SYSTEM_SETTINGS_LABELS: Record<string, string> = {
  livenessCheckEnabled: 'verificación de vida en altas',
  attendanceNoShowGraceMinutes: 'tolerancia de no-show docente',
  attendanceLateToleranceMinutes: 'tolerancia de llegada tarde',
  attendanceEarlyExitToleranceMinutes: 'tolerancia de salida anticipada',
  attendanceClassBridgeGapMinutes: 'tiempo entre clases del mismo bloque',
  attendanceMonitorEnabled: 'monitor automático de incidentes',
  attendanceMonitorIntervalMs: 'intervalo del monitor',
  biometricLateHour: 'hora de tardanza biométrica',
  biometricLateMinute: 'minuto de tardanza biométrica',
  biometricDuplicateWindowMinutes: 'ventana de huellas repetidas',
}

const USER_FIELD_LABELS: Record<string, string> = {
  role: 'rol',
  username: 'nombre de usuario',
  nationalId: 'cédula',
  nationalIdDocumentExpiresAt: 'vencimiento del documento',
  firstName: 'nombre',
  lastName: 'apellido',
  name: 'nombre mostrado',
  isApproved: 'aprobación de la cuenta',
  approvedAt: 'fecha de aprobación',
  isActive: 'cuenta activa',
}

function asRecord(m: unknown): Record<string, unknown> | null {
  if (m && typeof m === 'object' && !Array.isArray(m)) return m as Record<string, unknown>
  return null
}

export function auditMetadataTechnicalJson(metadata: unknown): string | undefined {
  if (metadata == null) return undefined
  try {
    return JSON.stringify(metadata)
  } catch {
    return String(metadata)
  }
}

export type AuditDetailDisplay = {
  /** Líneas de texto para mostrar en la tabla; vacío → mostrar "—" */
  lines: string[]
  /** JSON compacto para tooltip o bloque técnico */
  technicalJson?: string
}

function formatWhenShort(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function joinUniqueLabels(keys: string[], catalog: Record<string, string>): string {
  const parts = keys.map((k) => catalog[k] ?? k.replace(/([A-Z])/g, ' $1').trim().toLowerCase())
  if (parts.length <= 1) return parts[0] ?? ''
  if (parts.length === 2) return `${parts[0]} y ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`
}

/**
 * Resume metadata según el código de acción (enum del backend).
 */
export function auditMetadataDisplay(action: string, metadata: unknown): AuditDetailDisplay {
  const r = asRecord(metadata)
  if (!r || Object.keys(r).length === 0) {
    return { lines: [] }
  }

  const technicalJson = auditMetadataTechnicalJson(metadata)
  switch (action) {
    case 'AUTH_LOGIN_FAILURE': {
      const reason = String(r.reason ?? '')
      const line = LOGIN_FAILURE_REASONS[reason] ?? `Intento rechazado (${reason.replace(/_/g, ' ').toLowerCase()}).`
      return { lines: [line], technicalJson }
    }
    case 'AUTH_GOOGLE_LOGIN_SUCCESS': {
      const needs = r.needsProfileCompletion === true
      return {
        lines: [
          needs
            ? 'Ingresó con Google y debe completar el perfil antes de usar el sistema.'
            : 'Ingresó correctamente con cuenta de Google.',
        ],
        technicalJson,
      }
    }
    case 'USER_CREATED_BY_ADMIN': {
      const email = r.email != null ? String(r.email) : null
      return {
        lines: email ? [`Alta de usuario con correo ${email}.`] : ['Alta de usuario registrada.'],
        technicalJson,
      }
    }
    case 'USER_UPDATED_BY_ADMIN': {
      const fields = r.fieldsChanged
      if (Array.isArray(fields) && fields.length > 0) {
        const strs = fields.map((f) => String(f))
        if (strs.length === 1) {
          const one = USER_FIELD_LABELS[strs[0]] ?? strs[0]
          return { lines: [`Se actualizó ${one}.`], technicalJson }
        }
        const phrase = joinUniqueLabels(strs, USER_FIELD_LABELS)
        return { lines: [`Se actualizaron: ${phrase}.`], technicalJson }
      }
      return { lines: ['Se guardaron cambios en el usuario.'], technicalJson }
    }
    case 'USER_ACCOUNT_LOCK_TOGGLED': {
      const locked = r.locked === true
      return {
        lines: [locked ? 'Se bloqueó temporalmente el acceso a la cuenta.' : 'Se quitó el bloqueo de acceso a la cuenta.'],
        technicalJson,
      }
    }
    case 'ADMIN_PASSWORD_RESET_ISSUED': {
      const exp = r.expiresAt != null ? String(r.expiresAt) : null
      return {
        lines: [
          exp
            ? `Se generó un enlace para restablecer contraseña (válido hasta ${formatWhenShort(exp)}).`
            : 'Se generó un enlace para restablecer contraseña.',
        ],
        technicalJson,
      }
    }
    case 'SYSTEM_SETTINGS_UPDATED': {
      const keys = r.keysChanged
      if (Array.isArray(keys) && keys.length > 0) {
        const strs = keys.map((k) => String(k))
        if (strs.length === 1) {
          const one = SYSTEM_SETTINGS_LABELS[strs[0]] ?? strs[0]
          return { lines: [`Se actualizó la configuración de ${one}.`], technicalJson }
        }
        const phrase = joinUniqueLabels(strs, SYSTEM_SETTINGS_LABELS)
        return { lines: [`Se actualizaron ajustes: ${phrase}.`], technicalJson }
      }
      return { lines: ['Se actualizaron parámetros del sistema.'], technicalJson }
    }
    case 'MEDICAL_LEAVE_CREATED': {
      const typeKey = r.type != null ? String(r.type) : ''
      const typeLabel = MEDICAL_LEAVE_TYPE_LABELS[typeKey] ?? 'permiso / licencia'
      return {
        lines: [
          `Tipo: ${typeLabel}. El trámite aparece en la columna Entidad.`,
        ],
        technicalJson,
      }
    }
    case 'MEDICAL_LEAVE_UPDATED': {
      return { lines: ['Se modificaron datos de la licencia o permiso.'], technicalJson }
    }
    case 'MEDICAL_LEAVE_DEACTIVATED': {
      return { lines: ['La licencia o permiso dejó de estar vigente.'], technicalJson }
    }
    case 'EVENT_CREATED': {
      const title = r.title != null ? String(r.title) : ''
      const typeKey = r.type != null ? String(r.type) : ''
      const typeLabel = EVENT_TYPE_LABELS[typeKey] ?? typeKey.replace(/_/g, ' ').toLowerCase()
      const assigned = r.assignedUserId != null && String(r.assignedUserId).trim() !== ''
      const lines: string[] = []
      if (title) lines.push(`Título: «${title.length > 120 ? `${title.slice(0, 117)}…` : title}».`)
      if (typeKey) lines.push(`Tipo: ${typeLabel}.`)
      lines.push(
        assigned
          ? 'Quedó asignado a otra persona: recibió aviso en la campana (y push si aplica).'
          : 'Sin asignatario: no se generó aviso de asignación.',
      )
      return { lines, technicalJson }
    }
    default:
      break
  }

  /* Casos sin metadata tipada o acciones futuras: lista breve traduciendo claves conocidas */
  const entries = Object.entries(r)
  if (entries.length === 1) {
    const [k, v] = entries[0]
    if (k === 'affectedUserId') {
      return {
        lines: ['La acción aplica al titular del registro (ver columna Entidad).'],
        technicalJson,
      }
    }
    const val = typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v)
    const keyLabel =
      k === 'reason'
        ? 'Motivo'
        : k === 'email'
          ? 'Correo'
          : k === 'type'
            ? 'Tipo'
            : k.replace(/_/g, ' ')
    return { lines: [`${keyLabel}: ${val}.`], technicalJson }
  }

  return {
    lines: ['Hay datos adicionales; el bloque «Datos técnicos» muestra la información exacta.'],
    technicalJson,
  }
}
