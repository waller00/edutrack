ALTER TABLE "SystemSettings"
ADD COLUMN IF NOT EXISTS "institutionTimezone" TEXT NOT NULL DEFAULT 'America/Montevideo';
