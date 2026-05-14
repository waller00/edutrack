export const DATABASE_CONTEXT = `Contexto de base de datos disponible (estructura, sin datos reales):
- Tabla "User": personas/cuentas del sistema. Campos útiles: "id", "email", "username", "firstName", "lastName", "name", "nationalIdDocumentExpiresAt", "isApproved", "isActive", "lockUntil", "createdAt", "roleId". Relación con "OrgRole" por "roleId". Usá búsquedas por nombre, apellido, username o email.
- Tabla "OrgRole": rol organizacional. Campos: "id", "code", "label". Códigos esperados: ADMIN, TEACHER, STAFF, STUDENT u otros roles configurados.
- Tabla "Attendance": marcas de asistencia. Campos: "id", "userId", "eventId", "type", "status", "date", "time", "notes". "type": CHECK_IN/CHECK_OUT. "status" incluye PRESENT, LATE, ABSENT_NOT_JUSTIFIED, ABSENT_JUSTIFIED, EXIT, EARLY_EXIT.
- Tabla "AttendanceIncident": incidencias derivadas de asistencia. Campos: "id", "userId", "eventId", "attendanceId", "type", "status", "title", "description", "detectedAt". "type": LATE_ARRIVAL (llegada tarde), TEACHER_NO_SHOW (falta/ausencia docente), EARLY_EXIT (salida anticipada). "status": OPEN, ACKNOWLEDGED, RESOLVED.
- Tabla "Event": clases, jornadas, reuniones y turnos. Campos: "id", "title", "type", "status", "startDate", "endDate", "startTime", "endTime", "userId", "assignedUserId", "courseId". Para eventos asignados a docentes/personal, "assignedUserId" es la persona asignada.
- Tabla "Course": cursos/grupos asociados a eventos. Campos: "id", "name", "code", "isActive".
- Tabla "MedicalLeave": licencias o permisos. Campos: "id", "userId", "type", "status", "startDate", "endDate", "reason", "doctorName". "status": ACTIVE/INACTIVE. El período de licencia se interpreta por solapamiento con el rango pedido.
- Tabla "BiometricPunch": marcas crudas del reloj biométrico. Campos: "id", "userId", "deviceUserId", "occurredAt", "punchType", "processStatus", "processError". "processStatus": PENDING, PROCESSED, FAILED, DUPLICATE.
- Tabla "AuditLog": auditoría del sistema. Campos: "id", "occurredAt", "action", "actorUserId", "actorIp", "source", "entityType", "entityId", "metadata".

Mapa semántico:
- "faltas", "ausencias", "no vino", "no llegó", "inasistencias" en consultas directas de asistencia suelen mapear a "Attendance"."status" IN ('ABSENT_NOT_JUSTIFIED', 'ABSENT_JUSTIFIED'). Si el usuario habla de incidencias o ausencias docentes detectadas, también puede mapear a "AttendanceIncident"."type" = 'TEACHER_NO_SHOW'.
- "llegaron tarde", "personas que llegaron tarde", "tardanzas", "entradas tarde" en consultas directas suelen mapear a "Attendance"."type" = 'CHECK_IN' y "Attendance"."status" = 'LATE'. Si el usuario habla de incidencias, puede mapear a "AttendanceIncident"."type" = 'LATE_ARRIVAL'.
- "salidas anticipadas" mapea a "AttendanceIncident"."type" = 'EARLY_EXIT'.
- "docentes con más faltas", "ranking de ausencias", "quién faltó más" requiere agrupar por usuario y contar incidencias TEACHER_NO_SHOW.
- "licencias activas/vigentes" mapea a "MedicalLeave"."status" = 'ACTIVE'.
- "usuarios pendientes", "cuentas bloqueadas", "documento por vencer" mapea a "User" con isApproved/isActive/lockUntil/nationalIdDocumentExpiresAt.`
