UPDATE "Attendance"
SET "status" = 'EXIT'::"AttendanceStatus"
WHERE "type" = 'CHECK_OUT'::"AttendanceType"
  AND "status" = 'PRESENT'::"AttendanceStatus";
