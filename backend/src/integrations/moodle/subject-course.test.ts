import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMappedIdMock } = vi.hoisted(() => ({ getMappedIdMock: vi.fn() }));
vi.mock("./object-map.js", () => ({ getMappedId: getMappedIdMock }));

import { resolveSubjectCourse } from "./subject-course.js";

const BASE = {
  schoolYearId: "year-1",
  courseOfferingId: "offering-1",
  subjectId: "subject-1",
};

describe("resolveSubjectCourse", () => {
  beforeEach(() => getMappedIdMock.mockReset());

  it("resuelve el curso general cuando no se filtra por orientación", async () => {
    getMappedIdMock.mockResolvedValue(77);

    const resolved = await resolveSubjectCourse(BASE);

    expect(resolved).toMatchObject({ moodleCourseId: 77, isGeneral: true });
    expect(resolved?.idnumber).toBe("et-subject-offering-offering-1-subject-1");
    expect(getMappedIdMock).toHaveBeenCalledTimes(1);
  });

  it("prefiere courseOrientationId sobre orientationId", async () => {
    getMappedIdMock.mockResolvedValue(88);

    const resolved = await resolveSubjectCourse({
      ...BASE,
      courseOrientationId: "co-1",
      orientationId: "o-1",
    });

    expect(resolved).toMatchObject({
      moodleCourseId: 88,
      effectiveCourseOrientationId: "co-1",
      effectiveOrientationId: null,
      isGeneral: false,
    });
    // Acertó en el primer candidato: no probó los más generales.
    expect(getMappedIdMock).toHaveBeenCalledTimes(1);
  });

  it("cae al curso general si la orientación no está sincronizada (tronco común)", async () => {
    getMappedIdMock.mockResolvedValueOnce(null).mockResolvedValueOnce(42);

    const resolved = await resolveSubjectCourse({ ...BASE, orientationId: "o-1" });

    expect(resolved).toMatchObject({
      moodleCourseId: 42,
      effectiveOrientationId: null,
      isGeneral: true,
    });
    expect(getMappedIdMock).toHaveBeenCalledTimes(2);
  });

  it("prueba las tres formas antes de rendirse", async () => {
    getMappedIdMock.mockResolvedValue(null);

    const resolved = await resolveSubjectCourse({
      ...BASE,
      courseOrientationId: "co-1",
      orientationId: "o-1",
    });

    expect(resolved).toBeNull();
    expect(getMappedIdMock).toHaveBeenCalledTimes(3);
  });

  it("devuelve null sin consultar el mapeo si el scope no es resoluble", async () => {
    const resolved = await resolveSubjectCourse({ ...BASE, subjectId: "" });

    expect(resolved).toBeNull();
    expect(getMappedIdMock).not.toHaveBeenCalled();
  });
});
