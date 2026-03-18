import jwt, { SignOptions } from "jsonwebtoken";
import type { JwtPayload } from "./types.js";

const JWT_SECRET = process.env.JWT_SECRET!;
const ACCESS_TOKEN_TTL = (process.env.ACCESS_TOKEN_TTL || "2h") as unknown as number; // jsonwebtoken types

export function signAccessToken(payload: JwtPayload) {
  const options: SignOptions = { expiresIn: ACCESS_TOKEN_TTL };
  return jwt.sign(payload as any, JWT_SECRET as any, options);
}
export function verifyToken(token: string) {
  return jwt.verify(token, JWT_SECRET as any) as JwtPayload;
}
