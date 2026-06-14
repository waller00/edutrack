import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { execSync } from "node:child_process";

/**
 * Levanta un Postgres efímero, le aplica el schema con el mismo `db push` del proyecto
 * y deja `DATABASE_URL` apuntando ahí. Los workers (forked después de este setup) heredan
 * el env, por lo que el singleton `prisma` se conecta a esta base de test.
 */
let container: StartedPostgreSqlContainer | undefined;

export async function setup(): Promise<void> {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("edutrack_test")
    .start();

  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;

  execSync("./node_modules/.bin/prisma db push --skip-generate --accept-data-loss", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
