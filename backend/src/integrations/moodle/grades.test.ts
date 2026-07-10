import { describe, it, expect, beforeEach, vi } from "vitest";

const { moodleRestMock } = vi.hoisted(() => ({ moodleRestMock: vi.fn() }));

vi.mock("./client.js", () => ({ moodleRest: moodleRestMock }));

import { listCourseAssignments, getAssignmentGrades, saveAssignmentGrade } from "./grades.js";

beforeEach(() => {
  moodleRestMock.mockReset();
});

describe("listCourseAssignments", () => {
  it("invoca mod_assign_get_assignments y normaliza tipo/nota máxima", async () => {
    moodleRestMock.mockResolvedValue({
      courses: [
        {
          id: 100,
          assignments: [
            { id: 5, cmid: 50, name: "Tarea puntaje", grade: 100 },
            { id: 6, cmid: 60, name: "Tarea escala", grade: -1 },
            { id: 7, cmid: 70, name: "Tarea sin nota", grade: 0 },
          ],
        },
      ],
    });

    const list = await listCourseAssignments(100);

    expect(moodleRestMock).toHaveBeenCalledWith("mod_assign_get_assignments", {
      "courseids[0]": "100",
      includenotenrolledcourses: "1",
    });
    expect(list).toEqual([
      { id: 5, cmid: 50, name: "Tarea puntaje", maxGrade: 100, gradeType: "point" },
      { id: 6, cmid: 60, name: "Tarea escala", maxGrade: null, gradeType: "scale" },
      { id: 7, cmid: 70, name: "Tarea sin nota", maxGrade: null, gradeType: "none" },
    ]);
  });

  it("devuelve lista vacía si no hay cursos en la respuesta", async () => {
    moodleRestMock.mockResolvedValue({ warnings: [] });
    expect(await listCourseAssignments(100)).toEqual([]);
  });
});

describe("getAssignmentGrades", () => {
  it("indexa notas por userid y omite las sin calificar (-1)", async () => {
    moodleRestMock.mockResolvedValue({
      assignments: [
        {
          assignmentid: 5,
          grades: [
            { userid: 42, grade: "85.00000" },
            { userid: 43, grade: "-1.00000" },
            { userid: 44, grade: "60" },
          ],
        },
      ],
    });

    const grades = await getAssignmentGrades(5);

    expect(moodleRestMock).toHaveBeenCalledWith("mod_assign_get_grades", {
      "assignmentids[0]": "5",
    });
    expect(grades.get(42)).toBe(85);
    expect(grades.has(43)).toBe(false);
    expect(grades.get(44)).toBe(60);
    expect(grades.size).toBe(2);
  });

  it("con varias entradas por alumno se queda con la de mayor timemodified", async () => {
    moodleRestMock.mockResolvedValue({
      assignments: [
        {
          assignmentid: 5,
          grades: [
            { userid: 42, grade: "50", timemodified: 100 },
            { userid: 42, grade: "80", timemodified: 300 }, // vigente
            { userid: 42, grade: "70", timemodified: 200 },
          ],
        },
      ],
    });
    const grades = await getAssignmentGrades(5);
    expect(grades.get(42)).toBe(80);
  });

  it("devuelve mapa vacío si la respuesta no trae assignments", async () => {
    moodleRestMock.mockResolvedValue({ warnings: [] });
    expect((await getAssignmentGrades(5)).size).toBe(0);
  });
});

describe("saveAssignmentGrade", () => {
  it("invoca mod_assign_save_grade con los parámetros de escritura", async () => {
    moodleRestMock.mockResolvedValue(null);
    await saveAssignmentGrade(5, 42, 90);
    expect(moodleRestMock).toHaveBeenCalledWith("mod_assign_save_grade", {
      assignmentid: "5",
      userid: "42",
      grade: "90",
      attemptnumber: "-1",
      addattempt: "0",
      workflowstate: "",
      applytoall: "0",
    });
  });
});
