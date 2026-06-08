import { describe, expect, it, vi } from "vitest";
import {
  buildContiguousClassBlocks,
  earlyEntryWindowMinutes,
  findBlockContainingInstant,
  findBlockContainingEventId,
  fetchTeacherClassSlotsForUruguayDay,
} from "./teacher-class-blocks.js";

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

  it("buildContiguousClassBlocks: lista vacía → sin bloques", () => {
    expect(buildContiguousClassBlocks([], 60)).toEqual([]);
  });

  it("earlyEntryWindowMinutes: acota entre 90 y 240", () => {
    expect(earlyEntryWindowMinutes(30)).toBe(90);
    expect(earlyEntryWindowMinutes(120)).toBe(120);
    expect(earlyEntryWindowMinutes(999)).toBe(240);
  });

  it("findBlockContainingInstant: respeta la ventana de entrada anticipada", () => {
    const blocks = [[slot("a", "2026-05-05T12:00:00.000Z", "2026-05-05T12:45:00.000Z")]];
    // 30 min antes, con ventana de 90 → dentro
    expect(findBlockContainingInstant(new Date("2026-05-05T11:30:00.000Z"), blocks, 90)).toBe(blocks[0]);
    // 2 h antes → fuera
    expect(findBlockContainingInstant(new Date("2026-05-05T10:00:00.000Z"), blocks, 90)).toBeNull();
  });

  it("findBlockContainingEventId: localiza el bloque o null", () => {
    const blocks = [[slot("a", "2026-05-05T12:00:00.000Z", "2026-05-05T12:45:00.000Z")]];
    expect(findBlockContainingEventId("a", blocks)).toBe(blocks[0]);
    expect(findBlockContainingEventId("zzz", blocks)).toBeNull();
  });

  it("fetchTeacherClassSlotsForUruguayDay: combina eventos asignados y suplencias, ordenados", async () => {
    const tx = {
      event: {
        findMany: vi.fn().mockResolvedValue([
          { id: "e1", title: "Clase", type: "CLASE", startTime: new Date("2026-05-05T13:00:00.000Z"), endTime: new Date("2026-05-05T13:45:00.000Z") },
        ]),
      },
      $queryRaw: vi.fn().mockResolvedValue([
        { eventId: "e2", title: "Suplencia", type: "CLASE", startTime: new Date("2026-05-05T12:00:00.000Z"), endTime: new Date("2026-05-05T12:45:00.000Z") },
      ]),
    };

    const slots = await fetchTeacherClassSlotsForUruguayDay(tx, "user-1", new Date("2026-05-05T15:00:00.000Z"));

    expect(slots.map((s) => s.id)).toEqual(["e2", "e1"]);
    expect(slots[0].title).toContain("suplencia");
  });
});
