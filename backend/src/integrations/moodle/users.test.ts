import { describe, it, expect, beforeEach, vi } from "vitest";

const { moodleRestMock, enabledMock, authMethodMock, prismaMock } = vi.hoisted(() => ({
  moodleRestMock: vi.fn(),
  enabledMock: vi.fn(),
  authMethodMock: vi.fn(() => "manual"),
  prismaMock: {
    user: { update: vi.fn(), findUnique: vi.fn() },
  },
}));

vi.mock("./client.js", () => ({
  moodleRest: moodleRestMock,
  isMoodleIntegrationEnabled: enabledMock,
  moodleUserAuthMethod: authMethodMock,
}));
vi.mock("../../db/prisma.js", () => ({ prisma: prismaMock }));

import { syncMoodleUser, syncMoodleUserById } from "./users.js";

const baseUser = {
  id: "11111111-2222-4333-8444-555555555555",
  email: "Persona@Example.com",
  firstName: "Ana",
  lastName: "Pérez",
  name: null,
};

beforeEach(() => {
  moodleRestMock.mockReset();
  enabledMock.mockReset().mockReturnValue(true);
  authMethodMock.mockReset().mockReturnValue("manual");
  prismaMock.user.update.mockReset().mockResolvedValue({});
  prismaMock.user.findUnique.mockReset();
});

describe("syncMoodleUser", () => {
  it("devuelve null si la integración está deshabilitada", async () => {
    enabledMock.mockReturnValue(false);
    expect(await syncMoodleUser(baseUser)).toBeNull();
    expect(moodleRestMock).not.toHaveBeenCalled();
  });

  it("devuelve null y no llama a Moodle si el usuario no tiene email", async () => {
    expect(await syncMoodleUser({ ...baseUser, email: "" })).toBeNull();
    expect(moodleRestMock).not.toHaveBeenCalled();
  });

  it("si ya existe por idnumber (UUID EduTrack), persiste el id y no crea", async () => {
    moodleRestMock.mockImplementation(async (fn: string, params: Record<string, string>) => {
      if (fn === "core_user_get_users_by_field" && params.field === "idnumber") return [{ id: 55 }];
      return [];
    });

    const id = await syncMoodleUser(baseUser);

    expect(id).toBe(55);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: baseUser.id },
      data: { moodleUserId: 55 },
    });
    expect(moodleRestMock).not.toHaveBeenCalledWith("core_user_create_users", expect.anything());
  });

  it("si existe por email sin idnumber EduTrack, vincula la cuenta OAuth existente", async () => {
    moodleRestMock.mockImplementation(async (fn: string, params: Record<string, string>) => {
      if (fn === "core_user_get_users_by_field" && params.field === "idnumber") return [];
      if (fn === "core_user_get_users_by_field" && params.field === "email") return [{ id: 77 }];
      return [];
    });

    const id = await syncMoodleUser(baseUser);

    expect(id).toBe(77);
    expect(moodleRestMock).toHaveBeenCalledWith(
      "core_user_update_users",
      expect.objectContaining({
        "users[0][id]": "77",
        "users[0][idnumber]": baseUser.id,
      }),
    );
    expect(moodleRestMock).not.toHaveBeenCalledWith("core_user_create_users", expect.anything());
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: baseUser.id },
      data: { moodleUserId: 77 },
    });
  });

  it("si no existe, crea el usuario espejo y persiste el nuevo id", async () => {
    moodleRestMock.mockImplementation(async (fn: string) => {
      if (fn === "core_user_get_users_by_field") return [];
      if (fn === "core_user_create_users") return [{ id: 99 }];
      return [];
    });

    const id = await syncMoodleUser(baseUser);

    expect(id).toBe(99);
    const createCall = moodleRestMock.mock.calls.find((c) => c[0] === "core_user_create_users");
    expect(createCall).toBeTruthy();
    const params = createCall![1] as Record<string, string>;
    // El email se normaliza a minúsculas y el idnumber es el UUID EduTrack.
    expect(params["users[0][email]"]).toBe("persona@example.com");
    expect(params["users[0][idnumber]"]).toBe(baseUser.id);
    expect(params["users[0][firstname]"]).toBe("Ana");
    expect(params["users[0][lastname]"]).toBe("Pérez");
    expect(params["users[0][confirmed]"]).toBeUndefined();
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: baseUser.id },
      data: { moodleUserId: 99 },
    });
  });

  it("marca confirmed=1 al crear usuarios oauth2", async () => {
    authMethodMock.mockReturnValue("oauth2");
    moodleRestMock.mockImplementation(async (fn: string) => {
      if (fn === "core_user_get_users_by_field") return [];
      if (fn === "core_user_create_users") return [{ id: 100 }];
      return [];
    });

    await syncMoodleUser(baseUser);

    const createCall = moodleRestMock.mock.calls.find((c) => c[0] === "core_user_create_users");
    const params = createCall![1] as Record<string, string>;
    expect(params["users[0][auth]"]).toBe("oauth2");
    expect(params["users[0][confirmed]"]).toBe("1");
  });

  it("lanza si la creación no devuelve un id (la outbox reintentará)", async () => {
    moodleRestMock.mockImplementation(async (fn: string) => {
      if (fn === "core_user_get_users_by_field") return [];
      if (fn === "core_user_create_users") return [{ noId: true }];
      return [];
    });
    await expect(syncMoodleUser(baseUser)).rejects.toThrow(/MOODLE_CREATE_USER_UNEXPECTED/);
  });
});

describe("syncMoodleUserById", () => {
  it("devuelve null si el usuario local no existe", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    expect(await syncMoodleUserById("missing")).toBeNull();
  });

  it("resuelve el usuario local y delega en syncMoodleUser", async () => {
    prismaMock.user.findUnique.mockResolvedValue(baseUser);
    moodleRestMock.mockImplementation(async (fn: string, params: Record<string, string>) => {
      if (fn === "core_user_get_users_by_field" && params.field === "idnumber") return [{ id: 12 }];
      return [];
    });
    expect(await syncMoodleUserById(baseUser.id)).toBe(12);
  });
});
