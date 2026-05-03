import { beforeEach, describe, expect, it, vi } from "vitest";

const useSpy = vi.fn();
const strategyMock = vi.fn(function Strategy(this: any, _options: unknown, verify: unknown) {
  this.name = "google";
  this.verify = verify;
});

const prismaMock = {
  user: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock("passport", () => ({
  default: {
    use: useSpy,
  },
}));

vi.mock("passport-google-oauth20", () => ({
  Strategy: strategyMock,
}));

vi.mock("./prisma.js", () => ({
  prisma: prismaMock,
}));

vi.mock("./org-role-service.js", () => ({
  getOrgRoleIdByCodeOrThrow: vi.fn().mockResolvedValue("staff-role-id"),
  normalizeOrgRoleCode: (raw: string) => raw.trim().toUpperCase(),
}));

describe("passportGoogle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    process.env.GOOGLE_CALLBACK_URL = "http://localhost/auth/google/callback";
  });

  it("extracts profile data with fallbacks", async () => {
    const { getGoogleProfileData } = await import("./passportGoogle.js");

    expect(
      getGoogleProfileData({
        emails: [{ value: "user@example.com" }],
        name: { givenName: " Ada ", familyName: " Lovelace " },
        displayName: "  Ada Lovelace  ",
      })
    ).toEqual({
      email: "user@example.com",
      givenName: "Ada",
      familyName: "Lovelace",
      fullName: "Ada Lovelace",
    });
  });

  it("builds update data only for missing fields", async () => {
    const { buildGoogleUpdateData } = await import("./passportGoogle.js");

    expect(
      buildGoogleUpdateData(
        { googleId: null, firstName: null, lastName: "Existing", name: null },
        "google-id",
        "Ada",
        "Lovelace",
        "Ada Lovelace"
      )
    ).toEqual({
      googleId: "google-id",
      firstName: "Ada",
      name: "Ada Lovelace",
    });
  });

  it("registers the strategy and creates new users when necessary", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({ id: "u1", email: "user@example.com" });
    await import("./passportGoogle.js");

    expect(useSpy).toHaveBeenCalledOnce();
    const verify = strategyMock.mock.calls[0][1];
    const done = vi.fn();

    await verify(
      "access-token",
      "refresh-token",
      {
        id: "google-id",
        emails: [{ value: "user@example.com" }],
        name: { givenName: "Ada", familyName: "Lovelace" },
        displayName: "Ada Lovelace",
      },
      done
    );

    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ roleId: "staff-role-id", email: "user@example.com" }),
      }),
    );
    expect(done).toHaveBeenCalledWith(null, { id: "u1", email: "user@example.com" });
  });

  it("updates existing users only when profile fields are missing", async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: "u1",
      email: "user@example.com",
      googleId: null,
      firstName: null,
      lastName: null,
      name: null,
    });
    prismaMock.user.update.mockResolvedValue({ id: "u1", email: "user@example.com", googleId: "google-id" });
    await import("./passportGoogle.js");
    const verify = strategyMock.mock.calls[0][1];
    const done = vi.fn();

    await verify(
      "access-token",
      "refresh-token",
      {
        id: "google-id",
        emails: [{ value: "user@example.com" }],
        name: { givenName: "Ada", familyName: "Lovelace" },
        displayName: "Ada Lovelace",
      },
      done
    );

    expect(prismaMock.user.update).toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith(null, expect.objectContaining({ id: "u1" }));
  });

  it("rejects profiles without email and forwards unexpected errors", async () => {
    prismaMock.user.findFirst.mockRejectedValueOnce(new Error("db"));
    await import("./passportGoogle.js");
    const verify = strategyMock.mock.calls[0][1];
    const missingEmailDone = vi.fn();

    await verify("access-token", "refresh-token", { id: "google-id", emails: [] }, missingEmailDone);
    expect(missingEmailDone).toHaveBeenCalledWith(null, false);

    const done = vi.fn();
    await verify(
      "access-token",
      "refresh-token",
      { id: "google-id", emails: [{ value: "user@example.com" }] },
      done
    );
    expect(done).toHaveBeenCalledWith(expect.any(Error), false);
  });
});
