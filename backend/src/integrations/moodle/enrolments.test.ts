import { describe, it, expect, beforeEach, vi } from "vitest";

const { moodleRestMock } = vi.hoisted(() => ({ moodleRestMock: vi.fn() }));

vi.mock("./client.js", () => ({ moodleRest: moodleRestMock }));

import { enrolUser, enrolUsersBatch, getEnrolledUserIds, unenrolUser } from "./enrolments.js";

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

  it("incluye timestart/timeend (en segundos Unix) cuando hay ventana", async () => {
    moodleRestMock.mockResolvedValue([]);
    const start = new Date("2026-06-01T10:00:00.000Z");
    const end = new Date("2026-06-01T12:00:00.000Z");
    await enrolUser(42, 100, 7, { timestart: start, timeend: end });
    expect(moodleRestMock).toHaveBeenCalledWith("enrol_manual_enrol_users", {
      "enrolments[0][roleid]": "7",
      "enrolments[0][userid]": "42",
      "enrolments[0][courseid]": "100",
      "enrolments[0][timestart]": String(Math.floor(start.getTime() / 1000)),
      "enrolments[0][timeend]": String(Math.floor(end.getTime() / 1000)),
    });
  });

  it("tolera fallo de mail de bienvenida si el usuario ya quedó inscripto", async () => {
    moodleRestMock.mockImplementation(async (fn: string) => {
      if (fn === "enrol_manual_enrol_users") {
        throw new Error("MOODLE_EXCEPTION: Message was not sent.");
      }
      if (fn === "core_enrol_get_enrolled_users") return [{ id: 42 }];
      return [];
    });

    await expect(enrolUser(42, 100, 3)).resolves.toBeUndefined();
  });
});

describe("enrolUsersBatch", () => {
  it("inscribe varias parejas usuario↔curso en una sola llamada", async () => {
    moodleRestMock.mockResolvedValue([]);
    await enrolUsersBatch([
      { moodleUserId: 42, moodleCourseId: 100, roleId: 5 },
      { moodleUserId: 42, moodleCourseId: 101, roleId: 5 },
    ]);
    expect(moodleRestMock).toHaveBeenCalledTimes(1);
    expect(moodleRestMock).toHaveBeenCalledWith("enrol_manual_enrol_users", {
      "enrolments[0][roleid]": "5",
      "enrolments[0][userid]": "42",
      "enrolments[0][courseid]": "100",
      "enrolments[1][roleid]": "5",
      "enrolments[1][userid]": "42",
      "enrolments[1][courseid]": "101",
    });
  });

  it("no llama a Moodle si la lista está vacía", async () => {
    await enrolUsersBatch([]);
    expect(moodleRestMock).not.toHaveBeenCalled();
  });
});

describe("unenrolUser", () => {
  it("invoca enrol_manual_unenrol_users con usuario y curso", async () => {
    moodleRestMock.mockResolvedValue(null);
    await unenrolUser(42, 100);
    expect(moodleRestMock).toHaveBeenCalledWith("enrol_manual_unenrol_users", {
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
