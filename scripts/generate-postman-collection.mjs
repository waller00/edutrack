// Genera la colección Postman de EduTrack a partir de las rutas reales del backend.
// Uso: node scripts/generate-postman-collection.mjs (escribe en postman/)
import { writeFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const OUT_DIR = '/home/waller/Documentos/final_class/postman'

// --- helpers -----------------------------------------------------------------

/**
 * R('Nombre', 'GET', '/path/{{id}}', { desc, query, body, headers, noAuth, test, prerequest, raw })
 * query: [['key','value', {optional:true, desc:'...'}]]
 */
function R(name, method, path, opts = {}) {
  const { desc = '', query = [], body, headers = [], noAuth = false, test, prerequest, rawBody, contentType } = opts

  const qs = query.map(([key, value, o = {}]) => ({
    key,
    value: String(value ?? ''),
    ...(o.optional ? { disabled: true } : {}),
    ...(o.desc ? { description: o.desc } : {}),
  }))

  const cleanPath = path.replace(/^\//, '')
  const enabled = qs.filter((q) => !q.disabled)
  const rawQs = enabled.length ? `?${enabled.map((q) => `${q.key}=${q.value}`).join('&')}` : ''

  const hdrs = [...headers]
  if (body !== undefined || rawBody !== undefined) {
    hdrs.unshift({ key: 'Content-Type', value: contentType || 'application/json' })
  }

  const event = []
  if (prerequest) event.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: prerequest.split('\n') } })
  if (test) event.push({ listen: 'test', script: { type: 'text/javascript', exec: test.split('\n') } })

  const item = {
    name,
    request: {
      method,
      header: hdrs,
      url: {
        raw: `{{baseUrl}}/${cleanPath}${rawQs}`,
        host: ['{{baseUrl}}'],
        path: cleanPath.split('/').filter(Boolean),
        ...(qs.length ? { query: qs } : {}),
      },
      description: desc,
    },
    response: [],
  }

  if (body !== undefined) {
    item.request.body = {
      mode: 'raw',
      raw: JSON.stringify(body, null, 2),
      options: { raw: { language: 'json' } },
    }
  } else if (rawBody !== undefined) {
    item.request.body = { mode: 'raw', raw: rawBody, options: { raw: { language: 'text' } } }
  }

  if (noAuth) {
    item.event = [
      ...event,
      {
        listen: 'prerequest',
        script: { type: 'text/javascript', exec: ['// Endpoint público / autenticado por otro medio: no inyectar cookie de sesión.', 'pm.request.headers.remove("Cookie");'] },
      },
    ]
  } else if (event.length) {
    item.event = event
  }

  return item
}

const F = (name, description, item) => ({ name, description, item })

// --- constantes reutilizadas -------------------------------------------------

const UUID = '{{userId}}'
const RANGE = [
  ['startDate', '{{dateFrom}}', { desc: 'YYYY-MM-DD (día civil Uruguay)' }],
  ['endDate', '{{dateTo}}', { desc: 'YYYY-MM-DD' }],
]
const SY = [
  ['schoolYearId', '{{schoolYearId}}', { optional: true, desc: 'Ciclo lectivo; si se omite se usa el activo' }],
  ['allYears', '1', { optional: true, desc: '1 = ignorar filtro de ciclo lectivo' }],
]

// --- carpetas ----------------------------------------------------------------

const folders = []

folders.push(
  F(
    '00 · Salud del servicio',
    'Chequeos de vida y readiness. No requieren sesión — sirven para verificar que el API responde antes de nada.',
    [
      R('Health', 'GET', '/health', { noAuth: true, desc: 'Siempre 200 si el proceso está vivo.' }),
      R('Ready', 'GET', '/ready', {
        noAuth: true,
        desc: '200 si Postgres y Redis responden; 503 si alguna dependencia está caída. Es el endpoint a mirar cuando el login falla con error=oidc.',
      }),
    ],
  ),
)

folders.push(
  F(
    '01 · Sesión (empezar acá)',
    [
      'EduTrack usa patrón BFF: la sesión es una cookie `sid` guardada en Redis, NO un Bearer token.',
      '',
      'Dos formas de obtener el `sid`:',
      '',
      '1. **Atajo programático** (solo si el server tiene `EDUTRACK_PERFORMANCE_AUTH_ENABLED=true`, típicamente local):',
      '   ejecutá "Crear sesión (performance)" y el `sid` queda guardado en el environment automáticamente.',
      '',
      '2. **Login real por navegador** (lo normal en producción): abrí `{{baseUrl}}/auth/login` en el browser,',
      '   completá Keycloak, y copiá la cookie `sid` desde DevTools → Application → Cookies. Pegala en la variable `sid`.',
      '',
      'Un script a nivel colección inyecta `Cookie: sid={{sid}}` en cada request.',
    ].join('\n'),
    [
      R('Crear sesión (performance) → guarda sid', 'POST', '/auth/performance/session', {
        noAuth: true,
        headers: [{ key: 'x-edutrack-performance-secret', value: '{{perfSecret}}' }],
        body: { identifier: '{{perfUser}}' },
        desc:
          'Emite una sesión BFF sin pasar por Keycloak. Requiere EDUTRACK_PERFORMANCE_AUTH_ENABLED=true y EDUTRACK_PERFORMANCE_AUTH_SECRET en el backend.\nDevuelve 404 si la función está apagada (así es en producción por defecto).',
        test: [
          'if (pm.response.code === 200) {',
          '  const b = pm.response.json();',
          '  pm.environment.set("sid", b.sid);',
          '  pm.environment.set("userId", b.user.id);',
          '  console.log("sid guardado para", b.user.email, b.user.role);',
          '}',
          'if (pm.response.code === 404) {',
          '  console.warn("Performance auth apagado en este server: usá el login por navegador y pegá el sid a mano.");',
          '}',
        ].join('\n'),
      }),
      R('Login (redirect a Keycloak)', 'GET', '/auth/login', {
        noAuth: true,
        query: [['returnTo', '/admin', { optional: true, desc: 'Path del frontend al que volver tras loguear' }]],
        desc: 'Devuelve un 302 a Keycloak. Desde Postman no completa el flujo: abrilo en el navegador.',
      }),
      R('Callback OIDC', 'GET', '/auth/callback', {
        noAuth: true,
        query: [
          ['code', '', { desc: 'Código de autorización que devuelve Keycloak' }],
          ['state', '', { desc: 'State de la request de login' }],
        ],
        desc: 'Lo llama Keycloak, no vos. Está acá para documentar el flujo: acá se crea la sesión en Redis y se setea la cookie sid.',
      }),
      R('Refrescar sesión', 'POST', '/auth/refresh', { desc: 'Renueva el access token de Keycloak asociado a la sesión.' }),
      R('Yo (perfil de la sesión)', 'GET', '/auth/me', {
        desc: 'Usuario + rol + permisos efectivos. Es el mejor test de que la cookie sid está funcionando.',
        test: [
          'pm.test("Sesión activa", () => pm.response.to.have.status(200));',
          'if (pm.response.code === 200) { pm.environment.set("userId", pm.response.json().id || pm.environment.get("userId")); }',
        ].join('\n'),
      }),
      R('Logout', 'POST', '/auth/logout', {
        body: { returnTo: '/login' },
        desc: 'Destruye la sesión en Redis, limpia la cookie y cierra la sesión en Keycloak.',
      }),
      R('Logout (enlace de navegador)', 'GET', '/auth/logout', {
        query: [['returnTo', '/login', { optional: true }]],
        desc: 'Misma operación que el POST, en forma de link navegable.',
      }),
    ],
  ),
)

