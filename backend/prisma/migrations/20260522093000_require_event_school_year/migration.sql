-- Todo evento operativo queda asociado a un ciclo lectivo.

DO $$
DECLARE
  fallback_school_year_id TEXT;
  fallback_code INTEGER := EXTRACT(YEAR FROM NOW())::INTEGER;
BEGIN
  SELECT "id"
  INTO fallback_school_year_id
  FROM "SchoolYear"
  WHERE "status" = 'ACTIVE'
  ORDER BY "code" DESC, "createdAt" DESC
  LIMIT 1;

  IF fallback_school_year_id IS NULL THEN
    SELECT "id"
    INTO fallback_school_year_id
    FROM "SchoolYear"
    ORDER BY "code" DESC, "createdAt" DESC
    LIMIT 1;
  END IF;

  IF fallback_school_year_id IS NULL THEN
    INSERT INTO "SchoolYear" ("id", "code", "label", "status", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, fallback_code, 'Ciclo lectivo ' || fallback_code, 'ACTIVE', now(), now())
    RETURNING "id" INTO fallback_school_year_id;
  END IF;

  UPDATE "Event"
  SET "schoolYearId" = fallback_school_year_id
  WHERE "schoolYearId" IS NULL;
END $$;

ALTER TABLE "Event" ALTER COLUMN "schoolYearId" SET NOT NULL;
