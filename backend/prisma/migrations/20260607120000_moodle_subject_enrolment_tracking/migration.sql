-- Curso Moodle por asignatura (dentro de curso/año/orientación).
ALTER TYPE "MoodleObjectType" ADD VALUE IF NOT EXISTS 'SUBJECT_COURSE';

-- Origen y estado del acceso docente otorgado en Moodle.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MoodleEnrolmentSource') THEN
    CREATE TYPE "MoodleEnrolmentSource" AS ENUM ('TEACHER_EVENT', 'SUBSTITUTE', 'STUDENT_ENROLLMENT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MoodleEnrolmentStatus') THEN
    CREATE TYPE "MoodleEnrolmentStatus" AS ENUM ('ACTIVE', 'REVOKED');
  END IF;
END $$;

-- Tracking fino de inscripciones otorgadas por la integración (titular / suplente / matrícula).
CREATE TABLE IF NOT EXISTS "MoodleEnrolmentMap" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "moodleUserId"   INTEGER NOT NULL,
  "moodleCourseId" INTEGER NOT NULL,
  "roleId"         INTEGER NOT NULL,
  "sourceType"     "MoodleEnrolmentSource" NOT NULL,
  "sourceId"       TEXT,
  "startsAt"       TIMESTAMP(3),
  "endsAt"         TIMESTAMP(3),
  "status"         "MoodleEnrolmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MoodleEnrolmentMap_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MoodleEnrolmentMap_sourceType_userId_moodleCourseId_key"
  ON "MoodleEnrolmentMap"("sourceType", "userId", "moodleCourseId");
CREATE INDEX IF NOT EXISTS "MoodleEnrolmentMap_sourceType_status_idx"
  ON "MoodleEnrolmentMap"("sourceType", "status");
CREATE INDEX IF NOT EXISTS "MoodleEnrolmentMap_moodleCourseId_idx"
  ON "MoodleEnrolmentMap"("moodleCourseId");
CREATE INDEX IF NOT EXISTS "MoodleEnrolmentMap_userId_idx"
  ON "MoodleEnrolmentMap"("userId");
CREATE INDEX IF NOT EXISTS "MoodleEnrolmentMap_status_endsAt_idx"
  ON "MoodleEnrolmentMap"("status", "endsAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MoodleEnrolmentMap_userId_fkey') THEN
    ALTER TABLE "MoodleEnrolmentMap"
      ADD CONSTRAINT "MoodleEnrolmentMap_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
