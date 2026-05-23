-- Endurece invariantes de ciclo lectivo y agrega vínculos históricos compatibles.

ALTER TABLE "asignaturas" ADD COLUMN IF NOT EXISTS "courseOfferingId" TEXT;
ALTER TABLE "StudentTuitionYear" ADD COLUMN IF NOT EXISTS "schoolYearId" TEXT;
ALTER TABLE "StudentTuitionMonth" ADD COLUMN IF NOT EXISTS "schoolYearId" TEXT;

UPDATE "StudentTuitionYear" t
SET "schoolYearId" = sy."id"
FROM "SchoolYear" sy
WHERE t."schoolYearId" IS NULL
  AND sy."code" = t."year";

UPDATE "StudentTuitionMonth" t
SET "schoolYearId" = sy."id"
FROM "SchoolYear" sy
WHERE t."schoolYearId" IS NULL
  AND sy."code" = t."year";

CREATE INDEX IF NOT EXISTS "asignaturas_courseOfferingId_idx" ON "asignaturas"("courseOfferingId");
CREATE INDEX IF NOT EXISTS "StudentTuitionYear_schoolYearId_idx" ON "StudentTuitionYear"("schoolYearId");
CREATE INDEX IF NOT EXISTS "StudentTuitionMonth_schoolYearId_idx" ON "StudentTuitionMonth"("schoolYearId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'asignaturas_courseOfferingId_fkey'
  ) THEN
    ALTER TABLE "asignaturas"
      ADD CONSTRAINT "asignaturas_courseOfferingId_fkey"
      FOREIGN KEY ("courseOfferingId") REFERENCES "CourseOffering"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'StudentTuitionYear_schoolYearId_fkey'
  ) THEN
    ALTER TABLE "StudentTuitionYear"
      ADD CONSTRAINT "StudentTuitionYear_schoolYearId_fkey"
      FOREIGN KEY ("schoolYearId") REFERENCES "SchoolYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'StudentTuitionMonth_schoolYearId_fkey'
  ) THEN
    ALTER TABLE "StudentTuitionMonth"
      ADD CONSTRAINT "StudentTuitionMonth_schoolYearId_fkey"
      FOREIGN KEY ("schoolYearId") REFERENCES "SchoolYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SchoolYear_dates_order_check'
  ) THEN
    ALTER TABLE "SchoolYear"
      ADD CONSTRAINT "SchoolYear_dates_order_check"
      CHECK ("startsOn" IS NULL OR "endsOn" IS NULL OR "startsOn" <= "endsOn");
  END IF;
END $$;

WITH ranked_active AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "code" DESC, "createdAt" DESC, "id") AS rn
  FROM "SchoolYear"
  WHERE "status" = 'ACTIVE'
)
UPDATE "SchoolYear" sy
SET "status" = 'CLOSED'
FROM ranked_active r
WHERE sy."id" = r."id"
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "SchoolYear_single_active_idx"
  ON "SchoolYear" ((1))
  WHERE "status" = 'ACTIVE';
