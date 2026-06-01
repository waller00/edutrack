-- Ciclo lectivo directo en Attendance: segmenta el listado/estadísticas por ciclo
-- sin depender de la relación con Event (las marcas sin evento ya no quedan ocultas).

ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "schoolYearId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Attendance_schoolYearId_fkey'
  ) THEN
    ALTER TABLE "Attendance"
      ADD CONSTRAINT "Attendance_schoolYearId_fkey"
      FOREIGN KEY ("schoolYearId") REFERENCES "SchoolYear"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Attendance_schoolYearId_idx" ON "Attendance"("schoolYearId");

-- Backfill 1: marcas vinculadas a un evento → ciclo del evento.
UPDATE "Attendance" a
SET "schoolYearId" = e."schoolYearId"
FROM "Event" e
WHERE a."eventId" = e."id" AND a."schoolYearId" IS NULL;

-- Backfill 2: marcas sin evento → ciclo cuyo rango de fechas contiene la marca.
UPDATE "Attendance" a
SET "schoolYearId" = sy."id"
FROM "SchoolYear" sy
WHERE a."schoolYearId" IS NULL
  AND a."eventId" IS NULL
  AND sy."startsOn" IS NOT NULL
  AND sy."endsOn" IS NOT NULL
  AND a."date" >= sy."startsOn"
  AND a."date" <= sy."endsOn";