folders.push(
  F(
    '02 · Cuenta y 2FA',
    'Gestión de la propia cuenta contra Keycloak (cambio de contraseña, segundo factor, códigos de recuperación).',
    [
      R('Ir a la cuenta Keycloak', 'GET', '/auth/account', { desc: 'Redirect a la consola de cuenta de Keycloak.' }),
      R('Ir a cambiar contraseña', 'GET', '/auth/account/password'),
      R('Ir a configurar 2FA', 'GET', '/auth/account/2fa'),
      R('Estado del 2FA', 'GET', '/auth/account/2fa/status', { desc: 'Indica si el usuario tiene OTP configurado.' }),
      R('Seguridad de la cuenta', 'GET', '/auth/account/security'),
      R('Códigos de recuperación', 'GET', '/auth/account/recovery-codes'),
      R('Desactivar 2FA con código OTP', 'POST', '/auth/account/2fa/disable', {
        body: { code: '123456' },
        desc: 'El código se valida contra Keycloak vía direct grant (Keycloak nunca devuelve el secretData).',
      }),
      R('Desactivar 2FA (borrado directo)', 'DELETE', '/auth/account/2fa'),
      R('Pedir desactivación de 2FA por correo', 'POST', '/auth/account/2fa/disable-email', {
        desc: 'Envía un mail con token firmado. Requiere correo verificado.',
      }),
      R('Pedir desactivación por correo (sin sesión)', 'POST', '/auth/account/2fa/disable-email-public', {
        noAuth: true,
        body: { identifier: 'usuario@ejemplo.com' },
        desc: 'Para quien quedó afuera por el 2FA. Responde HTML genérico siempre (no revela si el usuario existe).',
      }),
      R('Página de confirmación por correo', 'GET', '/auth/account/2fa/disable-email', {
        noAuth: true,
        query: [['token', '', { desc: 'Token firmado que llega por mail' }]],
      }),
      R('Confirmar desactivación por correo', 'POST', '/auth/account/2fa/disable-email/confirm', {
        noAuth: true,
        body: { token: '<token del mail>' },
      }),
      R('Olvidé mi contraseña', 'POST', '/auth/forgot-password', {
        noAuth: true,
        body: { email: 'usuario@ejemplo.com' },
        desc: 'Dispara el reset de Keycloak. Siempre responde ok para no filtrar qué correos existen.',
      }),
    ],
  ),
)

folders.push(
  F(
    '03 · Registro y perfil propio',
    'Alta de usuarios desde el formulario público y edición del propio perfil.',
    [
      R('Opciones de registro', 'GET', '/auth/registration-options', {
        noAuth: true,
        desc: 'Dice si la prueba de vida (Didit) es obligatoria y si está configurada.',
      }),
      R('¿Username disponible?', 'GET', '/auth/check-username', {
        noAuth: true,
        query: [['u', 'jperez']],
      }),
      R('Datos precargados de registro SSO', 'GET', '/auth/register/sso', {
        noAuth: true,
        query: [['token', '', { desc: 'Token de registro emitido tras login con Google' }]],
      }),
      R('Registrar usuario', 'POST', '/auth/register', {
        noAuth: true,
        body: {
          email: 'nuevo.docente@ejemplo.com',
          password: 'Contrasena.Fuerte1',
          nationalId: '12345672',
          firstName: 'Ana',
          lastName: 'Pérez',
          phone: '099123456',
          birthdate: '1990-05-12T00:00:00.000Z',
          role: 'TEACHER',
          livenessToken: '{{livenessToken}}',
        },
        desc: 'password y livenessToken son opcionales según configuración (SSO / liveness apagado).',
      }),
      R('Verificar correo', 'POST', '/auth/verify', { noAuth: true, body: { token: '<token del mail>' } }),
      R('Reenviar verificación', 'POST', '/auth/verify/resend'),
      R('Actualizar mi perfil', 'PUT', '/auth/profile', {
        body: {
          firstName: 'Ana',
          lastName: 'Pérez',
          username: 'ana.perez',
          phone: '099123456',
          nationalId: '12345672',
          birthdate: '1990-05-12',
        },
        desc: 'La cédula solo se puede fijar una vez (después la cambia un admin). Cambiar el email invalida la verificación.',
      }),
    ],
  ),
)

folders.push(
  F(
    '04 · Prueba de vida (Didit)',
    'Liveness para el registro. Inactivo si faltan DIDIT_API_KEY / DIDIT_WORKFLOW_ID.',
    [
      R('Crear sesión de liveness', 'POST', '/auth/didit/liveness-session', {
        noAuth: true,
        body: { email: 'nuevo.docente@ejemplo.com' },
        test: 'if (pm.response.code === 200) { pm.environment.set("livenessToken", pm.response.json().id || ""); }',
      }),
      R('Estado de la sesión de liveness', 'GET', '/auth/liveness/status', {
        noAuth: true,
        query: [['token', '{{livenessToken}}', { desc: 'UUID interno o didit_session_id' }]],
      }),
      R('Verificar campos contra el documento', 'POST', '/auth/didit/register-field-verify', {
        noAuth: true,
        body: {
          livenessToken: '{{livenessToken}}',
          email: 'nuevo.docente@ejemplo.com',
          firstName: 'Ana',
          lastName: 'Pérez',
          nationalId: '12345672',
          birthdate: '1990-05-12',
        },
        desc: 'Contrasta lo que escribió la persona contra lo que leyó Didit del documento.',
      }),
      R('Webhook de Didit', 'POST', '/webhooks/didit', {
        noAuth: true,
        headers: [{ key: 'x-signature', value: '<HMAC>' }],
        rawBody: '{"session_id":"...","status":"Approved"}',
        contentType: 'application/json',
        desc: 'Lo llama Didit, no vos. El cuerpo se lee en raw para validar el HMAC — está documentado acá por completitud.',
      }),
    ],
  ),
)

folders.push(
  F(
    '05 · Admin · Usuarios',
    'ABM de usuarios del sistema. Requiere permisos users.*. El usuario ADMIN está protegido: no se puede bloquear, bajar ni cambiarle el rol desde acá.',
    [
      R('Listar usuarios', 'GET', '/admin/users', {
        query: [
          ['page', '1'],
          ['pageSize', '20'],
          ['q', '', { optional: true, desc: 'Busca en email, username, nombre y apellido' }],
          ['role', 'TEACHER', { optional: true, desc: 'Código de perfil (TEACHER, STAFF, ...)' }],
          ['approved', 'true', { optional: true }],
          ['active', 'true', { optional: true }],
          ['verified', 'true', { optional: true }],
          ['locked', 'true', { optional: true }],
          ['docExpiring', 'true', { optional: true, desc: 'Carné de salud próximo a vencer' }],
        ],
        test: 'const b = pm.response.json(); if (b.items && b.items.length) pm.environment.set("userId", b.items[0].id);',
      }),
      R('Crear usuario', 'POST', '/admin/users', {
        body: { email: 'nuevo.staff@ejemplo.com', role: 'STAFF', username: 'nuevo.staff' },
        desc: 'Crea el usuario en EduTrack y en Keycloak. No se puede crear con rol ADMIN.',
      }),
      R('Actualizar usuario', 'PUT', `/admin/users/${UUID}`, {
        body: {
          firstName: 'Ana',
          lastName: 'Pérez',
          username: 'ana.perez',
          nationalId: '12345672',
          role: 'TEACHER',
          isApproved: true,
          isActive: true,
          emailVerified: true,
        },
      }),
      R('Bloquear / desbloquear usuario', 'PUT', `/admin/users/${UUID}/lock`, {
        query: [['lock', 'true', { desc: 'true bloquea 15 min y mata las sesiones; false desbloquea' }]],
      }),
      R('Forzar reset de contraseña', 'POST', `/admin/users/${UUID}/password/reset`, {
        desc: 'Manda el mail de reset de Keycloak e invalida las sesiones BFF activas.',
      }),
      R('Eliminar usuario', 'DELETE', `/admin/users/${UUID}`),
    ],
  ),
)

folders.push(
  F(
    '06 · Admin · Perfiles y permisos',
    'Roles de la organización (OrgRole) y la matriz de permisos por perfil. Cada permiso tiene alcance own | all.',
    [
      R('Listar roles', 'GET', '/admin/org-roles'),
      R('Crear rol', 'POST', '/admin/org-roles', { body: { code: 'COORDINADOR', label: 'Coordinación' } }),
      R('Editar rol', 'PATCH', '/admin/org-roles/{{roleCode}}', { body: { label: 'Coordinación académica', active: true } }),
      R('Eliminar rol', 'DELETE', '/admin/org-roles/{{roleCode}}', { desc: 'Los roles builtIn (ADMIN/TEACHER/STAFF) no se pueden borrar.' }),
      R('Matriz de permisos por perfil', 'GET', '/admin/profiles'),
      R('Crear perfil con permisos', 'POST', '/admin/profiles', {
        body: {
          code: 'COORDINADOR',
          label: 'Coordinación',
          permissions: [
            { id: 'attendance.read', enabled: true, scope: 'all' },
            { id: 'events.read', enabled: true, scope: 'all' },
          ],
        },
      }),
      R('Reemplazar permisos del perfil', 'PUT', '/admin/profiles/{{roleCode}}/permissions', {
        body: {
          permissions: [
            { id: 'attendance.read', enabled: true, scope: 'all' },
            { id: 'attendance.update', enabled: false },
          ],
        },
      }),
      R('Ajustar un permiso puntual', 'PUT', '/admin/profiles/{{roleCode}}/permissions/{{permissionId}}', {
        body: { enabled: true, scope: 'all' },
      }),
      R('Crear permiso a medida', 'POST', '/admin/profiles/{{roleCode}}/permissions', {
        body: { module: 'reports', action: 'export', label: 'Exportar reportes', enabled: true, scope: 'own' },
      }),
    ],
  ),
)

