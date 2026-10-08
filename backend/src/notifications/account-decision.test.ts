import { describe, it, expect, beforeEach, vi } from "vitest";

const { sendMailMock } = vi.hoisted(() => ({ sendMailMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./email.js", () => ({ sendMail: sendMailMock }));

import {
  buildApprovalEmail,
  buildRejectionEmail,
  sendApprovalEmail,
  sendRejectionEmail,
} from "./account-decision.js";

describe("correos de la decisión sobre la cuenta", () => {
  beforeEach(() => {
    sendMailMock.mockClear();
  });

  it("la aprobación saluda por nombre y lleva al ingreso", () => {
    const mail = buildApprovalEmail({ firstName: "Ana", loginUrl: "https://edutrack-uy.com/login" });
    expect(mail.subject).toMatch(/aprobada/i);
    expect(mail.text).toContain("Hola Ana,");
    expect(mail.html).toContain('href="https://edutrack-uy.com/login"');
  });

  it("sin nombre, saluda genérico", () => {
    expect(buildApprovalEmail({ firstName: "  ", loginUrl: "x" }).text.startsWith("Hola,")).toBe(true);
  });

  it("el rechazo incluye el motivo escapado y avisa que se borraron los datos", () => {
    const mail = buildRejectionEmail({ firstName: "Ana", reason: "<b>no</b> corresponde" });
    expect(mail.html).toContain("Motivo: &lt;b&gt;no&lt;/b&gt; corresponde");
    expect(mail.text).toContain("Motivo: <b>no</b> corresponde");
    expect(mail.text).toMatch(/Borramos los datos/);
  });

  it("el rechazo sin motivo no muestra la línea", () => {
    const mail = buildRejectionEmail({ reason: "   " });
    expect(mail.html).not.toContain("Motivo");
    expect(mail.text).not.toContain("Motivo");
  });

  it("envía cada correo a la persona", async () => {
    process.env.FRONTEND_URL = "https://edutrack-uy.com";
    await sendApprovalEmail({ email: "a@b.com", firstName: "Ana" });
    await sendRejectionEmail({ email: "a@b.com", reason: "duplicada" });
    expect(sendMailMock).toHaveBeenCalledTimes(2);
    expect(sendMailMock.mock.calls[0][0]).toMatchObject({ to: "a@b.com" });
    expect(sendMailMock.mock.calls[0][0].text).toContain("https://edutrack-uy.com/login");
    expect(sendMailMock.mock.calls[1][0].text).toContain("Motivo: duplicada");
  });
});
