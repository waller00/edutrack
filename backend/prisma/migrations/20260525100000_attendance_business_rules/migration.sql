ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ATTENDANCE_MANUAL_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ATTENDANCE_JUSTIFIED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ATTENDANCE_INCIDENT_RESOLVED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SUBSTITUTION_CREATED';

ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'JUSTIFIED';
ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'FREE';
ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'PENDING_REVIEW';
ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'SUBSTITUTED';
ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';
ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'OUT_OF_SCHEDULE';
ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'UNIDENTIFIED_PUNCH';

CREATE TYPE "AttendanceJustificationType" AS ENUM (
  'ABSENCE',
  'LATE_ARRIVAL',
  'EARLY_EXIT',
  'OTHER'
);

CREATE TABLE "AttendanceJustification" (
  "id" TEXT NOT NULL,
  "attendanceId" TEXT NOT NULL,
  "type" "AttendanceJustificationType" NOT NULL DEFAULT 'OTHER',
  "reason" TEXT NOT NULL,
  "notes" TEXT,
  "attachment" TEXT,
  "previousStatus" "AttendanceStatus" NOT NULL,
  "newStatus" "AttendanceStatus" NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AttendanceJustification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Substitution" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "originalTeacherUserId" TEXT NOT NULL,
  "substituteUserId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "startTime" TIMESTAMP(3) NOT NULL,
  "endTime" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "notes" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Substitution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AttendanceJustification_attendanceId_idx" ON "AttendanceJustification"("attendanceId");
CREATE INDEX "AttendanceJustification_createdByUserId_idx" ON "AttendanceJustification"("createdByUserId");
CREATE INDEX "AttendanceJustification_createdAt_idx" ON "AttendanceJustification"("createdAt");

CREATE UNIQUE INDEX "Substitution_eventId_date_key" ON "Substitution"("eventId", "date");
CREATE INDEX "Substitution_originalTeacherUserId_date_idx" ON "Substitution"("originalTeacherUserId", "date");
CREATE INDEX "Substitution_substituteUserId_date_idx" ON "Substitution"("substituteUserId", "date");
CREATE INDEX "Substitution_createdByUserId_idx" ON "Substitution"("createdByUserId");

ALTER TABLE "AttendanceJustification"
  ADD CONSTRAINT "AttendanceJustification_attendanceId_fkey"
  FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttendanceJustification"
  ADD CONSTRAINT "AttendanceJustification_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Substitution"
  ADD CONSTRAINT "Substitution_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Substitution"
  ADD CONSTRAINT "Substitution_originalTeacherUserId_fkey"
  FOREIGN KEY ("originalTeacherUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Substitution"
  ADD CONSTRAINT "Substitution_substituteUserId_fkey"
  FOREIGN KEY ("substituteUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Substitution"
  ADD CONSTRAINT "Substitution_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
