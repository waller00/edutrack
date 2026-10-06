import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMailSpy = vi.fn();
const createTransportSpy = vi.fn(() => ({ sendMail: sendMailSpy }));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: createTransportSpy,
  },
}));

describe("email", () => {
  const previousFrontendUrl = process.env.FRONTEND_URL;
  afterEach(() => {
    if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previousFrontendUrl;
  });

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASS = "pass";
    process.env.FRONTEND_URL = "http://frontend.local";
    delete process.env.SMTP_FROM;
    delete process.env.BREVO_API_KEY;
  });

  it("creates a secure transporter and uses default sender from frontend host", async () => {
    const { sendMail } = await import("./email.js");

    await sendMail({ to: "user@example.com", subject: "Hola", html: "<p>Hola</p>" });

    expect(createTransportSpy).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      auth: { user: "user", pass: "pass" },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000,
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

describe("email Brevo HTTPS API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        text: async () => "",
      })
    );
    process.env.BREVO_API_KEY = "xkeysib-test-key";
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "587";
    process.env.FRONTEND_URL = "http://frontend.local";
    process.env.SMTP_FROM = "EduTrack <noreply@test.com>";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BREVO_API_KEY;
  });

  it("con BREVO_API_KEY envía por la API transaccional (HTTPS) en lugar de SMTP", async () => {
    const { sendMail } = await import("./email.js");

    await sendMail({ to: "user@example.com", subject: "Asunto", html: "<p>cuerpo</p>", text: "cuerpo" });

    expect(sendMailSpy).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)?.["api-key"]).toBe("xkeysib-test-key");
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      sender: { email: "noreply@test.com", name: "EduTrack" },
      to: [{ email: "user@example.com" }],
      subject: "Asunto",
      htmlContent: "<p>cuerpo</p>",
      textContent: "cuerpo",
    });
  });

  it("sin texto plano no manda textContent", async () => {
    const { sendMail } = await import("./email.js");

    await sendMail({ to: "user@example.com", subject: "Asunto", html: "<p>cuerpo</p>" });

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1]?.body as string) ?? "{}");
    expect(body).not.toHaveProperty("textContent");
  });

  it("parsea remitentes con comillas simples y sin nombre", async () => {
    process.env.SMTP_FROM = "'Mesa de ayuda' <help@test.com>";
    let { sendMail } = await import("./email.js");
    await sendMail({ to: "user@example.com", subject: "Con nombre", html: "<p>cuerpo</p>" });

    vi.resetModules();
    process.env.SMTP_FROM = "plain@test.com";
    ({ sendMail } = await import("./email.js"));
    await sendMail({ to: "user@example.com", subject: "Sin nombre", html: "<p>cuerpo</p>" });

    const firstBody = JSON.parse((vi.mocked(fetch).mock.calls[0][1]?.body as string) ?? "{}");
    const secondBody = JSON.parse((vi.mocked(fetch).mock.calls[1][1]?.body as string) ?? "{}");
    expect(firstBody.sender).toEqual({ email: "help@test.com", name: "Mesa de ayuda" });
    expect(secondBody.sender).toEqual({ email: "plain@test.com" });
  });

  it("con BREVO_API_KEY vacía usa SMTP", async () => {
    process.env.BREVO_API_KEY = "  ";
    const { sendMail } = await import("./email.js");

    await sendMail({ to: "u@x.com", subject: "S", html: "<p>x</p>" });

    expect(fetch).not.toHaveBeenCalled();
    expect(createTransportSpy).toHaveBeenCalled();
    expect(sendMailSpy).toHaveBeenCalled();
  });

  it("lanza si la API responde error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => '{"code":"unauthorized","message":"Key not found"}',
    } as Response);
    const { sendMail } = await import("./email.js");

    await expect(sendMail({ to: "u@x.com", subject: "S", html: "<p>x</p>" })).rejects.toThrow(
      /Brevo API 401: .*Key not found/,
    );
  });
});
