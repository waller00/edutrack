-- Vincula entradas biométricas históricas sin evento al evento asignado más cercano.
-- Esto corrige casos donde una marca previa al inicio (ej. 18:05 para evento 18:06)
-- quedaba como "Sin evento" y por fuera del filtro de ciclo lectivo.
WITH candidates AS (
  SELECT
    a.id AS "attendanceId",
    e.id AS "eventId",
    ROW_NUMBER() OVER (
      PARTITION BY a.id
      ORDER BY
        CASE WHEN e."startTime" <= a.time THEN 0 ELSE 1 END,
        ABS(EXTRACT(EPOCH FROM (a.time - e."startTime")))
    ) AS rn
  FROM "Attendance" a
  JOIN "Event" e
    ON e."assignedUserId" = a."userId"
   AND e.status IN ('SCHEDULED', 'IN_PROGRESS')
   AND e."startTime" IS NOT NULL
   AND e."endTime" IS NOT NULL
   AND e."startTime" <= a.time + INTERVAL '90 minutes'
   AND e."endTime" >= a.time
  WHERE a.type = 'CHECK_IN'
    AND a."eventId" IS NULL
)
UPDATE "Attendance" a
SET "eventId" = c."eventId"
FROM candidates c
WHERE c.rn = 1
  AND a.id = c."attendanceId";

-- Una entrada sin evento no tiene referencia real para afirmar "llegó tarde".
UPDATE "Attendance"
SET status = 'PRESENT'
WHERE type = 'CHECK_IN'
  AND status = 'LATE'
  AND "eventId" IS NULL;

-- Si se vinculó un evento y la marca cae dentro de la tolerancia del inicio real,
-- normaliza el estado a presente.
WITH settings AS (
  SELECT COALESCE(MAX("attendanceLateToleranceMinutes"), 5) AS tolerance_minutes
  FROM "SystemSettings"
)
UPDATE "Attendance" a
SET status = 'PRESENT'
FROM "Event" e, settings s
WHERE a."eventId" = e.id
  AND a.type = 'CHECK_IN'
  AND a.status = 'LATE'
  AND e."startTime" IS NOT NULL
  AND a.time <= e."startTime" + (s.tolerance_minutes || ' minutes')::interval;
