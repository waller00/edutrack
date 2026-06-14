import { describe, it, expect, beforeEach, vi } from "vitest";

const { moodleRestMock, prismaMock } = vi.hoisted(() => ({
  moodleRestMock: vi.fn(),
  prismaMock: {
    moodleObjectMap: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock("./client.js", () => ({
  moodleRest: moodleRestMock,
  moodleRootCategoryId: () => 0,
  moodleUserLang: () => "es",
}));
vi.mock("../../db/prisma.js", () => ({ prisma: prismaMock }));

import { ensureCategory, ensureCourse, ensureStudentMoodleUser } from "./courses.js";

beforeEach(() => {
  moodleRestMock.mockReset();
  prismaMock.moodleObjectMap.findUnique.mockReset().mockResolvedValue(null);
  prismaMock.moodleObjectMap.upsert.mockReset().mockResolvedValue({});
});

describe("ensureCategory", () => {
  it("devuelve el id mapeado sin llamar a Moodle si ya existe el vínculo", async () => {
    prismaMock.moodleObjectMap.findUnique.mockResolvedValue({ moodleId: 5 });
    expect(await ensureCategory("sy1", "et-year-sy1", "Ciclo 2026")).toBe(5);
    expect(moodleRestMock).not.toHaveBeenCalled();
  });

  it("recupera el drift: si existe en Moodle por idnumber, lo mapea", async () => {
    moodleRestMock.mockImplementation(async (fn: string) => {
      if (fn === "core_course_get_categories") return [{ id: 8 }];
      return [];
    });
    expect(await ensureCategory("sy1", "et-year-sy1", "Ciclo 2026")).toBe(8);
    expect(prismaMock.moodleObjectMap.upsert).toHaveBeenCalled();
    expect(moodleRestMock).not.toHaveBeenCalledWith("core_course_create_categories", expect.anything());
  });

  it("crea la categoría si no existe en ningún lado y guarda el mapeo", async () => {
    moodleRestMock.mockImplementation(async (fn: string) => {
      if (fn === "core_course_get_categories") return [];
      if (fn === "core_course_create_categories") return [{ id: 12 }];
      return [];
    });
    expect(await ensureCategory("sy1", "et-year-sy1", "Ciclo 2026")).toBe(12);
    const saved = prismaMock.moodleObjectMap.upsert.mock.calls[0][0];
    expect(saved.create.objectType).toBe("CATEGORY");
    expect(saved.create.moodleId).toBe(12);
  });

  it("lanza si la creación no devuelve id", async () => {
    moodleRestMock.mockImplementation(async (fn: string) => {
      if (fn === "core_course_get_categories") return [];
      if (fn === "core_course_create_categories") return [{}];
      return [];
    });
    await expect(ensureCategory("sy1", "et-year-sy1", "Ciclo 2026")).rejects.toThrow(
      /MOODLE_CREATE_CATEGORY_UNEXPECTED/,
    );
  });
});

describe("ensureCourse", () => {
  it("recupera por idnumber desde el sobre {courses:[...]}", async () => {
    moodleRestMock.mockImplementation(async (fn: string) => {
      if (fn === "core_course_get_courses_by_field") return { courses: [{ id: 21 }] };
      return [];
    });
    expect(await ensureCourse("off1", "et-offering-off1", "Mate (2026)", "MAT-2026", 12)).toBe(21);
    expect(moodleRestMock).not.toHaveBeenCalledWith("core_course_create_courses", expect.anything());
  });

  it("crea el curso si no existe", async () => {
    moodleRestMock.mockImplementation(async (fn: string) => {
      if (fn === "core_course_get_courses_by_field") return { courses: [] };
      if (fn === "core_course_create_courses") return [{ id: 33 }];
      return [];
    });
    expect(await ensureCourse("off1", "et-offering-off1", "Mate (2026)", "MAT-2026", 12)).toBe(33);
    const created = moodleRestMock.mock.calls.find((c) => c[0] === "core_course_create_courses")![1];
    expect(created["courses[0][idnumber]"]).toBe("et-offering-off1");
    expect(created["courses[0][categoryid]"]).toBe("12");
  });
});

describe("ensureStudentMoodleUser", () => {
  const student = { id: "aaaa-bbbb", firstName: "Juan", lastName: "Gómez", email: null };

  it("devuelve el id mapeado si ya existe el espejo del estudiante", async () => {
    prismaMock.moodleObjectMap.findUnique.mockResolvedValue({ moodleId: 70 });
    expect(await ensureStudentMoodleUser(student)).toBe(70);
    expect(moodleRestMock).not.toHaveBeenCalled();
  });

  it("crea el espejo con email sintético determinista cuando no hay contacto", async () => {
    moodleRestMock.mockImplementation(async (fn: string) => {
      if (fn === "core_user_get_users_by_field") return [];
      if (fn === "core_user_create_users") return [{ id: 71 }];
      return [];
    });
    expect(await ensureStudentMoodleUser(student)).toBe(71);
    const created = moodleRestMock.mock.calls.find((c) => c[0] === "core_user_create_users")![1];
    expect(created["users[0][idnumber]"]).toBe("et-student-aaaa-bbbb");
    expect(created["users[0][email]"]).toContain("@students.edutrack.local");
    expect(created["users[0][auth]"]).toBe("nologin");
  });
});
