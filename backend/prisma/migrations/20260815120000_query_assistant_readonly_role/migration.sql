-- Rol de solo lectura para el asistente de consultas (PostgreSQL 16).
--
-- Por que: el modo NL->SQL ejecuta con $queryRawUnsafe una consulta escrita por el
-- modelo. Validarla con expresiones regulares es fragil; el permiso de base es la
-- unica barrera que no depende de que ese validador sea perfecto.
--
-- Idempotente: el proyecto usa `prisma db push` (sin tabla _prisma_migrations), asi
-- que este archivo se ejecuta aparte con `npm run db:optimize` y puede correr N veces.
--
-- La contrasena NO se fija aca (quedaria en el repo). Se define fuera, por ejemplo:
--   ALTER ROLE edutrack_readonly WITH PASSWORD '...';
-- y esa misma credencial va en DATABASE_URL_READONLY.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edutrack_readonly') THEN
    -- NOLOGIN hasta que se le asigne contrasena: evita dejar una cuenta sin credencial.
    CREATE ROLE edutrack_readonly NOLOGIN;
  END IF;
END
$$;

-- Sin privilegios heredados de PUBLIC sobre el esquema.
GRANT USAGE ON SCHEMA public TO edutrack_readonly;

-- Solo lectura sobre lo que existe hoy...
GRANT SELECT ON ALL TABLES IN SCHEMA public TO edutrack_readonly;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO edutrack_readonly;

-- ...y sobre lo que cree `db push` en el futuro (el owner de las tablas es quien
-- corre las migraciones, por eso el DEFAULT PRIVILEGES se declara para ese rol).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO edutrack_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO edutrack_readonly;

-- Revoca explicitamente cualquier escritura que pudiera venir de PUBLIC.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM edutrack_readonly;

-- Corta consultas largas (cross joins, pg_sleep) sin depender del validador.
ALTER ROLE edutrack_readonly SET statement_timeout = '15s';
-- Refuerzo: toda transaccion de este rol es de solo lectura.
ALTER ROLE edutrack_readonly SET default_transaction_read_only = on;
-- Evita que una consulta pesada bloquee mantenimiento.
ALTER ROLE edutrack_readonly SET idle_in_transaction_session_timeout = '30s';
