import { beforeEach, describe, expect, it, vi } from "vitest";

const listenSpy = vi.fn((_port, callback?: () => void) => {
  callback?.();
  return { close: vi.fn() };
});

vi.mock("./app.js", () => ({
  default: { listen: listenSpy },
}));

describe("server", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("starts the app on the configured port", async () => {
    process.env.PORT = "4321";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await import("./server.js");

    expect(listenSpy).toHaveBeenCalledWith(4321, expect.any(Function));
    expect(logSpy).toHaveBeenCalledWith("Auth-service en http://localhost:4321");
  });

  it("falls back to port 4000", async () => {
    delete process.env.PORT;
    await import("./server.js");
    expect(listenSpy).toHaveBeenCalledWith(4000, expect.any(Function));
  });
});
