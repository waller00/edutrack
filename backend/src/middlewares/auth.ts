import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../jwt.js";

export function authGuard(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization?.replace("Bearer ", "");
  const token = header || (req as any).cookies?.access_token;
  if (!token) return res.status(401).json({ message: "No autorizado" });
  try {
    const user = verifyToken(token);
    (req as any).user = { ...user, id: user.id ?? user.sub };
    next();
  } catch {
    return res.status(401).json({ message: "Token inválido" });
  }
}

export function requireRole(role: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const u = (req as any).user;
    if (!u || u.role !== role) return res.status(403).json({ message: "Prohibido" });
    next();
  };
}

export function requireAnyRole(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const u = (req as any).user;
    if (!u || !roles.includes(u.role)) return res.status(403).json({ message: "Prohibido" });
    next();
  };
}
