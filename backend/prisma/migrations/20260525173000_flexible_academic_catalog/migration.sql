-- Modelo académico flexible: catálogo de cursos, orientaciones, asignaturas
-- y asociaciones por nivel/curso/orientación/ciclo. No carga datos reales.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AcademicLevel') THEN
    CREATE TYPE "AcademicLevel" AS ENUM ('EBI', 'EMS');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubjectAssociationType') THEN
    CREATE TYPE "SubjectAssociationType" AS ENUM (
      'NIVEL_COMPLETO',
      'CURSO_COMPLETO',
      'TRONCO_COMUN_CURSO',
      'ORIENTACION',
      'PERSONALIZADA'
    );
  END IF;
END $$;

ALTER TABLE "Course"
  ADD COLUMN IF NOT EXISTS "level" "AcademicLevel",
  ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "asignaturas"
  ALTER COLUMN "courseId" DROP NOT NULL;

ALTER TABLE "asignaturas" DROP CONSTRAINT IF EXISTS "asignaturas_courseId_fkey";
ALTER TABLE "asignaturas"
  ADD CONSTRAINT "asignaturas_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "Orientation" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Orientation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CourseOrientation" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "orientationId" TEXT NOT NULL,
  "schoolYearId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourseOrientation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SubjectCourseAssignment" (
  "id" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "level" "AcademicLevel",
  "courseId" TEXT,
  "orientationId" TEXT,
  "schoolYearId" TEXT,
  "associationType" "SubjectAssociationType" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubjectCourseAssignment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Event"
  ADD COLUMN IF NOT EXISTS "orientationId" TEXT,
  ADD COLUMN IF NOT EXISTS "courseOrientationId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Orientation_code_key" ON "Orientation"("code") WHERE "code" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "Orientation_isActive_idx" ON "Orientation"("isActive");
CREATE INDEX IF NOT EXISTS "Orientation_sortOrder_name_idx" ON "Orientation"("sortOrder", "name");

CREATE UNIQUE INDEX IF NOT EXISTS "CourseOrientation_courseId_orientationId_schoolYearId_key"
  ON "CourseOrientation"("courseId", "orientationId", "schoolYearId");
CREATE INDEX IF NOT EXISTS "CourseOrientation_courseId_isActive_idx" ON "CourseOrientation"("courseId", "isActive");
CREATE INDEX IF NOT EXISTS "CourseOrientation_orientationId_isActive_idx" ON "CourseOrientation"("orientationId", "isActive");
CREATE INDEX IF NOT EXISTS "CourseOrientation_schoolYearId_isActive_idx" ON "CourseOrientation"("schoolYearId", "isActive");

CREATE INDEX IF NOT EXISTS "SubjectCourseAssignment_subjectId_isActive_idx" ON "SubjectCourseAssignment"("subjectId", "isActive");
CREATE INDEX IF NOT EXISTS "SubjectCourseAssignment_level_isActive_idx" ON "SubjectCourseAssignment"("level", "isActive");
CREATE INDEX IF NOT EXISTS "SubjectCourseAssignment_courseId_isActive_idx" ON "SubjectCourseAssignment"("courseId", "isActive");
CREATE INDEX IF NOT EXISTS "SubjectCourseAssignment_orientationId_isActive_idx" ON "SubjectCourseAssignment"("orientationId", "isActive");
CREATE INDEX IF NOT EXISTS "SubjectCourseAssignment_schoolYearId_isActive_idx" ON "SubjectCourseAssignment"("schoolYearId", "isActive");
CREATE INDEX IF NOT EXISTS "SubjectCourseAssignment_associationType_idx" ON "SubjectCourseAssignment"("associationType");

CREATE INDEX IF NOT EXISTS "Course_level_sortOrder_idx" ON "Course"("level", "sortOrder");
CREATE INDEX IF NOT EXISTS "asignaturas_isActive_idx" ON "asignaturas"("isActive");
CREATE INDEX IF NOT EXISTS "asignaturas_sortOrder_name_idx" ON "asignaturas"("sortOrder", "name");
CREATE INDEX IF NOT EXISTS "Event_orientationId_idx" ON "Event"("orientationId");
CREATE INDEX IF NOT EXISTS "Event_courseOrientationId_idx" ON "Event"("courseOrientationId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CourseOrientation_courseId_fkey') THEN
    ALTER TABLE "CourseOrientation"
      ADD CONSTRAINT "CourseOrientation_courseId_fkey"
      FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CourseOrientation_orientationId_fkey') THEN
    ALTER TABLE "CourseOrientation"
      ADD CONSTRAINT "CourseOrientation_orientationId_fkey"
      FOREIGN KEY ("orientationId") REFERENCES "Orientation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CourseOrientation_schoolYearId_fkey') THEN
    ALTER TABLE "CourseOrientation"
      ADD CONSTRAINT "CourseOrientation_schoolYearId_fkey"
      FOREIGN KEY ("schoolYearId") REFERENCES "SchoolYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubjectCourseAssignment_subjectId_fkey') THEN
    ALTER TABLE "SubjectCourseAssignment"
      ADD CONSTRAINT "SubjectCourseAssignment_subjectId_fkey"
      FOREIGN KEY ("subjectId") REFERENCES "asignaturas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubjectCourseAssignment_courseId_fkey') THEN
    ALTER TABLE "SubjectCourseAssignment"
      ADD CONSTRAINT "SubjectCourseAssignment_courseId_fkey"
      FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubjectCourseAssignment_orientationId_fkey') THEN
    ALTER TABLE "SubjectCourseAssignment"
      ADD CONSTRAINT "SubjectCourseAssignment_orientationId_fkey"
      FOREIGN KEY ("orientationId") REFERENCES "Orientation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubjectCourseAssignment_schoolYearId_fkey') THEN
    ALTER TABLE "SubjectCourseAssignment"
      ADD CONSTRAINT "SubjectCourseAssignment_schoolYearId_fkey"
      FOREIGN KEY ("schoolYearId") REFERENCES "SchoolYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Event_orientationId_fkey') THEN
    ALTER TABLE "Event"
      ADD CONSTRAINT "Event_orientationId_fkey"
      FOREIGN KEY ("orientationId") REFERENCES "Orientation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Event_courseOrientationId_fkey') THEN
    ALTER TABLE "Event"
      ADD CONSTRAINT "Event_courseOrientationId_fkey"
      FOREIGN KEY ("courseOrientationId") REFERENCES "CourseOrientation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Compatibilidad: las asignaturas legacy atadas directamente a un curso quedan
-- representadas también como asociación de curso completo.
INSERT INTO "SubjectCourseAssignment" (
  "id",
  "subjectId",
  "courseId",
  "schoolYearId",
  "associationType",
  "isActive",
  "sortOrder",
  "notes",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  s."id",
  s."courseId",
  co."schoolYearId",
  'CURSO_COMPLETO',
  s."isActive",
  s."sortOrder",
  'Migrado desde asignatura vinculada directamente a curso',
  now(),
  now()
FROM "asignaturas" s
LEFT JOIN "CourseOffering" co ON co."id" = s."courseOfferingId"
WHERE s."courseId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "SubjectCourseAssignment" a
    WHERE a."subjectId" = s."id"
      AND a."courseId" = s."courseId"
      AND COALESCE(a."schoolYearId", '') = COALESCE(co."schoolYearId", '')
      AND a."associationType" = 'CURSO_COMPLETO'
  );
