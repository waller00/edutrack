import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMailSpy = vi.fn();
const createTransportSpy = vi.fn(() => ({ sendMail: sendMailSpy }));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: createTransportSpy,
  },
}));

describe("email", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASS = "pass";
    process.env.FRONTEND_URL = "http://frontend.local";
    delete process.env.SMTP_FROM;
  });

  it("creates a secure transporter and uses default sender from frontend host", async () => {
    const { sendMail } = await import("./email.js");

    await sendMail({ to: "user@example.com", subject: "Hola", html: "<p>Hola</p>" });

    expect(createTransportSpy).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      auth: { user: "user", pass: "pass" },
    });
    expect(sendMailSpy).toHaveBeenCalledWith({
      from: "no-reply@frontend.local",
      to: "user@example.com",
      subject: "Hola",
      html: "<p>Hola</p>",
    });
  });

  it("honors SMTP_FROM when provided", async () => {
    process.env.SMTP_FROM = "custom@example.com";
    const { sendMail } = await import("./email.js");

    await sendMail({ to: "user@example.com", subject: "Hola", html: "<p>Hola</p>", text: "Hola" });

    expect(sendMailSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "custom@example.com",
        text: "Hola",
      })
    );
  });
});
