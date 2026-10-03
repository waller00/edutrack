-- Retiro idempotente del módulo. Se ejecuta con db:optimize después de db push.
-- El enum AuditAction se conserva para poder consultar la auditoría histórica.
BEGIN;

-- La FK elimina en cascada las asignaciones de todos los roles, incluidos los personalizados.
DELETE FROM "Permission" WHERE code = 'query-assistant.use';

DO $$
DECLARE
  grant_owner text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edutrack_readonly') THEN
    ALTER ROLE edutrack_readonly NOLOGIN PASSWORD NULL;
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM edutrack_readonly;
    REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM edutrack_readonly;
    REVOKE ALL PRIVILEGES ON SCHEMA public FROM edutrack_readonly;

    -- Los permisos por defecto pueden pertenecer a distintos usuarios de despliegue.
    FOR grant_owner IN
      SELECT DISTINCT pg_get_userbyid(d.defaclrole)
      FROM pg_default_acl d
      CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'edutrack_readonly')
        AND d.defaclnamespace = 'public'::regnamespace
    LOOP
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM edutrack_readonly', grant_owner);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM edutrack_readonly', grant_owner);
    END LOOP;

    BEGIN
      DROP ROLE edutrack_readonly;
    EXCEPTION WHEN dependent_objects_still_exist THEN
      -- No usar DROP OWNED: podría destruir objetos ajenos al módulo.
      -- Si el rol se reutilizó fuera de esta base, queda sin login ni permisos locales.
      RAISE NOTICE 'edutrack_readonly deshabilitado; conserva dependencias ajenas al módulo';
    END;
  END IF;
END
$$;

COMMIT;
