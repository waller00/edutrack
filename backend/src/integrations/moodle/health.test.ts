import { afterEach, describe, expect, it, vi } from "vitest";
import { getMoodleHealthStatus, probeMoodleConnection } from "./health.js";
import { isMoodleIntegrationEnabled, moodleRest } from "./client.js";
import { getMoodleOperationalSettings } from "../../config/system-settings.js";
import { prisma } from "../../db/prisma.js";

vi.mock("./client.js", () => ({
  isMoodleIntegrationEnabled: vi.fn(),
  moodleBaseUrl: vi.fn(() => "http://moodle:8080"),
  moodleRest: vi.fn(),
}));

vi.mock("../../config/system-settings.js", () => ({
  getMoodleOperationalSettings: vi.fn(),
}));

vi.mock("../../db/prisma.js", () => ({
  prisma: {
    moodleSyncTask: {
      groupBy: vi.fn(),
    },
  },
}));

describe("moodle health", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("probeMoodleConnection devuelve sitename cuando REST responde", async () => {
    vi.mocked(isMoodleIntegrationEnabled).mockReturnValue(true);
    vi.mocked(moodleRest).mockResolvedValueOnce({ sitename: "EduTrack Local", release: "5.0.2" });
    await expect(probeMoodleConnection()).resolves.toEqual({
      ok: true,
      siteName: "EduTrack Local",
      moodleVersion: "5.0.2",
    });
  });

  it("getMoodleHealthStatus agrega outbox y settings", async () => {
    vi.mocked(isMoodleIntegrationEnabled).mockReturnValue(true);
    vi.mocked(getMoodleOperationalSettings).mockResolvedValueOnce({
      syncEnabled: true,
      reconcileIntervalMs: 900000,
      syncStudents: false,
    });
    vi.mocked(moodleRest).mockResolvedValueOnce({ sitename: "Test" });
    vi.mocked(prisma.moodleSyncTask.groupBy).mockResolvedValueOnce([
      { status: "PENDING", _count: { _all: 2 } },
      { status: "FAILED", _count: { _all: 1 } },
    ] as never);

    const status = await getMoodleHealthStatus();
    expect(status.configured).toBe(true);
    expect(status.connection.ok).toBe(true);
    expect(status.outbox.pending).toBe(2);
    expect(status.outbox.failed).toBe(1);
  });
});