folders.push(
  F(
    '07 · Admin · Ajustes, Moodle y auditoría',
    'Parámetros operativos del sistema (tolerancias de asistencia, ventana antiduplicado biométrica, sincronización Moodle), auditoría y asistente de consultas.',
    [
      R('Leer ajustes', 'GET', '/admin/system-settings'),
      R('Guardar ajustes', 'PUT', '/admin/system-settings', {
        body: {
          livenessCheckEnabled: false,
          attendanceLateToleranceMinutes: 10,
          attendanceNoShowGraceMinutes: 30,
          attendanceEarlyExitToleranceMinutes: 10,
          attendanceClassBridgeGapMinutes: 30,
          attendanceMonitorEnabled: true,
          attendanceMonitorIntervalMs: 300000,
          biometricDuplicateWindowMinutes: 5,
          moodleSyncEnabled: true,
          moodleSyncStudents: true,
          moodleReconcileIntervalMs: 3600000,
          institutionTimezone: 'America/Montevideo',
        },
        desc: 'Todos los campos son opcionales: mandá solo los que querés cambiar.',
      }),
      R('Estado de la integración Moodle', 'GET', '/admin/moodle/status'),
      R('Reconciliar Moodle ahora', 'POST', '/admin/moodle/reconcile', {
        desc: 'Sincronización idempotente EduTrack→Moodle: cursos, titulares, suplentes, estudiantes y revocaciones.',
      }),
      R('Bitácora de auditoría', 'GET', '/admin/audit-logs', {
        query: [
          ['page', '1'],
          ['pageSize', '25'],
          ['action', '', { optional: true, desc: 'Filtra por tipo de acción (ej. USER_ACCOUNT_LOCK_TOGGLED)' }],
          ['actorUserId', '', { optional: true }],
          ['from', '{{dateFrom}}', { optional: true }],
          ['to', '{{dateTo}}', { optional: true }],
        ],
      }),
      R('Asistente de consultas (NL→SQL)', 'POST', '/admin/query-assistant', {
        body: {
          question: '¿Qué docentes tuvieron más faltas injustificadas este mes?',
          dateFrom: '{{dateFrom}}',
          dateTo: '{{dateTo}}',
        },
        desc: 'Traduce lenguaje natural a consultas sobre el modelo. Las preguntas de faltas se responden desde el resumen de ausencias, no con SQL crudo (las faltas son estado derivado).',
      }),
    ],
  ),
)

folders.push(
  F(
    '08 · Admin · Estudiantes',
    'Padrón de estudiantes, matrícula por ciclo lectivo y control de pagos (anual y mensual).',
    [
      R('Resumen por estado', 'GET', '/admin/students/summary', {
        query: [['courseId', '', { optional: true }]],
      }),
      R('Listar estudiantes', 'GET', '/admin/students', {
        query: [
          ['page', '1'],
          ['pageSize', '20'],
          ['q', '', { optional: true, desc: 'Nombre, apellido, cédula o email' }],
          ['courseId', '', { optional: true }],
          ['orientationId', '', { optional: true }],
          ['status', 'ACTIVE', { optional: true, desc: 'ACTIVE | GRADUATED | WITHDRAWN | TRANSFERRED' }],
          ['tuitionYear', '2026', { optional: true, desc: 'Filtra por estado de pago anual' }],
          ['tuitionMonth', '3', { optional: true }],
          ['tuitionPaid', 'false', { optional: true }],
          ['tuitionPreviewYear', '2026', { optional: true, desc: 'Año a mostrar en la grilla de cuotas' }],
          ...SY,
        ],
        test: 'const b = pm.response.json(); if (b.items && b.items.length) pm.environment.set("studentId", b.items[0].id);',
      }),
      R('Ver estudiante', 'GET', '/admin/students/{{studentId}}'),
      R('Crear estudiante', 'POST', '/admin/students', {
        body: {
          firstName: 'Lucía',
          lastName: 'Rodríguez',
          documentId: '12345672',
          courseId: '{{courseId}}',
          schoolYearId: '{{schoolYearId}}',
          email: 'lucia.rodriguez@ejemplo.com',
          username: 'lucia.rodriguez',
          contactPhone: '099111222',
          tutorPhone: '099333444',
          address: 'Av. Siempreviva 742',
          healthCardExpiresAt: '2027-03-01',
          enrollmentStatus: 'ACTIVE',
          tuitionYears: [{ year: 2026, paid: false }],
          tuitionMonths: [{ year: 2026, month: 3, paid: true, amountCents: 850000 }],
        },
        desc: 'La cédula es obligatoria y se valida con dígito verificador uruguayo. El email debe ser único entre estudiantes y usuarios (Moodle exige unicidad).',
      }),
      R('Actualizar estudiante', 'PUT', '/admin/students/{{studentId}}', {
        body: { contactPhone: '099555666', enrollmentStatus: 'ACTIVE', internalNotes: 'Cambio de teléfono informado por el tutor.' },
        desc: 'Todos los campos son opcionales (PATCH semántico). Mandar "" en un campo limpiable lo deja en null.',
      }),
      R('Eliminar estudiante', 'DELETE', '/admin/students/{{studentId}}'),
    ],
  ),
)

folders.push(
  F(
    '09 · Admin · Ciclos lectivos',
    'Alta, activación y cierre de años lectivos, y el pasaje de un ciclo al siguiente (promoción/repetición de estudiantes + copia de cursos).',
    [
      R('Listar ciclos', 'GET', '/admin/school-years', {
        test: 'const b = pm.response.json(); const rows = Array.isArray(b) ? b : (b.items || []); if (rows.length) pm.environment.set("schoolYearId", rows[0].id);',
      }),
      R('Ciclo activo', 'GET', '/admin/school-years/active'),
      R('Comparar dos ciclos', 'GET', '/admin/school-years/compare-metrics', {
        query: [
          ['a', '{{schoolYearId}}'],
          ['b', '{{sourceSchoolYearId}}'],
        ],
      }),
      R('Plan de inicio de ciclo', 'GET', '/admin/school-years/{{schoolYearId}}/start-plan', {
        query: [['sourceSchoolYearId', '{{sourceSchoolYearId}}', { optional: true }]],
        desc: 'Devuelve cursos y estudiantes candidatos con la decisión sugerida. Es el paso previo a POST /start.',
      }),
      R('Crear ciclo', 'POST', '/admin/school-years', {
        body: { code: 2027, label: 'Ciclo 2027', startsOn: '2027-03-01', endsOn: '2027-12-15', status: 'PLANNED' },
        desc: 'No se puede crear directo en ACTIVE: para eso está POST /:id/activate.',
      }),
      R('Editar ciclo', 'PATCH', '/admin/school-years/{{schoolYearId}}', {
        body: { label: 'Ciclo 2027 (ajustado)', startsOn: '2027-03-05', endsOn: '2027-12-20' },
      }),
      R('Iniciar ciclo (promoción de estudiantes)', 'POST', '/admin/school-years/{{schoolYearId}}/start', {
        body: {
          sourceSchoolYearId: '{{sourceSchoolYearId}}',
          courseIds: ['{{courseId}}'],
          orientationSelections: [{ courseId: '{{courseId}}', orientationId: '{{orientationId}}' }],
          studentDecisions: [
            { studentId: '{{studentId}}', action: 'PROMOTE', targetCourseId: '{{courseId}}', targetOrientationId: '{{orientationId}}' },
          ],
          copySubjects: true,
        },
        desc: 'action: PROMOTE | REPEAT | GRADUATED | WITHDRAWN | TRANSFERRED. Las dos primeras exigen targetCourseId dentro de courseIds.',
      }),
      R('Activar ciclo', 'POST', '/admin/school-years/{{schoolYearId}}/activate'),
      R('Cerrar ciclo', 'POST', '/admin/school-years/{{schoolYearId}}/close'),
      R('Copiar cursos desde otro ciclo', 'POST', '/admin/school-years/{{schoolYearId}}/copy-courses-from/{{sourceSchoolYearId}}', {
        desc: 'Solo funciona si el ciclo destino no tiene cursos todavía.',
      }),
      R('Eliminar ciclo', 'DELETE', '/admin/school-years/{{schoolYearId}}'),
    ],
  ),
)

