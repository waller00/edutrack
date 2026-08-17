import { PrismaClient } from "@prisma/client";

/**
 * Cliente Prisma con credenciales de solo lectura, para ejecutar el SQL que escribe
 * el modelo en el asistente de consultas.
 *
 * El validador de `llm-sql.ts` filtra por texto y eso es fragil por naturaleza; este
 * rol es la barrera que no depende de que ese filtro sea perfecto. El rol y sus limites
 * (`statement_timeout`, `default_transaction_read_only`) se crean en
 * `prisma/migrations/20260815120000_query_assistant_readonly_role/migration.sql`,
 * que corre con `npm run db:optimize`.
 *
 * Es `null` cuando falta `DATABASE_URL_READONLY`. Quien lo use debe fallar cerrado:
 * nunca caer al cliente principal, que se conecta con el usuario dueño de la base.
 */
let cached: PrismaClient | null | undefined;

export function getReadonlyPrisma(): PrismaClient | null {
  if (cached !== undefined) return cached;

  const url = process.env.DATABASE_URL_READONLY?.trim();
  cached = url ? new PrismaClient({ datasources: { db: { url } } }) : null;
  return cached;
}

/** Solo para tests: olvida el cliente memorizado. */
export function resetReadonlyPrismaCache(): void {
  cached = undefined;
}
