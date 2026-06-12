-- Cuenta Moodle de estudiantes: username (nombre.apellido), email del alumno y
-- marca del mail de bienvenida. DDL idempotente: se ejecuta en cada arranque vía
-- db:optimize porque `prisma db push` rechaza agregar un UNIQUE sobre una tabla
-- existente sin --accept-data-loss (flag que NUNCA debe usarse aquí: borraría la
-- columna "contactEmail", que sigue siendo la columna física del campo email).

ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "username" TEXT;
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "moodleWelcomeSentAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "Student_username_key" ON "Student"("username");

ALTER TYPE "MoodleSyncTaskType" ADD VALUE IF NOT EXISTS 'STUDENT_USER_UPSERT';
