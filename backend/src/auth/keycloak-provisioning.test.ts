import { describe, it, expect, beforeEach, vi } from "vitest";

const { prismaMock, syncIdentityMock, findIdsByEmailMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  syncIdentityMock: vi.fn(),
  findIdsByEmailMock: vi.fn(),
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./keycloak.js", () => ({
  syncKeycloakUserIdentity: syncIdentityMock,
  findKeycloakUserIdsByEmail: findIdsByEmailMock,
}));

import {
  backfillKeycloakLinks,
  KeycloakAccountConflictError,
  linkKeycloakAccount,
  provisionUserFromClaims,
  SsoRegistrationRequiredError,
} from "./keycloak-provisioning.js";

const ana = {
  id: "u-1",
  email: "ana@e.com",
  username: "ana",
  firstName: "Ana",
  lastName: "P",
  keycloakId: null as string | null,
  orgRole: { code: "ADMIN" },
};

/** `findUnique` por keycloakId o por username, según el `where` que reciba. */
function usersBy(opts: { keycloakId?: Record<string, unknown>; username?: Record<string, unknown> }) {
  prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: Record<string, string> }) => {
    if (where.keycloakId) return opts.keycloakId?.[where.keycloakId] ?? null;
    if (where.username) return opts.username?.[where.username] ?? null;
    return null;
  });
}

async function provisionError(claims: Record<string, unknown>) {
  try {
    await provisionUserFromClaims(claims);
  } catch (error) {
    return error;
  }
  throw new Error("se esperaba un error");
}

describe("provisionUserFromClaims", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncIdentityMock.mockResolvedValue(undefined);
    prismaMock.user.update.mockResolvedValue({});
    prismaMock.user.findFirst.mockResolvedValue(null);
    usersBy({});
  });

  it("NO revierte el rol de un usuario existente con el rol del realm", async () => {
    usersBy({ keycloakId: { "kc-1": { ...ana, keycloakId: "kc-1" } } });

    const result = await provisionUserFromClaims({
      sub: "kc-1",
      email: "ana@e.com",
      realm_access: { roles: ["TEACHER"] },
    });

    expect(result.role).toBe("ADMIN");
    const updateArg = prismaMock.user.update.mock.calls[0]?.[0];
    expect(updateArg?.data).not.toHaveProperty("roleId");
  });

  it("vincula por sub aunque el email del claim haya cambiado", async () => {
    usersBy({ keycloakId: { "kc-1": { ...ana, keycloakId: "kc-1" } } });

    const result = await provisionUserFromClaims({ sub: "kc-1", email: "otra@e.com" });

    expect(result.id).toBe("u-1");
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it("el primer login de un usuario sin vínculo lo encuentra por email y guarda el sub", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ ...ana, email: "Ana@E.com" });

    const result = await provisionUserFromClaims({ sub: "kc-1", email: "ana@e.com" });

    expect(result.id).toBe("u-1");
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: { equals: "ana@e.com", mode: "insensitive" } } }),
    );
    const data = prismaMock.user.update.mock.calls[0]?.[0]?.data;
    expect(data.keycloakId).toBe("kc-1");
    // Sólo cambió la caja: se normaliza el email sin tocar la verificación.
    expect(data.email).toBe("ana@e.com");
    expect(data).not.toHaveProperty("emailVerifiedAt");
  });

  it("no entra a un usuario que ya está vinculado a otra cuenta de Keycloak", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ ...ana, keycloakId: "kc-original" });

    const error = await provisionError({ sub: "kc-atacante", email: "ana@e.com" });

    expect(error).toBeInstanceOf(KeycloakAccountConflictError);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("no vincula por username: con sólo el username de otro, no entra ni abre un alta", async () => {
    usersBy({ username: { ana: { id: "u-1" } } });

    const error = await provisionError({ sub: "kc-atacante", email: "atacante@gmail.com", preferred_username: "ana" });

    expect(error).toBeInstanceOf(KeycloakAccountConflictError);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("un email nuevo sin verificar en Keycloak queda sin verificar", async () => {
    usersBy({ keycloakId: { "kc-1": { ...ana, keycloakId: "kc-1" } } });

    await provisionUserFromClaims({ sub: "kc-1", email: "nueva@e.com", email_verified: false });

    const data = prismaMock.user.update.mock.calls[0]?.[0]?.data;
    expect(data.email).toBe("nueva@e.com");
    expect(data.emailVerifiedAt).toBeNull();
  });

  it("un email verificado por Keycloak marca la verificación", async () => {
    usersBy({ keycloakId: { "kc-1": { ...ana, keycloakId: "kc-1" } } });

    await provisionUserFromClaims({ sub: "kc-1", email: "ana@e.com", email_verified: true });

    const data = prismaMock.user.update.mock.calls[0]?.[0]?.data;
    expect(data).not.toHaveProperty("email");
    expect(data.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("rechaza claims sin sub", async () => {
    await expect(provisionUserFromClaims({ email: "ana@e.com" })).rejects.toThrow("sub");
  });

  it("pide completar registro para un usuario SSO sin cuenta local", async () => {
    const error = await provisionError({
      sub: "kc-2",
      email: "nuevo@e.com",
      given_name: "Nuevo",
      family_name: "User",
    });

    expect(error).toBeInstanceOf(SsoRegistrationRequiredError);
    expect((error as SsoRegistrationRequiredError).profile).toEqual(expect.objectContaining({
      kcId: "kc-2",
      email: "nuevo@e.com",
      firstName: "Nuevo",
      lastName: "User",
    }));
  });
});

describe("linkKeycloakAccount", () => {
  beforeEach(() => vi.clearAllMocks());

  it("guarda el vínculo sin pisar uno existente", async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    await linkKeycloakAccount("u-1", "kc-1");
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: "u-1", keycloakId: null },
      data: { keycloakId: "kc-1" },
    });
  });

  it("sin id de Keycloak no hace nada, y un fallo no rompe el alta", async () => {
    await linkKeycloakAccount("u-1", "");
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();

    prismaMock.user.updateMany.mockRejectedValueOnce(new Error("P2002"));
    await expect(linkKeycloakAccount("u-1", "kc-1")).resolves.toBeUndefined();
  });
});

describe("backfillKeycloakLinks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("vincula por email a los usuarios sin vínculo e informa los que no tienen cuenta", async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: "u-1", email: "Ana@E.com" },
      { id: "u-2", email: "beto@e.com" },
      { id: "u-3", email: "sin-cuenta@e.com" },
    ]);
    findIdsByEmailMock.mockResolvedValue(new Map([
      ["ana@e.com", "kc-1"],
      ["beto@e.com", "kc-2"],
    ]));
    prismaMock.user.updateMany
      .mockResolvedValueOnce({ count: 1 })
      // kc-2 ya es de otro usuario: no se adivina cuál es el bueno.
      .mockRejectedValueOnce(new Error("P2002"));

    const result = await backfillKeycloakLinks();

    expect(prismaMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { keycloakId: null } }));
    expect(findIdsByEmailMock).toHaveBeenCalledWith(["ana@e.com", "beto@e.com", "sin-cuenta@e.com"]);
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: "u-1", keycloakId: null },
      data: { keycloakId: "kc-1" },
    });
    expect(result).toEqual({ linked: 1, missing: ["u-3"] });
  });

  it("sin usuarios pendientes no consulta Keycloak", async () => {
    prismaMock.user.findMany.mockResolvedValue([]);
    expect(await backfillKeycloakLinks()).toEqual({ linked: 0, missing: [] });
    expect(findIdsByEmailMock).not.toHaveBeenCalled();
  });
});
