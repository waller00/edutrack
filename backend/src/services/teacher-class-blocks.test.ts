import { describe, expect, it } from "vitest";
import { buildContiguousClassBlocks } from "./teacher-class-blocks.js";

const slot = (id: string, start: string, end: string, title = id) => ({
  id,
  title,
  type: "CLASE",
  startTime: new Date(start),
  endTime: new Date(end),
});

describe("teacher class blocks", () => {
  it("agrupa clases consecutivas aunque sean de grupos distintos", () => {
    const blocks = buildContiguousClassBlocks(
      [
        slot("math-1a", "2026-05-05T12:00:00.000Z", "2026-05-05T12:45:00.000Z", "Matemática 1A"),
        slot("math-2b", "2026-05-05T12:50:00.000Z", "2026-05-05T13:35:00.000Z", "Matemática 2B"),
      ],
      60,
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0].map((s) => s.id)).toEqual(["math-1a", "math-2b"]);
  });

  it("separa bloques cuando el puente libre supera el umbral configurado", () => {
    const blocks = buildContiguousClassBlocks(
      [
        slot("first", "2026-05-05T12:00:00.000Z", "2026-05-05T12:45:00.000Z"),
        slot("second", "2026-05-05T14:00:00.000Z", "2026-05-05T14:45:00.000Z"),
      ],
      60,
    );

    expect(blocks).toHaveLength(2);
  });
});
