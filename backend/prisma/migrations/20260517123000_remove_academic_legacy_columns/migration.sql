-- Corte final del modelo académico.
-- Los datos existentes son descartables: se eliminan vínculos legacy y se deja
-- Course como catálogo, CourseOffering como oferta anual y StudentEnrollment
-- como única matrícula por ciclo.

DELETE FROM "AttendanceIncident";
DELETE FROM "Attendance";
DELETE FROM "Event";
DELETE FROM "StudentTuitionMonth";
DELETE FROM "StudentTuitionYear";
DELETE FROM "StudentEnrollment";
DELETE FROM "Student";

ALTER TABLE "Event" DROP CONSTRAINT IF EXISTS "Event_courseId_fkey";
ALTER TABLE "Student" DROP CONSTRAINT IF EXISTS "Student_courseId_fkey";
ALTER TABLE "Student" DROP CONSTRAINT IF EXISTS "Student_schoolYearId_fkey";
ALTER TABLE "Student" DROP CONSTRAINT IF EXISTS "Student_courseOfferingId_fkey";
ALTER TABLE "Course" DROP CONSTRAINT IF EXISTS "Course_schoolYearId_fkey";

DROP INDEX IF EXISTS "Course_schoolYearId_code_key";
DROP INDEX IF EXISTS "Course_schoolYearId_idx";
DROP INDEX IF EXISTS "Student_courseId_idx";
DROP INDEX IF EXISTS "Student_schoolYearId_idx";
DROP INDEX IF EXISTS "Student_courseOfferingId_idx";
DROP INDEX IF EXISTS "Student_enrollmentStatus_idx";
DROP INDEX IF EXISTS "Event_courseId_idx";
DROP INDEX IF EXISTS "StudentEnrollment_courseId_idx";

ALTER TABLE "Course" DROP COLUMN IF EXISTS "schoolYearId";
ALTER TABLE "Student" DROP COLUMN IF EXISTS "schoolYearId";
ALTER TABLE "Student" DROP COLUMN IF EXISTS "courseId";
ALTER TABLE "Student" DROP COLUMN IF EXISTS "courseOfferingId";
ALTER TABLE "Student" DROP COLUMN IF EXISTS "enrollmentStatus";
ALTER TABLE "Student" DROP COLUMN IF EXISTS "withdrawnAt";
ALTER TABLE "Student" DROP COLUMN IF EXISTS "withdrawalAcademicYear";
ALTER TABLE "Event" DROP COLUMN IF EXISTS "courseId";
ALTER TABLE "StudentEnrollment" DROP COLUMN IF EXISTS "courseId";

ALTER TABLE "StudentEnrollment" ALTER COLUMN "courseOfferingId" SET NOT NULL;
ALTER TABLE "StudentEnrollment" DROP CONSTRAINT IF EXISTS "StudentEnrollment_courseOfferingId_fkey";
ALTER TABLE "StudentEnrollment"
  ADD CONSTRAINT "StudentEnrollment_courseOfferingId_fkey"
  FOREIGN KEY ("courseOfferingId") REFERENCES "CourseOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "Course_code_key" ON "Course"("code");
