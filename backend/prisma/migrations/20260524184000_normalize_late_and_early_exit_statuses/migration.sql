-- Corrige salidas biométricas históricas que quedaron como "Salida" común
-- aunque ocurrieron antes del fin planificado del evento.
WITH settings AS (
  SELECT COALESCE(MAX("attendanceLateToleranceMinutes"), 5) AS tolerance_minutes
  FROM "SystemSettings"
)
UPDATE "Attendance" a
SET
  status = 'EARLY_EXIT',
  notes = CASE
    WHEN a.notes IS NULL OR btrim(a.notes) = '' THEN 'Salida automática - SALIDA ANTICIPADA'
    WHEN a.notes ILIKE '%SALIDA ANTICIPADA%' THEN a.notes
    ELSE a.notes || ' - SALIDA ANTICIPADA'
  END
FROM "Event" e, settings s
WHERE a."eventId" = e.id
  AND a.type = 'CHECK_OUT'
  AND a.status = 'EXIT'
  AND e."endTime" IS NOT NULL
  AND a.time < e."endTime" - (s.tolerance_minutes || ' minutes')::interval;

-- Marca como "Llegada muy tarde" las entradas que superan la gracia operativa
-- de no-show, aunque el monitor no haya abierto una incidencia antes.
WITH settings AS (
  SELECT COALESCE(MAX("attendanceNoShowGraceMinutes"), 15) AS no_show_grace_minutes
  FROM "SystemSettings"
),
late_rows AS (
  SELECT
    a.id,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (a.time - e."startTime")) / 60))::int AS minutes_late
  FROM "Attendance" a
  JOIN "Event" e ON e.id = a."eventId"
  CROSS JOIN settings s
  WHERE a.type = 'CHECK_IN'
    AND a.status = 'LATE'
    AND e."startTime" IS NOT NULL
    AND a.time >= e."startTime" + (s.no_show_grace_minutes || ' minutes')::interval
    AND COALESCE(a.notes, '') NOT ILIKE '%Llegada muy tarde%'
)
UPDATE "Attendance" a
SET notes = CASE
  WHEN a.notes IS NULL OR btrim(a.notes) = '' THEN 'Llegada muy tarde: ' || l.minutes_late || ' min tarde'
  ELSE 'Llegada muy tarde: ' || l.minutes_late || ' min tarde - ' || a.notes
END
FROM late_rows l
WHERE a.id = l.id;
