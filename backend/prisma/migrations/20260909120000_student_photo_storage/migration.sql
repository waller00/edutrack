-- Almacenamiento de la foto del alumno.
--
-- JPEG/PNG/WebP ya vienen comprimidos, así que el `pglz` que Postgres intenta por defecto
-- (storage EXTENDED) sólo quema CPU en cada escritura y no recupera nada. EXTERNAL manda el valor
-- a TOAST sin intentar comprimirlo.
--
-- Idempotente y tolerante a una base donde `db push` todavía no creó la tabla: este archivo corre
-- con `npm run db:optimize`, que puede ejecutarse antes o después del push.
DO $$
BEGIN
  IF to_regclass('"StudentPhoto"') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE "StudentPhoto" ALTER COLUMN "bytes" SET STORAGE EXTERNAL';
  END IF;
END
$$;
