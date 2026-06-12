import { describe, it, expect, beforeEach, vi } from "vitest";

const { sendMailMock, moodlePublicUrlMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn(),
  moodlePublicUrlMock: vi.fn(),
}));

vi.mock("./email.js", () => ({ sendMail: sendMailMock }));
vi.mock("../integrations/moodle/client.js", () => ({ moodlePublicUrl: moodlePublicUrlMock }));

import { buildStudentWelcomeEmail, sendStudentWelcomeEmail } from "./student-welcome.js";

beforeEach(() => {
  sendMailMock.mockReset().mockResolvedValue(undefined);
  moodlePublicUrlMock.mockReset().mockReturnValue("https://moodle.edutrack-uy.com");
});

describe("buildStudentWelcomeEmail", () => {
  it("incluye username, link a Moodle y link de contraseña en html y texto", () => {
    const { subject, html, text } = buildStudentWelcomeEmail({
      firstName: "Ana",
      username: "ana.diaz",
      moodleUrl: "https://moodle.edutrack-uy.com/",
    });
    expect(subject).toContain("aula virtual");
    for (const body of [html, text]) {
      expect(body).toContain("ana.diaz");
      expect(body).toContain("https://moodle.edutrack-uy.com");
      expect(body).toContain("https://moodle.edutrack-uy.com/login/forgot_password.php");
    }
  });

  it("escapa HTML en los datos del alumno", () => {
    const { html } = buildStudentWelcomeEmail({
      firstName: "<b>Ana</b>",
      username: "a&b",
      moodleUrl: "https://moodle.test",
    });
    expect(html).not.toContain("<b>Ana</b>");
    expect(html).toContain("&lt;b&gt;Ana&lt;/b&gt;");
    expect(html).toContain("a&amp;b");
  });
});

describe("sendStudentWelcomeEmail", () => {
  it("envía el mail al alumno con el contenido generado", async () => {
    await sendStudentWelcomeEmail({ to: "ana@test.com", firstName: "Ana", username: "ana.diaz" });
    const arg = sendMailMock.mock.calls[0][0];
    expect(arg.to).toBe("ana@test.com");
    expect(arg.html).toContain("ana.diaz");
    expect(arg.text).toContain("forgot_password.php");
  });

  it("lanza si no hay URL pública de Moodle configurada", async () => {
    moodlePublicUrlMock.mockReturnValue(null);
    await expect(
      sendStudentWelcomeEmail({ to: "ana@test.com", firstName: "Ana", username: "ana.diaz" }),
    ).rejects.toThrow("MOODLE_PUBLIC_URL_NOT_CONFIGURED");
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});
