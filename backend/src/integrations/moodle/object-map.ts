import type { MoodleObjectType } from "@prisma/client";
import { prisma } from "../../db/prisma.js";

/**
 * Mapeo persistente EduTrack↔Moodle (`MoodleObjectMap`). Compartido por las capas
 * de estructura académica (`courses.ts`) y cuentas de estudiantes (`student-users.ts`).
 */

export async function getMappedId(
  objectType: MoodleObjectType,
  localId: string,
): Promise<number | null> {
  const row = await prisma.moodleObjectMap.findUnique({
    where: { objectType_localId: { objectType, localId } },
    select: { moodleId: true },
  });
  return row?.moodleId ?? null;
}

/**
 * Versión en lote de `getMappedId`, para no hacer N consultas al listar.
 *
 * Es consulta local (no pega a Moodle), así que se puede llamar siempre; a diferencia del estado
 * en vivo de la cuenta, que va detrás del opt-in `includeMoodle` porque cuesta un web service.
 */
export async function getMappedIds(
  objectType: MoodleObjectType,
  localIds: readonly string[],
): Promise<Map<string, number>> {
  if (localIds.length === 0) return new Map();
  const rows = await prisma.moodleObjectMap.findMany({
    where: { objectType, localId: { in: [...new Set(localIds)] } },
    select: { localId: true, moodleId: true },
  });
  return new Map(rows.map((row) => [row.localId, row.moodleId]));
}

export async function saveMapping(
  objectType: MoodleObjectType,
  localId: string,
  moodleId: number,
  idnumber: string,
): Promise<void> {
  await prisma.moodleObjectMap.upsert({
    where: { objectType_localId: { objectType, localId } },
    create: { objectType, localId, moodleId, idnumber },
    update: { moodleId, idnumber },
  });
}
