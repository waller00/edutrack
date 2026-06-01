import { describe, it, expect, beforeEach, vi } from "vitest";

const { prismaMock, syncIdentityMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  syncIdentityMock: vi.fn(),
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./keycloak.js", () => ({
  syncKeycloakUserIdentity: syncIdentityMock,
}));

import { provisionUserFromClaims, SsoRegistrationRequiredError } from "./keycloak-provisioning.js";

describe("provisionUserFromClaims", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncIdentityMock.mockResolvedValue(undefined);
  });

  it("NO revierte el rol de un usuario existente con el rol del realm", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u-1",
      email: "ana@e.com",
      username: "ana",
      firstName: "Ana",
      lastName: "P",
      orgRole: { code: "ADMIN" },
    });
    prismaMock.user.update.mockResolvedValue({});

    const result = await provisionUserFromClaims({
      sub: "kc-1",
      email: "ana@e.com",
      realm_access: { roles: ["TEACHER"] },
    });

    expect(result.role).toBe("ADMIN");
    const updateArg = prismaMock.user.update.mock.calls[0]?.[0];
    expect(updateArg?.data).not.toHaveProperty("roleId");
  });

  it("pide completar registro para un usuario SSO sin cuenta local", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    let error: unknown;
    try {
      await provisionUserFromClaims({
        sub: "kc-2",
        email: "nuevo@e.com",
        given_name: "Nuevo",
        family_name: "User",
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(SsoRegistrationRequiredError);
    expect((error as SsoRegistrationRequiredError).profile).toEqual(expect.objectContaining({
      kcId: "kc-2",
      email: "nuevo@e.com",
      firstName: "Nuevo",
      lastName: "User",
    }));
  });
});
