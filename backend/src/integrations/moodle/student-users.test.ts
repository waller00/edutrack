import { describe, it, expect, beforeEach, vi } from "vitest";

const { moodleRestMock, enabledMock, sendWelcomeMock, prismaMock } = vi.hoisted(() => ({
  moodleRestMock: vi.fn(),
  enabledMock: vi.fn(),
  sendWelcomeMock: vi.fn(),
  prismaMock: {
    moodleObjectMap: { findUnique: vi.fn(), upsert: vi.fn() },
    student: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock("./client.js", () => ({
  moodleRest: moodleRestMock,
  isMoodleIntegrationEnabled: enabledMock,
  moodleUserLangParam: () => ({}),
}));
vi.mock("../../notifications/student-welcome.js", () => ({
  sendStudentWelcomeEmail: sendWelcomeMock,
}));
vi.mock("../../db/prisma.js", () => ({ prisma: prismaMock }));

import {
  ensureStudentMoodleAccount,
  getStudentMoodleVerifications,
  resendStudentMoodleWelcome,
  setStudentMoodlePassword,
  syncMoodleStudentById,
} from "./student-users.js";

const realStudent = {
  id: "s1-uuid",
  firstName: "Ana",
  lastName: "Díaz",
  email: "Ana@Test.com",
  username: "ana.diaz",
};

const noEmailStudent = { id: "s2-uuid", firstName: "Beto", lastName: "Sosa", email: null, username: "beto.sosa" };

function restByFunction(map: Record<string, unknown>) {
  moodleRestMock.mockImplementation(async (fn: string) => map[fn] ?? []);
}

function restCall(fn: string) {
  return moodleRestMock.mock.calls.find((c) => c[0] === fn)?.[1];
}

beforeEach(() => {
  moodleRestMock.mockReset();
  enabledMock.mockReset().mockReturnValue(true);
  sendWelcomeMock.mockReset().mockResolvedValue(undefined);
  prismaMock.moodleObjectMap.findUnique.mockReset().mockResolvedValue(null);
  prismaMock.moodleObjectMap.upsert.mockReset().mockResolvedValue({});
  prismaMock.student.findUnique.mockReset();
  prismaMock.student.updateMany.mockReset().mockResolvedValue({ count: 1 });
});

describe("ensureStudentMoodleAccount", () => {
  it("sin email crea el espejo nologin con email sintético (regresión)", async () => {
    restByFunction({ core_user_create_users: [{ id: 71 }] });
    const r = await ensureStudentMoodleAccount(noEmailStudent);
    expect(r).toEqual({ moodleId: 71, realAccount: false });
    const created = restCall("core_user_create_users")!;
    expect(created["users[0][auth]"]).toBe("nologin");
    expect(created["users[0][email]"]).toContain("@students.edutrack.local");
    expect(created["users[0][username]"]).toBe("etss2uuid");
    expect(created["users[0][idnumber]"]).toBe("et-student-s2-uuid");
  });

  it("con email+username crea cuenta real manual con el username del alumno", async () => {
    restByFunction({ core_user_create_users: [{ id: 72 }] });
    const r = await ensureStudentMoodleAccount(realStudent);
    expect(r).toEqual({ moodleId: 72, realAccount: true });
    const created = restCall("core_user_create_users")!;
    expect(created["users[0][auth]"]).toBe("manual");
    expect(created["users[0][username]"]).toBe("ana.diaz");
    expect(created["users[0][email]"]).toBe("ana@test.com");
    expect(prismaMock.moodleObjectMap.upsert).toHaveBeenCalled();
  });

  it("si ya está mapeado devuelve el id sin llamar a Moodle (camino reconciliación)", async () => {
    prismaMock.moodleObjectMap.findUnique.mockResolvedValue({ moodleId: 70 });
    const r = await ensureStudentMoodleAccount(realStudent);
    expect(r).toEqual({ moodleId: 70, realAccount: true });
    expect(moodleRestMock).not.toHaveBeenCalled();
  });

  it("con forceUpdate alinea el usuario existente a manual (upgrade de nologin)", async () => {
    prismaMock.moodleObjectMap.findUnique.mockResolvedValue({ moodleId: 70 });
    restByFunction({ core_user_update_users: [] });
    const r = await ensureStudentMoodleAccount(realStudent, { forceUpdate: true });
    expect(r.moodleId).toBe(70);
    const updated = restCall("core_user_update_users")!;
    expect(updated["users[0][id]"]).toBe("70");
    expect(updated["users[0][auth]"]).toBe("manual");
    expect(updated["users[0][username]"]).toBe("ana.diaz");
    expect(updated["users[0][email]"]).toBe("ana@test.com");
  });

  it("con forceUpdate pero sin email no toca el usuario existente", async () => {
    prismaMock.moodleObjectMap.findUnique.mockResolvedValue({ moodleId: 70 });
    await ensureStudentMoodleAccount(noEmailStudent, { forceUpdate: true });
    expect(moodleRestMock).not.toHaveBeenCalled();
  });

  it("recupera drift: existe por idnumber, lo mapea y devuelve su id", async () => {
    restByFunction({ core_user_get_users_by_field: [{ id: 80 }] });
    const r = await ensureStudentMoodleAccount(realStudent);
    expect(r.moodleId).toBe(80);
    expect(prismaMock.moodleObjectMap.upsert).toHaveBeenCalled();
    expect(restCall("core_user_create_users")).toBeUndefined();
  });

  it("lanza si la creación no devuelve id", async () => {
    restByFunction({ core_user_create_users: [{}] });
    await expect(ensureStudentMoodleAccount(realStudent)).rejects.toThrow(
      /MOODLE_CREATE_STUDENT_UNEXPECTED/,
    );
  });
});

describe("getStudentMoodleVerifications", () => {
  it("consulta varios idnumber en una llamada y marca verificado tras el primer acceso", async () => {
    restByFunction({
      core_user_get_users_by_field: [
        {
          id: 72,
          idnumber: "et-student-s1-uuid",
          confirmed: true,
          firstaccess: 1_700_000_000,
          preferences: [{ name: "auth_forcepasswordchange", value: "0" }],
        },
      ],
    });

    const statuses = await getStudentMoodleVerifications(["s1-uuid", "s2-uuid"]);

    expect(statuses.get("s1-uuid")).toEqual(
      expect.objectContaining({ state: "VERIFIED", verified: true, accountExists: true, moodleUserId: 72 }),
    );
    expect(statuses.get("s2-uuid")).toEqual(
      expect.objectContaining({ state: "NOT_FOUND", verified: false, accountExists: false }),
    );
    expect(restCall("core_user_get_users_by_field")).toEqual({
      field: "idnumber",
      "values[0]": "et-student-s1-uuid",
      "values[1]": "et-student-s2-uuid",
    });
  });

  it("mantiene pendiente si Moodle todavía exige cambiar la contraseña temporal", async () => {
    restByFunction({
      core_user_get_users_by_field: [
        {
          id: 72,
          idnumber: "et-student-s1-uuid",
          confirmed: 1,
          firstaccess: 1_700_000_000,
          preferences: [{ name: "auth_forcepasswordchange", value: "1" }],
        },
      ],
    });

    const status = (await getStudentMoodleVerifications(["s1-uuid"])).get("s1-uuid");
    expect(status).toEqual(expect.objectContaining({ state: "PENDING", verified: false }));
  });

  it("devuelve estado no disponible sin consultar la red si Moodle está deshabilitado", async () => {
    enabledMock.mockReturnValue(false);
    const status = (await getStudentMoodleVerifications(["s1-uuid"])).get("s1-uuid");
    expect(status).toEqual(expect.objectContaining({ state: "UNAVAILABLE", verified: null }));
    expect(moodleRestMock).not.toHaveBeenCalled();
  });
});

describe("setStudentMoodlePassword", () => {
  it("por defecto deja la contraseña usable sin forzar el cambio (datos de demo)", async () => {
    restByFunction({ core_user_update_users: [] });
    await setStudentMoodlePassword(70, "Estudiante123!");
    const updated = restCall("core_user_update_users")!;
    expect(updated["users[0][id]"]).toBe("70");
    expect(updated["users[0][password]"]).toBe("Estudiante123!");
    expect(updated["users[0][preferences][0][type]"]).toBeUndefined();
  });

  it("con forceChange exige el cambio en el primer ingreso", async () => {
    restByFunction({ core_user_update_users: [] });
    await setStudentMoodlePassword(70, "Edu-abc123-4567!", { forceChange: true });
    const updated = restCall("core_user_update_users")!;
    expect(updated["users[0][preferences][0][type]"]).toBe("auth_forcepasswordchange");
    expect(updated["users[0][preferences][0][value]"]).toBe("1");
  });
});

describe("syncMoodleStudentById", () => {
  const dbStudent = { ...realStudent, email: "ana@test.com", moodleWelcomeSentAt: null };

  beforeEach(() => {
    prismaMock.student.findUnique.mockResolvedValue(dbStudent);
    restByFunction({ core_user_create_users: [{ id: 90 }] });
  });

  it("no hace nada si la integración está deshabilitada", async () => {
    enabledMock.mockReturnValue(false);
    await syncMoodleStudentById("s1-uuid");
    expect(prismaMock.student.findUnique).not.toHaveBeenCalled();
  });

  it("no hace nada si el estudiante no existe", async () => {
    prismaMock.student.findUnique.mockResolvedValue(null);
    await syncMoodleStudentById("nope");
    expect(moodleRestMock).not.toHaveBeenCalled();
  });

  it("crea la cuenta real, fija contraseña temporal y envía la bienvenida una vez (claim atómico)", async () => {
    await syncMoodleStudentById("s1-uuid");
    expect(sendWelcomeMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ana@test.com", firstName: "Ana", username: "ana.diaz" }),
    );
    // La contraseña temporal va al mail y se fija en Moodle forzando el cambio.
    const tempPassword = sendWelcomeMock.mock.calls[0][0].tempPassword as string;
    expect(tempPassword).toMatch(/^Edu-/);
    const updated = restCall("core_user_update_users")!;
    expect(updated["users[0][password]"]).toBe(tempPassword);
    expect(updated["users[0][preferences][0][type]"]).toBe("auth_forcepasswordchange");
    expect(updated["users[0][preferences][0][value]"]).toBe("1");
    const claim = prismaMock.student.updateMany.mock.calls[0][0];
    expect(claim.where).toEqual({ id: "s1-uuid", moodleWelcomeSentAt: null });
    expect(claim.data.moodleWelcomeSentAt).toBeInstanceOf(Date);
  });

  it("no reenvía si el claim ya fue tomado por otro camino", async () => {
    prismaMock.student.updateMany.mockResolvedValue({ count: 0 });
    await syncMoodleStudentById("s1-uuid");
    expect(sendWelcomeMock).not.toHaveBeenCalled();
  });

  it("no envía bienvenida si ya se mandó antes", async () => {
    prismaMock.student.findUnique.mockResolvedValue({
      ...dbStudent,
      moodleWelcomeSentAt: new Date("2026-01-01T00:00:00Z"),
    });
    await syncMoodleStudentById("s1-uuid");
    expect(sendWelcomeMock).not.toHaveBeenCalled();
    expect(prismaMock.student.updateMany).not.toHaveBeenCalled();
  });

  it("no envía bienvenida a cuentas nologin (sin email)", async () => {
    prismaMock.student.findUnique.mockResolvedValue({
      ...noEmailStudent,
      moodleWelcomeSentAt: null,
    });
    await syncMoodleStudentById("s2-uuid");
    expect(sendWelcomeMock).not.toHaveBeenCalled();
  });

  it("si falla el envío libera el claim y relanza para que el outbox reintente", async () => {
    sendWelcomeMock.mockRejectedValue(new Error("SMTP down"));
    await expect(syncMoodleStudentById("s1-uuid")).rejects.toThrow("SMTP down");
    const revert = prismaMock.student.updateMany.mock.calls[1][0];
    expect(revert.where).toEqual({ id: "s1-uuid" });
    expect(revert.data.moodleWelcomeSentAt).toBeNull();
  });
});

describe("resendStudentMoodleWelcome", () => {
  it("regenera la contraseña y reenvía el correo de una cuenta pendiente", async () => {
    prismaMock.student.findUnique.mockResolvedValue(realStudent);
    restByFunction({
      core_user_get_users_by_field: [],
      core_user_create_users: [{ id: 91 }],
      core_user_update_users: [],
    });

    const sentAt = await resendStudentMoodleWelcome("s1-uuid");

    expect(sentAt).toBeInstanceOf(Date);
    expect(sendWelcomeMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ana@test.com", username: "ana.diaz", tempPassword: expect.stringMatching(/^Edu-/) }),
    );
    expect(prismaMock.student.updateMany).toHaveBeenCalledWith({
      where: { id: "s1-uuid" },
      data: { moodleWelcomeSentAt: sentAt },
    });
  });

  it("rechaza el reenvío si el alumno ya verificó su acceso", async () => {
    prismaMock.student.findUnique.mockResolvedValue(realStudent);
    restByFunction({
      core_user_get_users_by_field: [
        { id: 72, idnumber: "et-student-s1-uuid", confirmed: 1, firstaccess: 1_700_000_000 },
      ],
    });

    await expect(resendStudentMoodleWelcome("s1-uuid")).rejects.toThrow("MOODLE_STUDENT_ALREADY_VERIFIED");
    expect(sendWelcomeMock).not.toHaveBeenCalled();
  });
});
