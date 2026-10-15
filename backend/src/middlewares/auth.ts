import { Request, Response, NextFunction } from "express";
import { prisma } from "../db/prisma.js";
import { getSession } from "../auth/session-store.js";
import { memoizeInRequest } from "../lib/request-cache.js";
import { DEFAULT_PROFILE_PERMISSIONS, type BuiltinProfileRole } from "../identity/profile-permissions-defaults.js";

/** Sólo `NODE_ENV=test`: permisos extra del token Bearer de cada usuario de prueba. */
const testProfilePermissions = new Map<string, Record<string, "own" | "all">>();

/** Alcance de un permiso en la matriz de fábrica de un rol; `null` si no lo tiene. */
export function defaultScopeFor(roleCode: string, permissionCode: string): "own" | "all" | null {
  const grants = DEFAULT_PROFILE_PERMISSIONS[roleCode as BuiltinProfileRole] ?? [];
  const grant = grants.find((p) => p.id === permissionCode && p.enabled);
  return grant ? grant.scope : null;
}

/**
 * Por qué una cuenta no puede entrar. Una cuenta nueva pasa por dos pasos en orden —verificar el
 * correo y después la aprobación de administración— y la pantalla de ingreso tiene que decir en
 * cuál está (y ofrecer el reenvío del correo), no un "inhabilitada" genérico.
 */
function blockedAccountBody(account: { isActive: boolean; emailVerifiedAt: Date | null }, email: string) {
  if (!account.isActive) return { message: "Cuenta inhabilitada", code: "ACCOUNT_INACTIVE" };
  if (!account.emailVerifiedAt) return { message: "Correo sin verificar", code: "EMAIL_NOT_VERIFIED", email };
  return { message: "Cuenta pendiente de aprobación", code: "PENDING_APPROVAL", email };
}

export async function authGuard(req: Request, res: Response, next: NextFunction) {
  const sid = (req as any).cookies?.sid as string | undefined;
  if (sid) {
    try {
      const session = await getSession(sid);
      if (!session) return res.status(401).json({ message: "Sesión expirada" });

      // Una sesión válida en Redis no alcanza: el usuario pudo ser dado de baja,
      // dejado pendiente o bloqueado por un admin después de iniciar sesión.
      const account = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { isActive: true, isApproved: true, emailVerifiedAt: true, lockUntil: true },
      });
      if (!account) return res.status(401).json({ message: "No autorizado" });
      if (!account.isActive || !account.isApproved) {
        return res.status(403).json(blockedAccountBody(account, session.email));
      }
      if (account.lockUntil && account.lockUntil.getTime() > Date.now()) {
        return res.status(403).json({ message: "Cuenta bloqueada" });
      }

      (req as any).user = {
        sub: session.userId,
        id: session.userId,
        email: session.email,
        role: session.role,
      };
      (req as any).bffSession = session;
      return next();
    } catch {
      return res.status(401).json({ message: "No autorizado" });
    }
  }

  if (process.env.NODE_ENV === "test") {
    const header = req.headers.authorization?.replace("Bearer ", "");
    const token = header || ((req as any).cookies?.access_token as string | undefined);
    if (token) {
      try {
        const { verifyTestBearerToken } = await import("../test-utils/bearer-token.js");
        const user = verifyTestBearerToken(token);
        (req as any).user = { ...user, id: user.id ?? user.sub };
        // Cada pedido deja (o borra) el perfil a medida de su token: el último token manda.
        if (user.permissions) testProfilePermissions.set(user.sub, user.permissions);
        else testProfilePermissions.delete(user.sub);
        return next();
      } catch {
        return res.status(401).json({ message: "Token inválido" });
      }
    }
  }

  return res.status(401).json({ message: "No autorizado" });
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
    // Los tests con token Bearer no tienen base: se resuelve con la matriz de fábrica del rol, la
    // misma que se siembra, más los permisos que el token declare (perfil a medida). Antes era
    // "ADMIN = all, el resto = own" para cualquier permiso, y una ruta podía pedir un permiso que
    // el rol no tiene sin que ningún test lo notara.
    return testProfilePermissions.get(userId)?.[permissionCode] ?? defaultScopeFor(roleCode, permissionCode);
  }
  const scopes = await memoizeInRequest(`permission-scopes:${userId}`, () => loadPermissionScopes(userId));
  return scopes?.get(permissionCode) ?? null;
}

/**
 * Todos los permisos habilitados del rol del usuario, con su alcance, en una consulta. `null` si
 * la cuenta o el rol no están activos. Dentro de un pedido se resuelve una sola vez
 * (`memoizeInRequest`): la matriz se sigue leyendo en vivo, pedido a pedido.
 */
async function loadPermissionScopes(userId: string): Promise<Map<string, "own" | "all"> | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isActive: true,
      isApproved: true,
      orgRole: {
        select: {
          active: true,
          grants: {
            where: { enabled: true },
            select: { scope: true, permission: { select: { code: true } } },
          },
        },
      },
    },
  });
  if (!user?.isActive || !user.isApproved || !user.orgRole?.active) return null;
  const scopes = new Map<string, "own" | "all">();
  for (const grant of user.orgRole.grants) {
    // Con un grant ALL y otro OWN para el mismo permiso, gana ALL.
    if (grant.scope === "ALL") scopes.set(grant.permission.code, "all");
    else if (!scopes.has(grant.permission.code)) scopes.set(grant.permission.code, "own");
  }
  return scopes;
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
