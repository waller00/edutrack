-- Production 2FA recovery-code storage:
-- one hashed, single-use row per recovery code instead of a JSON blob on User.
CREATE TABLE "TwoFactorBackupCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TwoFactorBackupCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TwoFactorBackupCode_userId_codeHash_key" ON "TwoFactorBackupCode"("userId", "codeHash");
CREATE INDEX "TwoFactorBackupCode_userId_usedAt_idx" ON "TwoFactorBackupCode"("userId", "usedAt");

ALTER TABLE "TwoFactorBackupCode"
ADD CONSTRAINT "TwoFactorBackupCode_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User" DROP COLUMN IF EXISTS "twoFactorBackupCodes";
