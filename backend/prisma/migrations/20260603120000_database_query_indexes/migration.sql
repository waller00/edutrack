-- Optimizacion de consultas operativas (PostgreSQL 16).
-- Los indices compuestos siguen los patrones where/orderBy del backend:
-- asistencia, eventos/calendario, biometrico, licencias, estudiantes y cuotas.

-- Extension usada por busquedas administrativas con contains + mode insensitive.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Attendance: listados por usuario/ciclo, ingesta biometrica por dia y stats.
CREATE INDEX IF NOT EXISTS "Attendance_userId_date_time_idx"
  ON "Attendance"("userId", "date", "time");

CREATE INDEX IF NOT EXISTS "Attendance_userId_date_type_eventId_idx"
  ON "Attendance"("userId", "date", "type", "eventId");

CREATE INDEX IF NOT EXISTS "Attendance_schoolYearId_date_time_idx"
  ON "Attendance"("schoolYearId", "date", "time");

CREATE INDEX IF NOT EXISTS "Attendance_schoolYearId_type_status_date_idx"
  ON "Attendance"("schoolYearId", "type", "status", "date");

-- Event: calendario personal/admin, recurrencias y matching de clases biometrico.
CREATE INDEX IF NOT EXISTS "Event_parentEventId_idx"
  ON "Event"("parentEventId");

CREATE INDEX IF NOT EXISTS "Event_assignedUserId_schoolYearId_startDate_idx"
  ON "Event"("assignedUserId", "schoolYearId", "startDate");

CREATE INDEX IF NOT EXISTS "Event_userId_schoolYearId_startDate_idx"
  ON "Event"("userId", "schoolYearId", "startDate");

CREATE INDEX IF NOT EXISTS "Event_assignedUserId_type_status_startTime_idx"
  ON "Event"("assignedUserId", "type", "status", "startTime");

CREATE INDEX IF NOT EXISTS "Event_schoolYearId_type_status_startDate_idx"
  ON "Event"("schoolYearId", "type", "status", "startDate");

CREATE INDEX IF NOT EXISTS "Event_active_class_assignee_time_idx"
  ON "Event"("assignedUserId", "startTime", "endTime")
  WHERE "assignedUserId" IS NOT NULL
    AND "type" = 'CLASE'
    AND "status" IN ('SCHEDULED', 'IN_PROGRESS');

CREATE INDEX IF NOT EXISTS "Event_active_class_window_idx"
  ON "Event"("startTime", "endTime", "assignedUserId")
  WHERE "assignedUserId" IS NOT NULL
    AND "type" = 'CLASE'
    AND "status" IN ('SCHEDULED', 'IN_PROGRESS');

-- Incidencias: feed admin y deduplicacion de incidentes abiertos.
CREATE INDEX IF NOT EXISTS "AttendanceIncident_status_type_detectedAt_idx"
  ON "AttendanceIncident"("status", "type", "detectedAt");

CREATE INDEX IF NOT EXISTS "AttendanceIncident_userId_eventId_type_status_idx"
  ON "AttendanceIncident"("userId", "eventId", "type", "status");

CREATE INDEX IF NOT EXISTS "AttendanceIncident_open_lookup_idx"
  ON "AttendanceIncident"("userId", "eventId", "type")
  WHERE "status" = 'OPEN';

-- Biometrico: problemas por rango y trazabilidad por usuario.
CREATE INDEX IF NOT EXISTS "BiometricPunch_userId_occurredAt_idx"
  ON "BiometricPunch"("userId", "occurredAt");

CREATE INDEX IF NOT EXISTS "BiometricPunch_processStatus_occurredAt_idx"
  ON "BiometricPunch"("processStatus", "occurredAt");

CREATE INDEX IF NOT EXISTS "BiometricPunch_problem_status_occurredAt_idx"
  ON "BiometricPunch"("processStatus", "occurredAt")
  WHERE "processStatus" IN ('FAILED', 'PENDING');

-- Licencias medicas: solapamiento por usuario y estado activo.
CREATE INDEX IF NOT EXISTS "MedicalLeave_userId_status_startDate_endDate_idx"
  ON "MedicalLeave"("userId", "status", "startDate", "endDate");

CREATE INDEX IF NOT EXISTS "MedicalLeave_active_user_range_idx"
  ON "MedicalLeave"("userId", "startDate", "endDate")
  WHERE "status" = 'ACTIVE';

-- Estudiantes/matriculas/cuotas: filtros por ciclo, curso, estado y pagos.
DROP INDEX IF EXISTS "StudentEnrollment_schoolYearId_courseOfferingId_enrollmentStatu";

CREATE INDEX IF NOT EXISTS "StudentEnrollment_sy_offering_status_idx"
  ON "StudentEnrollment"("schoolYearId", "courseOfferingId", "enrollmentStatus");

CREATE INDEX IF NOT EXISTS "StudentEnrollment_studentId_createdAt_idx"
  ON "StudentEnrollment"("studentId", "createdAt");

CREATE INDEX IF NOT EXISTS "StudentTuitionMonth_year_month_paid_idx"
  ON "StudentTuitionMonth"("year", "month", "paid");

-- Notificaciones: contador y listado de no leidas.
CREATE INDEX IF NOT EXISTS "InAppNotification_unread_user_createdAt_idx"
  ON "InAppNotification"("userId", "createdAt")
  WHERE "readAt" IS NULL;

-- Busquedas textuales con contains/insensitive.
CREATE INDEX IF NOT EXISTS "Student_firstName_trgm_idx"
  ON "Student" USING GIN ("firstName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Student_lastName_trgm_idx"
  ON "Student" USING GIN ("lastName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Student_documentId_trgm_idx"
  ON "Student" USING GIN ("documentId" gin_trgm_ops)
  WHERE "documentId" IS NOT NULL;

-- Lookups case-insensitive usados por importacion y resolucion de catalogo.
CREATE INDEX IF NOT EXISTS "User_active_username_lower_idx"
  ON "User"(lower("username"))
  WHERE "isActive" = true AND "username" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Course_active_code_lower_idx"
  ON "Course"(lower("code"))
  WHERE "isActive" = true AND "code" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Course_active_name_lower_idx"
  ON "Course"(lower("name"))
  WHERE "isActive" = true;

CREATE INDEX IF NOT EXISTS "Orientation_active_code_lower_idx"
  ON "Orientation"(lower("code"))
  WHERE "isActive" = true AND "code" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Orientation_active_name_lower_idx"
  ON "Orientation"(lower("name"))
  WHERE "isActive" = true;

CREATE INDEX IF NOT EXISTS "asignaturas_active_code_lower_idx"
  ON "asignaturas"(lower("code"))
  WHERE "isActive" = true AND "code" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "asignaturas_active_name_lower_idx"
  ON "asignaturas"(lower("name"))
  WHERE "isActive" = true;
