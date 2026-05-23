-- Catálogo académico estable + oferta anual.
-- Mantiene Course.schoolYearId, Student.schoolYearId/courseId y Event.courseId
-- como compatibilidad durante la transición.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE "CourseOffering" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "schoolYearId" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourseOffering_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudentEnrollment" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "schoolYearId" TEXT NOT NULL,
  "courseId" TEXT,
  "courseOfferingId" TEXT,
  "enrollmentStatus" "StudentEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "withdrawnAt" TIMESTAMP(3),
  "withdrawalAcademicYear" INTEGER,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudentEnrollment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Student" ADD COLUMN "courseOfferingId" TEXT;
ALTER TABLE "Event" ADD COLUMN "courseOfferingId" TEXT;

CREATE UNIQUE INDEX "CourseOffering_courseId_schoolYearId_key" ON "CourseOffering"("courseId", "schoolYearId");
CREATE INDEX "CourseOffering_schoolYearId_isActive_idx" ON "CourseOffering"("schoolYearId", "isActive");
CREATE INDEX "CourseOffering_courseId_idx" ON "CourseOffering"("courseId");

CREATE UNIQUE INDEX "StudentEnrollment_studentId_schoolYearId_key" ON "StudentEnrollment"("studentId", "schoolYearId");
CREATE INDEX "StudentEnrollment_schoolYearId_enrollmentStatus_idx" ON "StudentEnrollment"("schoolYearId", "enrollmentStatus");
CREATE INDEX "StudentEnrollment_courseId_idx" ON "StudentEnrollment"("courseId");
CREATE INDEX "StudentEnrollment_courseOfferingId_idx" ON "StudentEnrollment"("courseOfferingId");

CREATE INDEX "Student_courseOfferingId_idx" ON "Student"("courseOfferingId");
CREATE INDEX "Event_courseOfferingId_idx" ON "Event"("courseOfferingId");

ALTER TABLE "CourseOffering"
  ADD CONSTRAINT "CourseOffering_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseOffering"
  ADD CONSTRAINT "CourseOffering_schoolYearId_fkey"
  FOREIGN KEY ("schoolYearId") REFERENCES "SchoolYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudentEnrollment"
  ADD CONSTRAINT "StudentEnrollment_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudentEnrollment"
  ADD CONSTRAINT "StudentEnrollment_schoolYearId_fkey"
  FOREIGN KEY ("schoolYearId") REFERENCES "SchoolYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StudentEnrollment"
  ADD CONSTRAINT "StudentEnrollment_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StudentEnrollment"
  ADD CONSTRAINT "StudentEnrollment_courseOfferingId_fkey"
  FOREIGN KEY ("courseOfferingId") REFERENCES "CourseOffering"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Student"
  ADD CONSTRAINT "Student_courseOfferingId_fkey"
  FOREIGN KEY ("courseOfferingId") REFERENCES "CourseOffering"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Event"
  ADD CONSTRAINT "Event_courseOfferingId_fkey"
  FOREIGN KEY ("courseOfferingId") REFERENCES "CourseOffering"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "CourseOffering" ("id", "courseId", "schoolYearId", "isActive", "notes", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, c."id", c."schoolYearId", c."isActive", 'Migrado desde Course.schoolYearId', now(), now()
FROM "Course" c
WHERE c."schoolYearId" IS NOT NULL
ON CONFLICT ("courseId", "schoolYearId") DO NOTHING;

UPDATE "Student" s
SET "courseOfferingId" = co."id"
FROM "CourseOffering" co
WHERE s."courseId" = co."courseId"
  AND s."schoolYearId" = co."schoolYearId"
  AND s."courseOfferingId" IS NULL;

UPDATE "Event" e
SET "courseOfferingId" = co."id"
FROM "CourseOffering" co
WHERE e."courseId" = co."courseId"
  AND e."schoolYearId" = co."schoolYearId"
  AND e."courseOfferingId" IS NULL;

INSERT INTO "StudentEnrollment" (
  "id",
  "studentId",
  "schoolYearId",
  "courseId",
  "courseOfferingId",
  "enrollmentStatus",
  "withdrawnAt",
  "withdrawalAcademicYear",
  "notes",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  s."id",
  s."schoolYearId",
  s."courseId",
  s."courseOfferingId",
  s."enrollmentStatus",
  s."withdrawnAt",
  s."withdrawalAcademicYear",
  'Migrado desde Student',
  now(),
  now()
FROM "Student" s
WHERE s."schoolYearId" IS NOT NULL
ON CONFLICT ("studentId", "schoolYearId") DO NOTHING;