folders.push(
  F(
    '10 · Estructura académica (cursos, orientaciones, asignaturas)',
    'Catálogo académico. Los cursos se ofrecen por ciclo lectivo (CourseOffering); las asignaturas se asocian por nivel, curso, tronco común, orientación u optativa.',
    [
      R('Listar orientaciones', 'GET', '/courses/orientations', {
        test: 'const b = pm.response.json(); const rows = Array.isArray(b) ? b : (b.items || []); if (rows.length) pm.environment.set("orientationId", rows[0].id);',
      }),
      R('Crear orientación', 'POST', '/courses/orientations', {
        body: { name: 'Científico', code: 'CIE', description: 'Bachillerato científico', isActive: true, sortOrder: 1 },
      }),
      R('Editar orientación', 'PUT', '/courses/orientations/{{orientationId}}', { body: { name: 'Científico-Biológico' } }),
      R('Eliminar orientación', 'DELETE', '/courses/orientations/{{orientationId}}'),
      R('Listar cursos', 'GET', '/courses', {
        query: [
          ['all', '1', { optional: true, desc: 'Admin: incluye inactivos' }],
          ['includeNotOffered', '1', { optional: true, desc: 'Admin: incluye cursos sin oferta en el ciclo' }],
          ...SY,
        ],
        test: 'const b = pm.response.json(); const rows = Array.isArray(b) ? b : (b.items || []); if (rows.length) pm.environment.set("courseId", rows[0].id);',
      }),
      R('Crear curso', 'POST', '/courses', {
        body: {
          name: '1º Bachillerato',
          code: '1BACH',
          level: 'EMS',
          sortOrder: 10,
          description: 'Primer año de bachillerato',
          isActive: true,
          offerInSchoolYear: true,
          schoolYearId: '{{schoolYearId}}',
        },
        desc: 'level: EBI (ciclo básico) | EMS (bachillerato).',
      }),
      R('Editar curso', 'PUT', '/courses/{{courseId}}', { body: { name: '1º Bachillerato A', offeringIsActive: true } }),
      R('Eliminar curso', 'DELETE', '/courses/{{courseId}}'),
      R('Orientaciones de un curso', 'GET', '/courses/{{courseId}}/orientations', {
        test: 'const b = pm.response.json(); const rows = Array.isArray(b) ? b : (b.items || []); if (rows.length) pm.environment.set("courseOrientationId", rows[0].id);',
      }),
      R('Asociar orientación al curso', 'POST', '/courses/{{courseId}}/orientations', {
        body: { orientationId: '{{orientationId}}', isActive: true, schoolYearId: '{{schoolYearId}}' },
      }),
      R('Quitar orientación del curso', 'DELETE', '/courses/{{courseId}}/orientations/{{courseOrientationId}}'),
      R('Asignaturas del curso', 'GET', '/courses/{{courseId}}/subjects', {
        test: 'const b = pm.response.json(); const rows = Array.isArray(b) ? b : (b.items || []); if (rows.length) pm.environment.set("subjectId", rows[0].id || rows[0].subjectId);',
      }),
      R('Crear asignatura en el curso', 'POST', '/courses/{{courseId}}/subjects', {
        body: {
          name: 'Matemática',
          code: 'MAT',
          associationType: 'CURSO_COMPLETO',
          level: 'EMS',
          sortOrder: 1,
          isActive: true,
        },
        desc: 'associationType: NIVEL_COMPLETO | CURSO_COMPLETO | TRONCO_COMUN_CURSO | ORIENTACION | OPTATIVA | PERSONALIZADA. Para ORIENTACION hay que mandar orientationId.',
      }),
      R('Editar asignatura del curso', 'PUT', '/courses/{{courseId}}/subjects/{{subjectId}}', {
        body: { name: 'Matemática I', isActive: true },
      }),
      R('Quitar asignatura del curso', 'DELETE', '/courses/{{courseId}}/subjects/{{subjectId}}'),
    ],
  ),
)

folders.push(
  F(
    '11 · Eventos y horarios',
    'Clases, jornadas laborales y reuniones. Los eventos recurrentes generan ocurrencias virtuales: se editan/cancelan por fecha (ymd) sin romper la serie.',
    [
      R('Mis eventos', 'GET', '/events/my-events', {
        query: [...RANGE, ['type', 'CLASE', { optional: true }], ['status', 'SCHEDULED', { optional: true }], ['courseId', '', { optional: true }]],
      }),
      R('Todos los eventos', 'GET', '/events/all', {
        query: [
          ['page', '1'],
          ['pageSize', '20'],
          ...RANGE,
          ['userId', '', { optional: true }],
          ['assignedUserId', '', { optional: true, desc: 'Docente designado' }],
          ['type', 'CLASE', { optional: true, desc: 'JORNADA_LABORAL | REUNION | CLASE' }],
          ['status', 'SCHEDULED', { optional: true, desc: 'SCHEDULED | IN_PROGRESS | COMPLETED | CANCELLED | EXPIRED' }],
          ['courseId', '', { optional: true }],
          ...SY,
        ],
        test: 'const b = pm.response.json(); if (b.items && b.items.length) pm.environment.set("eventId", b.items[0].id);',
      }),
      R('Ver evento', 'GET', '/events/{{eventId}}'),
      R('Crear evento', 'POST', '/events', {
        body: {
          title: 'Matemática 1ºA',
          description: 'Clase semanal',
          type: 'CLASE',
          startDate: '{{dateFrom}}',
          startTime: '08:00',
          endTime: '09:30',
          assignedUserId: '{{userId}}',
          courseId: '{{courseId}}',
          subjectId: '{{subjectId}}',
          courseOrientationId: '{{courseOrientationId}}',
          isRecurring: true,
          recurrenceType: 'WEEKLY',
          daysOfWeek: [1, 3],
          recurrenceEnd: '{{dateTo}}',
        },
        desc: 'startDate acepta YYYY-MM-DD y las horas HH:MM en hora de Uruguay (se normalizan a UTC). daysOfWeek: 0=domingo.',
        test: 'if (pm.response.code < 300) { const b = pm.response.json(); if (b.id) pm.environment.set("eventId", b.id); }',
      }),
      R('Editar evento', 'PUT', '/events/{{eventId}}', {
        body: { title: 'Matemática 1ºA (aula 12)', startTime: '08:15', endTime: '09:45', status: 'SCHEDULED' },
      }),
      R('Cancelar evento', 'PUT', '/events/{{eventId}}/cancel', { body: { reason: 'Paro docente' } }),
      R('Eliminar evento', 'DELETE', '/events/{{eventId}}'),
      R('Importar eventos (CSV parseado)', 'POST', '/events/import', {
        query: [['schoolYearId', '{{schoolYearId}}', { optional: true }]],
        body: {
          dryRun: true,
          rows: [
            {
              title: 'Historia 2ºB',
              type: 'CLASE',
              startDate: '2026-08-03',
              startTime: '10:00',
              endTime: '11:30',
              docente: 'ana.perez',
              curso: '2BACH',
              asignatura: 'HIS',
            },
          ],
        },
        desc: 'dryRun=true valida sin escribir. Máximo 500 filas por lote.',
      }),
      R('Cancelar una ocurrencia', 'POST', '/events/{{eventId}}/occurrences/{{ymd}}/cancel', {
        body: { reason: 'Feriado institucional' },
        desc: 'ymd en formato YYYY-MM-DD. Materializa un evento hijo cancelado sin tocar la serie madre.',
      }),
      R('Editar una ocurrencia', 'PUT', '/events/{{eventId}}/occurrences/{{ymd}}', {
        body: { title: 'Matemática (clase de consulta)', startTime: '09:00', endTime: '10:30', assignedUserId: '{{userId}}' },
      }),
      R('Restaurar una ocurrencia', 'DELETE', '/events/{{eventId}}/occurrences/{{ymd}}', {
        desc: 'Borra la excepción materializada: la ocurrencia vuelve a seguir la serie madre.',
      }),
    ],
  ),
)

