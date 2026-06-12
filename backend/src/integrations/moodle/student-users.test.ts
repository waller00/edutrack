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
}));
vi.mock("../../notifications/student-welcome.js", () => ({
  sendStudentWelcomeEmail: sendWelcomeMock,
}));
vi.mock("../../db/prisma.js", () => ({ prisma: prismaMock }));

import { ensureStudentMoodleAccount, syncMoodleStudentById } from "./student-users.js";

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

  it("crea la cuenta real y envía la bienvenida una vez (claim atómico)", async () => {
    await syncMoodleStudentById("s1-uuid");
    expect(sendWelcomeMock).toHaveBeenCalledWith({
      to: "ana@test.com",
      firstName: "Ana",
      username: "ana.diaz",
    });
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
