-- Vínculo estable con Keycloak (User.keycloakId) y alertas de estudiantes por ciclo.
--
-- Corre ANTES de `prisma db push` (npm run db:prepush, desde docker-entrypoint.sh): db push
-- rechaza agregar un UNIQUE sobre una tabla con datos sin --accept-data-loss, y sin estas columnas
-- e índices el login (que busca por keycloakId) no funcionaría. Es idempotente y no hace nada en
-- una base nueva: ahí las tablas todavía no existen y db push las crea completas.
-- Los nombres de índice son los que genera Prisma, así db push no ve diferencias después.

DO $$
BEGIN
  IF to_regclass('"User"') IS NOT NULL THEN
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "keycloakId" TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS "User_keycloakId_key" ON "User"("keycloakId");
  END IF;

  IF to_regclass('"StudentAlert"') IS NOT NULL THEN
    -- La clave nueva incluye la vieja más el ciclo: no puede haber duplicados al crearla.
    CREATE UNIQUE INDEX IF NOT EXISTS "StudentAlert_schoolYearId_type_studentId_key_key"
      ON "StudentAlert"("schoolYearId", "type", "studentId", "key");
    DROP INDEX IF EXISTS "StudentAlert_type_studentId_key_key";
  END IF;
END $$;