folders.push(
  F(
    '12 · Suplencias',
    'Cobertura de una clase por otro docente. La suplencia hace que el titular quede como SUBSTITUTED (ausencia prevista cubierta) cuando el suplente ficha.',
    [
      R('Listar suplencias', 'GET', '/substitutions', {
        query: [
          ['from', '{{dateFrom}}', { optional: true }],
          ['to', '{{dateTo}}', { optional: true }],
          ['eventId', '', { optional: true }],
          ['originalTeacherUserId', '', { optional: true }],
          ['substituteUserId', '', { optional: true }],
          ['page', '1'],
          ['pageSize', '20'],
        ],
        test: 'const b = pm.response.json(); if (b.items && b.items.length) pm.environment.set("substitutionId", b.items[0].id);',
      }),
      R('Crear suplencia', 'POST', '/substitutions', {
        body: {
          eventId: '{{eventId}}',
          substituteUserId: '{{userId}}',
          reason: 'Licencia médica del titular',
          notes: 'Cubre solo esta semana',
          occurrenceDate: '{{ymd}}',
        },
        desc: 'occurrenceDate limita la suplencia a una fecha puntual de un evento recurrente.',
      }),
      R('Eliminar suplencia', 'DELETE', '/substitutions/{{substitutionId}}'),
    ],
  ),
)

folders.push(
  F(
    '13 · Asistencia',
    [
      'Registro y conciliación de asistencia.',
      '',
      'Ojo con el modelo: **las faltas no son filas**. Una ausencia se deriva comparando la designación planificada contra las marcas existentes,',
      'y solo se materializa como fila cuando alguien la justifica o la marca explícitamente. Por eso `status=ABSENCES` en los filtros es un',
      'centinela que agrupa ABSENT_NOT_JUSTIFIED + ABSENT_JUSTIFIED + SUBSTITUTED.',
    ].join('\n'),
    [
      R('Registrar marca manual', 'POST', '/attendance/register', {
        body: {
          type: 'CHECK_IN',
          date: '2026-08-03T00:00:00.000Z',
          time: '2026-08-03T11:05:00.000Z',
          eventId: '{{eventId}}',
          notes: 'Registro manual por falla del lector',
        },
        desc: 'date y time en ISO/UTC. eventId es obligatorio.',
      }),
      R('Mis asistencias', 'GET', '/attendance/my-attendances', {
        query: [
          ...RANGE,
          ['type', 'CHECK_IN', { optional: true }],
          ['status', 'PRESENT', { optional: true }],
          ['includeAbsences', '1', { optional: true, desc: 'Suma las ausencias derivadas (no persistidas)' }],
        ],
      }),
      R('Listado administrativo', 'GET', '/attendance/all', {
        query: [
          ['page', '1'],
          ['pageSize', '20'],
          ...RANGE,
          ['userId', '', { optional: true }],
          ['eventId', '', { optional: true }],
          ['eventType', 'CLASE', { optional: true }],
          ['type', 'CHECK_IN', { optional: true, desc: 'CHECK_IN | CHECK_OUT' }],
          ['status', 'ABSENCES', { optional: true, desc: 'Centinela ABSENCES = todas las ausencias' }],
          ['role', 'TEACHER', { optional: true }],
          ...SY,
        ],
        desc: 'Paginado por ítems (un par entrada+salida cuenta como uno) para no cortar pares entre páginas.',
        test: 'const b = pm.response.json(); if (b.items && b.items.length && b.items[0].id) pm.environment.set("attendanceId", b.items[0].id);',
      }),
      R('Estadísticas', 'GET', '/attendance/stats', {
        query: [
          ...RANGE,
          ['userId', '', { optional: true }],
          ['eventType', 'CLASE', { optional: true }],
          ['type', 'CHECK_IN', { optional: true }],
          ['role', 'TEACHER', { optional: true }],
          ...SY,
        ],
        desc: 'Tasa de presencia/salida, presentes, ausencias y llegadas tarde del filtro aplicado.',
      }),
      R('Resumen por rango', 'GET', '/attendance/summary', {
        query: [['from', '{{dateFrom}}'], ['to', '{{dateTo}}'], ['userId', '', { optional: true }]],
      }),
      R('Editar asistencia', 'PUT', '/attendance/{{attendanceId}}', {
        body: { status: 'JUSTIFIED', notes: 'Certificado presentado en secretaría', reason: 'Corrección administrativa' },
      }),
      R('Justificar una asistencia', 'POST', '/attendance/{{attendanceId}}/justify', {
        body: { type: 'ABSENCE', reason: 'Certificado médico', notes: 'Presentado el 04/08', attachment: 'https://...' },
      }),
      R('Justificar un rango completo', 'POST', '/attendance/justify-range', {
        body: {
          userId: '{{userId}}',
          from: '{{dateFrom}}',
          to: '{{dateTo}}',
          type: 'ABSENCE',
          reason: 'Licencia sin goce de sueldo',
          notes: 'Aprobada por dirección',
          includeLate: false,
        },
        desc: 'Justifica de una todas las faltas (y opcionalmente tardanzas) ya vencidas de la persona en el rango.',
      }),
      R('Materializar una ausencia', 'POST', '/attendance/materialize-absence', {
        body: { userId: '{{userId}}', eventId: '{{eventId}}', date: '{{ymd}}', status: 'ABSENT_NOT_JUSTIFIED', notes: 'No se presentó' },
        desc: 'Convierte una ausencia derivada en una fila real de Attendance.',
      }),
      R('Marcar ausencias automáticamente', 'POST', '/attendance/mark-absences', {
        body: {
          startDate: '{{dateFrom}}',
          endDate: '{{dateTo}}',
          userId: '{{userId}}',
          expectedAbsence: false,
          schoolYearId: '{{schoolYearId}}',
        },
        desc: 'Barre el rango y materializa las ausencias que corresponden según eventos, licencias y días no laborables.',
      }),
      R('Agregar nota administrativa', 'POST', '/attendance/{{attendanceId}}/note', {
        body: { note: 'Llegó tarde por paro de transporte', markLate: true, markEarlyExit: false },
      }),
      R('Eliminar asistencia', 'DELETE', '/attendance/{{attendanceId}}'),
    ],
  ),
)

folders.push(
  F(
    '14 · Incidencias de asistencia',
    'Incidencias accionables detectadas por el monitor (docente que no se presentó, salida sin entrada).',
    [
      R('Listar incidencias', 'GET', '/attendance-incidents', {
        query: [
          ['status', 'OPEN', { optional: true, desc: 'OPEN | ACKNOWLEDGED | RESOLVED' }],
          ['type', 'TEACHER_NO_SHOW', { optional: true }],
          ['userId', '', { optional: true }],
          ['eventId', '', { optional: true }],
          ['page', '1'],
          ['pageSize', '20'],
        ],
        test: 'const b = pm.response.json(); if (b.items && b.items.length) pm.environment.set("incidentId", b.items[0].id);',
      }),
      R('Escanear ahora', 'POST', '/attendance-incidents/scan-now', {
        desc: 'Corre el detector fuera del intervalo programado.',
      }),
      R('Resolver incidencia', 'PATCH', '/attendance-incidents/{{incidentId}}/resolve'),
    ],
  ),
)

folders.push(
  F(
    '15 · Licencias médicas',
    'Licencias por tipo (MEDICAL_LEAVE, WORK_LEAVE, OTHER). Una licencia activa bloquea las marcas biométricas del período.',
    [
      R('Todas las licencias', 'GET', '/medical-leaves/all', {
        query: [
          ['page', '1'],
          ['pageSize', '20'],
          ['userId', '', { optional: true }],
          ['type', 'MEDICAL_LEAVE', { optional: true }],
          ['status', 'ACTIVE', { optional: true }],
          ['startDate', '{{dateFrom}}', { optional: true }],
          ['endDate', '{{dateTo}}', { optional: true }],
          ['schoolYearId', '{{schoolYearId}}', { optional: true }],
        ],
        test: 'const b = pm.response.json(); if (b.items && b.items.length) pm.environment.set("leaveId", b.items[0].id);',
      }),
      R('Mis licencias', 'GET', '/medical-leaves/my-leaves', { query: [['page', '1'], ['pageSize', '20']] }),
      R('Ver licencia', 'GET', '/medical-leaves/{{leaveId}}'),
      R('Crear licencia', 'POST', '/medical-leaves', {
        body: {
          userId: '{{userId}}',
          type: 'MEDICAL_LEAVE',
          startDate: '2026-08-03T00:00:00.000Z',
          endDate: '2026-08-07T23:59:59.000Z',
          reason: 'Certificado médico',
          notes: 'Presentado en secretaría',
        },
      }),
      R('Editar licencia', 'PUT', '/medical-leaves/{{leaveId}}', {
        body: { endDate: '2026-08-10T23:59:59.000Z', notes: 'Prórroga presentada' },
      }),
      R('Eliminar licencia', 'DELETE', '/medical-leaves/{{leaveId}}'),
    ],
  ),
)

