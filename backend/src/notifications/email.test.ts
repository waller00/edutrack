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

describe("email SendGrid HTTPS API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        text: async () => "",
      })
    );
    process.env.SMTP_HOST = "smtp.sendgrid.net";
    process.env.SMTP_USER = "apikey";
    process.env.SMTP_PASS = "SG.test-key";
    process.env.SMTP_PORT = "587";
    process.env.FRONTEND_URL = "http://frontend.local";
    process.env.SMTP_FROM = "EduTrack <noreply@test.com>";
    delete process.env.SENDGRID_HTTP_API;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("envía por la API v3 (HTTPS) en lugar de SMTP cuando host es SendGrid y user es apikey", async () => {
    const { sendMail } = await import("./email.js");

    await sendMail({ to: "user@example.com", subject: "Asunto", html: "<p>cuerpo</p>", text: "cuerpo" });

    expect(sendMailSpy).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)?.Authorization).toBe("Bearer SG.test-key");
    const body = JSON.parse(init?.body as string);
    expect(body.personalizations[0].to).toEqual([{ email: "user@example.com" }]);
    expect(body.from).toEqual({ email: "noreply@test.com", name: "EduTrack" });
    expect(body.subject).toBe("Asunto");
    expect(body.content).toEqual([
      { type: "text/plain", value: "cuerpo" },
      { type: "text/html", value: "<p>cuerpo</p>" },
    ]);
  });

  it("parsea remitentes SendGrid con comillas simples y sin nombre", async () => {
    process.env.SMTP_FROM = "'Mesa de ayuda' <help@test.com>";
    let { sendMail } = await import("./email.js");
    await sendMail({ to: "user@example.com", subject: "Con nombre", html: "<p>cuerpo</p>" });

    vi.resetModules();
    process.env.SMTP_FROM = "plain@test.com";
    ({ sendMail } = await import("./email.js"));
    await sendMail({ to: "user@example.com", subject: "Sin nombre", html: "<p>cuerpo</p>" });

    const firstBody = JSON.parse((vi.mocked(fetch).mock.calls[0][1]?.body as string) ?? "{}");
    const secondBody = JSON.parse((vi.mocked(fetch).mock.calls[1][1]?.body as string) ?? "{}");
    expect(firstBody.from).toEqual({ email: "help@test.com", name: "Mesa de ayuda" });
    expect(secondBody.from).toEqual({ email: "plain@test.com" });
  });

  it("con SENDGRID_HTTP_API=false usa nodemailer aunque sea SendGrid", async () => {
    process.env.SENDGRID_HTTP_API = "false";
    const { sendMail } = await import("./email.js");

    await sendMail({ to: "u@x.com", subject: "S", html: "<p>x</p>" });

    expect(fetch).not.toHaveBeenCalled();
    expect(createTransportSpy).toHaveBeenCalled();
    expect(sendMailSpy).toHaveBeenCalled();
  });

  it("lanza si la API responde error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => "denied",
    } as Response);
    const { sendMail } = await import("./email.js");

    await expect(sendMail({ to: "u@x.com", subject: "S", html: "<p>x</p>" })).rejects.toThrow(/SendGrid API 403/);
  });
});
