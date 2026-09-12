import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./concurrency.js";

describe("mapWithConcurrency", () => {
  it("preserva el orden de entrada aunque las tareas terminen desordenadas", async () => {
    const delays = [30, 0, 20, 10];
    const result = await mapWithConcurrency(delays, 4, async (ms, i) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return i;
    });
    expect(result).toEqual([0, 1, 2, 3]);
  });

  it("nunca supera el límite de tareas en vuelo", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 5, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
    });
    expect(peak).toBeLessThanOrEqual(5);
  });

  it("resuelve con un array vacío sin colgarse", async () => {
    await expect(mapWithConcurrency([], 5, async () => 1)).resolves.toEqual([]);
  });

  it("propaga el error de una tarea", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});