folders.push(
  F(
    '16 · Días no laborables',
    'Feriados y días no laborables institucionales. Una marca biométrica en estos días se rechaza y no computa horas ni faltas.',
    [
      R('Listar', 'GET', '/non-working-days', {
        query: [['from', '{{dateFrom}}', { optional: true }], ['to', '{{dateTo}}', { optional: true }]],
        test: 'const b = pm.response.json(); const rows = Array.isArray(b) ? b : (b.items || []); if (rows.length) pm.environment.set("nonWorkingDayId", rows[0].id);',
      }),
      R('Crear', 'POST', '/non-working-days', {
        body: { date: '2026-08-25', type: 'HOLIDAY', reason: 'Declaratoria de la Independencia', schoolYearId: '{{schoolYearId}}' },
        desc: 'type: HOLIDAY | NON_WORKING_DAY.',
      }),
      R('Eliminar', 'DELETE', '/non-working-days/{{nonWorkingDayId}}'),
    ],
  ),
)

folders.push(
  F(
    '17 · Analítica',
    'Tablero de indicadores para dirección: series temporales, distribución de estados, comparación con el período anterior y rankings de riesgo.',
    [
      R('Tablero', 'GET', '/analytics/dashboard', {
        query: [
          ['from', '{{dateFrom}}'],
          ['to', '{{dateTo}}'],
          ['role', 'TEACHER', { optional: true }],
          ['userId', '', { optional: true }],
          ['eventType', 'CLASE', { optional: true }],
          ['granularity', 'day', { optional: true, desc: 'day | week | month' }],
          ['compareToPrevious', '1', { optional: true }],
          ...SY,
        ],
      }),
      R('Línea de tiempo del día', 'GET', '/analytics/attendance-timeline', {
        query: [
          ['date', '{{ymd}}', { optional: true }],
          ['teacherId', '', { optional: true }],
          ['groupId', '', { optional: true }],
          ['status', '', { optional: true }],
          ['type', '', { optional: true }],
          ...SY,
        ],
      }),
      R('Rankings de riesgo', 'GET', '/analytics/rankings', {
        query: [['from', '{{dateFrom}}'], ['to', '{{dateTo}}'], ['role', 'TEACHER', { optional: true }]],
      }),
      R('Métricas', 'GET', '/analytics/metrics', { desc: 'Contrato reservado para la fase 2: hoy devuelve un stub.' }),
      R('Alertas críticas', 'GET', '/analytics/alerts/critical', { desc: 'Contrato reservado: hoy devuelve lista vacía.' }),
      R('Anomalías', 'GET', '/analytics/anomalies', { desc: 'Contrato reservado: hoy devuelve lista vacía.' }),
    ],
  ),
)

folders.push(
  F(
    '18 · Reportes',
    'Reportes renderizados en el momento (a diferencia de /exports, que va por trabajo asincrónico).',
    [
      R('Reporte de asistencia', 'GET', '/reports/report', {
        query: [
          ['format', 'excel', { desc: 'excel | pdf' }],
          ...RANGE,
          ['userId', '', { optional: true }],
          ['eventId', '', { optional: true }],
          ['eventType', 'CLASE', { optional: true }],
          ['type', 'CHECK_IN', { optional: true }],
          ['status', 'PRESENT', { optional: true }],
          ['role', 'TEACHER', { optional: true }],
        ],
      }),
      R('Eventos de una persona', 'GET', '/reports/user-events/{{userId}}', {
        query: [...RANGE, ...SY],
      }),
    ],
  ),
)

folders.push(
  F(
    '19 · Exportaciones',
    [
      'Exportaciones asincrónicas en tres pasos: **POST /exports** devuelve un `exportId` → **GET /exports/:id** consulta el estado',
      '(PENDING → DONE | FAILED) → **GET /exports/:id/download** baja el archivo.',
      '',
      'Formatos válidos por reporte:',
      '- `attendance_detail`: XLSX, PDF, CSV',
      '- `monthly_summary`: XLSX, PDF',
      '- `person_report` / `course_report`: XLSX, PDF (CSV no aplica)',
      '- `payroll_novedades`: XLSX, CSV (PDF no aplica)',
    ].join('\n'),
    [
      R('Crear exportación · Asistencia detallada', 'POST', '/exports', {
        body: {
          reportKey: 'attendance_detail',
          format: 'XLSX',
          from: '{{dateFrom}}',
          to: '{{dateTo}}',
          filters: { role: 'TEACHER', type: 'CHECK_IN' },
        },
        test: 'if (pm.response.code < 300) pm.environment.set("exportId", pm.response.json().exportId);',
      }),
      R('Crear exportación · Resumen mensual', 'POST', '/exports', {
        body: { reportKey: 'monthly_summary', format: 'PDF', from: '{{dateFrom}}', to: '{{dateTo}}', filters: {} },
        test: 'if (pm.response.code < 300) pm.environment.set("exportId", pm.response.json().exportId);',
      }),
      R('Crear exportación · Reporte por persona', 'POST', '/exports', {
        body: { reportKey: 'person_report', format: 'XLSX', from: '{{dateFrom}}', to: '{{dateTo}}', filters: { userId: '{{userId}}' } },
        test: 'if (pm.response.code < 300) pm.environment.set("exportId", pm.response.json().exportId);',
      }),
      R('Crear exportación · Reporte por curso', 'POST', '/exports', {
        body: { reportKey: 'course_report', format: 'XLSX', from: '{{dateFrom}}', to: '{{dateTo}}', filters: {} },
        test: 'if (pm.response.code < 300) pm.environment.set("exportId", pm.response.json().exportId);',
      }),
      R('Crear exportación · Novedades de liquidación (sueldos)', 'POST', '/exports', {
        body: {
          reportKey: 'payroll_novedades',
          format: 'CSV',
          from: '{{dateFrom}}',
          to: '{{dateTo}}',
          filters: { role: 'TEACHER', schoolYearId: '{{schoolYearId}}' },
        },
        desc:
          'Una fila por docente y concepto (CI, horas dictadas, suplencias, faltas, licencias) para importar en GNS / Memory / Kash / LIDESU.\nLas horas son NOMINALES (de la designación), no las biométricas: el titular cobra sus horas asignadas y las faltas descuentan como concepto aparte.\nCSV sale con separador ";" y BOM UTF-8. PDF no es un formato válido para este reporte.',
        test: 'if (pm.response.code < 300) pm.environment.set("exportId", pm.response.json().exportId);',
      }),
      R('Estado de la exportación', 'GET', '/exports/{{exportId}}', {
        desc: 'Devuelve status PENDING | DONE | FAILED. La UI hace polling cada 250 ms hasta 40 intentos.',
      }),
      R('Descargar exportación', 'GET', '/exports/{{exportId}}/download', {
        desc: 'Devuelve el binario con el content-type correspondiente. En Postman: "Send and Download" para guardarlo.',
      }),
    ],
  ),
)

folders.push(
  F(
    '20 · Calificaciones (puente Moodle)',
    'Planilla de notas por asignatura: se baja un XLSX con una hoja por tarea, se completa y se sube. Requiere que el curso ya esté sincronizado con Moodle.',
    [
      R('Tareas de la asignatura', 'GET', '/grades/activities', {
        query: [
          ['courseOfferingId', '{{courseOfferingId}}'],
          ['subjectId', '{{subjectId}}'],
          ['orientationId', '', { optional: true }],
          ['courseOrientationId', '', { optional: true }],
        ],
        desc: '409 si la asignatura todavía no tiene curso Moodle asociado.',
      }),
      R('Descargar planilla de notas', 'GET', '/grades/sheet', {
        query: [
          ['courseOfferingId', '{{courseOfferingId}}'],
          ['subjectId', '{{subjectId}}', { optional: true, desc: 'Sin esto baja todas las asignaturas de la oferta' }],
          ['assignmentId', '{{assignmentId}}', { optional: true, desc: 'Requiere subjectId' }],
          ['orientationId', '', { optional: true }],
        ],
      }),
      R('Subir planilla de notas', 'POST', '/grades/sheet/upload', {
        body: {
          courseOfferingId: '{{courseOfferingId}}',
          subjectId: '{{subjectId}}',
          assignmentId: 1,
          fileBase64: 'UEsDBBQ...  (xlsx en base64 o data-URL)',
        },
        desc: 'Devuelve cuántas notas se actualizaron y el detalle de errores por fila.',
      }),
    ],
  ),
)

