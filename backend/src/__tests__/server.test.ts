import { beforeEach, describe, expect, it, vi } from "vitest";

const { listenSpy, createServerSpy } = vi.hoisted(() => {
  const listenSpy = vi.fn((_port: number, _host: string, callback?: () => void) => {
    callback?.();
  });
  const createServerSpy = vi.fn(() => ({ listen: listenSpy }));
  return { listenSpy, createServerSpy };
});

vi.mock("node:http", () => ({
  default: { createServer: createServerSpy },
}));

vi.mock("../app.js", () => ({
  default: {},
}));

vi.mock("../services/school-year-service.js", () => ({
  ensureDefaultSchoolYearAndBackfill: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../config/system-settings.js", () => ({
  getAttendanceOperationalSettings: vi.fn().mockResolvedValue({ monitorEnabled: false }),
}));

vi.mock("../services/attendance-incidents.js", () => ({
  scanAndCreateTeacherNoShowIncidents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db/prisma.js", () => ({
  prisma: {},
}));

describe("server", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.PORT;
    process.env.ZKTECO_ICLOCK_PORT = "0";
  });

  it("starts the app on the configured port", async () => {
    process.env.PORT = "4321";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await import("../server.js");

    expect(createServerSpy).toHaveBeenCalled();
    expect(listenSpy).toHaveBeenCalledWith(4321, "0.0.0.0", expect.any(Function));
    expect(logSpy).toHaveBeenCalledWith("🚀 Auth-service corriendo en HTTP (puerto 4321)");
  });

  it("falls back to port 4000", async () => {
    delete process.env.PORT;
    await import("../server.js");
    expect(listenSpy).toHaveBeenCalledWith(4000, "0.0.0.0", expect.any(Function));
  });

  it("opens dedicated iclock port when ZKTECO_ICLOCK_PORT differs from PORT", async () => {
    process.env.PORT = "4000";
    process.env.ZKTECO_ICLOCK_PORT = "8081";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await import("../server.js");

    expect(listenSpy).toHaveBeenCalledWith(4000, "0.0.0.0", expect.any(Function));
    expect(listenSpy).toHaveBeenCalledWith(8081, "0.0.0.0", expect.any(Function));
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("ZKTeco iClock ADMS (dedicado)"),
    );
  });
});
