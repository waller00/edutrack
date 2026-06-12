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
