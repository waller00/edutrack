-- Flags explícitos para distinguir activo, ofertado y visible en filtros operativos.

ALTER TYPE "SubjectAssociationType" ADD VALUE IF NOT EXISTS 'OPTATIVA';

ALTER TABLE "CourseOffering"
  ADD COLUMN IF NOT EXISTS "isOffered" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "visibleInFilters" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "CourseOrientation"
  ADD COLUMN IF NOT EXISTS "isOffered" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "visibleInFilters" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "SubjectCourseAssignment"
  ADD COLUMN IF NOT EXISTS "isOffered" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "visibleInFilters" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "CourseOffering_schoolYearId_isOffered_visibleInFilters_idx"
  ON "CourseOffering"("schoolYearId", "isOffered", "visibleInFilters");

CREATE INDEX IF NOT EXISTS "CourseOrientation_schoolYearId_isOffered_visibleInFilters_idx"
  ON "CourseOrientation"("schoolYearId", "isOffered", "visibleInFilters");

CREATE INDEX IF NOT EXISTS "SubjectCourseAssignment_schoolYearId_isOffered_visibleInFilters_idx"
  ON "SubjectCourseAssignment"("schoolYearId", "isOffered", "visibleInFilters");
