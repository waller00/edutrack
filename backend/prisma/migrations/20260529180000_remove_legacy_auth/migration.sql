-- Elimina tablas y columnas del auth legacy (JWT, 2FA, reset por token propio).

DROP TABLE IF EXISTS "TwoFactorBackupCode";
DROP TABLE IF EXISTS "PasswordReset";
DROP TABLE IF EXISTS "RefreshToken";

ALTER TABLE "User" DROP COLUMN IF EXISTS "passwordHash";
ALTER TABLE "User" DROP COLUMN IF EXISTS "twoFactorEnabled";
ALTER TABLE "User" DROP COLUMN IF EXISTS "twoFactorSecret";
ALTER TABLE "User" DROP COLUMN IF EXISTS "twoFactorConfirmedAt";