folders.push(
  F(
    '21 · Biometría · Dispositivos y vinculación',
    [
      'Alta de lectores y enrolamiento PIN→persona.',
      '',
      'El flujo de vinculación: se crea un link-request → la próxima huella que llegue de un PIN sin mapear se **consume** para la vinculación',
      '(no genera asistencia) → se confirma. Por eso el request queda en WAITING_PUNCH hasta que la persona apoya el dedo.',
    ].join('\n'),
    [
      R('Lectores disponibles', 'GET', '/biometric/devices'),
      R('Lectores (administración)', 'GET', '/biometric/admin/devices', {
        test: 'const b = pm.response.json(); const rows = Array.isArray(b) ? b : (b.items || []); if (rows.length) { pm.environment.set("deviceId", rows[0].id); pm.environment.set("deviceCode", rows[0].code); }',
      }),
      R('Crear lector', 'POST', '/biometric/admin/devices', {
        body: {
          code: 'F22-PLANTA-BAJA',
          name: 'ZKTeco F22 · Planta baja',
          secret: 'un-secreto-largo-y-unico',
          admsSerial: 'CGV9234500123',
          timezone: 'America/Montevideo',
          isActive: true,
          allowedIps: ['192.168.1.50'],
        },
        desc: 'admsSerial es el SN que manda el reloj en /iclock. allowedIps vacío = sin restricción de IP.',
      }),
      R('Editar lector', 'PUT', '/biometric/admin/devices/{{deviceId}}', {
        body: { name: 'ZKTeco F22 · Entrada principal', isActive: true, allowedIps: ['192.168.1.50'] },
      }),
      R('Mi vinculación', 'GET', '/biometric/me/mapping'),
      R('Borrar mi vinculación', 'DELETE', '/biometric/me/mapping'),
      R('Vinculación activa', 'GET', '/biometric/link-requests/active'),
      R('Crear pedido de vinculación', 'POST', '/biometric/link-requests', {
        body: { deviceId: '{{deviceId}}' },
        desc: 'Alternativamente deviceCode. Queda en WAITING_PUNCH hasta que llegue una huella (TTL por BIOMETRIC_LINK_TTL_SECONDS, 120s por defecto).',
        test: 'if (pm.response.code < 300) { const b = pm.response.json(); if (b.id) pm.environment.set("linkRequestId", b.id); }',
      }),
      R('Confirmar vinculación', 'POST', '/biometric/link-requests/{{linkRequestId}}/confirm'),
      R('Cancelar vinculación', 'POST', '/biometric/link-requests/{{linkRequestId}}/cancel'),
      R('Biometría de un usuario', 'GET', '/biometric/admin/users/{{userId}}/biometric'),
      R('Borrar mapeo de un usuario', 'DELETE', '/biometric/admin/users/{{userId}}/biometric/mapping'),
      R('Vincular a un usuario', 'POST', '/biometric/admin/users/{{userId}}/biometric/link-requests', {
        body: { deviceId: '{{deviceId}}' },
        test: 'if (pm.response.code < 300) { const b = pm.response.json(); if (b.id) pm.environment.set("linkRequestId", b.id); }',
      }),
      R('Confirmar vinculación de un usuario', 'POST', '/biometric/admin/users/{{userId}}/biometric/link-requests/{{linkRequestId}}/confirm'),
      R('Cancelar vinculación de un usuario', 'POST', '/biometric/admin/users/{{userId}}/biometric/link-requests/{{linkRequestId}}/cancel'),
    ],
  ),
)

folders.push(
  F(
    '22 · Biometría · Ingesta de marcas',
    [
      'Dos caminos para que una marca entre al sistema. Ninguno usa la cookie de sesión: se autentican como dispositivo.',
      '',
      '**Genérico (JSON)**: `POST /biometric/adms-ingest` con el header `x-biometric-secret`.',
      '',
      '**Protocolo push ZKTeco (ADMS)**: el reloj F22 habla texto plano contra `/iclock/*` y se identifica por SN + IP permitida.',
      'El template de la huella nunca sale del dispositivo: solo viaja PIN + timestamp + status.',
    ].join('\n'),
    [
      R('Ingesta genérica (JSON)', 'POST', '/biometric/adms-ingest', {
        noAuth: true,
        headers: [{ key: 'x-biometric-secret', value: '{{deviceSecret}}' }],
        body: {
          deviceCode: '{{deviceCode}}',
          deviceUserId: '101',
          timestamp: '2026-08-03T11:02:00.000Z',
          punchType: 'CHECK_IN',
          externalId: 'manual-101-20260803T110200',
          payload: { source: 'postman' },
        },
        desc: 'Si se omite punchType, el tipo se infiere alternando contra la última marca del día. externalId da idempotencia.',
      }),
      R('ZKTeco · handshake (options=all)', 'GET', '/iclock/cdata', {
        noAuth: true,
        query: [['SN', '{{deviceSn}}'], ['options', 'all']],
        desc: 'Lo primero que pide el reloj al arrancar. Devuelve la configuración: Realtime=1, TimeZone=-3, delays.',
      }),
      R('ZKTeco · enviar fichadas (ATTLOG)', 'POST', '/iclock/cdata', {
        noAuth: true,
        query: [['SN', '{{deviceSn}}'], ['table', 'ATTLOG']],
        contentType: 'text/plain',
        rawBody: '101\t2026-08-03 08:02:11\t0\t1\n101\t2026-08-03 12:31:40\t1\t1',
        desc:
          'Formato TSV: PIN \\t timestamp \\t status \\t verifyMode. status 0=entrada, 1=salida.\nEl timestamp va en hora local del reloj (se convierte con la timezone del dispositivo).\nResponde OK:<n> con la cantidad de marcas procesadas.',
      }),
      R('ZKTeco · latido (getrequest)', 'GET', '/iclock/getrequest', {
        noAuth: true,
        query: [['SN', '{{deviceSn}}']],
        desc: 'El reloj pregunta si hay comandos pendientes. Actualiza lastSeenAt.',
      }),
      R('ZKTeco · registro del terminal', 'POST', '/iclock/registry', {
        noAuth: true,
        query: [['SN', '{{deviceSn}}']],
        contentType: 'text/plain',
        rawBody: '',
        desc: 'Registro / capacidades del terminal. La ruta acepta cualquier método (el F22 usa GET o POST según firmware).',
      }),
      R('ZKTeco · confirmación de comando', 'POST', '/iclock/devicecmd', {
        noAuth: true,
        query: [['SN', '{{deviceSn}}']],
        contentType: 'text/plain',
        rawBody: '',
      }),
    ],
  ),
)

folders.push(
  F(
    '23 · Notificaciones',
    'Push web (VAPID) y notificaciones dentro de la app.',
    [
      R('Clave pública VAPID', 'GET', '/notifications/web-push/vapid-public-key', { noAuth: true }),
      R('Estado de mi suscripción push', 'GET', '/notifications/web-push/status'),
      R('Suscribirme a push', 'POST', '/notifications/web-push/subscribe', {
        body: {
          subscription: {
            endpoint: 'https://fcm.googleapis.com/fcm/send/...',
            expirationTime: null,
            keys: { p256dh: '<clave p256dh>', auth: '<clave auth>' },
          },
          userAgent: 'Postman',
        },
        desc: '503 si el servidor no tiene VAPID configurado.',
      }),
      R('Cancelar suscripción push', 'DELETE', '/notifications/web-push/subscribe', {
        body: { endpoint: 'https://fcm.googleapis.com/fcm/send/...' },
        desc: 'Sin endpoint borra todas las suscripciones del usuario.',
      }),
      R('Enviarme una push de prueba', 'POST', '/notifications/web-push/test'),
      R('Mis notificaciones', 'GET', '/notifications/in-app', {
        query: [['unreadOnly', 'false', { desc: 'true | false' }], ['take', '50']],
        test: 'const b = pm.response.json(); const rows = b.items || b; if (Array.isArray(rows) && rows.length) pm.environment.set("notificationId", rows[0].id);',
      }),
      R('Cantidad sin leer', 'GET', '/notifications/in-app/unread-count'),
      R('Marcar como leída', 'PATCH', '/notifications/in-app/{{notificationId}}/read'),
      R('Marcar todas como leídas', 'POST', '/notifications/in-app/read-all'),
    ],
  ),
)

