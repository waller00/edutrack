ALTER TABLE "StudentEnrollment"
  ADD COLUMN IF NOT EXISTS "orientationId" TEXT,
  ADD COLUMN IF NOT EXISTS "courseOrientationId" TEXT;

CREATE INDEX IF NOT EXISTS "StudentEnrollment_orientationId_idx"
  ON "StudentEnrollment"("orientationId");

CREATE INDEX IF NOT EXISTS "StudentEnrollment_courseOrientationId_idx"
  ON "StudentEnrollment"("courseOrientationId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentEnrollment_orientationId_fkey') THEN
    ALTER TABLE "StudentEnrollment"
      ADD CONSTRAINT "StudentEnrollment_orientationId_fkey"
      FOREIGN KEY ("orientationId") REFERENCES "Orientation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentEnrollment_courseOrientationId_fkey') THEN
    ALTER TABLE "StudentEnrollment"
      ADD CONSTRAINT "StudentEnrollment_courseOrientationId_fkey"
      FOREIGN KEY ("courseOrientationId") REFERENCES "CourseOrientation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
