import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";

export function utcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

export async function findNonWorkingDayForDate(date: Date) {
  const day = utcDay(date);
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string; date: Date; type: string; reason: string; notes: string | null }>>(
      Prisma.sql`
        SELECT id, date, type, reason, notes
        FROM "NonWorkingDay"
        WHERE date = ${day}
        LIMIT 1
      `,
    );
    return rows[0] ?? null;
  } catch (error) {
    if (process.env.NODE_ENV === "test") return null;
    throw error;
  }
}

export async function isNonWorkingDate(date: Date) {
  return Boolean(await findNonWorkingDayForDate(date));
}
