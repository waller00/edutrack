import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, sendMailMock, resetKeycloakPasswordMock, deleteSessionsForUserMock, keycloakUserHasPasswordMock } = vi.hoisted(() => ({
  keycloakUserHasPasswordMock: vi.fn(),
  prismaMock: {
    user: { findFirst: vi.fn() },
    passwordReset: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  sendMailMock: vi.fn(),
  resetKeycloakPasswordMock: vi.fn(),
  deleteSessionsForUserMock: vi.fn(),
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../notifications/email.js", () => ({ sendMail: sendMailMock }));
vi.mock("./keycloak.js", () => ({
  resetKeycloakPassword: resetKeycloakPasswordMock,
  keycloakUserHasPassword: keycloakUserHasPasswordMock,
}));
vi.mock("./session-store.js", () => ({ deleteSessionsForUser: deleteSessionsForUserMock }));

import {
  buildPasswordResetEmail,
  completePasswordReset,
  PasswordResetTokenError,
  requestPasswordReset,
} from "./password-reset";

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

const activeUser = { id: "u1", email: "ana@example.com", isActive: true, keycloakId: "kc-1" };

function validReset(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    userId: "u1",
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    usedAt: null,
    user: { keycloakId: "kc-1", isActive: true },
    ...overrides,
  };
}

describe("password-reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FRONTEND_URL = "https://edutrack-uy.com";
    prismaMock.user.findFirst.mockResolvedValue(activeUser);
    prismaMock.passwordReset.findFirst.mockResolvedValue(null);
    prismaMock.passwordReset.create.mockResolvedValue({});
    prismaMock.passwordReset.updateMany.mockResolvedValue({ count: 1 });
    sendMailMock.mockResolvedValue(undefined);
    resetKeycloakPasswordMock.mockResolvedValue(undefined);
    deleteSessionsForUserMock.mockResolvedValue(1);
    keycloakUserHasPasswordMock.mockResolvedValue(true);
  });

  it("a una cuenta sin contraseña (entra con Google) le dice que la crea, no que la restablece", async () => {
    keycloakUserHasPasswordMock.mockResolvedValueOnce(false);

    await expect(requestPasswordReset("ana@example.com")).resolves.toBe(true);

    expect(keycloakUserHasPasswordMock).toHaveBeenCalledWith("kc-1");
    const mail = sendMailMock.mock.calls[0][0];
    expect(mail.subject).toBe("Creá tu contraseña de EduTrack");
    expect(mail.text).toContain("ingresar también con tu usuario o tu correo");
    expect(mail.text).toMatch(/reset\?token=[0-9a-f]{64}/);
  });

  it("si no se puede saber si tiene contraseña, manda el correo de siempre", async () => {
    keycloakUserHasPasswordMock.mockRejectedValueOnce(new Error("keycloak down"));

    await expect(requestPasswordReset("ana@example.com")).resolves.toBe(true);

    expect(sendMailMock.mock.calls[0][0].subject).toBe("Restablecé tu contraseña de EduTrack");
  });

  it("el correo lleva el enlace, el vencimiento y qué hacer si no lo pediste", () => {
    const mail = buildPasswordResetEmail("https://edutrack-uy.com/reset?token=abc");

    expect(mail.subject).toBe("Restablecé tu contraseña de EduTrack");
    expect(mail.html).toContain('href="https://edutrack-uy.com/reset?token=abc"');
    expect(mail.text).toContain("vence en 60 minutos");
    expect(mail.text).toContain("Si no lo pediste");
  });

  it("manda el enlace y guarda sólo el hash del token", async () => {
    await expect(requestPasswordReset("Ana@Example.com")).resolves.toBe(true);

    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: { equals: "Ana@Example.com", mode: "insensitive" } } }),
    );
    const mail = sendMailMock.mock.calls[0][0];
    expect(mail.to).toBe("ana@example.com");
    const token = /reset\?token=([0-9a-f]+)/.exec(mail.text)?.[1] ?? "";
    expect(token).toHaveLength(64);
    const created = prismaMock.passwordReset.create.mock.calls[0][0].data;
    expect(created.tokenHash).toBe(sha256(token));
    expect(created.userId).toBe("u1");
  });

  it("no manda nada si la cuenta no existe, está inactiva o no tiene acceso en Keycloak", async () => {
    prismaMock.user.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...activeUser, isActive: false })
      .mockResolvedValueOnce({ ...activeUser, keycloakId: null });

    for (let i = 0; i < 3; i += 1) {
      await expect(requestPasswordReset("ana@example.com")).resolves.toBe(false);
    }
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("respeta la espera mínima entre dos correos", async () => {
    prismaMock.passwordReset.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 10_000) });

    await expect(requestPasswordReset("ana@example.com")).resolves.toBe(false);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("con un enlace vigente cambia la contraseña, lo da por usado y cierra las sesiones", async () => {
    prismaMock.passwordReset.findUnique.mockResolvedValue(validReset());

    await expect(completePasswordReset("tok", "Segura123!")).resolves.toBe("u1");

    expect(prismaMock.passwordReset.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: sha256("tok") } }));
    expect(resetKeycloakPasswordMock).toHaveBeenCalledWith("kc-1", "Segura123!");
    expect(prismaMock.passwordReset.updateMany).toHaveBeenCalledWith({
      where: { id: "r1", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect(deleteSessionsForUserMock).toHaveBeenCalledWith("u1");
  });

  it("rechaza un enlace inexistente, usado, vencido o de una cuenta inactiva", async () => {
    prismaMock.passwordReset.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(validReset({ usedAt: new Date() }))
      .mockResolvedValueOnce(validReset({ expiresAt: new Date(Date.now() - 1000) }))
      .mockResolvedValueOnce(validReset({ user: { keycloakId: "kc-1", isActive: false } }));

    for (let i = 0; i < 4; i += 1) {
      await expect(completePasswordReset("tok", "Segura123!")).rejects.toBeInstanceOf(PasswordResetTokenError);
    }
    expect(resetKeycloakPasswordMock).not.toHaveBeenCalled();
  });

  it("si Keycloak rechaza la contraseña el enlace sigue sirviendo", async () => {
    prismaMock.passwordReset.findUnique.mockResolvedValue(validReset());
    resetKeycloakPasswordMock.mockRejectedValueOnce(Object.assign(new Error("policy"), { status: 400 }));

    await expect(completePasswordReset("tok", "Segura123!")).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.passwordReset.updateMany).not.toHaveBeenCalled();
  });
});
