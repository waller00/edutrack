import type { MoodleSyncTaskType } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { isMoodleIntegrationEnabled } from "./client.js";
import { syncMoodleUserById } from "./users.js";
import { syncMoodleStudentById } from "./student-users.js";

/**
 * Outbox persistente para sincronización con Moodle.
 *
 * Reemplaza el patrón "fire-and-forget" (`void ensureMoodleUserById`) que perdía en silencio
 * cualquier fallo transitorio. Aquí cada intención de sync queda en BD y se reintenta con
 * backoff exponencial hasta `maxAttempts`, de modo que una caída de Moodle no desincroniza
 * de forma permanente.
 */

const BACKOFF_BASE_MS = 60_000; // 1 min, duplicando por intento
let outboxWakeScheduled = false;

function backoffFor(attempts: number): Date {
  const ms = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), 6 * 60 * 60 * 1000);
  return new Date(Date.now() + ms);
}

function wakeOutboxSoon(): void {
  if (outboxWakeScheduled) return;
  outboxWakeScheduled = true;
  const t = setTimeout(() => {
    outboxWakeScheduled = false;
    void processOutboxOnce(20).catch((error) => {
      console.error("[moodle] outbox wake falló:", error);
    });
  }, 250);
  t.unref?.();
}

/** Encola (idempotente por `dedupeKey`) un upsert de usuario. No bloquea ni lanza. */
export async function enqueueUserUpsert(userId: string): Promise<void> {
  if (!isMoodleIntegrationEnabled()) return;
  const dedupeKey = `user:${userId}`;
  try {
    await prisma.moodleSyncTask.upsert({
      where: { dedupeKey },
      create: {
        type: "USER_UPSERT",
        dedupeKey,
        payload: { userId },
      },
      // Si ya existe (incluso DONE/FAILED), reábrelo: el dato local cambió y debe re-sincronizarse.
      update: {
        status: "PENDING",
        attempts: 0,
        lastError: null,
        runAfter: new Date(),
        lockedAt: null,
        payload: { userId },
      },
    });
    wakeOutboxSoon();
  } catch (e) {
    console.error("[moodle] enqueueUserUpsert falló:", userId, e);
  }
}

/** Encola (idempotente por `dedupeKey`) la cuenta Moodle de un estudiante. No bloquea ni lanza. */
export async function enqueueStudentUserUpsert(studentId: string): Promise<void> {
  if (!isMoodleIntegrationEnabled()) return;
  const dedupeKey = `student:${studentId}`;
  try {
    await prisma.moodleSyncTask.upsert({
      where: { dedupeKey },
      create: {
        type: "STUDENT_USER_UPSERT",
        dedupeKey,
        payload: { studentId },
      },
      // Si ya existe (incluso DONE/FAILED), reábrelo: el dato local cambió y debe re-sincronizarse.
      update: {
        status: "PENDING",
        attempts: 0,
        lastError: null,
        runAfter: new Date(),
        lockedAt: null,
        payload: { studentId },
      },
    });
    wakeOutboxSoon();
  } catch (e) {
    console.error("[moodle] enqueueStudentUserUpsert falló:", studentId, e);
  }
}

async function runTask(type: MoodleSyncTaskType, payload: unknown): Promise<void> {
  const data = (payload ?? {}) as Record<string, unknown>;
  switch (type) {
    case "USER_UPSERT": {
      const userId = String(data.userId ?? "");
      if (!userId) throw new Error("MOODLE_TASK_NO_USER_ID");
      await syncMoodleUserById(userId);
      return;
    }
    case "STUDENT_USER_UPSERT": {
      const studentId = String(data.studentId ?? "");
      if (!studentId) throw new Error("MOODLE_TASK_NO_STUDENT_ID");
      await syncMoodleStudentById(studentId);
      return;
    }
    default:
      throw new Error(`MOODLE_TASK_UNKNOWN_TYPE: ${String(type)}`);
  }
}

/**
 * Procesa hasta `limit` tareas pendientes y vencidas. Devuelve cuántas procesó.
 * Cada tarea se "reclama" marcando `lockedAt` para evitar doble ejecución entre ticks.
 */
export async function processOutboxOnce(limit = 20): Promise<number> {
  if (!isMoodleIntegrationEnabled()) return 0;

  const due = await prisma.moodleSyncTask.findMany({
    where: { status: "PENDING", runAfter: { lte: new Date() }, lockedAt: null },
    orderBy: { runAfter: "asc" },
    take: limit,
  });

  let processed = 0;
  for (const task of due) {
    // Claim atómico: sólo procede si seguía libre.
    const claim = await prisma.moodleSyncTask.updateMany({
      where: { id: task.id, lockedAt: null },
      data: { lockedAt: new Date() },
    });
    if (claim.count === 0) continue;

    processed += 1;
    try {
      await runTask(task.type, task.payload);
      await prisma.moodleSyncTask.update({
        where: { id: task.id },
        data: { status: "DONE", attempts: task.attempts + 1, lastError: null, lockedAt: null },
      });
    } catch (e) {
      const attempts = task.attempts + 1;
      const exhausted = attempts >= task.maxAttempts;
      const message = e instanceof Error ? e.message : String(e);
      await prisma.moodleSyncTask.update({
        where: { id: task.id },
        data: {
          status: exhausted ? "FAILED" : "PENDING",
          attempts,
          lastError: message.slice(0, 2000),
          runAfter: exhausted ? task.runAfter : backoffFor(attempts),
          lockedAt: null,
        },
      });
      if (exhausted) {
        console.error(`[moodle] tarea ${task.type} agotó reintentos:`, task.dedupeKey, message);
      }
    }
  }
  return processed;
}

/** Libera claims colgados (proceso reiniciado a mitad de tarea). */
export async function releaseStaleLocks(olderThanMs = 5 * 60_000): Promise<void> {
  await prisma.moodleSyncTask.updateMany({
    where: { status: "PENDING", lockedAt: { lt: new Date(Date.now() - olderThanMs) } },
    data: { lockedAt: null },
  });
}
