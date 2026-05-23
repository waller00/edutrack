import jwt, { SignOptions } from "jsonwebtoken";
import type { JwtPayload } from "../types.js";

const JWT_SECRET = process.env.JWT_SECRET!;
/** Duración aceptada por `ms` / jwt (ej. 15m, 2h, 7d); viene del .env. */
const ACCESS_TOKEN_TTL = (process.env.ACCESS_TOKEN_TTL || "2h") as NonNullable<
  SignOptions["expiresIn"]
>;

export function signAccessToken(payload: JwtPayload) {
  const options: SignOptions = { expiresIn: ACCESS_TOKEN_TTL, algorithm: "HS256" };
  return jwt.sign(payload as any, JWT_SECRET as any, options);
}
export function verifyToken(token: string) {
  return jwt.verify(token, JWT_SECRET as any, { algorithms: ["HS256"] }) as JwtPayload;
}

export type TwoFactorLoginPayload = {
  sub: string;
  email: string;
  role: string;
  purpose: "2fa-login";
};

export function signTwoFactorLoginToken(payload: Omit<TwoFactorLoginPayload, "purpose">) {
  const options: SignOptions = { expiresIn: "5m", algorithm: "HS256" };
  return jwt.sign({ ...payload, purpose: "2fa-login" } as any, JWT_SECRET as any, options);
}

export function verifyTwoFactorLoginToken(token: string) {
  const payload = jwt.verify(token, JWT_SECRET as any, { algorithms: ["HS256"] }) as TwoFactorLoginPayload;
  if (payload.purpose !== "2fa-login") throw new Error("Invalid token purpose");
  return payload;
}
