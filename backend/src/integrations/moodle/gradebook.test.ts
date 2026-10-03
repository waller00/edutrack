import { beforeEach, describe, expect, it, vi } from "vitest";

const { moodleRestMock } = vi.hoisted(() => ({ moodleRestMock: vi.fn() }));
vi.mock("./client.js", () => ({ moodleRest: moodleRestMock }));

import { fetchCourseGradeReport, isImportableItem } from "./gradebook.js";

function item(over: Record<string, unknown> = {}) {
  return {
    id: 10,
    itemname: "Parcial 1",
    itemtype: "mod",
    itemmodule: "assign",
    grademin: 0,
    grademax: 100,
    graderaw: 80,
    ...over,
  };
}

beforeEach(() => moodleRestMock.mockReset());

describe("isImportableItem", () => {
  const base = { id: 1, name: "x", itemType: "mod", itemModule: "assign", gradeMin: 0, gradeMax: 100, hidden: false };

  it("acepta actividades e ítems manuales", () => {
    expect(isImportableItem(base)).toBe(true);
    expect(isImportableItem({ ...base, itemType: "manual", itemModule: null })).toBe(true);
  });

  it("descarta los totales de curso y categoría", () => {
    // Son agregados que Moodle calcula: traerlos duplicaría lo que la libreta ya promedia.
    expect(isImportableItem({ ...base, itemType: "course" })).toBe(false);
    expect(isImportableItem({ ...base, itemType: "category" })).toBe(false);
  });

  it("descarta ocultos y sin puntaje", () => {
    expect(isImportableItem({ ...base, hidden: true })).toBe(false);
    expect(isImportableItem({ ...base, gradeMax: 0 })).toBe(false);
  });
});

describe("fetchCourseGradeReport", () => {
  it("pide el reporte de todos los usuarios en una sola llamada", async () => {
    moodleRestMock.mockResolvedValue({ usergrades: [] });
    await fetchCourseGradeReport(5);
    expect(moodleRestMock).toHaveBeenCalledWith("gradereport_user_get_grade_items", {
      courseid: "5",
      userid: "0",
    });
  });

  it("deduplica los ítems y conserva una nota por alumno", async () => {
    moodleRestMock.mockResolvedValue({
      usergrades: [
        { userid: 101, useridnumber: "et-student-a", gradeitems: [item(), item({ id: 11, itemname: "Foro" })] },
        { userid: 102, useridnumber: "et-student-b", gradeitems: [item({ graderaw: 55 })] },
      ],
    });

    const report = await fetchCourseGradeReport(5);

    expect(report.items.map((i) => i.id).sort()).toEqual([10, 11]);
    expect(report.grades).toHaveLength(3);
    expect(report.grades.find((g) => g.moodleUserId === 102)?.raw).toBe(55);
  });

  it("conserva el idnumber del alumno para poder mapearlo", async () => {
    moodleRestMock.mockResolvedValue({
      usergrades: [{ userid: 101, useridnumber: "et-student-abc", gradeitems: [item()] }],
    });
    expect((await fetchCourseGradeReport(5)).grades[0].idnumber).toBe("et-student-abc");
  });

  it("una nota sin calificar viaja como null, no como cero", async () => {
    moodleRestMock.mockResolvedValue({
      usergrades: [{ userid: 101, useridnumber: null, gradeitems: [item({ graderaw: null })] }],
    });
    expect((await fetchCourseGradeReport(5)).grades[0].raw).toBeNull();
  });

  it("omite el total del curso aunque venga en la respuesta", async () => {
    moodleRestMock.mockResolvedValue({
      usergrades: [
        { userid: 101, useridnumber: null, gradeitems: [item(), item({ id: 99, itemtype: "course", itemname: "Total" })] },
      ],
    });
    const report = await fetchCourseGradeReport(5);
    expect(report.items.map((i) => i.id)).toEqual([10]);
  });

  it("devuelve vacío si la respuesta no trae usergrades", async () => {
    moodleRestMock.mockResolvedValue({ warnings: [] });
    expect(await fetchCourseGradeReport(5)).toEqual({ items: [], grades: [] });
  });
});
