import jwt, { SignOptions } from "jsonwebtoken";
import type { JwtPayload } from "../types.js";

/** Tokens Bearer solo para tests de integración (vitest). No usar en producción. */
const JWT_SECRET = process.env.JWT_SECRET || "vitest-jwt-secret-key-min-32-characters-x";
const ACCESS_TOKEN_TTL = (process.env.ACCESS_TOKEN_TTL || "2h") as NonNullable<SignOptions["expiresIn"]>;

export function signAccessToken(payload: JwtPayload) {
  const options: SignOptions = { expiresIn: ACCESS_TOKEN_TTL, algorithm: "HS256" };
  return jwt.sign(payload as object, JWT_SECRET, options);
}

export function verifyTestBearerToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as JwtPayload;
}
