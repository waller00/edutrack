export type JwtPayload = {
  sub: string;
  id?: string;
  role: string;
  email: string;
  /**
   * Sólo tests: permisos que se SUMAN a la matriz de fábrica del rol, para modelar un perfil a medida
   * (p. ej. un docente al que administración le dio editar sus eventos).
   */
  permissions?: Record<string, "own" | "all">;
};

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}
