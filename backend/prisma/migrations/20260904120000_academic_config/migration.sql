-- Parametrizacion academica de la libreta: DDL que Prisma no puede expresar.
-- Idempotente; se aplica con `npm run db:optimize` (el proyecto usa `db push`, no `migrate deploy`).

-- Unicidad del codigo de los tipos de actividad GLOBALES.
-- En el schema la clave es @@unique([ownerUserId, code]), que cubre los tipos de cada docente
-- pero NO los globales: ahi ownerUserId es NULL y Postgres considera los NULL distintos entre si,
-- asi que admitiria dos "Escrito" globales. Un indice unico PARCIAL si los protege.
CREATE UNIQUE INDEX IF NOT EXISTS "ActivityType_global_code_key"
  ON "ActivityType"("code")
  WHERE "ownerUserId" IS NULL;

-- Un tramo de escala no puede estar invertido: se valida en la API, pero la BD es la ultima linea.
ALTER TABLE "GradingScaleLevel"
  DROP CONSTRAINT IF EXISTS "GradingScaleLevel_range_check";
ALTER TABLE "GradingScaleLevel"
  ADD CONSTRAINT "GradingScaleLevel_range_check"
  CHECK ("minValueHundredths" <= "maxValueHundredths");

-- Idem para el rango de la escala cuando ambos extremos estan definidos.
ALTER TABLE "GradingScale"
  DROP CONSTRAINT IF EXISTS "GradingScale_range_check";
ALTER TABLE "GradingScale"
  ADD CONSTRAINT "GradingScale_range_check"
  CHECK (
    "minValueHundredths" IS NULL
    OR "maxValueHundredths" IS NULL
    OR "minValueHundredths" <= "maxValueHundredths"
  );

-- Ventana del periodo: fin nunca antes que inicio.
ALTER TABLE "AcademicPeriod"
  DROP CONSTRAINT IF EXISTS "AcademicPeriod_window_check";
ALTER TABLE "AcademicPeriod"
  ADD CONSTRAINT "AcademicPeriod_window_check"
  CHECK ("startsOn" IS NULL OR "endsOn" IS NULL OR "startsOn" <= "endsOn");
