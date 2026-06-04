import { describe, it, expect, beforeEach, vi } from "vitest";

const { moodleRestMock } = vi.hoisted(() => ({ moodleRestMock: vi.fn() }));

vi.mock("./client.js", () => ({ moodleRest: moodleRestMock }));

import { enrolUser, getEnrolledUserIds } from "./enrolments.js";

beforeEach(() => {
  moodleRestMock.mockReset();
});

describe("enrolUser", () => {
  it("invoca enrol_manual_enrol_users con rol, usuario y curso", async () => {
    moodleRestMock.mockResolvedValue([]);
    await enrolUser(42, 100, 3);
    expect(moodleRestMock).toHaveBeenCalledWith("enrol_manual_enrol_users", {
      "enrolments[0][roleid]": "3",
      "enrolments[0][userid]": "42",
      "enrolments[0][courseid]": "100",
    });
  });
});

describe("getEnrolledUserIds", () => {
  it("devuelve el set de ids numéricos de los inscritos", async () => {
    moodleRestMock.mockResolvedValue([{ id: 1 }, { id: "2" }, { id: "x" }, { noId: true }]);
    const ids = await getEnrolledUserIds(100);
    expect([...ids].sort()).toEqual([1, 2]);
  });

  it("devuelve un set vacío si la respuesta no es un array", async () => {
    moodleRestMock.mockResolvedValue({ exception: "nope" });
    const ids = await getEnrolledUserIds(100);
    expect(ids.size).toBe(0);
  });
});
