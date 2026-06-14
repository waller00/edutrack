import { execSync } from "node:child_process";

/**
 * Provisiona la base para los tests de integración y deja `DATABASE_URL` apuntando ahí
 * (los workers, forked después de este setup, heredan el env → el singleton `prisma` se conecta).
 *
 *  - CI: usa `TEST_DATABASE_URL` (un Postgres "service container"). No importa Testcontainers,
 *    así evitamos el problema de undici/Node 20.
 *  - Local: si no hay `TEST_DATABASE_URL`, levanta un Postgres efímero con Testcontainers
 *    (import dinámico, para no requerirlo en CI).
 */
let stopContainer: (() => Promise<void>) | undefined;

export async function setup(): Promise<void> {
  let url = process.env.TEST_DATABASE_URL;

  if (!url) {
    const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
    const container = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("edutrack_test")
      .start();
    url = container.getConnectionUri();
    stopContainer = async () => {
      await container.stop();
    };
  }

  process.env.DATABASE_URL = url;

  execSync("./node_modules/.bin/prisma db push --skip-generate --accept-data-loss", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}

export async function teardown(): Promise<void> {
  await stopContainer?.();
}
