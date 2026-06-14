import { prisma } from "../../db/prisma.js";
import { getMoodleOperationalSettings } from "../../config/system-settings.js";
import { isMoodleIntegrationEnabled, moodleBaseUrl, moodleRest } from "./client.js";

export type MoodleHealthStatus = {
  configured: boolean;
  baseUrl: string | null;
  syncEnabled: boolean;
  syncStudents: boolean;
  reconcileIntervalMs: number;
  connection: {
    ok: boolean;
    siteName?: string;
    moodleVersion?: string;
    error?: string;
  };
  outbox: {
    pending: number;
    processing: number;
    failed: number;
    completed: number;
  };
};

export async function probeMoodleConnection(): Promise<{
  ok: boolean;
  siteName?: string;
  moodleVersion?: string;
  error?: string;
}> {
  if (!isMoodleIntegrationEnabled()) {
    return { ok: false, error: "MOODLE_NOT_CONFIGURED" };
  }
  try {
    const data = (await moodleRest("core_webservice_get_site_info", {})) as Record<string, unknown>;
    return {
      ok: true,
      siteName: typeof data.sitename === "string" ? data.sitename : undefined,
      moodleVersion: typeof data.release === "string" ? data.release : undefined,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message.slice(0, 500) };
  }
}

export async function getMoodleHealthStatus(): Promise<MoodleHealthStatus> {
  const settings = await getMoodleOperationalSettings();
  const configured = isMoodleIntegrationEnabled();
  const connection = configured ? await probeMoodleConnection() : { ok: false, error: "MOODLE_NOT_CONFIGURED" };

  const grouped = await prisma.moodleSyncTask.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const countByStatus = (status: string) =>
    grouped.find((g) => g.status === status)?._count._all ?? 0;

  return {
    configured,
    baseUrl: moodleBaseUrl(),
    syncEnabled: settings.syncEnabled,
    syncStudents: settings.syncStudents,
    reconcileIntervalMs: settings.reconcileIntervalMs,
    connection,
    outbox: {
      pending: countByStatus("PENDING"),
      processing: countByStatus("PROCESSING"),
      failed: countByStatus("FAILED"),
      completed: countByStatus("COMPLETED"),
    },
  };
}