folders.push(
  F(
    '24 · ⚠️ Destructivo (NO correr contra producción)',
    [
      '**Estos endpoints borran datos de verdad.** Antes de mandar cualquiera de estos, verificá que `{{baseUrl}}` apunte a local.',
      '',
      'Las herramientas de /admin/testing además requieren que el backend tenga habilitado el flag de testing;',
      'en producción responden con error si está apagado.',
    ].join('\n'),
    [
      R('Contexto de testing', 'GET', '/admin/testing/context', {
        desc: 'Único endpoint no destructivo de esta carpeta: dice si las herramientas están habilitadas y lista usuarios/lectores disponibles.',
      }),
      R('Simular marca ADMS', 'POST', '/admin/testing/simulate-adms', {
        body: { userId: '{{userId}}', deviceId: '{{deviceId}}', punchType: 'CHECK_IN', timestamp: '2026-08-03T11:02:00.000Z' },
        desc: 'Inyecta una marca como si viniera del lector, usando el mapeo existente del usuario. Útil para probar el pipeline sin el hardware.',
      }),
      R('⚠️ Borrar todas las asistencias', 'DELETE', '/attendance/purge-all'),
      R('⚠️ Borrar todos los eventos', 'DELETE', '/events/purge-all'),
      R('⚠️ Limpiar datos operativos', 'POST', '/admin/testing/wipe-operational', {
        body: { confirm: 'LIMPIAR' },
        desc: 'Borra asistencias, eventos, licencias y marcas. Conserva usuarios, roles y lectores.',
      }),
      R('⚠️ Reiniciar la base entera', 'POST', '/admin/testing/reset-all', {
        body: { confirm: 'BORRAR TODO' },
        desc: 'Deja solo un usuario administrador y un ciclo lectivo nuevo. Devuelve la contraseña generada del admin.',
      }),
    ],
  ),
)

// --- colección ---------------------------------------------------------------

const collection = {
  info: {
    _postman_id: randomUUID(),
    name: 'EduTrack · API',
    description: [
      '# EduTrack · API',
      '',
      'Colección completa del backend de EduTrack (Express + Prisma), generada a partir de las rutas reales del repo.',
      '',
      '## Autenticación',
      '',
      'EduTrack usa **patrón BFF**: no hay Bearer token. La sesión es una cookie `sid` respaldada en Redis,',
      'emitida cuando Keycloak completa el flujo OIDC. Un script a nivel colección inyecta `Cookie: sid={{sid}}`',
      'en todas las requests, salvo las que se autentican de otra forma (dispositivos biométricos, webhooks) o son públicas.',
      '',
      'Para conseguir el `sid`, mirá la carpeta **01 · Sesión (empezar acá)**.',
      '',
      '## Entornos',
      '',
      '| Entorno | baseUrl |',
      '| --- | --- |',
      '| Local | `http://localhost:4000` |',
      '| Producción | `https://api.edutrack-uy.com` |',
      '',
      '## Convenciones',
      '',
      '- Las fechas de rango van en `YYYY-MM-DD` y se interpretan como día civil en `America/Montevideo`.',
      '- `allYears=1` desactiva el filtro por ciclo lectivo; si se omite `schoolYearId`, se usa el ciclo activo.',
      '- Los parámetros marcados como deshabilitados en cada request son opcionales: activalos según necesites.',
      '- Los IDs se guardan solos en variables de entorno (`userId`, `eventId`, …) cuando corrés los listados.',
      '',
      '## Cuidado',
      '',
      'La carpeta **24 · Destructivo** borra datos reales. Verificá `baseUrl` antes de usarla.',
    ].join('\n'),
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: folders,
  event: [
    {
      listen: 'prerequest',
      script: {
        type: 'text/javascript',
        exec: [
          '// EduTrack usa cookie de sesión (patrón BFF), no Bearer token.',
          '// Inyectamos la cookie sid en cada request para no depender del cookie jar de Postman.',
          'const sid = pm.environment.get("sid") || pm.collectionVariables.get("sid");',
          'if (sid) {',
          '  pm.request.headers.upsert({ key: "Cookie", value: "sid=" + sid });',
          '}',
        ],
      },
    },
    {
      listen: 'test',
      script: {
        type: 'text/javascript',
        exec: [
          'if (pm.response.code === 401) {',
          '  console.warn("401: la cookie sid falta o venció. Volvé a la carpeta 01 · Sesión.");',
          '}',
          'if (pm.response.code === 403) {',
          '  console.warn("403: la sesión existe pero al perfil le falta el permiso para este endpoint.");',
          '}',
        ],
      },
    },
  ],
  variable: [
    { key: 'baseUrl', value: 'http://localhost:4000', type: 'string' },
    { key: 'sid', value: '', type: 'string' },
    { key: 'perfSecret', value: '', type: 'string' },
    { key: 'perfUser', value: 'admin@edutrack-uy.com', type: 'string' },
    { key: 'dateFrom', value: '2026-07-01', type: 'string' },
    { key: 'dateTo', value: '2026-07-31', type: 'string' },
    { key: 'ymd', value: '2026-07-15', type: 'string' },
    { key: 'userId', value: '', type: 'string' },
    { key: 'roleCode', value: 'TEACHER', type: 'string' },
    { key: 'permissionId', value: 'attendance.read', type: 'string' },
    { key: 'studentId', value: '', type: 'string' },
    { key: 'schoolYearId', value: '', type: 'string' },
    { key: 'sourceSchoolYearId', value: '', type: 'string' },
    { key: 'courseId', value: '', type: 'string' },
    { key: 'courseOfferingId', value: '', type: 'string' },
    { key: 'orientationId', value: '', type: 'string' },
    { key: 'courseOrientationId', value: '', type: 'string' },
    { key: 'subjectId', value: '', type: 'string' },
    { key: 'assignmentId', value: '1', type: 'string' },
    { key: 'eventId', value: '', type: 'string' },
    { key: 'attendanceId', value: '', type: 'string' },
    { key: 'incidentId', value: '', type: 'string' },
    { key: 'substitutionId', value: '', type: 'string' },
    { key: 'leaveId', value: '', type: 'string' },
    { key: 'nonWorkingDayId', value: '', type: 'string' },
    { key: 'exportId', value: '', type: 'string' },
    { key: 'notificationId', value: '', type: 'string' },
    { key: 'deviceId', value: '', type: 'string' },
    { key: 'deviceCode', value: '', type: 'string' },
    { key: 'deviceSecret', value: '', type: 'string' },
    { key: 'deviceSn', value: '', type: 'string' },
    { key: 'linkRequestId', value: '', type: 'string' },
    { key: 'livenessToken', value: '', type: 'string' },
  ],
}

// --- environments ------------------------------------------------------------

function env(name, values) {
  return {
    id: randomUUID(),
    name,
    values: values.map(([key, value, secret = false]) => ({
      key,
      value,
      type: secret ? 'secret' : 'default',
      enabled: true,
    })),
    _postman_variable_scope: 'environment',
  }
}

const sharedIds = [
  'sid',
  'userId',
  'studentId',
  'schoolYearId',
  'sourceSchoolYearId',
  'courseId',
  'courseOfferingId',
  'orientationId',
  'courseOrientationId',
  'subjectId',
  'eventId',
  'attendanceId',
  'incidentId',
  'substitutionId',
  'leaveId',
  'nonWorkingDayId',
  'exportId',
  'notificationId',
  'deviceId',
  'deviceCode',
  'deviceSn',
  'linkRequestId',
  'livenessToken',
]

const localEnv = env('EduTrack · Local', [
  ['baseUrl', 'http://localhost:4000'],
  ['perfSecret', '', true],
  ['perfUser', 'admin@edutrack-uy.com'],
  ['deviceSecret', '', true],
  ['dateFrom', '2026-07-01'],
  ['dateTo', '2026-07-31'],
  ['ymd', '2026-07-15'],
  ['roleCode', 'TEACHER'],
  ['permissionId', 'attendance.read'],
  ['assignmentId', '1'],
  ...sharedIds.map((k) => [k, '', k === 'sid']),
])

const prodEnv = env('EduTrack · Producción', [
  ['baseUrl', 'https://api.edutrack-uy.com'],
  ['perfSecret', '', true],
  ['perfUser', ''],
  ['deviceSecret', '', true],
  ['dateFrom', '2026-07-01'],
  ['dateTo', '2026-07-31'],
  ['ymd', '2026-07-15'],
  ['roleCode', 'TEACHER'],
  ['permissionId', 'attendance.read'],
  ['assignmentId', '1'],
  ...sharedIds.map((k) => [k, '', k === 'sid']),
])

// --- escritura ---------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(`${OUT_DIR}/EduTrack.postman_collection.json`, JSON.stringify(collection, null, 2) + '\n')
writeFileSync(`${OUT_DIR}/EduTrack.local.postman_environment.json`, JSON.stringify(localEnv, null, 2) + '\n')
writeFileSync(`${OUT_DIR}/EduTrack.prod.postman_environment.json`, JSON.stringify(prodEnv, null, 2) + '\n')

const count = folders.reduce((acc, f) => acc + f.item.length, 0)
console.log(`Carpetas: ${folders.length} · Requests: ${count}`)
