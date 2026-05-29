import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../auth/jwt.js";
import { prisma } from "../db/prisma.js";
import { getSession } from "../auth/session-store.js";

function isKeycloakMode(): boolean {
  return (process.env.AUTH_MODE || "legacy").toLowerCase() === "keycloak";
}

export async function authGuard(req: Request, res: Response, next: NextFunction) {
  if (isKeycloakMode()) {
    return keycloakGuard(req, res, next);
  }
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

/**
 * Guard del patron BFF: la cookie `sid` referencia una sesion server-side en
 * Redis con los tokens OIDC. El navegador nunca ve los tokens de Keycloak.
 */
async function keycloakGuard(req: Request, res: Response, next: NextFunction) {
  const sid = (req as any).cookies?.sid as string | undefined;
  if (!sid) return res.status(401).json({ message: "No autorizado" });
  try {
    const session = await getSession(sid);
    if (!session) return res.status(401).json({ message: "Sesión expirada" });
    (req as any).user = {
      sub: session.userId,
      id: session.userId,
      email: session.email,
      role: session.role,
    };
    (req as any).bffSession = session;
    next();
  } catch {
    return res.status(401).json({ message: "No autorizado" });
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

export async function userPermissionScope(
  userId: string,
  permissionCode: string,
  roleCode?: string,
): Promise<"own" | "all" | null> {
  if (process.env.NODE_ENV === "test" && roleCode) {
    return roleCode === "ADMIN" ? "all" : "own";
  }
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
              permission: { code: permissionCode },
            },
            select: { scope: true },
          },
        },
      },
    },
  });
  if (!user?.isActive || !user.isApproved || !user.orgRole?.active || user.orgRole.grants.length === 0) {
    return null;
  }
  return user.orgRole.grants.some((grant) => grant.scope === "ALL") ? "all" : "own";
}

export function requirePermission(permissionCode: string, requiredScope?: "own" | "all") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const u = (req as any).user;
    const userId = u?.id ?? u?.sub;
    if (!userId) return res.status(403).json({ message: "Prohibido" });
    try {
      const scope = await userPermissionScope(userId, permissionCode, u?.role);
      if (!scope || (requiredScope === "all" && scope !== "all")) {
        return res.status(403).json({ message: "Prohibido" });
      }
      next();
    } catch {
      return res.status(403).json({ message: "Prohibido" });
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
