export type JwtPayload = { sub: string; id?: string; role: string; email: string };

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}
