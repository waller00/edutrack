import type { MoodleEnrolmentSource } from "@prisma/client";
import { prisma } from "../../db/prisma.js";

/**
 * Tracking local de las inscripciones que la integración otorga en Moodle (`MoodleEnrolmentMap`).
 *
 * No dependemos sólo del estado remoto de Moodle para saber qué revocar: cada acceso queda
 * registrado con su origen (`TEACHER_EVENT` | `SUBSTITUTE` | `STUDENT_ENROLLMENT`) y su ventana
 * temporal. La clave lógica es `(sourceType, userId, moodleCourseId)`.
 */

export type EnrolmentMapRow = {
  id: string;
  userId: string;
  moodleUserId: number;
  moodleCourseId: number;
  roleId: number;
  sourceType: MoodleEnrolmentSource;
  sourceId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
};

/** Registra/actualiza (idempotente) una inscripción otorgada y la deja en estado `ACTIVE`. */
export async function upsertEnrolmentMap(args: {
  userId: string;
  moodleUserId: number;
  moodleCourseId: number;
  roleId: number;
  sourceType: MoodleEnrolmentSource;
  sourceId?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
}): Promise<void> {
  const { userId, moodleUserId, moodleCourseId, roleId, sourceType } = args;
  const sourceId = args.sourceId ?? null;
  const startsAt = args.startsAt ?? null;
  const endsAt = args.endsAt ?? null;
  await prisma.moodleEnrolmentMap.upsert({
    where: { sourceType_userId_moodleCourseId: { sourceType, userId, moodleCourseId } },
    create: { userId, moodleUserId, moodleCourseId, roleId, sourceType, sourceId, startsAt, endsAt },
    update: { moodleUserId, roleId, sourceId, startsAt, endsAt, status: "ACTIVE" },
  });
}

/** Inscripciones activas de un origen dado (para la fase de revocación). */
export async function listActiveEnrolments(
  sourceType: MoodleEnrolmentSource,
): Promise<EnrolmentMapRow[]> {
  return prisma.moodleEnrolmentMap.findMany({
    where: { sourceType, status: "ACTIVE" },
    select: {
      id: true,
      userId: true,
      moodleUserId: true,
      moodleCourseId: true,
      roleId: true,
      sourceType: true,
      sourceId: true,
      startsAt: true,
      endsAt: true,
    },
  });
}

/** Marca una inscripción como revocada (tras quitar el acceso en Moodle, o si seguía por titularidad). */
export async function markEnrolmentRevoked(id: string): Promise<void> {
  await prisma.moodleEnrolmentMap.update({ where: { id }, data: { status: "REVOKED" } });
}
