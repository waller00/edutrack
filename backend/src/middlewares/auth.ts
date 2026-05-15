import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../jwt.js";
import { prisma } from "../prisma.js";

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

export function requirePermission(permissionCode: string, requiredScope?: "own" | "all") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const u = (req as any).user;
    const userId = u?.id ?? u?.sub;
    if (!userId) return res.status(403).json({ message: "Prohibido" });
    if (u?.role === "ADMIN") return next();
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          isActive: true,
          isApproved: true,
          orgRole: {
            select: {
              active: true,
              grants: {
                where: {
                  enabled: true,
                  ...(requiredScope === "all" ? { scope: "ALL" as const } : {}),
                  permission: { code: permissionCode },
                },
                select: { permissionId: true },
                take: 1,
              },
            },
          },
        },
      });
      if (!user?.isActive || !user.isApproved || !user.orgRole?.active || user.orgRole.grants.length === 0) {
        return res.status(403).json({ message: "Prohibido" });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAnyRoleOrPermission(roles: string[], permissionCode: string) {
  const byPermission = requirePermission(permissionCode);
  return (req: Request, res: Response, next: NextFunction) => {
    const u = (req as any).user;
    if (u && roles.includes(u.role)) return next();
    void byPermission(req, res, next);
  };
}
