import { describe, it, expect, beforeEach, vi } from "vitest";

const { prismaMock, resolveRoleIdByCodeMock, ensureBuiltinOrgRolesMock, syncIdentityMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
  resolveRoleIdByCodeMock: vi.fn(),
  ensureBuiltinOrgRolesMock: vi.fn(),
  syncIdentityMock: vi.fn(),
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../identity/org-role-service.js", () => ({ resolveRoleIdByCode: resolveRoleIdByCodeMock }));
vi.mock("../identity/org-role-seed.js", () => ({ ensureBuiltinOrgRoles: ensureBuiltinOrgRolesMock }));
vi.mock("./keycloak.js", () => ({
  pickRealmRole: (claims: Record<string, any>) => {
    const roles: string[] = claims?.realm_access?.roles ?? [];
    for (const code of ["ADMIN", "STAFF", "TEACHER"]) if (roles.includes(code)) return code;
    return roles[0] ?? null;
  },
  syncKeycloakUserIdentity: syncIdentityMock,
}));

import { provisionUserFromClaims } from "./keycloak-provisioning.js";

describe("provisionUserFromClaims", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveRoleIdByCodeMock.mockResolvedValue("role-id");
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

  it("crea un usuario nuevo por SSO como PENDIENTE de aprobación", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({ id: "u-new" });

    const result = await provisionUserFromClaims({
      sub: "kc-2",
      email: "nuevo@e.com",
      given_name: "Nuevo",
      family_name: "User",
      realm_access: { roles: ["TEACHER"] },
    });

    expect(result.id).toBe("u-new");
    const createArg = prismaMock.user.create.mock.calls[0]?.[0];
    expect(createArg?.data?.isApproved).toBe(false);
    expect(createArg?.data?.isActive).toBe(true);
  });
});
