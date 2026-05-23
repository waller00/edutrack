import { describe, it, expect } from "vitest";
import { signAccessToken, verifyToken } from "./jwt.js";

describe("JWT", () => {
  it("firma y verifica payload con sub, email y role", () => {
    const payload = {
      sub: "usr-1",
      email: "a@b.com",
      role: "TEACHER",
    };
    const token = signAccessToken(payload);
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);

    const decoded = verifyToken(token);
    expect(decoded.sub).toBe("usr-1");
    expect(decoded.email).toBe("a@b.com");
    expect(decoded.role).toBe("TEACHER");
  });

  it("token inválido lanza", () => {
    expect(() => verifyToken("no.es.un.jwt")).toThrow();
    expect(() => verifyToken("")).toThrow();
  });
});
